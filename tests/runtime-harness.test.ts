import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ForemanDatabase } from '../src/main/storage/database'
import { DeliveryService } from '../src/main/delivery'
import type { AgentExecutor, ExecuteRequest } from '../src/main/executors/types'
import type { RoleConfig } from '../src/shared/contracts'
import { recoveryFixture, reopenRecoveryFixture } from './helpers/recovery'
import { realCliHarness } from './helpers/real-cli-crash'

type Session = {
  root: string; id: string; databasePath: string; model: string; kind: 'codex' | 'claude' | 'zcode'
  fault: 'before-call' | 'process-termination'; phase: 'initial' | 'recovering' | 'passed'
  injected: boolean; processTerminated: boolean; processRejected: boolean
  calls: Array<{ step: string; at: string }>
  waits: Array<{ at: string; until: string; source: string }>
  resumeAfter?: number; outcome?: Record<string, unknown>
}

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))
const throttled = (value: string) => /\b429\b|too many requests|请求限流/i.test(value)
function retrySeconds(value: string): number {
  const seconds = Number(value.match(/retrying[^\n]*?\bin\s+(\d+(?:\.\d+)?)s\b/i)?.[1] ?? value.match(/约\s*(\d+)\s*秒/)?.[1] ?? 60)
  return Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : 60
}

// Opt-in only. Persist the fixture and journal so a throttled run can be resumed.
describe.skipIf(!process.env.FOREMAN_REAL_HARNESS)('real CLI recovery acceptance', () => {
  it.each(['before-call', 'process-termination'] as const)('recovers after %s using real CLI results, verification and review', async (fault) => {
    const kind = process.env.FOREMAN_REAL_HARNESS
    if (kind !== 'codex' && kind !== 'claude' && kind !== 'zcode') throw new Error('Unsupported harness')
    const model = process.env.FOREMAN_HARNESS_MODEL
    if (!model) throw new Error('FOREMAN_HARNESS_MODEL is required')
    const actual = realCliHarness(kind)
    const registryKind = actual.kind
    const probe = await actual.probe()
    expect(probe.installed, 'CLI must be installed').toBe(true)
    if (kind !== 'zcode') expect(probe.authenticated, 'CLI must already be authenticated').toBe(true)
    const reportDir = resolve(process.env.FOREMAN_HARNESS_REPORT_DIR ?? join(tmpdir(), 'foreman-live-' + Date.now()))
    mkdirSync(reportDir, { recursive: true })
    const journal = join(reportDir, fault + '.json')
    const saved: Session | undefined = existsSync(journal) ? JSON.parse(readFileSync(journal, 'utf8')) : undefined
    if (saved && (saved.kind !== kind || saved.model !== model || saved.fault !== fault)) throw new Error('Journal model or harness mismatch')
    const f = saved ? reopenRecoveryFixture(saved.root, saved.id) : await recoveryFixture()
    const session: Session = saved ?? { root: f.root, id: f.id, databasePath: f.databasePath, kind, model, fault, phase: 'initial',
      injected: false, processTerminated: false, processRejected: false, calls: [], waits: [] }
    let orchestrator = f.createOrchestrator(actual)
    let pausing: Promise<void> | undefined
    let lastHeartbeat = 0
    let lastState = ''
    const sourceHashes: Record<string, string> = {}
    for (const file of ['src/main/run-recovery.ts', 'src/main/orchestrator.ts', 'src/main/model-runtime.ts', 'src/main/executors/process-executor.ts', 'tests/runtime-harness.test.ts', 'tests/helpers/recovery.ts', 'tests/helpers/real-cli-crash.ts', 'tests/helpers/zcode-native.ts', 'src/main/executors/zcode.ts', 'src/shared/executors.ts', 'src/shared/contracts.ts']) {
      sourceHashes[file] = createHash('sha256').update(readFileSync(file)).digest('hex')
    }
    function checkpoint(event: string) {
      const run = f.read()
      const snapshot = { ...session, event, updatedAt: new Date().toISOString(), version: probe.version, platform: process.platform,
        sourceHashes, runStatus: run.status, checkpointPhase: run.checkpointPhase, pauseReason: run.pauseReason,
        steps: run.agentTasks?.map((task) => ({ stepId: task.stepId, status: task.status, attempt: task.attempt, commit: task.commit, workspace: task.workspace })),
        verification: run.verification, reviewer: run.reviewDecision, delivery: run.deliveryEvidence,
        contract: run.contract, reviewAttempt: run.reviewAttempt, maxReviewLoops: f.db.getSettings().maxReviewLoops,
        nativeObservations: 'observations' in actual ? actual.observations : undefined }
      writeFileSync(journal + '.tmp', JSON.stringify(snapshot, null, 2) + '\n')
      renameSync(journal + '.tmp', journal)
    }
    function waitForLimit(seconds: number, source: string) {
      const until = Date.now() + seconds * 1000 + 2000
      if ((session.resumeAfter ?? 0) >= until - 3000) return
      session.resumeAfter = until
      session.waits.push({ at: new Date().toISOString(), until: new Date(until).toISOString(), source })
      checkpoint('waiting-for-rate-limit')
      console.log(JSON.stringify({ event: 'waiting-for-rate-limit', fault, retryAt: new Date(until).toISOString(), seconds, journal }))
    }
    const executor: AgentExecutor = {
      kind: registryKind, probe: () => actual.probe(), preflight: (request) => actual.preflight(request), cancel: (id) => actual.cancel(id),
      async execute(request: ExecuteRequest) {
        const step = request.role === 'implementer' ? request.prompt.match(/只负责步骤 (\w+)/)?.[1] ?? 'implementer' : request.role
        session.calls.push({ step, at: new Date().toISOString() }); checkpoint('model-call-' + step)
        const crashThisCall = step === 'c' && !session.injected && fault === 'process-termination'
        if (step === 'c' && !session.injected) {
          session.injected = true; checkpoint('injecting-' + fault)
          if (fault === 'before-call') throw new Error('Harness fault injection: connection interrupted before step c model call')
        }
        try {
          return await actual.execute({ ...request, emit(event) {
            request.emit(event)
            if (crashThisCall && !session.processTerminated && event.kind === 'stdout') {
              session.processTerminated = actual.crash(request.runId); checkpoint('crash-signal-sent')
            }
            if (event.kind === 'stderr' && throttled(event.message) && !pausing) {
              waitForLimit(retrySeconds(event.message), 'actual-model-call')
              pausing = orchestrator.pause(f.id).finally(() => { pausing = undefined })
              void pausing.catch(() => {})
            }
          } })
        } catch (error) {
          if (crashThisCall && session.processTerminated) { session.processRejected = true; checkpoint('crashed-process-rejected') }
          throw error
        }
      }
    }
    orchestrator = f.createOrchestrator(executor)
    const deadline = Date.now() + 55 * 60_000
    async function settled() {
      while (Date.now() < deadline) {
        const run = f.read()
        const state = run.status + ':' + JSON.stringify(run.agentTasks?.map((task) => [task.stepId, task.status, task.attempt]))
        if (state !== lastState || Date.now() - lastHeartbeat > 30_000) {
          checkpoint('progress'); lastState = state; lastHeartbeat = Date.now()
        }
        if (run.status === 'paused') {
          if (run.pauseReason === 'preflight' && !session.resumeAfter) {
            if (!throttled(run.error ?? '')) throw new Error(run.error || 'Unexpected preflight pause')
            waitForLimit(retrySeconds(run.error ?? ''), 'model-preflight')
          }
          if (!session.resumeAfter) throw new Error(run.error || 'Unexpected pause without a retry time')
          while (Date.now() < session.resumeAfter && Date.now() < deadline) await pause(Math.min(30_000, session.resumeAfter - Date.now()))
          if (Date.now() >= deadline) break
          if (pausing) await pausing
          try { orchestrator.resume(f.id); delete session.resumeAfter; checkpoint('resumed-after-rate-limit') }
          catch (error) {
            if (!(error instanceof Error) || !error.message.includes('已经在运行')) throw error
            await pause(1000)
          }
          continue
        }
        if (['failed', 'completed', 'awaiting_review_approval'].includes(run.status)) return run
        await pause(250)
      }
      throw new Error('Live acceptance time limit reached; fixture retained at ' + f.root)
    }
    try {
      if (session.phase === 'passed') {
        expect(f.read().resolution).toBe('merged')
        console.log(JSON.stringify({ result: 'already-verified', fault, journal, ...session.outcome }))
        return
      }
      if (!saved) {
        const role: RoleConfig = { ...f.settings.roles.implementer, executor: registryKind, model, effort: kind === 'zcode' ? 'default' : 'low' }
        for (const key of ['planner', 'implementer', 'reviewer'] as const) f.settings.roles[key] = { ...f.settings.roles[key], executor: registryKind, model, effort: kind === 'zcode' ? 'default' : 'low' }
        f.settings.execution = { maxParallelAgents: 2, agents: [role] }; f.db.saveSettings(f.settings); f.db.updateRun(f.id, { executionPolicy: f.settings.execution })
        f.settings.maxReviewLoops = 2; f.db.saveSettings(f.settings)
        checkpoint('created'); orchestrator.approve(f.id)
      } else if (f.read().status === 'paused' && !session.resumeAfter) orchestrator.resume(f.id)
      if (session.phase === 'initial') {
        const failed = await settled()
        expect(failed.status, failed.error).toBe('failed')
        if (fault === 'before-call') expect(failed.failure?.message).toContain('Harness fault injection')
        else { expect(session.processTerminated).toBe(true); expect(session.processRejected).toBe(true) }
        expect(failed.agentTasks!.map((task) => task.status)).toEqual(['integrated', 'integrated', 'failed'])
        session.phase = 'recovering'; checkpoint('expected-failure-confirmed')
        const reopened = new ForemanDatabase(f.databasePath, f.root)
        orchestrator = f.createOrchestrator(executor, reopened)
        const plan = await orchestrator.getRecovery(f.id); expect(plan.available, plan.reason).toBe(true)
        await orchestrator.recover(f.id, plan.failureAt!)
      } else if (f.read().status === 'failed') {
        const plan = await orchestrator.getRecovery(f.id); expect(plan.available, plan.reason).toBe(true)
        await orchestrator.recover(f.id, plan.failureAt!)
      }
      const done = await settled()
      if (done.status === 'awaiting_review_approval' && done.reviewDecision?.verdict === 'approved') await orchestrator.command(f.id, { type: 'approve_review' })
      expect(f.read().status, f.read().error).toBe('completed')
      expect(f.read().verification?.status).toBe('passed'); expect(f.read().reviewDecision?.verdict).toBe('approved')
      expect(session.calls.filter((call) => call.step === 'a')).toHaveLength(1)
      expect(session.calls.filter((call) => call.step === 'b')).toHaveLength(1)
      expect(session.calls.filter((call) => call.step === 'c').length).toBeGreaterThanOrEqual(2)
      expect(session.calls.filter((call) => call.step === 'planner')).toHaveLength(0)
      expect(f.db.listRuns()).toHaveLength(1)
      const merged = await new DeliveryService(f.db, f.manager, () => {}).merge(f.id)
      expect(merged.resolution).toBe('merged')
      const files: Record<string, string> = {}
      for (const id of ['a', 'b', 'c']) { const value = readFileSync(join(f.root, id + '.txt'), 'utf8'); expect(value).toBe(id); files[id + '.txt'] = createHash('sha256').update(value).digest('hex') }
      session.phase = 'passed'
      session.outcome = { recoveredSameRun: true, verification: f.read().verification?.status, review: f.read().reviewDecision?.verdict,
        merged: true, commit: merged.deliveryEvidence?.commit, processTerminated: session.processTerminated, processRejected: session.processRejected,
        attempts: f.read().agentTasks?.map((task) => ({ stepId: task.stepId, attempt: task.attempt })), files }
      checkpoint('passed')
      console.log(JSON.stringify({ result: 'passed', harness: kind, version: probe.version, model, platform: process.platform, fault, journal, ...session.outcome }))
    } catch (error) {
      orchestrator.shutdown(); checkpoint('incomplete-fixture-retained')
      console.log(JSON.stringify({ result: 'incomplete', fault, journal, root: f.root, phase: session.phase, runStatus: f.read().status }))
      throw error
    } finally { orchestrator.shutdown() }
  }, 60 * 60_000)
})
