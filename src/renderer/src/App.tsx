import { ParallelSettings, AgentTaskPanel } from './parallel-agents'
import { WorkflowOverview } from './workflow-overview'
import { filterRuns, initialRunTab, runCategory, runFilters, runStatusClass, runStatusLabel, type RunFilter, type RunDetailTab } from './run-presentation'
import { ExecutorPicker, ExecutorLogo } from './executor-picker'
import { ConnectorsView } from './connectors'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, Bot, Brain, Check, ChevronDown, ChevronRight, CircleStop, Cpu, FolderGit2,
  FileDiff, FolderOpen, Gauge, GitMerge, LayoutDashboard, LoaderCircle, Play, Plus,
  Monitor, PanelLeftClose, PanelLeftOpen, Pause, Puzzle, RefreshCw, RotateCcw, Save, Settings2, ShieldCheck, Sparkles, Target, TerminalSquare, Trash2, X,
  Github, GitBranch, CloudDownload, ExternalLink, GitPullRequest, Workflow, History, Search
} from 'lucide-react'
import type {
  AgentEnvironment, AppSettings, DeliveryGuide, DeliveryGuideAction, Effort, ExecutorCapability, ExecutorKind, GitHubDeliveryStatus, GoalCommand, GoalDetail, GoalSummary, GoalStatus, GoalTaskStatus, MemoryEntry, MemoryProviderHealth, MemoryStats, ModelCapabilityScan, ModelDefinition, ModelRuntimeStatus, RoleConfig, TencentDbSetupResult,
  GitOperationPlan, RepositoryInspection, RoleKey, RunCommand, RunEvent, RunStageMetric, RunStatus, RunSummary, WorkspaceInspection
} from '../../shared/contracts'
import foremanIcon from './assets/foreman-line-cat-icon.png'
import { executorLabel, effortLabel, modelLabel } from '../../shared/executors'
import { buildModelCapabilityTargets, selectableModelCatalog, customModelIsComplete, mergeConnectorScan } from './model-capabilities'
import { defaultGoalBudget, goalBudgetError, goalBudgetInput, GoalBudgetFields, type GoalBudget } from './goal-budget'
import { executorReadiness, modelReadiness } from './runtime-readiness'
import { ContractSummary, RunOverview } from './run-artifacts'
import { MemoryCurationDialog, MemoryApprovalDialog, needsMemoryCuration } from './memory-curation'
import type { TaskDraft } from './task-draft'
import { useWorkspaceDocuments, hasDraftContent, MAX_WORKSPACE_TABS, tabLimitMessage, type WorkspaceDocuments } from './workspace-documents'
import { WorkspaceTabs, workspaceTabId } from './workspace-tabs'
import { TaskProgress } from './task-progress'
import { ProjectHeading } from './project-heading'
import { RunRecoveryDialog } from './run-recovery'
import type { RunRecoveryPlan } from '../../shared/contracts'
import { settingsGroups, readRecentWorkspaces, type SettingsSection } from './settings-navigation'

type View = 'workbench' | 'runs' | 'goals' | 'memory' | 'settings'

const goalStatusLabel: Record<GoalStatus, string> = { active: '进行中', waiting_approval: '等待批准', paused: '已暂停', blocked: '已阻塞', completed: '已完成', failed: '失败', cancelled: '已取消' }
const goalTaskStatusLabel: Record<GoalTaskStatus, string> = { pending: '等待依赖', ready: '待执行', running: '执行中', waiting_approval: '等待批准', completed: '已完成', failed: '失败', blocked: '已阻塞', invalidated: '已失效' }

const roleMeta: Record<RoleKey, { label: string; eyebrow: string; index: string }> = {
  planner: { label: '规划者', eyebrow: 'PLAN', index: '01' },
  implementer: { label: '执行者', eyebrow: 'BUILD', index: '02' },
  reviewer: { label: '审核者', eyebrow: 'REVIEW', index: '03' }
}

export function App() {
  const [view, setView] = useState<View>('workbench')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showRepository, setShowRepository] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('settings-connectors')
  const [recentWorkspaces, setRecentWorkspaces] = useState(() => readRecentWorkspaces(window.localStorage))
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [capabilities, setCapabilities] = useState<ExecutorCapability[]>([])
  const [agentEnvironment, setAgentEnvironment] = useState<AgentEnvironment>({ desktops: [], skills: [], scannedAt: '' })
  const [repository, setRepository] = useState<RepositoryInspection>({ connected: false, hasCommits: false, bootstrapEligible: false, workspace: '', detached: false, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, conflicts: 0, clean: false, branches: [], message: '正在检查仓库…' })
  const [githubDelivery, setGithubDelivery] = useState<GitHubDeliveryStatus>({ available: false, authenticated: false, workflowRuns: [], polledAt: '', message: '正在检查 GitHub 交付状态…' })
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [events, setEvents] = useState<RunEvent[]>([])
  const documents = useWorkspaceDocuments(settings?.workspace ?? '')
  const { draft, update: updateDraft, saveError: draftSaveError } = documents
  const selectedId = documents.active?.kind === 'run' ? documents.active.runId : undefined
  const workbenchTab = documents.active?.kind ?? 'empty'
  const { title, objective } = draft
  const [notice, setNotice] = useState('')
  const [inspection, setInspection] = useState<WorkspaceInspection | null>(null)
  const [deliveryGuide, setDeliveryGuide] = useState<DeliveryGuide | null>(null)
  const [gitOperationPlan, setGitOperationPlan] = useState<GitOperationPlan | null>(null)
  const [busy, setBusy] = useState<string>()
  const [actionError, setActionError] = useState('')
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [memoryStats, setMemoryStats] = useState<MemoryStats>({ total: 0, candidate: 0, approved: 0, stale: 0 })
  const [memoryHealth, setMemoryHealth] = useState<MemoryProviderHealth>()
  const [tencentDbSetupResult, setTencentDbSetupResult] = useState<TencentDbSetupResult>()
  const [goals, setGoals] = useState<GoalSummary[]>([])
  const [selectedGoal, setSelectedGoal] = useState<GoalDetail | null>(null)
  const [runMenu, setRunMenu] = useState<{ run: RunSummary; x: number; y: number } | null>(null)
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const [resumeTarget, setResumeTarget] = useState<RunSummary | null>(null)
  const [resumeSupplement, setResumeSupplement] = useState('')
  const [recovery, setRecovery] = useState<{ run: RunSummary; plan: RunRecoveryPlan } | null>(null)
  const projectPickerRef = useRef<HTMLDialogElement>(null)
  const workspaceRef = useRef(settings?.workspace)
  workspaceRef.current = settings?.workspace
  const runMenuRef = useRef<HTMLDivElement>(null)
  const selectedIdRef = useRef<string | undefined>(undefined)
  const selectionRequestRef = useRef(0)
  const lastSavedSettingsRef = useRef('')
  const settingsSaveSequenceRef = useRef(0)

  const selected = runs.find((run) => run.id === selectedId)
  const running = selected && ['queued', 'planning', 'implementing', 'verifying', 'reviewing'].includes(selected.status)
  const automaticApprovals = settings
    ? Number(settings.approvals.planner.autoApprove) + Number(settings.approvals.reviewer.autoApprove)
    : 0
  const sidebarProjects = useMemo(() => {
    const grouped = new Map<string, RunSummary[]>()
    for (const run of runs) grouped.set(run.workspace, [...(grouped.get(run.workspace) ?? []), run])
    for (const workspace of recentWorkspaces) if (!grouped.has(workspace)) grouped.set(workspace, [])
    if (settings?.workspace && !grouped.has(settings.workspace)) grouped.set(settings.workspace, [])
    return [...grouped].map(([workspace, tasks]) => ({ workspace, tasks: [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }))
      .sort((a, b) => a.workspace === settings?.workspace ? -1 : b.workspace === settings?.workspace ? 1 : (b.tasks[0]?.updatedAt ?? '').localeCompare(a.tasks[0]?.updatedAt ?? ''))
  }, [runs, settings?.workspace, recentWorkspaces])

  useEffect(() => {
    if (!settings?.workspace) return
    setRecentWorkspaces((current) => {
      const next = [settings.workspace, ...current.filter((path) => path !== settings.workspace)].slice(0, 20)
      try { window.localStorage.setItem('foreman:recent-workspaces', JSON.stringify(next)) } catch { /* History is optional; drafts report their own save failures. */ }
      return next
    })
  }, [settings?.workspace])

  function openSettings(section: SettingsSection) { setSettingsSection(section); setView('settings') }

  useEffect(() => {
    if (showRepository) projectPickerRef.current?.showModal()
    else projectPickerRef.current?.close()
  }, [showRepository])

  async function openRun(id: string) {
    const run = runs.find((item) => item.id === id)
    if (!run || busy) return
    const projectDocuments = documents.get(run.workspace)
    if (!projectDocuments.tabs.some((tab) => tab.id === `run:${id}`) && projectDocuments.tabs.length >= MAX_WORKSPACE_TABS) { setActionError(tabLimitMessage); return }
    if (run.workspace !== settings?.workspace) {
      const switched = await perform('choose', () => activateWorkspace(run.workspace))
      if (!switched) return
    }
    try { documents.change(run.workspace, { type: 'open-run', runId: id }); setView('workbench') }
    catch (error) { setActionError(error instanceof Error ? error.message : String(error)) }
  }

  function changeDocument(action: import('./workspace-documents').DocumentAction) {
    if (!settings) return
    try { documents.change(settings.workspace, action); setActionError('') }
    catch (error) { setActionError(error instanceof Error ? error.message : String(error)) }
  }

  function newTask() {
    if (!settings) return
    changeDocument({ type: 'new' }); setView('workbench'); setShowRepository(false)
  }

  async function refreshRuns(select?: string, includeEvents = true) {
    const next = await window.foreman.listRuns()
    setRuns(next)
    const target = select ?? selectedIdRef.current
    if (target && includeEvents && selectedIdRef.current === target) {
      const request = ++selectionRequestRef.current
      const detail = await window.foreman.getRun(target)
      if (request === selectionRequestRef.current && selectedIdRef.current === target) setEvents(detail?.events ?? [])
    }
  }

  useEffect(() => {
    void Promise.all([window.foreman.getSettings(), window.foreman.probeExecutors(), window.foreman.listRuns()])
      .then(async ([nextSettings, nextCapabilities, nextRuns]) => {
        lastSavedSettingsRef.current = JSON.stringify(nextSettings)
        setSettings(nextSettings); setCapabilities(nextCapabilities); setRuns(nextRuns)
        const [environment, repositoryState] = await Promise.all([window.foreman.inspectAgentEnvironment(nextSettings.workspace), window.foreman.inspectRepository(nextSettings.workspace)])
        setAgentEnvironment(environment); setRepository(repositoryState); void refreshGitHubDelivery(nextSettings.workspace)

      })
      .catch((error) => setActionError(error instanceof Error ? error.message : String(error)))
    return window.foreman.onRunEvent((event) => {
      setEvents((current) => event.runId === selectedIdRef.current ? [...current, event] : current)
      void refreshRuns(undefined, false)
    })
  }, [])

  useEffect(() => {
    selectedIdRef.current = selectedId
    ++selectionRequestRef.current; setEvents([]); setInspection(null)
    if (selectedId) void selectRun(selectedId)
  }, [selectedId, settings?.workspace])
  useEffect(() => {
    if (!settings) return
    const serialized = JSON.stringify(settings)
    if (!lastSavedSettingsRef.current || serialized === lastSavedSettingsRef.current) return
    const sequence = ++settingsSaveSequenceRef.current
    setNotice('正在自动保存…')
    const timer = window.setTimeout(() => {
      void window.foreman.saveSettings(settings).then(() => {
        if (sequence !== settingsSaveSequenceRef.current) return
        lastSavedSettingsRef.current = serialized
        setNotice('已自动保存')
        window.setTimeout(() => setNotice((current) => current === '已自动保存' ? '' : current), 1600)
      }).catch(() => {
        if (sequence === settingsSaveSequenceRef.current) setNotice('配置待完善，完成后自动保存')
      })
    }, 650)
    return () => window.clearTimeout(timer)
  }, [settings])
  useEffect(() => { setDeliveryGuide(null) }, [selectedId])
  useEffect(() => {
    if (!runMenu) return
    const closeOutside = (event: PointerEvent) => {
      if (!runMenuRef.current?.contains(event.target as Node)) setRunMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setRunMenu(null) }
    const closeOnResize = () => setRunMenu(null)
    window.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeOnResize)
    return () => {
      window.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeOnResize)
    }
  }, [runMenu])

  useEffect(() => { if (view === 'memory' && settings) void refreshMemories() }, [view, settings?.workspace])
  useEffect(() => {
    if (view !== 'workbench' || !settings?.workspace) return
    void refreshGitHubDelivery(settings.workspace)
    const timer = window.setInterval(() => void refreshGitHubDelivery(settings.workspace), 30_000)
    return () => window.clearInterval(timer)
  }, [view, settings?.workspace])
  useEffect(() => {
    if (view !== 'goals') return
    void refreshGoals(); const timer = window.setInterval(() => void refreshGoals(selectedGoal?.goal.id), 1500)
    return () => window.clearInterval(timer)
  }, [view, selectedGoal?.goal.id])

  async function refreshGoals(select?: string) {
    const rows = await window.foreman.listGoals(); setGoals(rows)
    const id = select ?? selectedGoal?.goal.id ?? rows[0]?.id
    setSelectedGoal(id ? await window.foreman.getGoal(id) : null)
  }
  async function createGoal(value: Parameters<typeof window.foreman.createGoal>[0]) {
    return perform('goal-create', async () => { const detail = await window.foreman.createGoal(value); setSelectedGoal(detail); await refreshGoals(detail.goal.id) })
  }
  async function commandGoal(command: GoalCommand) {
    if (!selectedGoal) return
    if (command === 'cancel' && !window.confirm('取消这个长期目标？当前任务也会停止。')) return
    await perform(`goal-${command}`, async () => { setSelectedGoal(await window.foreman.commandGoal(selectedGoal.goal.id, command)); await refreshGoals(selectedGoal.goal.id) })
  }

  async function refreshMemories() {
    if (!settings) return
    const [rows, stats, health] = await Promise.all([
      window.foreman.listMemories(), window.foreman.getMemoryStats(), window.foreman.probeMemory()
    ])
    setMemories(rows); setMemoryStats(stats); setMemoryHealth(health)
  }

  async function probeMemorySettings() {
    if (!settings) return
    await perform('memory-probe', async () => setMemoryHealth(await window.foreman.probeMemory(settings)))
  }

  async function setupTencentDbMemory() {
    if (!window.confirm('一键配置会检查 Git 与 Docker，下载 TencentDB-Agent-Memory 官方仓库，并在独立终端启动官方交互式安装器。安装器可能拉取 Docker 镜像并占用 8420、8125、8424、8096 端口。\n\n不会把 LLM 密钥保存到 Model Foreman。确认继续？')) return
    await perform('memory-tencentdb-setup', async () => {
      const result = await window.foreman.setupTencentDbMemory()
      setTencentDbSetupResult(result)
      if (!result.ok) throw new Error(result.message)
    })
  }

  async function decideMemory(id: string, decision: 'approve' | 'reject') {
    return perform(`memory-${decision}`, async () => {
      if (decision === 'approve') await window.foreman.approveMemory(id, memories.find((entry) => entry.id === id)?.version); else await window.foreman.rejectMemory(id, memories.find((entry) => entry.id === id)?.version)
      await refreshMemories()
    })
  }

  async function curateMemories(input: import('../../shared/contracts').MemoryCurationInput) {
    return perform('memory-curate', async () => { await window.foreman.curateMemories(input); await refreshMemories() })
  }

  async function forgetMemory(id: string) {
    if (!window.confirm('永久删除这条本地记忆？此操作不可恢复。')) return
    await perform('memory-forget', async () => { await window.foreman.forgetMemory(id); await refreshMemories() })
  }

  useEffect(() => {
    if (selected?.executionWorkspace && (selected.resolution ?? 'open') === 'open' &&
      ['awaiting_approval', 'awaiting_review_approval', 'completed', 'failed', 'cancelled', 'paused'].includes(selected.status)) {
      void loadInspection(selected)
    } else setInspection(null)
  }, [selected?.id, selected?.status, selected?.resolution])

  async function startRun() {
    if (!settings || !objective.trim()) return
    const submittedId = documents.active?.id
    if (!submittedId) return
    const workspace = settings.workspace
    await perform('start', async () => {
      const run = await window.foreman.startRun({
        title: title.trim() || objective.trim().slice(0, 34), objective: objective.trim(), workspace: settings.workspace
      })
      documents.change(workspace, { type: 'submitted', id: submittedId, draft, runId: run.id })
      await refreshRuns(run.id)
    })
  }

  async function startGoalFromWorkbench(successCriteria: string[], budget: GoalBudget) {
    if (!settings || !objective.trim() || !successCriteria.length) return
    const submittedId = documents.active?.id
    if (!submittedId) return
    const workspace = settings.workspace
    await perform('goal-create', async () => {
      const detail = await window.foreman.createGoal({
        title: title.trim() || objective.trim().slice(0, 40), objective: objective.trim(), workspace: settings.workspace,
        successCriteria, constraints: [], priority: 50, ...goalBudgetInput(budget)
      })
      documents.change(workspace, { type: 'submitted', id: submittedId, draft }); setSelectedGoal(detail); await refreshGoals(detail.goal.id); setView('goals')
    })
  }

  async function selectRun(id: string) {
    await perform('select', async () => {
      const request = ++selectionRequestRef.current
      const detail = await window.foreman.getRun(id)
      if (request === selectionRequestRef.current && selectedIdRef.current === id) {
        if (detail) setEvents(detail.events)
        else { documents.change(settings!.workspace, { type: 'close', id: `run:${id}` }); setActionError('任务记录已不存在，已关闭对应页签。') }
      }
    }, false)
  }

  async function refreshAgentEnvironment(workspace = settings?.workspace) {
    if (!workspace) return
    const [environment, nextCapabilities] = await Promise.all([window.foreman.inspectAgentEnvironment(workspace), window.foreman.probeExecutors()])
    setAgentEnvironment(environment); setCapabilities(nextCapabilities)
  }

  async function handoffToDesktop(kind: ExecutorKind, runId?: string) {
    if (!settings) return
    await perform(`desktop-${kind}`, async () => {
      const result = await window.foreman.handoffToDesktop(kind, selected?.executionWorkspace ?? settings.workspace, runId)
      if (!result.opened) throw new Error(result.message)
      setNotice(result.message); window.setTimeout(() => setNotice(''), 2600)
    }, false)
  }

  async function approvePlan() {
    if (!selected) return
    await perform('approve', async () => {
      await window.foreman.approvePlan(selected.id)
      await refreshRuns(selected.id)
    })
  }

  async function commandRun(command: RunCommand) {
    if (!selected) return
    await perform(`run-${command.type}`, async () => {
      await window.foreman.commandRun(selected.id, command)
      await refreshRuns(selected.id)
    })
  }

  async function updateContract(contract: import('../../shared/contracts').ExecutionContract) {
    if (!selected) return
    await perform('contract', async () => { await window.foreman.updateContract(selected.id, contract); await refreshRuns(selected.id) })
  }

  async function pauseRun() {
    if (!selected) return
    await perform('pause', async () => { await window.foreman.pauseRun(selected.id); await refreshRuns(selected.id) })
  }

  async function resumeRun() {
    if (!resumeTarget) return
    const target = resumeTarget
    await openRun(target.id)
    if (!documents.get(target.workspace).tabs.some((tab) => tab.id === `run:${target.id}`)) return
    await perform('resume', async () => {
      await window.foreman.commandRun(target.id, { type: 'resume', instructions: resumeSupplement })
      setResumeTarget(null); setResumeSupplement(''); setView('workbench'); await refreshRuns(target.id)
    })
  }

  async function loadInspection(run = selected) {
    if (!run?.executionWorkspace || (run.resolution ?? 'open') !== 'open') return
    await perform('diff', async () => setInspection(await window.foreman.inspectRun(run.id)), false)
  }

  async function mergeRun() {
    if (!selected) return
    await perform('delivery-guide', async () => setDeliveryGuide(await window.foreman.getDeliveryGuide(selected.id)), false)
  }

  async function executeDeliveryStep(action: DeliveryGuideAction) {
    if (!selected) return
    const confirmations: Partial<Record<DeliveryGuideAction, string>> = {
      merge_branch: '将任务提交 fast-forward 合并到源项目？',
      cleanup: '确认恢复已有改动并完成合并后，清理 Foreman 隔离工作区与任务分支？'
    }
    if (confirmations[action] && !window.confirm(confirmations[action])) return
    await perform(`delivery-${action}`, async () => {
      const result = await window.foreman.executeDeliveryStep(selected.id, action)
      if ('steps' in result) setDeliveryGuide(result)
      else {
        setDeliveryGuide(null); setInspection(null); await refreshRuns(selected.id); await refreshRepository()
      }
    })
  }

  async function advanceLocalDelivery(automatic = false) {
    if (!selected) return
    if (automatic && !window.confirm('安全自动推进会依次保护源改动、创建任务提交、快进合并、恢复源改动并清理 Foreman worktree。\n\n不会执行 force、不会丢弃已有改动，也不会自动推送 GitHub。确认继续？')) return
    await perform(automatic ? 'delivery-auto' : 'delivery-next', async () => {
      let guide = deliveryGuide ?? await window.foreman.getDeliveryGuide(selected.id)
      setDeliveryGuide(guide)
      while (true) {
        const next = guide.steps.find((step) => step.status === 'ready' && step.actionLabel)
        if (!next) return
        if (!automatic && (next.key === 'merge_branch' || next.key === 'cleanup') && !window.confirm(next.key === 'merge_branch' ? '将任务提交 fast-forward 合并到源项目？' : '确认恢复已有改动并清理 Foreman 隔离工作区与任务分支？')) return
        const result = await window.foreman.executeDeliveryStep(selected.id, next.key)
        if ('steps' in result) {
          guide = result
          setDeliveryGuide(result)
          if (!automatic) return
          continue
        }
        setDeliveryGuide(null); setInspection(null)
        await refreshRuns(selected.id); await refreshRepository()
        return
      }
    })
  }

  async function refreshDeliveryGuide() {
    if (!selected) return
    await perform('delivery-refresh', async () => setDeliveryGuide(await window.foreman.getDeliveryGuide(selected.id)), false)
  }

  async function previewRepositoryPush() {
    if (!settings?.workspace) return
    await perform('git-push-preview', async () => {
      setGitOperationPlan(await window.foreman.planGitOperation(settings.workspace, 'push'))
    })
  }

  async function previewRepositoryPublish(remoteUrl?: string) {
    if (!settings?.workspace) return
    await perform('git-publish-preview', async () => {
      setGitOperationPlan(await window.foreman.planGitOperation(settings.workspace, 'publish', remoteUrl))
    })
  }

  async function executeRepositoryPush(confirmation: string) {
    if (!gitOperationPlan) return
    await perform('git-push-execute', async () => {
      const result = await window.foreman.executeGitOperation(gitOperationPlan.id, confirmation)
      setRepository(result.repository); setGitOperationPlan(null)
      await refreshGitHubDelivery(result.repository.root ?? settings?.workspace ?? '')
    })
  }

  async function discardRun() {
    if (!selected || !window.confirm(`确定放弃“${selected.title}”？\n\n这会永久删除该任务 worktree 中的改动和 ${selected.branch} 分支。`)) return
    await perform('discard', async () => {
      await window.foreman.discardRun(selected.id)
      setInspection(null)
      await refreshRuns(selected.id)
    })
  }

  async function retryRun(target = selected) {
    if (!target || target.status !== 'failed') return
    if (documents.get(target.workspace).tabs.length >= MAX_WORKSPACE_TABS) { setActionError(tabLimitMessage); return }
    if (target.workspace !== settings?.workspace) { const switched = await perform('choose', () => activateWorkspace(target.workspace)); if (!switched) return }
    await perform('retry-run', async () => {
      const retried = await window.foreman.retryRun(target.id)
      documents.change(target.workspace, { type: 'open-run', runId: retried.id }); setView('workbench')
      setInspection(null)
      setEvents([])
      await refreshRuns(retried.id)
    })
  }

  async function inspectRecovery(target = selected) {
    if (!target || target.status !== 'failed') return
    await perform('recovery-check', async () => {
      const plan = await window.foreman.getRunRecovery(target.id)
      setRecovery({ run: target, plan })
    }, false)
  }

  async function recoverRun() {
    if (!recovery?.plan.available || !recovery.plan.failureAt) return
    const { run, plan } = recovery
    await openRun(run.id)
    if (!documents.get(run.workspace).tabs.some((tab) => tab.id === `run:${run.id}`)) return
    await perform('recover-run', async () => {
      await window.foreman.recoverRun(run.id, plan.failureAt!)
      setRecovery(null); setInspection(null); setView('workbench')
      await refreshRuns(run.id)
    })
  }

  async function deleteRun(target = selected) {
    if (!target || ['queued', 'planning', 'implementing', 'verifying', 'reviewing'].includes(target.status)) return
    const scope = target.executionWorkspace
      ? `\n\n这会先清理 Foreman 创建的隔离 worktree 与 ${target.branch ?? '任务'} 分支，再永久删除运行记录和日志。`
      : '\n\n这会永久删除运行记录和日志。'
    if (!window.confirm(`确定删除任务“${target.title}”？${scope}`)) return
    await perform('delete-run', async () => {
      await window.foreman.deleteRun(target.id)
      documents.change(target.workspace, { type: 'close', id: `run:${target.id}` })
      setInspection(null)
      setEvents([])
      const next = await window.foreman.listRuns()
      setRuns(next)

    })
  }

  async function cancelRun() {
    if (!selected) return
    await perform('cancel', async () => {
      await window.foreman.cancelRun(selected.id)
      await refreshRuns(selected.id)
    })
  }

  async function activateWorkspace(path: string, inspected?: RepositoryInspection) {
    if (!settings) return
    const [repositoryState, environment] = await Promise.all([inspected ?? window.foreman.inspectRepository(path), window.foreman.inspectAgentEnvironment(path)])
    const workspace = repositoryState.root ?? path
    const nextSettings = await window.foreman.saveSettings({ ...settings, workspace })
    workspaceRef.current = workspace
    ++settingsSaveSequenceRef.current
    lastSavedSettingsRef.current = JSON.stringify(nextSettings)
    setRepository(repositoryState); setAgentEnvironment(environment); setSettings(nextSettings)
    setGitOperationPlan(null); setDeliveryGuide(null); setInspection(null)
    setGithubDelivery({ available: false, authenticated: false, workflowRuns: [], polledAt: '', message: '正在检查 GitHub 交付状态…' })
    setShowRepository(false); setView('workbench')
    void refreshGitHubDelivery(workspace)
  }

  async function switchWorkspace(path: string) {
    if (busy) return
    await perform('choose', () => activateWorkspace(path))
  }

  async function chooseWorkspace() {
    if (!settings || busy) return
    await perform('choose', async () => {
      const path = await window.foreman.chooseWorkspace()
      if (path) await activateWorkspace(path)
    })
  }

  async function cloneGitHubRepository(url: string) {
    if (!settings || busy) return
    await perform('clone-github', async () => {
      const repositoryState = await window.foreman.cloneGitHubRepository(url)
      if (repositoryState) await activateWorkspace(repositoryState.root ?? repositoryState.workspace, repositoryState)
    })
  }

  async function refreshRepository(workspace = settings?.workspace) {
    if (!workspace) return
    await perform('repository', async () => {
      const [repositoryState, delivery] = await Promise.all([window.foreman.inspectRepository(workspace), window.foreman.inspectGitHubDelivery(workspace)])
      setRepository(repositoryState); setGithubDelivery(delivery)
    }, false)
  }

  async function refreshGitHubDelivery(workspace = settings?.workspace) {
    if (!workspace) return
    try { const status = await window.foreman.inspectGitHubDelivery(workspace); if (workspaceRef.current === workspace) setGithubDelivery(status) }
    catch (error) { if (workspaceRef.current === workspace) setGithubDelivery({ available: false, authenticated: false, workflowRuns: [], polledAt: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) }) }
  }

  async function openRepositoryRemote(url = repository.remoteWebUrl) {
    if (!url) return
    await perform('repository-remote', async () => { await window.foreman.openRepositoryRemote(url) }, false)
  }

  async function openWorkspace() {
    const workspace = selected && (selected.resolution ?? 'open') === 'open' ? selected.executionWorkspace ?? selected.workspace : selected?.workspace ?? settings?.workspace
    if (!workspace) return
    await perform('open', async () => {
      const error = await window.foreman.openWorkspace(workspace)
      if (error) throw new Error(error)
    }, false)
  }

  async function openTerminal() {
    if (!settings?.workspace) return
    await perform('terminal', async () => {
      const error = await window.foreman.openTerminal(settings.workspace)
      if (error) throw new Error(error)
    }, false)
  }

  function openWorkflowSettings() {
    openSettings('role-workflow-settings')
  }

  async function perform(name: string, action: () => Promise<void>, showBusy = true) {
    setActionError('')
    if (showBusy) setBusy(name)
    try { await action(); return true }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setActionError(message.replace(/^Error invoking remote method '[^']+': Error:\s*/i, ''))
      return false
    }
    finally { if (showBusy) setBusy(undefined) }
  }

  return (<>
    <div className={sidebarCollapsed ? 'app-shell task-workspace-shell sidebar-collapsed' : 'app-shell task-workspace-shell'}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><img src={foremanIcon} alt="" /></div>
          <div className="brand-copy"><strong>Model Foreman</strong></div>
        </div>
        <button className="sidebar-toggle" title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>{sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}</button>
        <nav className="primary-nav">
          <button title="工作台" className={view === 'workbench' ? 'active' : ''} onClick={() => setView('workbench')}>
            <LayoutDashboard size={18} />工作台
          </button>
          <button title="运行记录" className={view === 'runs' ? 'active' : ''} onClick={() => setView('runs')}>
            <History size={18} />运行记录
          </button>
          <button title="长期目标" className={view === 'goals' ? 'active' : ''} onClick={() => setView('goals')}>
            <Target size={18} />长期目标
          </button>
          <button title="记忆治理" className={view === 'memory' ? 'active' : ''} onClick={() => setView('memory')}>
            <Brain size={18} />记忆治理
          </button>
        </nav>
        <div className="sidebar-section">
          <div className="section-label"><span>项目与任务</span><button title="刷新项目任务" onClick={() => void refreshRuns()}><RefreshCw size={13} /></button></div>
          <div className="project-run-tree">
            {sidebarProjects.map((project) => {
              const collapsed = collapsedProjects.has(project.workspace)
              return <section className={project.workspace === settings?.workspace ? 'project-run-group active' : 'project-run-group'} key={project.workspace}>
                <ProjectHeading workspace={project.workspace} count={project.tasks.length} current={project.workspace === settings?.workspace} collapsed={collapsed} disabled={Boolean(busy)} onSelect={() => void switchWorkspace(project.workspace)} onToggle={() => setCollapsedProjects((current) => { const next = new Set(current); if (next.has(project.workspace)) next.delete(project.workspace); else next.add(project.workspace); return next })} />
                {!collapsed && <div className="run-list">{project.tasks.length === 0 ? <p className="empty-copy">此项目还没有任务</p> : project.tasks.map((run) => (
                  <button key={run.id} title={run.title} className={selectedId === run.id ? 'run-item selected' : 'run-item'} onContextMenu={(event) => { event.preventDefault(); setRunMenu({ run, x: event.clientX, y: event.clientY }) }} onClick={() => { setView('workbench'); void openRun(run.id) }}>
                    <span className={`status-dot ${runStatusClass(run)}`} />
                    <span><b>{run.title}</b><small>{runStatusLabel(run)} · {formatDate(run.updatedAt)}</small></span>
                  </button>
                ))}</div>}
              </section>
            })}
          </div>
          {runs.length > 0 && <button className="all-runs-link" onClick={() => setView('runs')}><History size={13} />查看全部运行<ChevronRight size={13} /></button>}
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <button className="workspace-pill" title={settings?.workspace} aria-label="项目详情与切换" aria-expanded={showRepository} aria-haspopup="dialog" onClick={() => setShowRepository((open) => !open)}><FolderGit2 size={16} /><span>{settings ? workspaceName(settings.workspace) : '载入中…'}</span>{repository.connected && <small className="workspace-branch" title={repository.branch || '未连接分支'} aria-label={`当前分支：${repository.branch || '未连接分支'}`}><GitBranch size={13} /><span>{repository.branch || '未连接分支'}</span></small>}<ChevronDown size={13} /></button>
          {settings && <div className="topbar-setting-statuses" aria-label="运行策略状态">
            <button className={settings.verification.enabled ? 'topbar-setting-status enabled' : 'topbar-setting-status disabled'} title={`独立验证门禁：${settings.verification.enabled ? settings.verification.stopOnFailure ? '严格模式' : '已开启' : '已关闭'}`} onClick={() => openSettings('settings-verification')}><ShieldCheck size={13} /><span>门禁 · {settings.verification.enabled ? settings.verification.stopOnFailure ? '严格' : '开启' : '关闭'}</span></button>
            <button className={`topbar-setting-status ${automaticApprovals === 2 ? 'enabled' : automaticApprovals === 1 ? 'partial' : 'disabled'}`} title={`自动批准：规划者${settings.approvals.planner.autoApprove ? `开启（${Math.round(settings.approvals.planner.minConfidence * 100)}%）` : '关闭'}，审核者${settings.approvals.reviewer.autoApprove ? `开启（${Math.round(settings.approvals.reviewer.minConfidence * 100)}%）` : '关闭'}`} onClick={() => openSettings('settings-approvals')}><Check size={13} /><span>批准 · {automaticApprovals === 2 ? '自动' : automaticApprovals === 1 ? '1/2 自动' : '人工'}</span></button>
            <button className={settings.memory.enabled ? 'topbar-setting-status memory-enabled' : 'topbar-setting-status disabled'} title={`长期记忆：${settings.memory.enabled ? `${settings.memory.provider === 'local' ? '本地' : '腾讯云'}${settings.memory.requireApproval ? ' · 写入需批准' : ' · 自动写入'}` : '已关闭'}`} onClick={() => openSettings('settings-memory')}><Brain size={13} /><span>记忆 · {settings.memory.enabled ? settings.memory.provider === 'local' ? '本地' : '云端' : '关闭'}</span></button>
          </div>}
          <div className="topbar-actions">
            <button className={view === 'settings' ? 'topbar-tool topbar-settings active' : 'topbar-tool topbar-settings'} aria-label="打开设置" title="设置" onClick={() => setView('settings')}><Settings2 size={18} /></button>
            <button className="topbar-tool topbar-terminal" aria-label="打开命令行" title={`在终端打开 ${settings?.workspace ?? '当前工作目录'}`} onClick={() => void openTerminal()}><TerminalSquare size={18} /></button>
            <button className="topbar-new-task" onClick={newTask}><Plus size={15} />新任务</button>
          </div>
        </header>

        {!settings ? <div className="loading" role="status">正在载入项目与草稿…</div> : view === 'workbench' ? (
          <Workbench
            settings={settings} selected={selected} running={Boolean(running)} events={events.filter((event) => event.runId === selectedId)}
            active={workbenchTab} documents={documents.state} runs={runs} onDocument={changeDocument} onNewTask={newTask} onOpenProjects={() => setShowRepository(true)}
            draft={draft} onDraft={updateDraft} draftSaveError={draftSaveError} recentRuns={runs.filter((run) => run.workspace === settings?.workspace).slice(0, 3)} onSelectRun={(id) => void openRun(id)} capabilities={capabilities}
            inspection={inspection} busy={busy}
            title={title} objective={objective} onTitle={(value) => updateDraft({ title: value })} onObjective={(value) => updateDraft({ objective: value })}
            onStart={() => void startRun()} onStartGoal={(criteria, budget) => void startGoalFromWorkbench(criteria, budget)} onApprove={() => void approvePlan()}
            onCancel={() => void cancelRun()} onPause={() => void pauseRun()} onResume={() => { if (selected) { setResumeTarget(selected); setResumeSupplement('') } }} onUpdateContract={(contract) => void updateContract(contract)} onInspect={() => void loadInspection()}
            onMerge={() => void mergeRun()} onDiscard={() => void discardRun()}
            onRetry={() => void retryRun()} onRecover={() => void inspectRecovery()} onDelete={() => void deleteRun()}
            deliveryGuide={deliveryGuide} onDeliveryStep={(action) => void executeDeliveryStep(action)}
            onDeliveryRefresh={() => void refreshDeliveryGuide()} onDeliveryClose={() => setDeliveryGuide(null)}
            onOpen={() => void openWorkspace()}
            agentEnvironment={agentEnvironment} onDesktop={(kind) => void handoffToDesktop(kind, selected?.id)}
            repository={repository} githubDelivery={githubDelivery}
            gitOperationPlan={gitOperationPlan} onPreviewRepositoryPush={() => void previewRepositoryPush()}
            onExecuteRepositoryPush={(confirmation) => void executeRepositoryPush(confirmation)} onPreviewRepositoryPublish={(url) => void previewRepositoryPublish(url)} onCancelGitOperation={() => setGitOperationPlan(null)}
            onAdvanceLocalDelivery={() => void advanceLocalDelivery(false)} onAutoLocalDelivery={() => void advanceLocalDelivery(true)}
            onRunCommand={(command) => void commandRun(command)}
            onConfigureWorkflow={openWorkflowSettings} onConfigureConnectors={() => openSettings('settings-connectors')}
            onChoose={() => void chooseWorkspace()} onCloneGitHub={(url) => void cloneGitHubRepository(url)}
            onRefreshRepository={() => void refreshRepository()} onOpenRemote={(url) => void openRepositoryRemote(url)}
          />
        ) : view === 'runs' ? (
          <RunHistoryView runs={runs} onOpen={(id) => { setView('workbench'); void openRun(id) }} onRetry={(run) => void retryRun(run)} onRecover={(run) => void inspectRecovery(run)} onDelete={(run) => void deleteRun(run)} />
        ) : view === 'goals' && settings ? (
          <GoalView settings={settings} goals={goals} selected={selectedGoal} busy={busy}
            onCreate={createGoal} onSelect={(id) => void refreshGoals(id)} onCommand={(command) => void commandGoal(command)}
            onOpenRun={(id) => { setView('workbench'); void openRun(id) }} />
        ) : view === 'memory' && settings ? (
          <MemoryView entries={memories} runs={runs} activeWorkspace={settings.workspace} stats={memoryStats} health={memoryHealth} busy={busy}
            onRefresh={() => void refreshMemories()} onDecide={decideMemory} onCurate={curateMemories}
            onForget={(id) => void forgetMemory(id)} />
        ) : settings ? (
          <AppSettingsView section={settingsSection} onSectionChange={setSettingsSection} settings={settings} capabilities={capabilities} agentEnvironment={agentEnvironment} onChange={setSettings}
            onRefreshEnvironment={() => refreshAgentEnvironment()}
            onDesktop={(kind) => void handoffToDesktop(kind)} onProbeMemory={() => void probeMemorySettings()}
            onSetupTencentDb={() => void setupTencentDbMemory()} tencentDbSetupResult={tencentDbSetupResult}
            memoryHealth={memoryHealth} notice={notice} busy={busy} />
        ) : <div className="loading">正在载入配置…</div>}
        {actionError && <div className="error-toast"><span>{actionError}</span><button onClick={() => setActionError('')}><X size={15} /></button></div>}
      </main>
      {settings && <dialog ref={projectPickerRef} className="project-picker" aria-label="项目详情与切换" onCancel={(event) => { event.preventDefault(); if (!busy) setShowRepository(false) }} onClick={(event) => { if (event.target === event.currentTarget && !busy) setShowRepository(false) }}>
        <header><span><FolderGit2 size={18} /><b>项目详情与切换</b></span><button autoFocus className="quiet-button" disabled={Boolean(busy)} onClick={() => setShowRepository(false)} aria-label="关闭项目选择"><X size={17} /></button></header>
        <div className="project-picker-content"><nav className="project-picker-list" aria-label="最近项目"><b>最近项目</b>{sidebarProjects.map((project) => <button key={project.workspace} title={project.workspace} aria-current={project.workspace === settings.workspace ? 'true' : undefined} disabled={Boolean(busy)} onClick={() => void switchWorkspace(project.workspace)}><FolderGit2 size={15} /><span><b>{workspaceName(project.workspace)}</b><small>{project.workspace}</small></span>{project.workspace === settings.workspace && <Check size={14} />}</button>)}</nav>
        <RepositoryControl repository={repository} githubDelivery={githubDelivery} busy={busy} expanded onChoose={() => void chooseWorkspace()} onCloneGitHub={(url) => void cloneGitHubRepository(url)} onRefreshRepository={() => void refreshRepository()} onOpenRemote={(url) => void openRepositoryRemote(url)} />
        </div>
      </dialog>}
      {runMenu && <div ref={runMenuRef} className="run-context-menu" role="menu" aria-label={`${runMenu.run.title}任务操作`} style={{ left: Math.min(runMenu.x, window.innerWidth - 220), top: Math.min(runMenu.y, window.innerHeight - 210) }}><b title={runMenu.run.title}>{runMenu.run.title}</b><button onClick={() => { setView('workbench'); void openRun(runMenu.run.id); setRunMenu(null) }}><FolderOpen size={14} />打开任务</button>{['queued', 'planning', 'implementing', 'verifying', 'reviewing'].includes(runMenu.run.status) && <button onClick={() => { void window.foreman.commandRun(runMenu.run.id, { type: 'pause' }).then(() => refreshRuns(runMenu.run.id)); setRunMenu(null) }}><Pause size={14} />中止并保留检查点</button>}{runMenu.run.status === 'paused' && <button onClick={() => { setResumeTarget(runMenu.run); setResumeSupplement(''); setRunMenu(null) }}><RotateCcw size={14} />补充内容并恢复</button>}{!['queued', 'planning', 'implementing', 'verifying', 'reviewing'].includes(runMenu.run.status) && <button className="danger" onClick={() => { void deleteRun(runMenu.run); setRunMenu(null) }}><Trash2 size={14} />删除任务</button>}</div>}
      {resumeTarget && <div className="approval-scrim"><section className="resume-panel" role="dialog" aria-modal="true" aria-label="补充内容并恢复任务"><header><span><RotateCcw size={18} /><span><small>RESUME FROM CHECKPOINT · 从检查点恢复</small><b>补充内容后继续原任务</b></span></span></header><div className="resume-context"><label><span>原任务描述</span><p>{resumeTarget.objective}</p></label>{resumeTarget.additionalInstructions && <label><span>此前补充内容</span><p>{resumeTarget.additionalInstructions}</p></label>}<label><span>本次新增内容（可留空）</span><textarea autoFocus value={resumeSupplement} onChange={(event) => setResumeSupplement(event.target.value)} placeholder="例如：保持现有接口不变，并优先修复登录状态恢复。新增内容会追加到原任务上下文，不会覆盖之前的要求。" /></label></div><footer><button className="quiet-button" onClick={() => { setResumeTarget(null); setResumeSupplement('') }}>取消</button><button className="primary" disabled={Boolean(busy)} onClick={() => void resumeRun()}><Play size={14} />从上个检查点继续</button></footer></section></div>}
      {recovery && <RunRecoveryDialog run={recovery.run} plan={recovery.plan} busy={Boolean(busy)} error={actionError} onClose={() => setRecovery(null)} onRefresh={() => void inspectRecovery(recovery.run)} onRecover={() => void recoverRun()} onRetry={() => { const target = recovery.run; setRecovery(null); void retryRun(target) }} />}
    </div>
  </>)
}

function RunHistoryView({ runs, onOpen, onRetry, onRecover, onDelete }: {
  runs: RunSummary[]
  onOpen: (id: string) => void
  onRetry: (run: RunSummary) => void
  onRecover: (run: RunSummary) => void
  onDelete: (run: RunSummary) => void
}) {
  const [projectFilter, setProjectFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<RunFilter>('all')
  const [query, setQuery] = useState('')
  const projects = [...new Set(runs.map((run) => run.workspace))]
  const visibleRuns = filterRuns(runs, { project: projectFilter, status: statusFilter, query })
  const filtered = projectFilter !== 'all' || statusFilter !== 'all' || Boolean(query.trim())
  const clearFilters = () => { setProjectFilter('all'); setStatusFilter('all'); setQuery('') }
  const totals = visibleRuns.reduce((sum, run) => {
    const metrics = run.stageMetrics ?? []
    return {
      duration: sum.duration + metrics.reduce((value, metric) => value + metric.durationMs, 0),
      tokens: sum.tokens + metrics.reduce((value, metric) => value + metric.inputTokens + metric.outputTokens, 0),
      cost: sum.cost + metrics.reduce((value, metric) => value + metric.costUsd, 0)
    }
  }, { duration: 0, tokens: 0, cost: 0 })
  return <div className="page run-history-page">
    <div className="page-command-bar history-project-bar"><div><span className="page-command-icon"><FolderGit2 size={17} /></span><span><b>运行记录</b><small>查找任务、跟踪交付与资源消耗</small></span></div><span className="history-result-count" role="status">显示 {visibleRuns.length} / {runs.length} 个任务</span></div>
    <div className="history-filters" role="search" aria-label="筛选运行记录">
      <label className="history-search"><Search size={16} /><input type="search" aria-label="搜索任务" placeholder="搜索标题、描述、项目或分支" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button aria-label="清空搜索" onClick={() => setQuery('')}><X size={14} /></button>}</label>
      <label className="run-project-filter"><span>项目</span><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">全部项目（{projects.length}）</option>{projects.map((workspace) => <option value={workspace} key={workspace}>{workspaceName(workspace)}</option>)}</select></label>
      <label className="run-status-filter"><span>状态</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as RunFilter)}>{runFilters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {filtered && <button className="quiet-button history-filter-reset" onClick={clearFilters}>重置筛选</button>}
    </div>
    <div className="history-metrics"><div><b>{visibleRuns.length}</b><span>当前范围</span></div><div><b>{visibleRuns.filter((run) => runCategory(run) === 'delivery').length}</b><span>待交付</span></div><div><b>{visibleRuns.filter((run) => runCategory(run) === 'delivered').length}</b><span>已交付</span></div><div><b>{formatDuration(totals.duration)}</b><span>累计耗时</span></div><div><b>{formatTokenCount(totals.tokens)}</b><span>总 Token</span></div><div><b>${totals.cost.toFixed(3)}</b><span>已报告费用</span></div></div>
    <section className="run-history-list">
      <div className="run-history-head"><span>任务与状态</span><span>更新时间</span><span>耗时</span><span>Token</span><span>费用</span><span>操作</span></div>
      {visibleRuns.length === 0 ? <div className="memory-empty"><History size={28} /><b>{runs.length ? '没有匹配的任务' : '还没有运行记录'}</b><span>{runs.length ? '试试其他关键词或调整项目、状态筛选。' : '从工作台发起任务后，完整档案会保存在这里。'}</span>{filtered && <button className="quiet-button" onClick={clearFilters}>清除筛选</button>}</div> : visibleRuns.map((run) => {
        const metrics = run.stageMetrics ?? []
        const duration = metrics.reduce((sum, metric) => sum + metric.durationMs, 0)
        const tokens = metrics.reduce((sum, metric) => sum + metric.inputTokens + metric.outputTokens, 0)
        const cost = metrics.reduce((sum, metric) => sum + metric.costUsd, 0)
        const active = ['queued', 'planning', 'implementing', 'verifying', 'reviewing'].includes(run.status)
        return <article className="run-history-row" key={run.id}>
          <button className="run-history-open" title={`打开 ${run.title}`} onClick={() => onOpen(run.id)}><span className="history-run-title"><i className={`status-dot ${runStatusClass(run)}`} /><span><b>{run.title}</b><small>{workspaceName(run.workspace)} · <em className={`history-status ${runStatusClass(run)}`}>{runStatusLabel(run)}</em>{run.branch ? ` · ${run.branch}` : ''}</small></span></span></button>
          <time>{new Date(run.updatedAt).toLocaleString('zh-CN')}</time><b>{formatDuration(duration)}</b><b>{formatTokenCount(tokens)}</b><b>${cost.toFixed(3)}</b>
          <span className="run-history-actions">{run.status === 'failed' ? <><button className="history-recover" title="从失败处继续" aria-label={`从失败处继续 ${run.title}`} onClick={() => onRecover(run)}><Play size={14} /><span>继续</span></button><button title="重新创建任务" aria-label={`重新创建任务 ${run.title}`} onClick={() => onRetry(run)}><RotateCcw size={14} /></button></> : <button title="打开详情" aria-label={`打开任务 ${run.title}`} onClick={() => onOpen(run.id)}><ChevronRight size={15} /></button>}{!active && <button className="danger" title="删除任务" aria-label={`删除任务 ${run.title}`} onClick={() => onDelete(run)}><Trash2 size={14} /></button>}</span>
        </article>
      })}
    </section>
  </div>
}

function GoalView({ settings, goals, selected, busy, onCreate, onSelect, onCommand, onOpenRun }: {
  settings: AppSettings; goals: GoalSummary[]; selected: GoalDetail | null; busy?: string
  onCreate: (input: import('../../shared/contracts').GoalInput) => Promise<boolean>; onSelect:(id:string)=>void; onCommand:(command:GoalCommand)=>void; onOpenRun:(id:string)=>void
}) {
  const [title,setTitle]=useState(''); const [objective,setObjective]=useState(''); const [criteria,setCriteria]=useState(''); const [constraints,setConstraints]=useState('')
  const [budget, setBudget] = useState<GoalBudget>({ ...defaultGoalBudget })
  const goalTitleRef = useRef<HTMLInputElement>(null)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const [creating, setCreating] = useState(false)
  const goal = selected?.goal
  useEffect(() => { if (creating) goalTitleRef.current?.focus() }, [creating])
  const missing = !objective.trim() ? '请填写最终目标' : !lines(criteria).length ? '请至少填写一项成功标准' : goalBudgetError(budget)
  const submit=async ()=>{ const successCriteria=lines(criteria); if(missing)return;
    const created = await onCreate({ title:title.trim()||objective.trim().slice(0,40),objective:objective.trim(),workspace:settings.workspace,successCriteria,constraints:lines(constraints),priority:50,...goalBudgetInput(budget) });
    if (created) { setTitle('');setObjective('');setCriteria('');setConstraints('');setCreating(false);createButtonRef.current?.focus() }
  }

  return <div className="page goal-page">
    <div className="page-command-bar"><div><span className="page-command-icon"><Target size={17}/></span><span><b>长期目标</b><small>创建、跟踪并恢复持续交付目标</small></span></div><button className={creating ? 'quiet-button' : 'primary'} ref={createButtonRef} onClick={() => { setCreating(!creating); if (creating) createButtonRef.current?.focus() }}>{creating ? <><X size={14}/>取消创建</> : <><Target size={15}/>新建目标</>}</button></div>
    {creating && <section className="goal-composer">
      <p className="form-hint">适合分阶段交付、需要多次验证的工作。完成一次改动时，使用工作台的普通任务即可。</p>
      <div className="goal-fields">
        <div><label><span>目标标题（可选）</span><input ref={goalTitleRef} maxLength={160} value={title} onChange={(event)=>setTitle(event.target.value)} placeholder="例如：完成认证系统升级" /></label><label><span>最终目标（必填）</span><textarea required maxLength={20000} value={objective} onChange={(event)=>setObjective(event.target.value)} placeholder="例如：支持邮箱登录、刷新和注销，同时保持现有接口兼容。" /></label></div>
        <div><label><span>成功标准（必填，每行一项）</span><textarea required value={criteria} onChange={(event)=>setCriteria(event.target.value)} placeholder={'例如：登录、刷新与注销测试全部通过\n刷新令牌重放会被拒绝'} /></label><label><span>约束（可选，每行一项）</span><textarea value={constraints} onChange={(event)=>setConstraints(event.target.value)} placeholder="例如：不修改现有公开接口；不引入付费依赖。" /></label></div>
      </div>
      <GoalBudgetFields value={budget} onChange={setBudget} />
      <div className="goal-controls"><span className="form-hint" id="goal-start-hint" role="status">{busy ? '正在创建，请稍候…' : missing || '目标和成功标准已填写，启动前请核对上述预算。'}</span><button className="primary" aria-describedby="goal-start-hint" disabled={Boolean(busy)||Boolean(missing)} onClick={() => void submit()}><Target size={15}/>启动长期目标</button></div>
    </section>}
    {(!creating || goals.length > 0) && <div className={goals.length ? 'goal-layout' : 'goal-layout empty'}><aside className="goal-list">{goals.map((item)=><button className={item.id===goal?.id?'selected':''} key={item.id} onClick={()=>onSelect(item.id)}><span className={`status-dot ${item.status}`}/><span><b>{item.title}</b><small>{goalStatusLabel[item.status]} · {item.iteration}/{item.maxIterations}</small></span></button>)}</aside>
      <section className="goal-detail">{!goal?<div className="memory-empty"><Target size={28}/><b>把持续改进拆成可验收的阶段</b><span>例如：升级认证系统 → 登录测试通过 → 刷新令牌测试通过 → 兼容旧接口。</span><span>适合多阶段交付；一次性改动可在工作台发起普通任务。</span></div>:<><div className="goal-head"><div><span className="goal-status-label">{goalStatusLabel[goal.status]}</span><h2>{goal.title}</h2><p>{goal.objective}</p></div><div className="goal-actions">{goal.status==='active'||goal.status==='waiting_approval'?<button className="quiet-button" onClick={()=>onCommand('pause')}><Pause size={13}/>暂停</button>:goal.status==='paused'?<button className="merge-button" onClick={()=>onCommand('resume')}><Play size={13}/>恢复</button>:null}{goal.status==='paused'&&goal.terminalReason?.includes('工作区变化')&&<button className="quiet-button" onClick={()=>onCommand('revalidate')}><ShieldCheck size={13}/>重新验证</button>}{!['completed','cancelled'].includes(goal.status)&&<button className="danger-button" onClick={()=>onCommand('cancel')}><CircleStop size={13}/>取消</button>}</div></div>
        <div className="goal-metrics"><div><b>{goal.iteration}</b><span>循环次数</span></div><div><b>{selected.tasks.filter((task)=>task.status==='completed').length}/{selected.tasks.length}</b><span>成功标准</span></div><div><b>{goal.timeBudgetSeconds?`${Math.round(goal.timeBudgetSeconds/3600)}h`:'∞'}</b><span>时间预算</span></div><div><b>{Math.round(goal.tokensUsed/1000)}k</b><span>Token 用量</span></div><div><b>${goal.costUsedUsd.toFixed(2)}</b><span>费用用量</span></div></div>
        {goal.terminalReason&&<div className="goal-reason"><ShieldCheck size={15}/>{goal.terminalReason}{goal.status==='blocked'&&<button className="quiet-button" onClick={()=>onCommand('replan')}><RotateCcw size={13}/>重新规划</button>}</div>}
        <div className="task-graph">{selected.tasks.map((task,index)=><article className={task.status} key={task.id}><div className="task-index">{String(index+1).padStart(2,'0')}</div><div><span>{goalTaskStatusLabel[task.status]}</span><h3>{task.title}</h3><p>{task.objective.split('\n')[2]??task.objective}</p><small>尝试 {task.attempt}/{task.maxAttempts}{task.dependencies.length?` · 依赖 ${task.dependencies.length} 项`:''}</small></div>{task.runId&&<button className="quiet-button" onClick={()=>onOpenRun(task.runId!)}>打开任务</button>}</article>)}</div></>}</section>
    </div>}
  </div>
}

function Workbench(props: {
  settings: AppSettings | null; selected?: RunSummary; running: boolean; events: RunEvent[]
  active: 'draft' | 'run' | 'empty'; documents: WorkspaceDocuments; runs: RunSummary[]
  onDocument: (action: import('./workspace-documents').DocumentAction) => void; onNewTask: () => void
  onOpenProjects: () => void
  draft: TaskDraft; onDraft: (patch: Partial<TaskDraft>) => void; draftSaveError: boolean
  recentRuns: RunSummary[]; onSelectRun: (id: string) => void; capabilities: ExecutorCapability[]
  inspection: WorkspaceInspection | null; busy?: string
  deliveryGuide: DeliveryGuide | null
  title: string; objective: string; onTitle: (value: string) => void; onObjective: (value: string) => void
  onStart: () => void; onStartGoal: (successCriteria: string[], budget: GoalBudget) => void; onApprove: () => void; onCancel: () => void; onInspect: () => void
  onPause: () => void; onResume: () => void; onUpdateContract: (contract: import('../../shared/contracts').ExecutionContract) => void
  onMerge: () => void; onDiscard: () => void; onRetry: () => void; onRecover: () => void; onDelete: () => void; onOpen: () => void
  onDeliveryStep: (action: DeliveryGuideAction) => void; onDeliveryRefresh: () => void; onDeliveryClose: () => void
  agentEnvironment: AgentEnvironment; onDesktop: (kind: ExecutorKind) => void
  repository: RepositoryInspection; githubDelivery: GitHubDeliveryStatus
  gitOperationPlan: GitOperationPlan | null
  onChoose: () => void; onCloneGitHub: (url: string) => void; onRefreshRepository: () => void; onOpenRemote: (url: string) => void
  onPreviewRepositoryPush: () => void; onPreviewRepositoryPublish: (remoteUrl?: string) => void; onExecuteRepositoryPush: (confirmation: string) => void; onCancelGitOperation: () => void
  onAdvanceLocalDelivery: () => void; onAutoLocalDelivery: () => void
  onRunCommand: (command: RunCommand) => void
  onConfigureWorkflow: () => void; onConfigureConnectors: () => void
}) {
  const { settings, selected, events } = props
  const { mode: taskMode, criteria: goalCriteria, budget: goalBudget } = props.draft
  const setTaskMode = (mode: 'run' | 'goal') => props.onDraft({ mode })
  const setGoalCriteria = (criteria: string) => props.onDraft({ criteria })
  const setGoalBudget = (budget: GoalBudget) => props.onDraft({ budget })
  const [runTab, setRunTab] = useState<RunDetailTab>('overview')
  const selectRunTab = (tab: RunDetailTab) => {
    setRunTab(tab)
    if (selected?.id) window.sessionStorage.setItem(`foreman:run-tab:${selected.id}`, tab)
  }
  const [logFilter, setLogFilter] = useState<'progress' | 'model' | 'all'>('progress')
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [approvalMinimized, setApprovalMinimized] = useState(false)
  const [focusedMetric, setFocusedMetric] = useState<RunStageMetric | null>(null)
  const [gitConfirmation, setGitConfirmation] = useState('')
  const deliveryGuideRequested = useRef<string | undefined>(undefined)
  const resolution = selected?.resolution ?? 'open'
  const canDiscard = selected && ['awaiting_approval', 'completed', 'cancelled'].includes(selected.status) && resolution === 'open'
  const resourceTotals = useMemo(() => (selected?.stageMetrics ?? []).reduce((sum, metric) => ({
    duration: sum.duration + metric.durationMs,
    tokens: sum.tokens + metric.inputTokens + metric.outputTokens,
    cost: sum.cost + metric.costUsd
  }), { duration: 0, tokens: 0, cost: 0 }), [selected?.stageMetrics])
  const focusedEvents = useMemo(() => focusedMetric ? events.filter((event) => {
    const at = new Date(event.at).getTime()
    return at >= new Date(focusedMetric.startedAt).getTime() - 1000 && at <= new Date(focusedMetric.completedAt).getTime() + 1000
  }) : events, [events, focusedMetric])
  const visibleEventGroups = useMemo(() => groupRunEvents(focusedEvents, logFilter), [focusedEvents, logFilter])
  useEffect(() => {
    const savedTab = selected?.id ? window.sessionStorage.getItem(`foreman:run-tab:${selected.id}`) as typeof runTab | null : null
    const savedFilter = selected?.id ? window.sessionStorage.getItem(`foreman:log-filter:${selected.id}`) as typeof logFilter | null : null
    setRunTab(initialRunTab(selected, savedTab))
    if (savedFilter && ['progress', 'model', 'all'].includes(savedFilter)) setLogFilter(savedFilter)
    const waiting = selected?.status === 'awaiting_approval' || selected?.status === 'awaiting_review_approval'
    setApprovalOpen(Boolean(waiting)); setApprovalMinimized(false)
  }, [selected?.id])
  useEffect(() => { if (selected?.id) window.sessionStorage.setItem(`foreman:log-filter:${selected.id}`, logFilter) }, [selected?.id, logFilter])
  useEffect(() => {
    const waiting = selected?.status === 'awaiting_approval' || selected?.status === 'awaiting_review_approval'
    if (waiting) { setApprovalOpen(true); setApprovalMinimized(false) }
  }, [selected?.status])
  useEffect(() => {
    if (selected?.status !== 'completed' || resolution !== 'open' || props.deliveryGuide || deliveryGuideRequested.current === selected.id) return
    deliveryGuideRequested.current = selected.id
    props.onDeliveryRefresh()
  }, [selected?.id, selected?.status, resolution, props.deliveryGuide])
  useEffect(() => { setGitConfirmation('') }, [props.gitOperationPlan?.id])
  const deliveryContent = selected && settings && selected.workspace !== settings.workspace ? (
    <div className="delivery-project-mismatch"><b>此任务属于 {workspaceName(selected.workspace)}</b><p>当前连接的是 {workspaceName(settings.workspace)}。交付前请切换到任务项目，避免把操作应用到其他仓库。</p><button className="quiet-button" onClick={props.onOpenProjects}>切换项目</button></div>
  ) : (
          <section className="inspector-card delivery-inspector">
            <div className="inspector-heading"><span><small>DELIVERY GUIDE · 交付向导</small><b>{resolution === 'merged' ? '已交付到源项目' : resolution === 'discarded' ? '已放弃' : props.deliveryGuide ? '按向导完成当前步骤' : '交付准备'}</b></span><GitMerge size={17} /></div>
            {selected?.executionWorkspace ? <div className="delivery-toolbar inspector-toolbar">
              <div className="delivery-location"><FolderGit2 size={15} /><span><b>{resolution === 'open' ? '任务 worktree' : '交付记录'}</b>{resolution === 'open' ? <small title={selected.executionWorkspace}>{selected.executionWorkspace}</small> : <details><summary>查看历史工作区路径</summary><small>{selected.executionWorkspace}</small></details>}</span></div>
              <div className="delivery-actions">
                {resolution === 'open' && <button className="quiet-button" onClick={props.onOpen}><FolderOpen size={14} />打开</button>}
                {resolution === 'open' && props.agentEnvironment.desktops.filter((desktop) => desktop.installed).map((desktop) => <button className="quiet-button desktop-button" key={desktop.kind} onClick={() => props.onDesktop(desktop.kind)}><ExecutorLogo kind={desktop.kind} />{executorLabel(desktop.kind).replace(' CLI', '')} 接管</button>)}
                {resolution === 'open' && <button className="quiet-button" disabled={props.busy === 'diff'} onClick={props.onInspect}>{props.busy === 'diff' ? <LoaderCircle className="spin" size={14} /> : <FileDiff size={14} />}刷新证据</button>}
                {canDiscard && <button className="danger-button" disabled={Boolean(props.busy)} onClick={props.onDiscard}><Trash2 size={14} />放弃</button>}
                {resolution !== 'open' && <span className={`resolution-badge ${resolution}`}>{resolution === 'merged' ? '已合并并清理' : '已放弃并清理'}</span>}
              </div>
            </div> : <div className="delivery-rail-empty"><FolderGit2 size={20} /><b>尚未创建任务 worktree</b><span>连接项目并启动任务后，这里会显示隔离路径与交付操作。</span></div>}
            <RepositoryPublishGuide repository={props.repository} githubDelivery={props.githubDelivery} resolution={resolution} deliveryGuide={props.deliveryGuide} plan={props.gitOperationPlan} busy={props.busy} confirmation={gitConfirmation} onConfirmation={setGitConfirmation} onPreview={props.onPreviewRepositoryPush} onPreviewPublish={props.onPreviewRepositoryPublish} onExecute={() => props.onExecuteRepositoryPush(gitConfirmation)} onCancel={props.onCancelGitOperation} onOpenRemote={props.onOpenRemote} onOpenLocalGuide={props.onDeliveryRefresh} onOpenRepository={props.onOpenProjects} onOpenResult={props.onOpen} onRefresh={props.onRefreshRepository} onLocalStep={props.onDeliveryStep} onAdvanceLocalDelivery={props.onAdvanceLocalDelivery} onAutoLocalDelivery={props.onAutoLocalDelivery} />
            <div className="repository-rail-summary"><span><GitBranch size={13} /><span><b className="repository-branch-name">{props.repository.branch || '未连接分支'}</b><small>{props.repository.connected ? `${props.repository.unstaged + props.repository.staged + props.repository.untracked} 项本地改动` : '打开本地项目或从 GitHub 克隆'}</small></span></span><button title="刷新 Git、PR 与 CI/CD 状态" onClick={props.onRefreshRepository}><RefreshCw size={13} /></button></div>
          </section>
  )
  const runContent = (
      <section className="run-card workbench-surface" id="workspace-run-panel" role="tabpanel" aria-labelledby={workspaceTabId(props.documents.activeId)}>
        <div className="card-heading">
          <div><span className="eyebrow">当前任务</span><h2>{selected?.title ?? '等待第一个任务'}</h2></div>
          {selected && <div className="run-actions">
            {selected.branch && <span className="branch-badge" title={selected.branch}><FolderGit2 size={12} />{selected.branch}</span>}
            <span className={`status-badge ${runStatusClass(selected)}`}>{runStatusLabel(selected)}</span>
            {selected.status === 'completed' && resolution === 'open' && <button className="primary" onClick={() => selectRunTab('delivery')}><GitMerge size={14} />交付成果</button>}
            {props.running && <button className="run-control-button stop" disabled={Boolean(props.busy)} onClick={props.onPause}><Pause size={14} />中止并保留检查点</button>}
            {selected.status === 'paused' && <button className="run-control-button resume" disabled={Boolean(props.busy)} onClick={props.onResume}><RotateCcw size={14} />补充并恢复</button>}
          </div>}
        </div>
        {selected?.status === 'awaiting_approval' && <div className="approval-banner">
          <div><Sparkles size={18} /><span><b>计划等待批准</b><small>先检查下方计划；批准后执行模型才会获得隔离 worktree 的写权限。</small></span></div>
          <button className="primary" onClick={() => { setApprovalOpen(true); setApprovalMinimized(false) }}><Check size={16} />检查并批准</button>
        </div>}
        {selected?.status === 'awaiting_review_approval' && <div className="approval-banner review-approval-banner">
          <div><ShieldCheck size={18} /><span><b>审核等待确认</b><small>审核结论与验证证据已就绪，请打开审核确认，决定交付或返工。</small></span></div>
          <button className="primary" onClick={() => { setApprovalOpen(true); setApprovalMinimized(false) }}><Check size={16} />打开审核确认</button>
        </div>}
        {selected?.status === 'paused' && <div className="run-recovery-banner">
          <div><Pause size={18} /><span><b>{selected.pauseReason === 'authorization' ? '授权缺失，任务已安全暂停' : '任务已暂停'}</b><small>{selected.error || 'worktree 与检查点已保留，恢复时只从当前阶段继续。'}</small></span></div>
          <div className="run-recovery-actions"><button className="quiet-button" onClick={props.onResume}><RotateCcw size={14} />从检查点恢复</button><button className="danger-button" onClick={props.onDelete}><Trash2 size={14} />删除任务</button></div>
        </div>}
        {selected?.status === 'failed' && <div className="run-recovery-banner">
          <div><RotateCcw size={18} /><span><b>任务失败，现场与执行记录已保留</b><small>{selected.failure?.message || selected.error || '可检查已有产出并从失败处继续，也可重新创建任务。'}</small></span></div>
          <div className="run-recovery-actions">
            <button className="primary" disabled={Boolean(props.busy)} onClick={props.onRecover}><Play size={14} />从失败处继续</button>
            <button className="quiet-button" disabled={Boolean(props.busy)} onClick={props.onRetry}><RotateCcw size={14} />重新创建任务</button>
            <button className="danger-button" disabled={Boolean(props.busy)} onClick={props.onDelete}><Trash2 size={14} />删除记录与工作区</button>
          </div>
        </div>}
        {selected && <AgentTaskPanel run={selected} />}
        {selected && <TaskProgress run={selected} />}
        <button className="run-resource-compact" onClick={() => selectRunTab('resources')} aria-label="查看步骤耗时与资源"><Gauge size={14} />{formatDuration(resourceTotals.duration)}<span>·</span>{formatTokenCount(resourceTotals.tokens)} Token<span>·</span>${resourceTotals.cost.toFixed(3)}<ChevronRight size={14} /></button>
        <div className="run-detail-layout">
          <div className="run-tabs" role="tablist" aria-label="当前运行详情">
            {([['overview', '成果', <LayoutDashboard size={15} />], ['plan', '计划', <Workflow size={15} />], ['evidence', '变更', <ShieldCheck size={15} />], ['resources', '资源', <Gauge size={15} />], ['logs', '日志', <Activity size={15} />], ['delivery', '交付', <GitMerge size={15} />]] as const).map(([key, label, icon]) => <button role="tab" aria-selected={runTab === key} className={runTab === key ? 'selected' : ''} key={key} onClick={() => selectRunTab(key)}>{icon}<span>{label}</span></button>)}
          </div>
          <div className={`run-tab-panel tab-${runTab}`} key={runTab} role="tabpanel" aria-live="polite">
          {runTab === 'delivery' && deliveryContent}
          {runTab === 'overview' && <RunOverview run={selected} onOpenProject={props.onOpen} onEvidence={() => selectRunTab('evidence')} />}
          {runTab === 'plan' && <>
            {selected?.status === 'awaiting_approval' && selected.contract ? <ContractEditor contract={selected.contract} busy={props.busy === 'contract'} onSave={props.onUpdateContract} /> : <ContractSummary contract={selected?.contract} raw={selected?.plan} />}
          </>}
          {runTab === 'evidence' && <div className="evidence-stack">
            {selected?.executionWorkspace && resolution === 'open' ? <DiffPanel inspection={props.inspection} loading={props.busy === 'diff'} /> : <div className="diff-empty resolved-evidence"><b>{resolution === 'merged' ? '任务已合并，隔离工作区已清理' : resolution === 'discarded' ? '任务已放弃，隔离工作区已清理' : '尚未创建可检查的工作区'}</b><span>{resolution === 'merged' ? '源项目保留交付成果；此处不再读取已清理的工作区。' : resolution === 'discarded' ? '本任务没有交付到源项目。' : '执行开始后将显示变更证据。'}</span>{selected?.deliveryEvidence ? <><code>提交 {selected.deliveryEvidence.commit}</code><ul>{selected.deliveryEvidence.changedFiles.map((file) => <li key={file}>{file}</li>)}</ul></> : resolution === 'merged' && <span>这条历史记录未保存交付快照，请在源项目中查看 Git 历史。</span>}{resolution === 'merged' && <button className="quiet-button" onClick={props.onOpen}>打开成果目录</button>}</div>}
            {selected?.verification ? <VerificationPanel report={selected.verification} /> : <div className="diff-empty">独立验证完成后，这里会显示命令、退出码与工作区指纹。</div>}
          </div>}
          {runTab === 'resources' && <RunResourceLedger run={selected} onInspect={(metric) => { setFocusedMetric(metric); setLogFilter('all'); selectRunTab('logs') }} />}
          {runTab === 'logs' && <div className="event-panel">
            <div className="panel-title event-panel-title"><span><Activity size={15} />运行输出</span><span>{props.running && <button className="stop" onClick={props.onPause}><Pause size={14} />暂停</button>}{selected?.status === 'paused' && <button className="stop resume" onClick={props.onResume}><RotateCcw size={14} />恢复</button>}{props.running && <button className="stop" onClick={props.onCancel}><CircleStop size={14} />取消</button>}</span></div>
            {focusedMetric && <div className="focused-stage-filter"><span><Gauge size={14} />正在定位：{focusedMetric.label}{focusedMetric.problem ? ` · ${focusedMetric.problem}` : ''}</span><button onClick={() => setFocusedMetric(null)}>查看完整日志</button></div>}
            <div className="log-filter" role="tablist" aria-label="日志显示方式">{([['progress', '关键进度'], ['model', '模型输出'], ['all', '全部事件']] as const).map(([key, label]) => <button role="tab" aria-selected={logFilter === key} className={logFilter === key ? 'selected' : ''} key={key} onClick={() => setLogFilter(key)}>{label}</button>)}</div>
            <div className="terminal-log">
              {visibleEventGroups.length === 0 ? <div className="terminal-empty">{events.length ? '当前分类暂无输出，可切换到“全部事件”。' : selected?.status === 'failed' ? '此任务未保存运行输出。可查看上方失败原因，或在“变更”中检查已有产出。' : '启动任务后，运行输出会实时显示在这里。'}</div> : visibleEventGroups.map((group, index) => group.modelOutput ? (
                <ModelOutputEventCard group={group} key={`${group.at}-${index}`} />
              ) : <div className={`event-timeline-item ${group.kind}`} key={`${group.at}-${index}`}><i /><time>{formatEventTime(group.at)}</time><span><b>{phaseLabel(group.phase)}</b>{group.message}</span></div>)}
            </div>
          </div>}
          </div>
        </div>
      </section>
  )
  return (
    <div className="page workbench document-workbench">
      <WorkspaceTabs tabs={props.documents.tabs.map((tab) => ({ id: tab.id, kind: tab.kind, title: tab.kind === 'draft' ? tab.draft.title.trim() || '新任务' : props.runs.find((run) => run.id === tab.runId)?.title || '任务记录', hasDraft: tab.kind === 'draft' && hasDraftContent(tab.draft) }))} activeId={props.documents.activeId} closedDrafts={props.documents.closedDrafts.map((tab) => ({ id: tab.id, title: tab.draft.title.trim() || tab.draft.objective.trim().slice(0, 36) || '新任务' }))} onSelect={(id) => props.onDocument({ type: 'select', id })} onClose={(id) => props.onDocument({ type: 'close', id })} onRestore={(id) => props.onDocument({ type: 'restore', id })} onNew={props.onNewTask} />
      <div className="workbench-document-body">

        {props.active === 'empty' ? <section className="workspace-empty"><TerminalSquare size={28} /><h1>开始新的工作</h1><p>打开已有任务，或新建一个独立任务页签。关闭的草稿可从上方恢复。</p><button className="primary" onClick={props.onNewTask}><Plus size={15} />新任务</button></section> : props.active === 'run' ? selected ? runContent : <div role="status" className="loading">正在载入任务…</div> : <>
      <section className="composer-card workbench-surface" data-task-mode={taskMode} id="workspace-draft-panel" role="tabpanel" aria-labelledby={workspaceTabId(props.documents.activeId)}>
        <div className="composer-head"><div><span className="composer-kicker">任务工作区</span><h1>开始一个新任务</h1></div><div className="task-kind-selector" role="tablist" aria-label="任务运行方式"><button role="tab" aria-selected={taskMode === 'run'} className={taskMode === 'run' ? 'task-kind-run selected' : 'task-kind-run'} onClick={() => setTaskMode('run')}><Play size={14} />普通任务<span>完成一次交付闭环</span></button><button role="tab" aria-selected={taskMode === 'goal'} className={taskMode === 'goal' ? 'task-kind-goal selected' : 'task-kind-goal'} onClick={() => setTaskMode('goal')}><Target size={14} />长期目标<span>持续拆解、循环与恢复</span></button></div></div>
        <div className="task-mode-hint" role="note" aria-live="polite">{taskMode === 'goal' ? <Target size={20} /> : <Play size={20} />}<span><b>{taskMode === 'goal' ? '长期目标 · 分阶段持续交付' : '普通任务 · 完成一次明确的改动'}</b><small>{taskMode === 'goal' ? '填写最终目标与逐行成功标准，Foreman 会在预算范围内持续推进。' : '描述预期结果与验收要求，Foreman 会依次规划、实现和审核。'}</small></span></div>
        <div className="composer-input-stack">
          <label className="draft-field"><span>任务标题（可选）</span><input className="title-input" value={props.title} onChange={(event) => props.onTitle(event.target.value)} placeholder="输入任务标题，让任务更清晰" /></label>
          <label className="draft-field"><span>任务描述（必填）</span><textarea className="composer-objective" value={props.objective} onChange={(event) => props.onObjective(event.target.value)} placeholder={taskMode === 'goal' ? '例如：持续完成认证系统升级，直到所有成功标准均通过验证……' : '例如：为当前项目增加基于邮箱的登录，并补充集成测试……'} /></label>
        </div>
        {taskMode === 'goal' && <div className="draft-goal-fields"><label className="goal-criteria-field"><span><b>成功标准</b><small>每行一个可检查的结果；例如“登录测试全部通过”。</small></span><textarea value={goalCriteria} onChange={(event) => setGoalCriteria(event.target.value)} placeholder={'例如：\n登录、刷新与注销测试全部通过\n刷新令牌重放会被拒绝\n现有公开接口保持兼容'} /></label>
          <GoalBudgetFields value={goalBudget} onChange={setGoalBudget} />
        </div>}
        {settings && (Object.keys(roleMeta) as RoleKey[]).some((role) => settings.roles[role].executor !== 'custom' && executorReadiness(settings.roles[role].executor, props.capabilities).state !== 'available') && <p className="draft-environment-warning"><ShieldCheck size={14} />部分执行器尚未就绪，请在开始前检查<button onClick={props.onConfigureConnectors}>连接器</button>。</p>}
        <div className="composer-foot">
          <div className="draft-configuration">
          <div className="draft-context"><FolderGit2 size={15} /><span>项目上下文</span><b>{settings ? workspaceName(settings.workspace) : '正在载入项目'}</b><small>独立工作区</small><button className="quiet-button" onClick={props.onOpenProjects}>切换项目</button></div>
          <details className="draft-role-details"><summary>角色与流程 <span>规划 → 实现 → 审核</span></summary><div className="role-chips">{settings && (Object.keys(roleMeta) as RoleKey[]).map((key) => <RoleChip key={key} role={key} config={settings.roles[key]} />)}</div><button className="quiet-button" onClick={props.onConfigureWorkflow}>设置角色与流程</button></details>
          </div>
          <div className="composer-submit"><span><b>{props.draftSaveError ? '草稿仅保留在当前窗口' : props.objective || props.title || goalCriteria ? '草稿已保存到本机' : '独立创建新任务'}</b><small>{taskMode === 'goal' ? '目标将持续运行，并在每个可验证节点经过实现、审核与交付。' : '将在当前项目创建隔离 worktree，并按上述角色推进任务。'}</small></span><div className="composer-submit-actions"><button className="workflow-settings-shortcut" aria-label="设置角色与流程" title="前往设置中的角色与流程" onClick={props.onConfigureWorkflow}><Settings2 size={15} />角色与流程</button><button className="primary" disabled={Boolean(props.busy) || !settings || !props.objective.trim() || (taskMode === 'goal' && (!goalCriteria.split('\n').some((item) => item.trim()) || Boolean(goalBudgetError(goalBudget))))} onClick={() => taskMode === 'goal' ? props.onStartGoal(goalCriteria.split('\n').map((item) => item.trim()).filter(Boolean), goalBudget) : props.onStart()}>{taskMode === 'goal' ? <Target size={16} /> : <Play size={16} fill="currentColor" />}{props.busy === 'start' || props.busy === 'goal-create' ? '正在创建…' : taskMode === 'goal' ? '启动长期目标' : '开始任务'}</button></div></div>
        </div>
      </section>

      <section className="draft-recent-tasks" aria-label="最近任务"><h3>最近任务</h3>{props.recentRuns.length ? <div className="draft-recent-grid">{props.recentRuns.map((run) => <button className="draft-recent-card" key={run.id} onClick={() => props.onSelectRun(run.id)}>
        <span className="draft-recent-title"><FileDiff size={17} /><b>{run.title}</b><ChevronRight size={15} /></span>
        <span className="draft-recent-meta"><span className={`status-badge ${runStatusClass(run)}`}>{runStatusLabel(run)}</span><time dateTime={run.updatedAt}>{formatDate(run.updatedAt)}</time></span>
      </button>)}</div> : <p>当前项目还没有任务，从上方描述目标开始。</p>}</section>
      <p className="draft-preservation-note">切换任务和页面会保留草稿；草稿按项目分别保存。</p>
        </>}
      </div>
      {props.active === 'run' && selected && approvalOpen && !approvalMinimized && (selected.status === 'awaiting_approval' || selected.status === 'awaiting_review_approval') && <ApprovalPanel run={selected} busy={props.busy} onMinimize={() => setApprovalMinimized(true)} onCommand={props.onRunCommand} />}
    </div>
  )
}

function DeliveryGuidePanel({ guide, busy, onStep, onRefresh, onClose }: {
  guide: DeliveryGuide; busy?: string; onStep: (action: DeliveryGuideAction) => void; onRefresh: () => void; onClose: () => void
}) {
  return <section className="delivery-guide">
    <div className="delivery-guide-head"><span><GitMerge size={17} /><span><small>DELIVERY GUIDE</small><b>交付向导 · 逐步完成</b></span></span><div><button className="quiet-button" disabled={Boolean(busy)} onClick={onRefresh}><RefreshCw size={13} />重新检查</button><button className="icon-refresh" title="关闭交付向导" onClick={onClose}><X size={14} /></button></div></div>
    <p className="delivery-guide-intro">每次只执行当前就绪的一步。Foreman 不会丢弃源项目的已有改动，合并与清理前会再次请你确认。</p>
    <div className="delivery-guide-steps">{guide.steps.map((step, index) => <article className={step.status} key={step.key}>
      <span className="delivery-step-index">{step.status === 'done' ? <Check size={14} /> : index + 1}</span>
      <span className="delivery-step-copy"><b>{step.title}</b><small>{step.description}</small></span>
      {step.actionLabel ? <button className={step.key === 'merge_branch' || step.key === 'cleanup' ? 'merge-button' : 'quiet-button'} disabled={Boolean(busy)} onClick={() => onStep(step.key)}>{busy === `delivery-${step.key}` ? <LoaderCircle className="spin" size={13} /> : <ChevronRight size={13} />}{step.actionLabel}</button> : <span className={`delivery-step-state ${step.status}`}>{step.status === 'done' ? '已完成' : '等待前一步'}</span>}
    </article>)}</div>
  </section>
}

function RepositoryPublishGuide({ repository, githubDelivery, resolution, deliveryGuide, plan, busy, confirmation, onConfirmation, onPreview, onPreviewPublish, onExecute, onCancel, onOpenRemote, onOpenLocalGuide, onOpenRepository, onOpenResult, onRefresh, onLocalStep, onAdvanceLocalDelivery, onAutoLocalDelivery }: {
  repository: RepositoryInspection; githubDelivery: GitHubDeliveryStatus; resolution: 'open' | 'merged' | 'discarded'
  deliveryGuide: DeliveryGuide | null
  plan: GitOperationPlan | null; busy?: string; confirmation: string; onConfirmation: (value: string) => void
  onPreview: () => void; onPreviewPublish: (remoteUrl?: string) => void; onExecute: () => void; onCancel: () => void; onOpenRemote: (url: string) => void
  onOpenLocalGuide: () => void; onOpenRepository: () => void; onOpenResult: () => void; onRefresh: () => void; onLocalStep: (action: DeliveryGuideAction) => void
  onAdvanceLocalDelivery: () => void; onAutoLocalDelivery: () => void
}) {
  const planAnchor = useRef<HTMLDivElement>(null)
  const [publishSetupOpen, setPublishSetupOpen] = useState(false)
  const [publishRemoteUrl, setPublishRemoteUrl] = useState('')
  const locallyMerged = resolution === 'merged'
  const githubConnected = repository.provider === 'github' && Boolean(repository.remoteWebUrl)
  const hasUpstream = Boolean(repository.upstream)
  const needsPush = repository.ahead > 0
  const pushed = locallyMerged && githubConnected && hasUpstream && !needsPush
  const prReady = Boolean(githubDelivery.pullRequest)
  const nextLocalStep = deliveryGuide?.steps.find((step) => step.status === 'ready' && step.actionLabel)
  const autoAdvance = () => {
    if (!locallyMerged) { onAutoLocalDelivery(); return }
    if (!githubConnected || !hasUpstream) { setPublishSetupOpen(true); return }
    if (needsPush && !plan) { onPreview(); return }
    if (plan) { planAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return }
    onRefresh()
  }
  return <section className="repository-publish-guide">
    <div className="repository-publish-head"><span><Github size={15} /><span><small>SAFE DELIVERY · 1—2—3</small><b>安全交付</b></span></span><div>{!locallyMerged && resolution === 'open' && <button className="repository-auto-advance" disabled={Boolean(busy)} onClick={autoAdvance}><Sparkles size={12} />自动推进</button>}{repository.remoteWebUrl && <button title="打开 GitHub 仓库" onClick={() => onOpenRemote(repository.remoteWebUrl!)}><ExternalLink size={12} /></button>}</div></div>
    <p className="repository-auto-note">{locallyMerged ? '本地交付已完成。推送 GitHub 是可选的下一步，需要预览并确认。' : resolution === 'discarded' ? '此任务已放弃，本地交付操作已结束。' : '自动完成本地步骤；远端写入前仍需确认。'}</p>
    <div className="repository-publish-steps">
      <article className={locallyMerged ? 'done' : 'ready'}><i>{locallyMerged ? <Check size={12} /> : '1'}</i><span><b>本地合并</b><small>{locallyMerged ? '已合并至源项目' : nextLocalStep ? `下一步：${nextLocalStep.title}` : '检查 worktree'}</small></span><button className="repository-publish-action" disabled={Boolean(busy)} onClick={locallyMerged ? onOpenResult : deliveryGuide ? onAdvanceLocalDelivery : onOpenLocalGuide}>{locallyMerged ? <FolderGit2 size={12} /> : <GitMerge size={12} />}{locallyMerged ? '查看结果' : nextLocalStep?.actionLabel ?? '检查状态'}<ChevronRight size={12} /></button>{deliveryGuide && !locallyMerged && <div className="repository-local-substeps">{deliveryGuide.steps.map((step, index) => <button className={step.status} disabled={Boolean(busy) || step.status !== 'ready'} onClick={() => step.status === 'ready' && onLocalStep(step.key)} key={step.key}><i>{step.status === 'done' ? <Check size={10} /> : index + 1}</i><span><b>{step.title}</b><small>{step.status === 'ready' ? step.actionLabel : step.status === 'done' ? '已完成' : '等待前一步'}</small></span>{step.status === 'ready' && <ChevronRight size={11} />}</button>)}</div>}</article>
      <article className={pushed ? 'done' : locallyMerged ? 'ready' : 'pending'}><i>{pushed ? <Check size={12} /> : '2'}</i><span><b>推送 GitHub</b><small>{!githubConnected ? '绑定远端后首次发布' : !hasUpstream ? '建立上游分支' : pushed ? '已同步' : locallyMerged ? `${repository.ahead} 个 commit 待推送` : '等待本地合并'}</small></span><button className="repository-publish-action" disabled={Boolean(busy)} onClick={!locallyMerged ? onOpenRepository : !githubConnected || !hasUpstream ? () => setPublishSetupOpen(!publishSetupOpen) : pushed ? onRefresh : plan ? () => planAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) : onPreview}>{!githubConnected || !hasUpstream ? <GitBranch size={12} /> : pushed ? <RefreshCw size={12} /> : <ShieldCheck size={12} />}{!githubConnected ? '绑定并发布' : !hasUpstream ? '建立上游' : pushed ? '检查同步' : plan ? '继续确认' : '预览推送'}<ChevronDown size={12} /></button></article>
      <article className={prReady ? 'done' : pushed ? 'ready' : 'pending'}><i>{prReady ? <Check size={12} /> : '3'}</i><span><b>检查 PR / CI</b><small>{prReady ? `监控 PR #${githubDelivery.pullRequest!.number}` : pushed ? '刷新远端状态' : '推送后开始监控'}</small></span><button className="repository-publish-action" disabled={Boolean(busy) || !githubConnected} onClick={onRefresh}><RefreshCw size={12} />刷新监控<ChevronRight size={12} /></button>{prReady && <button className="repository-publish-link" onClick={() => onOpenRemote(githubDelivery.pullRequest!.url)}><GitPullRequest size={11} />打开 PR #{githubDelivery.pullRequest!.number}</button>}</article>
    </div>
    {publishSetupOpen && !hasUpstream && <div className="repository-first-publish">
      <span><ShieldCheck size={13} /><span><b>首次发布保护</b><small>{repository.remoteUrl ? `使用现有 ${repository.remoteName ?? 'remote'}：${repository.remoteUrl}` : '输入已有的 GitHub 空仓库地址；Foreman 不会替你新建仓库。'}</small></span></span>
      {!repository.remoteUrl && <input aria-label="首次发布 GitHub 仓库地址" value={publishRemoteUrl} onChange={(event) => setPublishRemoteUrl(event.target.value)} placeholder="https://github.com/owner/repository.git" />}
      <button className="quiet-button" disabled={Boolean(busy) || (!repository.remoteUrl && !publishRemoteUrl.trim())} onClick={() => onPreviewPublish(repository.remoteUrl ? undefined : publishRemoteUrl.trim())}><ShieldCheck size={12} />预览首次发布</button>
    </div>}
    {plan && <div className="git-plan-panel repository-push-plan" ref={planAnchor}>
      <div className="git-plan-head"><span><ShieldCheck size={14} /><span><small>{plan.kind === 'publish' ? 'SAFE FIRST PUBLISH' : 'SAFE PUSH PREVIEW'}</small><b>{plan.summary}</b></span></span><button title="关闭推送预览" onClick={onCancel}><X size={13} /></button></div>
      <code>{plan.command}</code>
      <ul>{plan.impact.map((item) => <li key={item}>{item}</li>)}</ul>
      {plan.blockers.length ? <div className="git-blockers">{plan.blockers.map((blocker) => <span key={blocker}><X size={11} />{blocker}</span>)}</div> : <div className="git-confirm"><label><span>输入 <code>{plan.confirmationPhrase}</code> 才执行</span><input value={confirmation} onChange={(event) => onConfirmation(event.target.value)} placeholder={plan.confirmationPhrase} /></label><div><span>仅推送当前 HEAD，不会 force push</span><button className="danger-confirm" disabled={Boolean(busy) || confirmation !== plan.confirmationPhrase} onClick={onExecute}>{busy === 'git-push-execute' ? <LoaderCircle className="spin" size={12} /> : <Github size={12} />}{plan.kind === 'publish' ? '确认首次发布' : '确认推送'}</button></div></div>}
    </div>}
  </section>
}

function ModelOutputEventCard({ group }: { group: RunEventGroup }) {
  const [expanded, setExpanded] = useState(() => group.message.length < 900)
  return <article className="model-output-card" data-kind={group.kind} data-expanded={expanded}>
    <button className="model-output-toggle" aria-expanded={expanded} aria-label={expanded ? '收起模型输出' : '展开模型输出'} onClick={() => setExpanded(!expanded)}>
      <span><b>{phaseLabel(group.phase)} · {group.kind === 'stderr' ? '诊断输出' : '模型输出'}</b><small>{expanded ? '点击收起长输出' : `${group.message.length.toLocaleString('zh-CN')} 字符 · 点击展开`}</small></span>
      <time>{formatEventTime(group.at)}</time>
      <ChevronDown size={14} />
    </button>
    {expanded && <pre>{group.message}</pre>}
  </article>
}

function RunResourceLedger({ run, onInspect }: { run?: RunSummary; onInspect?: (metric: RunStageMetric) => void }) {
  const metrics = run?.stageMetrics ?? []
  const totalDuration = metrics.reduce((sum, metric) => sum + metric.durationMs, 0)
  const totalInput = metrics.reduce((sum, metric) => sum + metric.inputTokens, 0)
  const totalOutput = metrics.reduce((sum, metric) => sum + metric.outputTokens, 0)
  const totalCost = metrics.reduce((sum, metric) => sum + metric.costUsd, 0)
  return <section className="resource-ledger">
    <div className="resource-ledger-head"><span><Gauge size={15} /><span><b>步骤耗时与资源</b><small>按真实模型调用和本地验证分别统计；CLI 未报告 Token 时显示 0。</small></span></span><div><span><b>{formatDuration(totalDuration)}</b><small>累计耗时</small></span><span><b>{formatTokenCount(totalInput + totalOutput)}</b><small>总 Token</small></span><span><b>${totalCost.toFixed(3)}</b><small>已报告费用</small></span></div></div>
    {!metrics.length ? <div className="resource-empty">{run ? '运行步骤完成后，这里会显示每一步的耗时、模型、输入 / 输出 Token、费用与本地验证命令数。' : '开始任务后，这里会实时累计每一步的耗时、Token、费用与本地验证资源。'}</div>
      : <div className="resource-rows">{metrics.map((metric, index) => <article key={metric.id} className={metric.status}>
        <span className={`resource-stage ${metric.stage}`}>{String(index + 1).padStart(2, '0')}</span>
        <span className="resource-identity"><b>{metric.label}</b><small>{metric.executor}{metric.model ? ` · ${metric.model}` : ''}</small></span>
        <span><small>耗时</small><b>{formatDuration(metric.durationMs)}</b></span>
        <span><small>输入</small><b>{formatTokenCount(metric.inputTokens)}</b></span>
        <span><small>输出</small><b>{formatTokenCount(metric.outputTokens)}</b></span>
        <span><small>费用</small><b>${metric.costUsd.toFixed(3)}</b></span>
        <span className="resource-detail"><small>{metric.problem ? '问题定位' : '资源'}</small><b title={metric.problem}>{metric.problem || metric.resourceDetail}</b>{onInspect && <button onClick={() => onInspect(metric)}>查看此步骤日志</button>}</span>
      </article>)}</div>}
  </section>
}

function RepositoryControl(props: {
  repository: RepositoryInspection; githubDelivery: GitHubDeliveryStatus; busy?: string; expanded?: boolean
  onChoose: () => void; onCloneGitHub: (url: string) => void; onRefreshRepository: () => void; onOpenRemote: (url: string) => void
}) {
  const { repository, githubDelivery } = props
  const [githubUrl, setGithubUrl] = useState('')
  const [showProjectDetails, setShowProjectDetails] = useState(Boolean(props.expanded))
  useEffect(() => setShowProjectDetails(Boolean(props.expanded)), [repository.workspace, props.expanded])
  const [repositoryTab, setRepositoryTab] = useState<'project' | 'delivery'>('project')
  const pullRequest = githubDelivery.pullRequest
  return <section className="delivery-control">
    <div className="delivery-control-head"><div><span className="repository-icon"><FolderGit2 size={18} /></span><span><small>项目与交付 · REPOSITORY & DELIVERY</small><b>{repository.connected || repository.bootstrapEligible ? repository.name : '连接项目'}</b><em>{repository.connected ? repository.root : repository.bootstrapEligible ? `${repository.root} · ${repository.message}` : repository.message}</em></span></div><div>{repository.connected && <><span className="connected-project-state"><GitBranch size={13} />{repository.branch} · {repository.conflicts ? `${repository.conflicts} 个冲突` : repository.clean ? '工作区干净' : `${repository.staged + repository.unstaged + repository.untracked} 项改动`}</span><button className="quiet-button" aria-expanded={showProjectDetails} onClick={() => setShowProjectDetails(!showProjectDetails)}>{showProjectDetails ? '收起项目详情' : '项目详情与切换'}</button></>}<button className="icon-refresh" title="刷新 Git、PR 与 CI/CD 状态" onClick={props.onRefreshRepository}><RefreshCw size={14} /></button></div></div>
    {(!repository.connected || showProjectDetails) && <div className="repository-connect compact">
      <button className="repository-source local" disabled={Boolean(props.busy)} onClick={props.onChoose}><FolderOpen size={17} /><span><b>打开本地项目</b><small>已有 Git 仓库或全新空文件夹</small></span></button>
      <div className="repository-source github"><Github size={17} /><span><b>从 GitHub 克隆</b><small>使用本机 Git 或 SSH 凭据</small></span><div><input aria-label="GitHub 仓库地址" placeholder="https://github.com/owner/repo" value={githubUrl} onChange={(event) => setGithubUrl(event.target.value)} /><button disabled={!githubUrl.trim() || Boolean(props.busy)} onClick={() => props.onCloneGitHub(githubUrl)}><CloudDownload size={13} />克隆</button></div></div>
    </div>
    }
    {repository.bootstrapEligible && <div className="repository-bootstrap"><span><Sparkles size={16} /></span><div><small>NEW PROJECT · 从零开始</small><b>{repository.bootstrapKind === 'empty-directory' ? '首个任务将安全初始化项目' : '首个任务将建立首个 Git 基线'}</b><p>Foreman 会创建 <code>main</code> 的空基线，再在独立 <code>foreman/…</code> worktree 中规划与写代码；不会自动导入任何已有文件。</p></div></div>}
    {repository.connected && showProjectDetails && <>
      <div className="repository-tabs" role="tablist" aria-label="项目与交付详情"><button role="tab" aria-selected={repositoryTab === 'project'} className={repositoryTab === 'project' ? 'selected' : ''} onClick={() => setRepositoryTab('project')}><FolderGit2 size={13} />项目状态</button><button role="tab" aria-selected={repositoryTab === 'delivery'} className={repositoryTab === 'delivery' ? 'selected' : ''} onClick={() => setRepositoryTab('delivery')}><Workflow size={13} />PR 与 CI/CD</button></div>
      {repositoryTab === 'project' && <>
      <div className="delivery-overview">
        <div className="repo-primary"><span className={repository.hasCommits && repository.clean ? 'repo-state clean' : 'repo-state dirty'}>{!repository.hasCommits ? 'NEW PROJECT' : repository.clean ? 'CLEAN' : 'CHANGES'}</span><b><GitBranch size={14} />{repository.branch}</b><small>{repository.head ?? '等待自动基线'}{repository.upstream ? ` · ${repository.upstream}` : ' · 无上游分支'}</small></div>
        <div className="repo-metrics"><span><b>{repository.ahead}</b><small>AHEAD</small></span><span><b>{repository.behind}</b><small>BEHIND</small></span><span><b>{repository.staged}</b><small>STAGED</small></span><span><b>{repository.unstaged}</b><small>UNSTAGED</small></span><span><b>{repository.untracked}</b><small>UNTRACKED</small></span><span className={repository.conflicts ? 'danger' : ''}><b>{repository.conflicts}</b><small>CONFLICTS</small></span></div>
        <div className="repo-remote"><span><Github size={14} /><span><b>{repository.provider === 'github' ? 'GitHub' : repository.remoteName ?? '本地仓库'}</b><small>{repository.remoteUrl ?? '尚未配置 Git remote'}</small></span></span>{repository.remoteWebUrl && <button className="quiet-button" onClick={() => props.onOpenRemote(repository.remoteWebUrl!)}><ExternalLink size={12} />打开仓库</button>}</div>
      </div>
      </>}
      {repositoryTab === 'delivery' && <>
      {repository.provider === 'github' && !githubDelivery.authenticated && <div className="gh-setup-guide">
        <div className="gh-setup-head"><span><Github size={16} /><span><b>启用 GitHub 交付监控</b><small>{githubDelivery.message}</small></span></span><button className="quiet-button" onClick={() => props.onOpenRemote('https://cli.github.com/')}><ExternalLink size={12} />官方安装指南</button></div>
        <div className="gh-setup-steps">
          <article className={githubDelivery.available ? 'done' : 'active'}><i>{githubDelivery.available ? <Check size={12} /> : '1'}</i><span><small>安装到本机</small><b><code>brew install gh</code></b><em>{githubDelivery.available ? `已安装 ${githubDelivery.cliVersion ?? ''}` : '没有 Homebrew 时使用右侧官方指南'}</em></span></article>
          <ChevronRight size={14} />
          <article className={githubDelivery.available ? 'active' : ''}><i>{githubDelivery.authenticated ? <Check size={12} /> : '2'}</i><span><small>登录 GitHub</small><b><code>gh auth login</code></b><em>在终端选择 GitHub.com，并按提示授权</em></span></article>
          <ChevronRight size={14} />
          <article><i>3</i><span><small>完成检测</small><b>返回 Foreman 刷新</b><em>这里只检测状态，不代替你登录或保存凭据</em></span><button onClick={props.onRefreshRepository}><RefreshCw size={11} />重新检测</button></article>
        </div>
      </div>}
      <div className="delivery-monitor-grid">
        <article className="delivery-monitor-card">
          <div className="monitor-card-head"><span><GitPullRequest size={15} /><b>Pull Request</b></span>{pullRequest && <button onClick={() => props.onOpenRemote(pullRequest.url)}><ExternalLink size={11} /></button>}</div>
          {!githubDelivery.authenticated ? <div className="monitor-empty"><Github size={19} /><b>GitHub 状态不可用</b><span>{githubDelivery.message}</span></div>
            : !pullRequest ? <div className="monitor-empty"><GitPullRequest size={19} /><b>当前分支没有 PR</b><span>{githubDelivery.message}</span></div>
            : <div className="pr-summary"><span className={`delivery-state ${deliveryTone(pullRequest.state, pullRequest.mergeStateStatus)}`}>{pullRequest.isDraft ? 'DRAFT' : pullRequest.state}</span><h3>#{pullRequest.number} {pullRequest.title}</h3><p>{pullRequest.headRefName} → {pullRequest.baseRefName}</p><div><span><small>REVIEW</small><b>{pullRequest.reviewDecision || 'PENDING'}</b></span><span><small>MERGE</small><b>{pullRequest.mergeStateStatus || 'UNKNOWN'}</b></span><span><small>CHECKS</small><b>{pullRequest.checks.length}</b></span></div></div>}
          {pullRequest?.checks.length ? <div className="check-list">{pullRequest.checks.slice(0, 5).map((check) => <button key={check.name} disabled={!check.url} onClick={() => check.url && props.onOpenRemote(check.url)}><i className={deliveryTone(check.status, check.conclusion)} /> <span><b>{check.name}</b><small>{check.conclusion || check.status}</small></span></button>)}</div> : null}
        </article>
        <article className="delivery-monitor-card">
          <div className="monitor-card-head"><span><Workflow size={15} /><b>CI / CD</b></span><small>{githubDelivery.polledAt ? `更新 ${formatDate(githubDelivery.polledAt)}` : '等待刷新'}</small></div>
          {!githubDelivery.workflowRuns.length ? <div className="monitor-empty"><Workflow size={19} /><b>暂无工作流运行</b><span>{githubDelivery.message}</span></div>
            : <div className="workflow-list">{githubDelivery.workflowRuns.map((run) => <button key={run.id} onClick={() => props.onOpenRemote(run.url)}><i className={deliveryTone(run.status, run.conclusion)} /><span><b>{run.workflowName}</b><small>{run.title}</small></span><em>{run.conclusion || run.status}</em></button>)}</div>}
        </article>
      </div>
      </>}
      <div className="repository-footer"><span>任务代码在独立 <code>foreman/…</code> worktree 中完成；Commit、合并与清理会在任务完成后的交付向导中逐步确认。</span></div>
    </>}
  </section>
}

function deliveryTone(status?: string, conclusion?: string): string {
  const value = `${status ?? ''} ${conclusion ?? ''}`.toLowerCase()
  if (/success|passed|completed|clean|open/.test(value) && !/failure|cancel/.test(value)) return 'success'
  if (/failure|failed|error|cancel|timed_out|blocked|dirty/.test(value)) return 'failure'
  if (/queued|pending|progress|waiting|requested|draft/.test(value)) return 'running'
  return 'neutral'
}

function WorkflowView({ settings, capabilities, agentEnvironment, onChange, onDesktop, notice, onRefreshEnvironment, section, onSectionChange }: {
  section?: SettingsSection; onSectionChange?: (section: SettingsSection) => void
  settings: AppSettings; capabilities: ExecutorCapability[]; agentEnvironment: AgentEnvironment; onChange: (settings: AppSettings) => void
  onDesktop: (kind: ExecutorKind) => void; notice: string; onRefreshEnvironment: () => void | Promise<void>
}) {
  const [capabilityScan, setCapabilityScan] = useState<ModelCapabilityScan | null>(() => {
    try { const saved = window.localStorage.getItem('foreman:model-capability-scan'); return saved ? JSON.parse(saved) as ModelCapabilityScan : null }
    catch { return null }
  })
  const [connectorKind, setConnectorKind] = useState<ExecutorKind>('codex')
  const [workflowEditor, setWorkflowEditor] = useState<RoleKey | 'parallel'>('planner')
  const [focusEditor, setFocusEditor] = useState(false)
  const workflowEditorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusEditor) return
    workflowEditorRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    workflowEditorRef.current?.focus({ preventScroll: true })
    setFocusEditor(false)
  }, [workflowEditor, focusEditor])
  const [checkingModels, setCheckingModels] = useState<ExecutorKind | null>(null)
  const [modelScanError, setModelScanError] = useState<Partial<Record<ExecutorKind, string>>>({})
  const customCheckVersions = useRef(new Map<string, number>())
  const [customModelChecks, setCustomModelChecks] = useState<Record<string, { state: 'checking' | 'ready' | 'error'; message: string }>>({})
  const updateRole = (role: RoleKey, patch: Partial<RoleConfig>) => onChange({ ...settings, roles: { ...settings.roles, [role]: { ...settings.roles[role], ...patch } } })
  const selectableModels = (kind: ExecutorKind) => selectableModelCatalog(settings, capabilityScan, kind).filter((model) => kind !== 'custom' || customModelIsComplete(model))
  const scanRoleModels = async (kind: ExecutorKind) => {
    setCheckingModels(kind)
    setModelScanError((current) => ({ ...current, [kind]: '' }))
    try {
      const scan = await window.foreman.scanModelCapabilities(buildModelCapabilityTargets(settings).filter((target) => target.executor === kind), settings.workspace)
      setCapabilityScan((previous) => {
        const next = mergeConnectorScan(previous, scan, kind)
        try { window.localStorage.setItem('foreman:model-capability-scan', JSON.stringify(next)) } catch { /* Keep the current page usable when browser storage is unavailable. */ }
        return next
      })
    }
    catch (error) { setModelScanError((current) => ({ ...current, [kind]: `模型检测未完成：${error instanceof Error ? error.message : String(error)}。请检查此连接器后重试；已保留上次结果。` })) }
    finally { setCheckingModels(null) }
  }
  const clearModelChecks = (kind: ExecutorKind, modelId?: string) => {
    setCapabilityScan((current) => {
      if (!current) return current
      const next = { ...current, models: current.models.filter((item) => item.kind !== kind || Boolean(modelId && item.model !== modelId)) }
      try { window.localStorage.setItem('foreman:model-capability-scan', JSON.stringify(next)) } catch { /* Keep the current page usable when browser storage is unavailable. */ }
        return next
    })
  }
  const updateLegacyCatalog = (kind: ExecutorKind, value: string) => {
    clearModelChecks(kind)
    const models = value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [id, label, effortText] = line.split('|').map((part) => part.trim())
      const efforts = (effortText || 'low,medium,high,xhigh,max').split(',').map((item) => item.trim()).filter((item): item is Effort => ['low', 'medium', 'high', 'xhigh', 'max'].includes(item))
      return { id, label: label || id, efforts: efforts.length ? efforts : ['medium'] as Effort[], source: 'custom' as const }
    })
    onChange({ ...settings, models: { ...settings.models, [kind]: models } })
  }
  const toggleSkill = (role: RoleKey, invocation: string) => {
    const current = settings.roles[role].skills
    updateRole(role, { skills: current.includes(invocation) ? current.filter((item) => item !== invocation) : [...current, invocation] })
  }
  const addCustomModel = () => {
    const id = `custom-${Date.now()}`
    onChange({ ...settings, models: { ...settings.models, custom: [...settings.models.custom, {
      id, label: '自定义模型', efforts: ['medium'], source: 'custom', protocol: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1', apiKey: '', remoteModel: ''
    }] } })
  }
  const updateCustomModel = (id: string, patch: Partial<AppSettings['models']['custom'][number]>) => {
    clearModelChecks('custom', id)
    customCheckVersions.current.set(id, (customCheckVersions.current.get(id) ?? 0) + 1)
    setCustomModelChecks((current) => { const next = { ...current }; delete next[id]; return next })
    onChange({ ...settings, models: { ...settings.models, custom: settings.models.custom.map((model) => model.id === id ? { ...model, ...patch } : model) } })
  }
  const removeCustomModel = (id: string) => { customCheckVersions.current.set(id, (customCheckVersions.current.get(id) ?? 0) + 1); clearModelChecks('custom', id); onChange({ ...settings, models: { ...settings.models, custom: settings.models.custom.filter((model) => model.id !== id) } }) }
  const probeCustomModel = async (model: ModelDefinition) => {
    const version = (customCheckVersions.current.get(model.id) ?? 0) + 1
    customCheckVersions.current.set(model.id, version)
    setCustomModelChecks((current) => ({ ...current, [model.id]: { state: 'checking', message: '正在连接远端接口…' } }))
    try {
      const status: ModelRuntimeStatus = await window.foreman.probeCustomModel(model, settings.workspace)
      if (customCheckVersions.current.get(model.id) !== version) return
      setCustomModelChecks((current) => ({ ...current, [model.id]: { state: status.available ? 'ready' : 'error', message: status.message } }))
    } catch (error) {
      if (customCheckVersions.current.get(model.id) !== version) return
      setCustomModelChecks((current) => ({ ...current, [model.id]: { state: 'error', message: error instanceof Error ? error.message : String(error) } }))
    }
  }
  return (
    <>
      {(!section || section === 'settings-connectors') && <ConnectorsView kind={connectorKind} onSelect={setConnectorKind} settings={settings} capabilities={capabilities} environment={agentEnvironment} notice={notice} scan={capabilityScan} checking={Boolean(checkingModels)} checkingKind={checkingModels} scanError={modelScanError[connectorKind] ?? ''} onScan={(kind) => void scanRoleModels(kind)} onRefresh={onRefreshEnvironment} onDesktop={onDesktop} onWorkflow={() => onSectionChange?.('role-workflow-settings')} onCatalog={updateLegacyCatalog} customEditor={<section className="custom-model-settings" id="custom-model-settings">
        <div className="memory-settings-head"><Cpu size={18}/><div><b>自定义 API 模型</b><span>支持 OpenAI Responses 与 Anthropic Messages 兼容接口；API Key 仅作为执行器环境变量注入，不写入命令或任务日志。</span></div><div className="custom-model-heading-actions"><span className={`auto-save-status ${notice.includes('待完善') ? 'attention' : ''}`}>{notice || '修改后自动保存'}</span><button className="quiet-button custom-model-add" onClick={addCustomModel}><Plus size={14}/>添加模型</button></div></div>
        {settings.models.custom.length === 0 ? <div className="custom-model-empty"><Cpu size={19}/><span><b>尚未配置自定义模型</b><small>添加并完成配置后，可在“角色与流程”中选择 API 图标。</small></span></div> : <div className="custom-model-list">{settings.models.custom.map((model, index) => {
          const inUse = (Object.keys(settings.roles) as RoleKey[]).some((role) => settings.roles[role].executor === 'custom' && settings.roles[role].model === model.id) || settings.execution?.agents.some((agent) => agent.executor === 'custom' && agent.model === model.id)
          const check = customModelChecks[model.id]
          return <article className="custom-model-card" key={model.id}>
            <header><span><i>{String(index + 1).padStart(2, '0')}</i><span><b>{model.label || '未命名模型'}</b><small>{model.protocol === 'anthropic-messages' ? 'Anthropic Messages' : 'OpenAI Responses'} · {model.remoteModel || '待填写模型名称'}</small></span></span><div className="custom-model-actions"><button className={`custom-model-probe ${check?.state ?? ''}`} disabled={!customModelIsComplete(model) || check?.state === 'checking'} title={!customModelIsComplete(model) ? '请先完整填写 URL、API Key 和模型名称' : '向远端接口发送最小请求验证连通性'} onClick={() => void probeCustomModel(model)}>{check?.state === 'checking' ? <LoaderCircle className="spin" size={13}/> : <Activity size={13}/>} {check?.state === 'checking' ? '检测中' : '检测连接'}</button><button className="danger-button" disabled={inUse} title={inUse ? '当前有角色正在使用此模型' : '删除自定义模型'} onClick={() => removeCustomModel(model.id)}><Trash2 size={13}/>{inUse ? '使用中' : '删除'}</button></div></header>
            <div className="custom-model-fields">
              <label><span>协议</span><select value={model.protocol} onChange={(event) => { const protocol = event.target.value as 'openai-responses' | 'anthropic-messages'; updateCustomModel(model.id, { protocol, ...(model.baseUrl === 'https://api.openai.com/v1' || model.baseUrl === 'https://api.anthropic.com' ? { baseUrl: protocol === 'openai-responses' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com' } : {}) }) }}><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
              <label><span>显示名称</span><input value={model.label} onChange={(event) => updateCustomModel(model.id, { label: event.target.value })} placeholder="例如：公司内部 GPT" /></label>
              <label><span>模型名称</span><input value={model.remoteModel ?? ''} onChange={(event) => updateCustomModel(model.id, { remoteModel: event.target.value })} placeholder="例如：gpt-5.6-sol" /></label>
              <label className="custom-model-url"><span>API URL / Base URL</span><input value={model.baseUrl ?? ''} onChange={(event) => updateCustomModel(model.id, { baseUrl: event.target.value })} placeholder={model.protocol === 'anthropic-messages' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'} /></label>
              <label className="custom-model-key"><span>API Key</span><input type="password" autoComplete="off" value={model.apiKey ?? ''} onChange={(event) => updateCustomModel(model.id, { apiKey: event.target.value })} placeholder="输入该接口的 API Key" /></label>
            </div>
            {check && <div className={`custom-model-check-result ${check.state}`}><i /> <span>{check.message}</span></div>}
          </article>
        })}</div>}
      </section>} />}



      {(!section || section === 'role-workflow-settings') && <section className="workflow-diagram settings-workflow-settings" id="role-workflow-settings">
        <WorkflowOverview settings={settings} onConfigure={(target) => {
          if (target === 'verification') { onSectionChange?.('settings-verification'); return }
          setWorkflowEditor(target); setFocusEditor(true)
        }} />
        <div className="workflow-editor" ref={workflowEditorRef} tabIndex={-1} role="region" aria-label="流程配置编辑区">
        <div className="workflow-editor-nav" role="group" aria-label="选择要编辑的流程角色">
          {([['planner', '规划者'], ['implementer', '主执行者'], ['parallel', '并行与成员'], ['reviewer', '审核者']] as const).map(([key, label]) => <button key={key} aria-pressed={workflowEditor === key} onClick={() => setWorkflowEditor(key)}>{label}</button>)}
        </div>
        <div className="workflow-editor-caption"><span>{workflowEditor === 'parallel' ? '设置并行上限与执行成员' : `配置${workflowEditor === 'implementer' ? '主执行者' : roleMeta[workflowEditor].label}`}</span><small>对新任务生效</small></div>
        {workflowEditor === 'reviewer' &&
        <div className="workflow-policy-strip"><div><RotateCcw size={15} /><span><b>Reviewer 返工循环</b><small>审核要求修改时重新进入执行；达到上限后停止并交给人工决策。</small></span></div><label><span>最大返工轮次</span><input type="number" min="0" max="8" value={settings.maxReviewLoops} onChange={(event) => onChange({ ...settings, maxReviewLoops: Number(event.target.value) })} /></label></div>
        }
        {workflowEditor !== 'parallel' && <div className="role-flow">
        {([workflowEditor] as RoleKey[]).map((role) => {
          const meta = roleMeta[role]; const config = settings.roles[role]
          const availableModels = selectableModels(config.executor)
          const modelDefinition = availableModels.find((model) => model.id === config.model)
          const scannedModel = capabilityScan?.models.find((model) => model.kind === config.executor && model.model === config.model)
          const availableEfforts = scannedModel?.supportedEfforts.length ? scannedModel.supportedEfforts : modelDefinition?.efforts ?? ['low', 'medium', 'high', 'xhigh', 'max']
          const readiness = modelReadiness(settings, capabilities, capabilityScan, config.executor, config.model)
          const providerSkills = uniqueInvocations(agentEnvironment.skills.filter((skill) => skill.provider === config.executor && skill.enabled))
          return <Fragment key={role}><div className="role-card-wrap">
            <article className={`role-card role-${role}`}>
              <div className="role-card-head"><span className="role-number">{meta.index}</span><div><small>{meta.eyebrow}</small><div className="role-title-line"><h2>{meta.label}</h2><span className={`role-model-status ${readiness.state}`} title={readiness.detail}><i /><span>{readiness.label}</span></span></div></div><Bot size={21} /></div>
              <ExecutorPicker label={`${meta.label}执行器`} value={config.executor} customAvailable={selectableModels('custom').length > 0} onChange={(executor) => {
                const first = selectableModels(executor)[0]
                updateRole(role, { executor, model: first?.id || '', effort: first?.efforts[0] ?? 'medium', skills: [], skillMode: 'auto' })
              }} />
              <label><span>模型</span><select value={config.model} onChange={(event) => { const model = event.target.value; const definition = availableModels.find((item) => item.id === model); updateRole(role, { model, ...(definition && !definition.efforts.includes(config.effort) ? { effort: definition.efforts[0] } : {}) }) }}>
                {!availableModels.some((model) => model.id === config.model) && <option value={config.model}>{config.model} · 当前配置</option>}{availableModels.map((model) => { const result = capabilityScan?.models.find((item) => item.kind === config.executor && item.model === model.id); return <option key={model.id} value={model.id}>{model.label}{result ? ` · ${result.availability === 'available' ? '上次检测通过' : result.availability === 'partial' ? '上次部分通过' : '上次检测失败'}` : capabilityScan ? ' · 未检测' : ''}</option> })}
              </select></label>
              <label><span>推理强度</span><select value={config.effort} disabled={config.executor === 'zcode' || Boolean(capabilityScan && !availableEfforts.length)} onChange={(event) => updateRole(role, { effort: event.target.value as Effort })}>
                {!availableEfforts.length && <option value={config.effort}>无可用强度</option>}{availableEfforts.map((effort) => <option value={effort} key={effort}>{effortLabel(effort)}</option>)}
              </select></label>
              {config.executor === 'zcode' && <p className="form-hint">模型、推理选项、Skill 与插件沿用 ZCode 自身配置。实现角色自动执行文件编辑与命令；规划和审核使用只读 plan 模式。</p>}
              {config.executor !== 'zcode' && <div className="role-skill-controls">
                <div className="role-skill-label"><Puzzle size={12} /><b>专用 Skill</b></div>
                <div className="skill-mode-tabs"><button className={config.skillMode === 'auto' ? 'selected' : ''} onClick={() => updateRole(role, { skillMode: 'auto' })}>自动匹配</button><button className={config.skillMode === 'explicit' ? 'selected' : ''} onClick={() => updateRole(role, { skillMode: 'explicit' })}>指定必用</button></div>
                {config.skillMode === 'auto' ? <small>{providerSkills.length} 个可用 Skill，将按任务渐进加载</small> : <div className="skill-picker visible"><div className="skill-picker-head"><span>本角色必须使用</span><b>{config.skills.length} 已选</b></div><div className="skill-options">
                  {providerSkills.length === 0 && <small>未发现该执行器的可用 Skill，请在设置中刷新环境。</small>}
                  {providerSkills.map((skill) => <label className={config.skills.includes(skill.invocation) ? 'selected' : ''} key={skill.invocation} title={`${skill.path}\n${skill.description}`}><input type="checkbox" checked={config.skills.includes(skill.invocation)} onChange={() => toggleSkill(role, skill.invocation)} /><span><b>{skill.invocation}</b><small>{scopeLabel(skill.scope)}</small></span><i><Check size={10} /></i></label>)}
                </div></div>}
              </div>}
              <details className="role-prompt-editor"><summary>编辑角色提示词</summary><label><span>角色提示词</span><textarea value={config.prompt} onChange={(event) => updateRole(role, { prompt: event.target.value })} /></label></details>
              <div className="role-health"><span>{executorLabel(config.executor)} · {readiness.label}</span><button className="connector-link" onClick={() => { setConnectorKind(config.executor); onSectionChange?.('settings-connectors') }}>查看连接器 <ChevronRight size={12} /></button></div>
            </article>
          </div></Fragment>
        })}
        </div>}
        {workflowEditor === 'parallel' && <ParallelSettings settings={settings} onChange={onChange} />}
        {workflowEditor === 'implementer' && <p className="workflow-editor-note">串行任务直接使用主执行者；并行任务审核后的返工也由主执行者完成。初次并行执行的配置请在“并行与成员”中调整。</p>}
        </div>
      </section>}
    </>
  )
}

export function AppSettingsView({ section = 'settings-connectors', onSectionChange, settings, capabilities, agentEnvironment, onChange, onRefreshEnvironment, onDesktop, onProbeMemory, onSetupTencentDb, tencentDbSetupResult, memoryHealth, notice, busy }: {
  section?: SettingsSection; onSectionChange?: (section: SettingsSection) => void
  settings: AppSettings; capabilities: ExecutorCapability[]; agentEnvironment: AgentEnvironment; onChange: (settings: AppSettings) => void
  onRefreshEnvironment: () => void | Promise<void>; onDesktop: (kind: ExecutorKind) => void; onProbeMemory: () => void; onSetupTencentDb: () => void
  tencentDbSetupResult?: TencentDbSetupResult; memoryHealth?: MemoryProviderHealth; notice: string; busy?: string
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0 }, [section])
  const group = settingsGroups.find((group) => group.id === section)!
  return <div className="page app-settings-page">
    <div className="page-command-bar"><div><span className="page-command-icon"><Settings2 size={17} /></span><span><b>设置</b><small>连接器、角色、验证与记忆</small></span></div></div>
    <div className="settings-layout"><nav className="settings-group-nav" aria-label="设置分组">{settingsGroups.map((item) => <button key={item.id} aria-current={section === item.id ? 'page' : undefined} onClick={() => onSectionChange?.(item.id)}><b>{item.label}</b><small>{item.description}</small></button>)}</nav>
    <div className="settings-content" ref={contentRef} role="region" aria-label={group.label}>
      <div className="settings-content-heading"><span><h1>{group.label}</h1><p>{group.description}</p></span>{section !== 'settings-connectors' && <span className="auto-save-status" role="status">{notice || '修改后自动保存'}</span>}</div>
    <WorkflowView settings={settings} capabilities={capabilities} agentEnvironment={agentEnvironment} onChange={onChange} onDesktop={onDesktop} notice={notice} onRefreshEnvironment={onRefreshEnvironment} section={section} onSectionChange={onSectionChange} />
    {section === 'settings-verification' && <section className="verification-settings" id="settings-verification">
      <div className="memory-settings-head"><ShieldCheck size={18} /><div><b>独立验证门禁默认值</b><span>留空命令时自动发现 package.json 中的 lint、typecheck、test、build。</span></div></div>
      <div className="settings-section-body verification-body">
        <div className="settings-switch-stack">
          <label className="toggle-row"><span><b>启用独立验证</b><small>不信任执行器的自报结果</small></span><input type="checkbox" checked={settings.verification.enabled} onChange={(event) => onChange({ ...settings, verification: { ...settings.verification, enabled: event.target.checked } })} /><i aria-hidden="true" /></label>
          <label className="toggle-row"><span><b>失败即停止</b><small>门禁失败后阻止进入审核</small></span><input type="checkbox" checked={settings.verification.stopOnFailure} onChange={(event) => onChange({ ...settings, verification: { ...settings.verification, stopOnFailure: event.target.checked } })} /><i aria-hidden="true" /></label>
        </div>
        <div className="verification-fields"><label><span>单命令超时（秒）</span><input type="number" min="10" max="3600" value={settings.verification.timeoutSeconds} onChange={(event) => onChange({ ...settings, verification: { ...settings.verification, timeoutSeconds: Number(event.target.value) } })} /></label><label><span>固定命令（每行一条；留空自动发现）</span><textarea value={settings.verification.commands.join('\n')} onChange={(event) => onChange({ ...settings, verification: { ...settings.verification, commands: lines(event.target.value) } })} /></label></div>
      </div>
    </section>}
    {section === 'settings-approvals' && <section className="verification-settings approval-settings" id="settings-approvals">
      <div className="memory-settings-head"><ShieldCheck size={18} /><div><b>人工批准与“替我批准”</b><span>低于置信度阈值时始终停下来请求人工确认；开关关闭时每次都由你批准。</span></div></div>
      <div className="approval-policy-grid">{(['planner', 'reviewer'] as const).map((key) => <article key={key}><label className="toggle-row"><span><b>{key === 'planner' ? '规划替我批准' : '审核替我批准'}</b><small>{key === 'planner' ? '保存合同并直接进入执行' : '确认审核结论并进入交付或返工'}</small></span><input type="checkbox" checked={settings.approvals[key].autoApprove} onChange={(event) => onChange({ ...settings, approvals: { ...settings.approvals, [key]: { ...settings.approvals[key], autoApprove: event.target.checked } } })} /><i aria-hidden="true" /></label><label className="confidence-field"><span>最低置信度</span><input type="range" min="0.5" max="1" step="0.05" value={settings.approvals[key].minConfidence} onChange={(event) => onChange({ ...settings, approvals: { ...settings.approvals, [key]: { ...settings.approvals[key], minConfidence: Number(event.target.value) } } })} /><b>{Math.round(settings.approvals[key].minConfidence * 100)}%</b></label></article>)}</div>
    </section>}
    {section === 'settings-memory' && <MemoryConfiguration settings={settings} health={memoryHealth} setupResult={tencentDbSetupResult} busy={busy} onChange={onChange} onProbe={onProbeMemory} onSetup={onSetupTencentDb} />}
    </div></div>
  </div>
}

function ApprovalPanel({ run, busy, onMinimize, onCommand }: { run: RunSummary; busy?: string; onMinimize: () => void; onCommand: (command: RunCommand) => void }) {
  const [feedback, setFeedback] = useState('')
  const [draft, setDraft] = useState(run.contract)
  useEffect(() => { setDraft(run.contract); setFeedback('') }, [run.id, run.status, run.contract])
  const isPlan = run.status === 'awaiting_approval'
  const updateStep = (index: number, value: string) => draft && setDraft({ ...draft, steps: draft.steps.map((step, stepIndex) => stepIndex === index ? { ...step, description: value } : step) })
  return <div className="approval-scrim" role="presentation"><section className="approval-panel" role="dialog" aria-modal="true" aria-label={isPlan ? '批准规划' : '批准审核'}>
    <header><span><ShieldCheck size={19} /><span><small>{isPlan ? 'PLAN APPROVAL · 规划批准' : 'REVIEW APPROVAL · 审核批准'}</small><b>{isPlan ? '确认执行合同' : '确认审核结论'}</b></span></span><button className="quiet-button" onClick={onMinimize}>缩小到右侧</button></header>
    <div className="approval-panel-body">{isPlan && draft ? <>
      <label><span>计划摘要</span><textarea value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
      <div className="approval-step-list">{draft.steps.map((step, index) => <label key={step.id}><span><b>{String(index + 1).padStart(2, '0')} · {step.title}</b><small>{step.acceptanceCriteria.join('；')}</small></span><textarea value={step.description} onChange={(event) => updateStep(index, event.target.value)} /></label>)}</div>
    </> : <div className="review-decision-card"><span className={`review-verdict ${run.reviewDecision?.verdict}`}>{run.reviewDecision?.verdict}</span><h3>{run.reviewDecision?.summary}</h3><p>审核置信度 {Math.round((run.reviewDecision?.confidence ?? 0) * 100)}% · 独立验证 {run.verification?.status ?? '未知'}</p>{run.reviewDecision?.findings.map((finding) => <article key={`${finding.severity}-${finding.title}`}><b>{finding.title}</b><span>{finding.requiredChange}</span></article>)}</div>}
      <label className="approval-feedback"><span>补充意见（可选）</span><textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder={isPlan ? '批准后交给执行者的补充要求；重做规划时必须填写。' : '确认交付或返工时附带给后续步骤的意见。'} /></label>
    </div>
    <footer>{isPlan ? <><button className="quiet-button" disabled={!feedback.trim() || Boolean(busy)} onClick={() => onCommand({ type: 'replan', feedback })}><RotateCcw size={14} />带意见重做规划</button><button className="primary" disabled={!draft || Boolean(busy)} onClick={() => draft && onCommand({ type: 'approve_plan', contract: draft, feedback })}><Check size={15} />保存并批准</button></> : <><button className="quiet-button" disabled={Boolean(busy)} onClick={() => onCommand({ type: 'request_changes', feedback: feedback || run.reviewDecision?.summary || '请根据审核结论返工' })}><RotateCcw size={14} />确认并返工</button><button className="primary" disabled={run.reviewDecision?.verdict !== 'approved' || run.verification?.status === 'failed' || Boolean(busy)} onClick={() => onCommand({ type: 'approve_review', feedback })}><Check size={15} />批准并进入交付</button></>}</footer>
  </section></div>
}

function ContractEditor({ contract, busy, onSave }: { contract: import('../../shared/contracts').ExecutionContract; busy: boolean; onSave: (contract: import('../../shared/contracts').ExecutionContract) => void }) {
  const [draft, setDraft] = useState(contract)
  useEffect(() => setDraft(contract), [contract])
  const updateStep = (index: number, patch: Partial<import('../../shared/contracts').ContractStep>) => setDraft({ ...draft, steps: draft.steps.map((step, i) => i === index ? { ...step, ...patch } : step) })
  return <section className="contract-editor"><div className="contract-head"><div><b>执行合同</b><span>编辑内容并逐步批准；所有步骤批准后才能执行。</span></div><button className="quiet-button" disabled={busy} onClick={() => onSave(draft)}><Save size={13} />保存合同</button></div>
    <label><span>合同摘要</span><textarea value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
    <div className="contract-steps">{draft.steps.map((step, index) => <article key={step.id} className={step.status === 'approved' ? 'approved' : ''}>
      <div className="contract-step-head"><small>{String(index + 1).padStart(2, '0')}</small><input value={step.title} onChange={(event) => updateStep(index, { title: event.target.value })} /><button className={step.status === 'approved' ? 'merge-button' : 'quiet-button'} onClick={() => updateStep(index, { status: step.status === 'approved' ? 'pending' : 'approved' })}>{step.status === 'approved' ? <><Check size={12} />已批准</> : '批准此步'}</button></div>
      <textarea value={step.description} onChange={(event) => updateStep(index, { description: event.target.value })} />
      <label><span>验收标准（每行一条）</span><textarea value={step.acceptanceCriteria.join('\n')} onChange={(event) => updateStep(index, { acceptanceCriteria: lines(event.target.value) })} /></label>
      <label><span>步骤 ID：{step.id} · 依赖步骤 ID（每行一个；清空表示独立）</span><textarea value={(step.dependsOn ?? draft.steps.slice(0, index).map((item) => item.id)).join('\n')} onChange={(event) => updateStep(index, { dependsOn: lines(event.target.value) })} /></label>
      <label><span>允许修改的文件或目录（每行一个；留空将独占执行）</span><textarea value={step.files.join('\n')} onChange={(event) => updateStep(index, { files: lines(event.target.value) })} /></label>
      <label><span>验证命令（每行一条）</span><textarea value={step.verificationCommands.join('\n')} onChange={(event) => updateStep(index, { verificationCommands: lines(event.target.value) })} /></label>
    </article>)}</div>
  </section>
}

function VerificationPanel({ report }: { report: import('../../shared/contracts').VerificationReport }) {
  return <section className={`verification-panel ${report.status}`}><div className="diff-heading"><span><ShieldCheck size={15} />独立验证证据 · {report.workspaceFingerprint.slice(0, 12)}</span><b>{report.status.toUpperCase()}</b></div>{report.checks.length === 0 && <div className="verification-check"><span className="health-off" /><b>未发现可执行门禁</b><small>由 Reviewer 评估风险</small></div>}{report.checks.map((check) => <div className="verification-check" key={check.command}><span className={check.passed ? 'health-ok' : 'health-off'} /><b>{check.command}</b><small>exit {check.exitCode ?? '—'} · {check.durationMs}ms</small></div>)}</section>
}

function lines(value: string): string[] { return value.split('\n').map((line) => line.trim()).filter(Boolean) }

function MemoryView({ entries, runs, activeWorkspace, stats, health, busy, onRefresh, onDecide, onCurate, onForget }: {
  entries: MemoryEntry[]; runs: RunSummary[]; activeWorkspace: string; stats: MemoryStats; health?: MemoryProviderHealth; busy?: string
  onRefresh: () => void; onDecide: (id: string, decision: 'approve' | 'reject') => Promise<boolean>; onCurate: (input: import('../../shared/contracts').MemoryCurationInput) => Promise<boolean>; onForget: (id: string) => void
}) {
  const [curating, setCurating] = useState<MemoryEntry[] | null>(null)
  const [preview, setPreview] = useState<MemoryEntry | null>(null)
  const [projectFilter, setProjectFilter] = useState(activeWorkspace || 'all')
  const [taskFilter, setTaskFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('candidate')
  useEffect(() => { setProjectFilter(activeWorkspace || 'all'); setTaskFilter('all') }, [activeWorkspace])
  const runIndex = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs])
  const projectOptions = useMemo(() => [...new Set([activeWorkspace, ...entries.map((entry) => entry.workspace)].filter(Boolean))], [activeWorkspace, entries])
  const projectEntries = projectFilter === 'all' ? entries : entries.filter((entry) => entry.workspace === projectFilter)
  const sourceTasks = [...new Set(projectEntries.map((entry) => entry.sourceRunId ?? 'manual'))]
  const visibleEntries = entries.filter((entry) => {
    const source = entry.sourceRunId ?? 'manual'
    const projectMatches = projectFilter === 'all' || projectFilter === entry.workspace
    const taskMatches = taskFilter === 'all' || taskFilter === source
    const statusMatches = statusFilter === 'all' || (statusFilter === 'stale'
      ? ['superseded', 'needs_revalidation', 'expired'].includes(entry.status)
      : entry.status === statusFilter)
    return projectMatches && taskMatches && statusMatches
  })
  const projectGroups = [...visibleEntries.reduce((groups, entry) => {
    groups.set(entry.workspace, [...(groups.get(entry.workspace) ?? []), entry])
    return groups
  }, new Map<string, MemoryEntry[]>())]

  return <div className="page memory-page">
    <div className="page-command-bar"><div><span className="page-command-icon"><Brain size={17} /></span><span><b>记忆治理</b><small>按来源整理、评审与复用项目经验</small></span></div><button className="quiet-button" onClick={onRefresh}><RefreshCw size={14} />刷新记忆</button></div>
    <div className="memory-metrics"><div><b>{stats.candidate}</b><span>等待审核</span></div><div><b>{stats.approved}</b><span>已批准</span></div><div><b>{stats.stale}</b><span>已失效</span></div><div className={health?.ok ? 'healthy' : 'unhealthy'}><ShieldCheck size={17} /><span>{health?.message ?? '检测中…'}</span></div></div>
    <section className="memory-organizer" aria-label="按任务整理记忆">
      <div className="memory-organizer-title"><FolderGit2 size={16} /><span><b>任务归档</b><small>先提炼可复用经验，再逐条预览批准；一次性验收要求留在任务记录中</small></span></div>
      <label className="memory-project-filter"><span>项目</span><select value={projectFilter} onChange={(event) => { setProjectFilter(event.target.value); setTaskFilter('all') }}><option value="all">全部项目（{projectOptions.length}）</option>{projectOptions.map((workspace) => <option value={workspace} key={workspace}>{workspaceName(workspace)}</option>)}</select></label>
      <label className="memory-task-filter"><span>来源任务</span><select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}><option value="all">全部任务（{sourceTasks.length}）</option>{sourceTasks.map((source) => <option value={source} key={source}>{source === 'manual' ? '手动与外部记忆' : runIndex.get(source)?.title ?? `来源任务已删除 · ${source.slice(0, 8)}`}</option>)}</select></label>
      <label className="memory-status-filter"><span>治理状态</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">全部状态</option><option value="candidate">等待审核</option><option value="approved">已批准</option><option value="stale">已失效</option><option value="rejected">已拒绝</option></select></label>
    </section>
    <div className="memory-project-groups">{entries.length === 0 ? <div className="memory-empty"><Brain size={28} /><b>还没有长期记忆</b><span>任务合并后，只从评审中提炼经验；没有可复用发现时不生成候选。</span></div> : projectGroups.length === 0 ? <div className="memory-empty"><Brain size={28} /><b>没有符合筛选条件的记忆</b><span>更换项目、来源任务或治理状态后重试。</span></div> : projectGroups.map(([workspace, projectMemories]) => {
      const taskGroups = [...projectMemories.reduce((groups, entry) => { const source = entry.sourceRunId ?? 'manual'; groups.set(source, [...(groups.get(source) ?? []), entry]); return groups }, new Map<string, MemoryEntry[]>())]
      return <section className="memory-project-group" key={workspace}><header><FolderGit2 size={16} /><span><b>{workspaceName(workspace)}</b><small title={workspace}>{workspace}</small></span><em>{projectMemories.length} 条记忆</em></header><div className="memory-task-groups">{taskGroups.map(([source, groupEntries]) => {
        const sourceRun = source === 'manual' ? undefined : runIndex.get(source)
        return <details className="memory-task-group" key={source} open>
        <summary><span><ChevronDown size={15} /><span><b>{source === 'manual' ? '手动与外部记忆' : sourceRun?.title ?? '来源任务已删除'}</b><small>{source === 'manual' ? '无本地任务绑定' : sourceRun ? `${runStatusLabel(sourceRun)} · ${formatDate(sourceRun.updatedAt)}` : `任务 ID ${source.slice(0, 12)}`}</small></span></span><em>{groupEntries.length} 条记忆</em></summary>
        {groupEntries.some((entry) => entry.status === 'candidate') && <div className="memory-curation-bar"><span>{groupEntries.filter((entry) => entry.status === 'candidate').length} 条待审候选 · 同类内容可以合并，原记录仍保留。</span><button className="quiet-button" disabled={Boolean(busy)} onClick={() => setCurating(groupEntries.filter((entry) => entry.status === 'candidate'))}>整理候选</button></div>}
        <details className="memory-entry-details" open={groupEntries.length <= 3}><summary>查看完整内容与逐条操作（{groupEntries.length} 条）</summary><div className="memory-list">{groupEntries.map((entry) => <article className="memory-card" key={entry.id}>
          <div className="memory-card-head"><div><span className={`memory-status ${entry.status}`}>{memoryStatusLabel(entry.status)}</span><small>{memoryKindLabel(entry.kind)}</small></div><time>{new Date(entry.updatedAt).toLocaleString('zh-CN')}</time></div>
          <h2>{entry.title}</h2><p>{entry.content}</p>
          <div className="memory-source"><span>commit {entry.sourceCommit?.slice(0, 10) ?? 'manual'}</span><span title={entry.sourceFiles.join('\n')}>{entry.sourceFiles.length ? `${entry.sourceFiles.slice(0, 2).join(', ')}${entry.sourceFiles.length > 2 ? ` +${entry.sourceFiles.length - 2}` : ''}` : '无文件绑定'}</span><span>置信度 {Math.round(entry.confidence * 100)}%</span><span>召回 {entry.usageCount} 次</span></div>
          <div className="memory-actions">{entry.status === 'candidate' && <><button className="memory-approve-button" disabled={Boolean(busy)} onClick={() => needsMemoryCuration(entry) ? setCurating([entry]) : setPreview(entry)}><Check size={13} />{needsMemoryCuration(entry) ? '整理后批准' : '预览并批准'}</button><button className="memory-reject-button" disabled={Boolean(busy)} onClick={() => onDecide(entry.id, 'reject')}><X size={13} />拒绝</button></>}<button className="danger-button memory-delete-button" disabled={Boolean(busy)} onClick={() => onForget(entry.id)}><Trash2 size={13} />删除</button></div>
        </article>)}</div></details>
      </details>
      })}</div></section>
    })}</div>
    {curating && <MemoryCurationDialog entries={curating} busy={busy} onClose={() => setCurating(null)} onSave={onCurate} />}
    {preview && <MemoryApprovalDialog entry={preview} busy={busy} onClose={() => setPreview(null)} onApprove={() => onDecide(preview.id, 'approve')} />}
  </div>
}

function MemoryConfiguration({ settings, health, setupResult, busy, onChange, onProbe, onSetup }: {
  settings: AppSettings; health?: MemoryProviderHealth; setupResult?: TencentDbSetupResult; busy?: string
  onChange: (settings: AppSettings) => void; onProbe: () => void; onSetup: () => void
}) {
  const [guideOpen, setGuideOpen] = useState(true)
  return <section className="memory-settings governance-settings" id="settings-memory">
    <div className="memory-settings-head"><Brain size={18} /><div><b>长期记忆设置</b><span>只从已合并任务的评审发现提炼经验，不再拆分一次性验收条件；密钥只通过环境变量读取。</span></div></div>
    <div className="settings-section-body memory-body">
      <div className="settings-switch-stack memory-switches">
        <label className="toggle-row"><span><b>启用长期记忆</b><small>任务开始前召回已批准知识</small></span><input type="checkbox" checked={settings.memory.enabled} onChange={(event) => onChange({ ...settings, memory: { ...settings.memory, enabled: event.target.checked } })} /><i aria-hidden="true" /></label>
        <label className="toggle-row"><span><b>候选需人工批准</b><small>审核后才进入长期记忆</small></span><input type="checkbox" checked={settings.memory.requireApproval} onChange={(event) => onChange({ ...settings, memory: { ...settings.memory, requireApproval: event.target.checked } })} /><i aria-hidden="true" /></label>
      </div>
      <div className="memory-fields">
        <label className="memory-field provider-field"><span>记忆 Provider</span><select value={settings.memory.provider} onChange={(event) => onChange({ ...settings, memory: { ...settings.memory, provider: event.target.value as 'local' | 'tencentdb' } })}><option value="local">Foreman Local</option><option value="tencentdb">TencentDB Core v3</option></select></label>
        <label className="memory-field"><span>召回条数</span><input type="number" min="1" max="20" value={settings.memory.maxItems} onChange={(event) => onChange({ ...settings, memory: { ...settings.memory, maxItems: Number(event.target.value) } })} /></label>
        <label className="memory-field"><span>字符预算</span><input type="number" min="500" max="30000" value={settings.memory.maxChars} onChange={(event) => onChange({ ...settings, memory: { ...settings.memory, maxChars: Number(event.target.value) } })} /></label>
      </div>
    </div>
    {settings.memory.provider === 'tencentdb' && <>
    <section className="tencentdb-guide">
      <button className="tencentdb-guide-head" aria-expanded={guideOpen} onClick={() => setGuideOpen(!guideOpen)}><span><ShieldCheck size={17} /><span><small>TENCENTDB MEMORY CORE · 可选 Sidecar</small><b>TencentDB 配置向导</b></span></span><ChevronDown size={16} /></button>
      {guideOpen && <div className="tencentdb-guide-body">
        <article><i>1</i><span><b>自动检查与准备</b><small>Foreman 检查 Git、Docker CLI 与 daemon，并把官方仓库下载到应用专用目录；不会修改当前项目。</small></span></article>
        <article><i>2</i><span><b>官方终端配置</b><small>在独立终端运行官方交互式安装器。LLM 密钥直接交给安装器，不会进入 Foreman 数据库或任务日志。</small></span></article>
        <article><i>3</i><span><b>连接并启用</b><small>安装完成后保持 Endpoint 为 <code>http://127.0.0.1:8420</code>，填写隔离 ID，再验证连接并保存设置。</small></span></article>
        <div className="tencentdb-setup-action"><div><b>本地一键配置</b><small>将下载官方仓库并可能拉取 Docker 镜像；默认涉及 8420 / 8125 / 8424 / 8096 端口。点击前会再次确认。</small>{setupResult && <em className={setupResult.ok ? 'ready' : 'failed'}>{setupResult.message}</em>}</div><button className="primary" disabled={Boolean(busy)} onClick={onSetup}>{busy === 'memory-tencentdb-setup' ? <LoaderCircle className="spin" size={14} /> : <CloudDownload size={14} />}一键配置并启动</button></div>
        <div className={`tencentdb-probe ${health?.provider === 'tencentdb' ? (health.ok ? 'ready' : 'failed') : ''}`}><span><i />{health?.provider === 'tencentdb' ? health.message : '配置完成后验证 /health 与 Gateway 鉴权。'}</span><button className="quiet-button" disabled={Boolean(busy)} onClick={onProbe}>{busy === 'memory-probe' ? <LoaderCircle className="spin" size={13} /> : <Activity size={13} />}验证连接</button></div>
      </div>}
    </section>
    <div className="provider-details">
      <label className="provider-field"><span>Core Endpoint</span><input value={settings.memory.tencentdb.endpoint} onChange={(event) => onChange({ ...settings, memory: { ...settings.memory, tencentdb: { ...settings.memory.tencentdb, endpoint: event.target.value } } })} /></label>
      <label className="provider-field"><span>Service ID</span><input value={settings.memory.tencentdb.serviceId} onChange={(event) => onChange({ ...settings, memory: { ...settings.memory, tencentdb: { ...settings.memory.tencentdb, serviceId: event.target.value } } })} /></label>
      <label className="provider-field"><span>Team ID</span><input value={settings.memory.tencentdb.teamId} onChange={(event) => onChange({ ...settings, memory: { ...settings.memory, tencentdb: { ...settings.memory.tencentdb, teamId: event.target.value } } })} /></label>
      <label className="provider-field"><span>Agent ID</span><input value={settings.memory.tencentdb.agentId} onChange={(event) => onChange({ ...settings, memory: { ...settings.memory, tencentdb: { ...settings.memory.tencentdb, agentId: event.target.value } } })} /></label>
      <label className="provider-field"><span>User ID</span><input value={settings.memory.tencentdb.userId} onChange={(event) => onChange({ ...settings, memory: { ...settings.memory, tencentdb: { ...settings.memory.tencentdb, userId: event.target.value } } })} /></label>
      <label className="provider-field"><span>Gateway Token 环境变量</span><input value={settings.memory.tencentdb.gatewayTokenEnv} onChange={(event) => onChange({ ...settings, memory: { ...settings.memory, tencentdb: { ...settings.memory.tencentdb, gatewayTokenEnv: event.target.value } } })} /></label>
      <label className="provider-field"><span>User Key 环境变量</span><input value={settings.memory.tencentdb.userKeyEnv} onChange={(event) => onChange({ ...settings, memory: { ...settings.memory, tencentdb: { ...settings.memory.tencentdb, userKeyEnv: event.target.value } } })} /></label>
    </div></>}
  </section>
}

function RoleChip({ role, config }: { role: RoleKey; config: RoleConfig }) {
  return <div className={`role-chip role-chip-${role}`}><span>{roleMeta[role].index}</span><div><b>{roleMeta[role].label}</b><small>{modelLabel(config.model)} · {effortLabel(config.effort)}{config.skillMode === 'explicit' ? ` · ${config.skills.length} skill` : ''}</small></div></div>
}

function Artifact({ title, content }: { title: string; content?: string }) {
  return <div className="artifact"><div className="panel-title">{title}</div><div className="artifact-copy">{content || '尚未生成'}</div></div>
}

function DiffPanel({ inspection, loading }: { inspection: WorkspaceInspection | null; loading: boolean }) {
  return <div className="diff-panel">
    <div className="diff-heading">
      <span><FileDiff size={15} />变更 Diff</span>
      {inspection && <div className="diff-metrics"><b>{inspection.filesChanged} 文件</b><i>+{inspection.additions}</i><em>-{inspection.deletions}</em></div>}
    </div>
    {loading ? <div className="diff-empty"><LoaderCircle className="spin" size={18} />正在读取变更…</div>
      : !inspection ? <div className="diff-empty">任务进入等待批准或结束状态后，将在这里显示隔离 worktree 的变更。</div>
      : inspection.diff ? <pre className="diff-code">{inspection.diff.split('\n').map((line, index) => <DiffLine key={index} line={line} />)}</pre>
      : <div className="diff-empty">当前 worktree 没有文件变更。</div>}
  </div>
}

function DiffLine({ line }: { line: string }) {
  const kind = line.startsWith('+') && !line.startsWith('+++') ? 'added'
    : line.startsWith('-') && !line.startsWith('---') ? 'removed'
    : line.startsWith('@@') ? 'hunk' : line.startsWith('diff ') ? 'file' : ''
  return <span className={kind}>{line || ' '}{'\n'}</span>
}

function compactCapabilityMessage(message?: string): string {
  if (!message) return '当前显示默认候选能力，尚未调用远程 API 验证。'
  const cleaned = message.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s+/g, ' ').trim()
  if (/unrecognized_model|model.+not (?:found|recognized)|模型.+(?:不存在|未识别)/i.test(cleaned)) return '当前执行器未识别该模型，请检查模型 ID 或 CC-Switch 别名映射。'
  if (/429|usage limit|quota|额度|套餐用量/i.test(cleaned)) return 'API 配额或套餐额度不足，请稍后重试或切换可用模型。'
  if (/unauthorized|authentication|not logged|login|未登录|未授权|401/i.test(cleaned)) return '执行器尚未完成授权，请登录后重新检测。'
  if (/timeout|timed out|超时/i.test(cleaned)) return '远程 API 检测超时，请检查网络后重试。'
  if (/remote api (?:is )?available|远程 API 可用/i.test(cleaned)) return '远程 API 可用，已完成推理强度验证。'
  const result = cleaned.match(/"(?:result|message)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i)?.[1]
  const readable = (result ?? cleaned).replaceAll('\\n', ' ').replaceAll('\\"', '"')
  return readable.length > 150 ? `${readable.slice(0, 147)}…` : readable
}

function memoryStatusLabel(status: MemoryEntry['status']): string {
  return ({ candidate: '等待审核', approved: '已批准', rejected: '已拒绝', superseded: '已替代', needs_revalidation: '待复验', expired: '已过期' })[status]
}

function memoryKindLabel(kind: MemoryEntry['kind']): string {
  return ({ fact: '事实', decision: '决策', lesson: '经验', procedure: '流程', constraint: '约束' })[kind]
}

function workspaceName(workspace: string): string {
  const normalized = workspace.replace(/[\\/]+$/, '')
  return normalized.split(/[\\/]/).pop() || workspace
}

function formatDate(date: string) { return new Date(date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) }
function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds}ms`
  const seconds = Math.round(milliseconds / 100) / 10
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}
function formatTokenCount(value: number): string {
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(2)}m`
}
function scopeLabel(scope: import('../../shared/contracts').SkillScope) { return ({ project: '项目', user: '用户', plugin: 'Plugin', admin: '管理员', compatibility: '兼容目录' })[scope] }
function uniqueInvocations(skills: import('../../shared/contracts').AgentSkill[]) { return [...new Map(skills.map((skill) => [skill.invocation, skill])).values()] }
function cleanEvent(message: string) {
  const trimmed = message.replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '').replace(/\r(?=.)/g, '\n').trim()
  if (!trimmed.startsWith('{')) return trimmed
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const item = parsed.item as Record<string, unknown> | undefined
    return String(item?.text ?? parsed.message ?? parsed.type ?? trimmed)
  } catch { return trimmed }
}

interface RunEventGroup { at: string; phase: RunStatus; kind: RunEvent['kind']; message: string; modelOutput: boolean }
function groupRunEvents(events: RunEvent[], filter: 'progress' | 'model' | 'all'): RunEventGroup[] {
  const selected = events.filter((event) => filter === 'all' || (filter === 'model' ? event.kind === 'stdout' || event.kind === 'stderr' : ['status', 'result', 'error'].includes(event.kind)))
  return selected.reduce<RunEventGroup[]>((groups, event) => {
    const message = cleanEvent(event.message)
    if (!message) return groups
    const modelOutput = event.kind === 'stdout' || event.kind === 'stderr'
    const previous = groups.at(-1)
    if (modelOutput && previous?.modelOutput && previous.kind === event.kind && previous.phase === event.phase) previous.message += `\n${message}`
    else groups.push({ at: event.at, phase: event.phase, kind: event.kind, message, modelOutput })
    return groups
  }, [])
}
function phaseLabel(phase: RunStatus): string {
  return ({ queued: '准备', planning: '规划', awaiting_approval: '待批规划', implementing: '执行', verifying: '验证', reviewing: '审核', awaiting_review_approval: '待批审核', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消' })[phase]
}
function formatEventTime(at: string): string { return new Date(at).toLocaleTimeString('zh-CN', { hour12: false }) }
