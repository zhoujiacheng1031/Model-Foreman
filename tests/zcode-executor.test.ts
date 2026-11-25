import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ZcodeExecutor, resolveZcodeLaunch, type ZcodeLaunch } from '../src/main/executors/zcode'
import { ExecutorRegistry } from '../src/main/executors/registry'
import { ModelRuntimeGate } from '../src/main/model-runtime'
import { ForemanDatabase, defaultSettings } from '../src/main/storage/database'
import { appSettingsSchema } from '../src/main/validation'
import { executorReadiness, modelReadiness } from '../src/renderer/src/runtime-readiness'
import { buildModelCapabilityTargets } from '../src/renderer/src/model-capabilities'
import type { ExecuteRequest } from '../src/main/executors/types'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'foreman-zcode-')); directories.push(root)
  const script = join(root, 'cli.cjs'); const log = join(root, 'args.json')
  await writeFile(script, `const fs=require('fs'); const args=process.argv.slice(2);
if(args.includes('--version')) {console.log('0.18.0');process.exit(0)}
fs.writeFileSync(process.env.ARG_LOG,JSON.stringify({args,cwd:process.cwd()}));
if(process.env.FAIL_RESULT) console.log(JSON.stringify({sessionId:'sess_test',response:'bad',projection:{status:'error'}}));
else {console.log(JSON.stringify({type:'turn.started',sessionId:'sess_test'}));console.log(JSON.stringify({type:'result',sessionId:'sess_test',response:'OK',usage:{inputTokens:12,outputTokens:4}}));}
`)
  const launch: ZcodeLaunch = { command: process.execPath, args: [script], executable: script, environment: { ARG_LOG: log } }
  const request: ExecuteRequest = { runId: 'r', role: 'implementer', model: 'native-default', effort: 'default', prompt: 'task', workspace: root, emit() {} }
  return { root, log, launch, request, executor: new ZcodeExecutor(() => launch) }
}

describe('ZCode product executor', () => {
  it('locates the desktop bundle without relying on a shell or transferring credentials', () => {
    const bundle = '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs'
    const launch = resolveZcodeLaunch({ env: { HOME: '/absent', PATH: '/absent' }, home: '/absent', platform: 'darwin', node: '/runtime/node', exists: (file) => file === bundle || file.endsWith('zcode-builtin.json') })
    expect(launch).toMatchObject({ command: '/runtime/node', args: [bundle], executable: bundle, environment: { ELECTRON_RUN_AS_NODE: '1', ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: '/absent/.zcode/v2/provider_config.json', ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: '/Applications/ZCode.app/Contents/Resources/config/provider/zcode-builtin.json' } })
    expect(Object.keys(launch.environment).some((key) => /api.key|token/i.test(key))).toBe(false)
  })

  it('supports explicit standalone paths and preserves native configuration overrides', () => {
    const launch = resolveZcodeLaunch({ env: { FOREMAN_ZCODE_PATH: '/runtime/zcode.cjs', ZCODE_DATA_BASE_DIR: '/native-data', ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: '/custom/builtin.json', ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: '/custom/personal.json' }, exists: () => true })
    expect(launch.environment).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
    expect(launch.args).toEqual(['/runtime/zcode.cjs'])
    expect(() => resolveZcodeLaunch({ env: { FOREMAN_ZCODE_PATH: 'relative/zcode' }, exists: () => true })).toThrow('绝对路径')
    const windows = resolveZcodeLaunch({ env: { FOREMAN_ZCODE_PATH: 'C:\\Tools\\zcode.exe', OS: 'Windows_NT' }, platform: 'win32', exists: () => true })
    expect(windows).toMatchObject({ command: 'C:\\Tools\\zcode.exe', args: [] })
  })

  it('reports installation separately from unverified authentication', async () => {
    const { executor } = await fixture()
    const probe = await executor.probe()
    expect(probe).toMatchObject({ installed: true, version: '0.18.0' })
    expect('authenticated' in probe && probe.authenticated).not.toBe(true)
    expect(executorReadiness('zcode', [{ ...probe, kind: 'zcode', authenticationMessage: probe.authenticationMessage ?? '' }])).toMatchObject({ state: 'pending', label: '已安装 · 待预检' })
  })

  it.each(['planner', 'implementer', 'reviewer'] as const)('launches %s with the correct permission mode and parses final output and usage', async (role) => {
    const { executor, request, log, root } = await fixture()
    const result = await executor.execute({ ...request, role })
    expect(result).toMatchObject({ output: 'OK', usage: { inputTokens: 12, outputTokens: 4 }, sessionId: 'sess_test' })
    const invocation = JSON.parse(await readFile(log, 'utf8'))
    expect(invocation.cwd).toBe(await realpath(root))
    expect(invocation.args).toEqual(expect.arrayContaining(['--cwd', root, '--mode', role === 'implementer' ? 'yolo' : 'plan', '--output-format', 'stream-json']))
    expect(invocation.args).not.toContain('--model')
    expect(invocation.args).not.toContain('--effort')
  })

  it('rejects a requested model or effort that the native CLI cannot select', async () => {
    const { executor, request } = await fixture()
    await expect(executor.execute({ ...request, model: 'glm-5.3' })).rejects.toThrow('Unsupported model')
    await expect(executor.preflight({ ...request, effort: 'high' })).rejects.toThrow('Unsupported effort')
  })

  it('validates the native result even on exit 0, both during preflight and execution', async () => {
    const { executor, launch, request } = await fixture()
    launch.environment.FAIL_RESULT = '1'
    await expect(executor.preflight({ ...request, effort: 'default' })).rejects.toThrow('失败或中断')
    await expect(executor.execute(request)).rejects.toThrow('失败或中断')
  })

  it('scans only native defaults and rechecks after native configuration could have changed', async () => {
    const { executor, request } = await fixture()
    const gate = new ModelRuntimeGate(new ExecutorRegistry([executor]))
    const config = { executor: 'zcode' as const, model: request.model, effort: 'default' as const }
    const scan = await gate.scan([{ ...config, role: 'planner' }, { ...config, role: 'reviewer' }], request.workspace)
    expect(scan.models[0]).toMatchObject({ supportedEfforts: ['default'], availability: 'available', roles: ['planner', 'reviewer'] })
    expect(scan.models[0].checks).toHaveLength(1)
    expect(scan.models[0].message).toContain('原生')
    expect((await gate.check(config, request.workspace)).cached).toBe(false)
    const probe = await executor.probe()
    const readiness = modelReadiness(defaultSettings(request.workspace), [{ kind: 'zcode', ...probe, authenticationMessage: probe.authenticationMessage ?? '' }], scan, 'zcode', request.model)
    expect(readiness.label).toBe('上次检测通过')
  })

  it('migrates pre-ZCode settings and validates native defaults for roles and parallel members', async () => {
    const { root } = await fixture(); const db = new ForemanDatabase(join(root, 'db.sqlite'), root)
    const old = defaultSettings(root)
    // Simulate an existing serialized catalog from a version without ZCode.
    const { zcode: _unused, ...legacyModels } = old.models
    db.saveSettings(JSON.parse(JSON.stringify({ ...old, models: legacyModels })))
    const settings = db.getSettings()
    settings.roles.implementer = { ...settings.roles.implementer, executor: 'zcode', model: 'native-default', effort: 'default' }
    settings.execution = { maxParallelAgents: 2, agents: [settings.roles.implementer] }
    expect(appSettingsSchema.safeParse(settings).success).toBe(true)
    expect(buildModelCapabilityTargets(settings)).toContainEqual(expect.objectContaining({ executor: 'zcode', model: 'native-default' }))
    settings.roles.implementer.effort = 'high'
    expect(appSettingsSchema.safeParse(settings).success).toBe(false)
  })
})
