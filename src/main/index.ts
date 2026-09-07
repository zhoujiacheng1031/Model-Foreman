import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { AppSettings, DeliveryGuideAction, ExecutorKind, GitOperationKind, GoalCommand, GoalInput, ModelDefinition, RunCommand, TaskInput } from '../shared/contracts'
import { ExecutorRegistry } from './executors/registry'
import { Orchestrator } from './orchestrator'
import { ForemanDatabase } from './storage/database'
import { GitWorktreeManager } from './workspace/git-worktree'
import { DeliveryService } from './delivery'
import { appSettingsSchema, customModelDefinitionSchema, goalInputSchema, taskInputSchema, validated } from './validation'
import { ForemanMemoryModule } from './memory/memory-module'
import { DurableScheduler, GoalRuntime } from './goals'
import { AgentEnvironmentService } from './agent-environment'
import { RepositoryService } from './repository'
import { configureCliEnvironment } from './executors/cli-environment'
import { RunLifecycleService } from './run-lifecycle'
import { ModelRuntimeGate } from './model-runtime'
import { discoverClaudeModelIds } from './executors/claude-model-discovery'
import { TencentDbSetupService } from './memory/tencentdb-setup'
import { CodexExecutor } from './executors/codex'
import { ClaudeExecutor } from './executors/claude'
import { CustomApiExecutor } from './executors/custom-api'

let mainWindow: BrowserWindow | null = null
let database: ForemanDatabase
let registry: ExecutorRegistry
let orchestrator: Orchestrator
let delivery: DeliveryService
let memory: ForemanMemoryModule
let goalRuntime: GoalRuntime
let scheduler: DurableScheduler
let agentEnvironment: AgentEnvironmentService
let repositories: RepositoryService
let runLifecycle: RunLifecycleService
let modelRuntime: ModelRuntimeGate
let tencentDbSetup: TencentDbSetupService

function createWindow(): void {
  const supportsWindowTransparency = process.platform === 'darwin' || process.platform === 'win32'
  const platformMaterial = process.platform === 'darwin'
    ? { transparent: true, vibrancy: 'under-window' as const, visualEffectState: 'active' as const }
    : process.platform === 'win32'
      ? { transparent: true, backgroundMaterial: 'acrylic' as const }
      : {}
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 840,
    minHeight: 620,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: supportsWindowTransparency ? '#00000000' : '#eaf0f8',
    ...platformMaterial,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => database.getSettings())
  ipcMain.handle('settings:save', (_event, settings: AppSettings) => database.saveSettings(validated(appSettingsSchema, settings)))
  ipcMain.handle('executors:probe', async () => Promise.all(registry.all().map(async (executor) => ({ kind: executor.kind, ...await executor.probe() }))))
  ipcMain.handle('models:probe', (_event, kind: ExecutorKind, model: string, effort: import('../shared/contracts').Effort, workspace: string) =>
    modelRuntime.check({ executor: kind, model, effort }, workspace))
  ipcMain.handle('models:probe-custom', (_event, value: ModelDefinition, workspace: string) => {
    const model = validated(customModelDefinitionSchema, value)
    const executor = new CustomApiExecutor((id) => id === model.id ? model : undefined)
    return new ModelRuntimeGate(new ExecutorRegistry([executor]), 0).check({ executor: 'custom', model: model.id, effort: 'medium' }, workspace)
  })
  ipcMain.handle('models:scan-capabilities', async (_event, targets: import('../shared/contracts').ModelCapabilityTarget[], workspace: string) => {
    const discovered = await discoverClaudeModelIds(undefined, workspace)
    return modelRuntime.scan([...targets, ...discovered.map((model) => ({ executor: 'claude' as const, model }))], workspace)
  })
  ipcMain.handle('agent-environment:inspect', (_event, workspace: string) => agentEnvironment.inspect(workspace))
  ipcMain.handle('repository:inspect', (_event, workspace: string) => repositories.inspect(workspace))
  ipcMain.handle('repository:github-delivery', (_event, workspace: string) => repositories.inspectGitHubDelivery(workspace))
  ipcMain.handle('repository:git-plan', (_event, workspace: string, kind: GitOperationKind, message?: string) => repositories.planOperation(workspace, kind, message))
  ipcMain.handle('repository:git-execute', (_event, planId: string, confirmation: string) => repositories.executeOperation(planId, confirmation))
  ipcMain.handle('repository:clone-github', async (_event, url: string) => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'], title: '选择 GitHub 仓库的存放位置', buttonLabel: '克隆到这里' })
    if (result.canceled || !result.filePaths[0]) return null
    return repositories.cloneGitHub(url, result.filePaths[0])
  })
  ipcMain.handle('repository:open-remote', async (_event, url: string) => {
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/(?:pull|actions)(?:\/[^\s?#]*)?)?\/?$/.test(url) && url !== 'https://cli.github.com/') throw new Error('拒绝打开未允许的外部地址')
    await shell.openExternal(url)
    return url
  })
  ipcMain.handle('desktop:handoff', async (_event, kind: ExecutorKind, workspace: string, runId?: string) => {
    const desktop = await agentEnvironment.desktop(kind)
    if (!desktop.installed) return { opened: false, promptCopied: false, message: desktop.message }
    const run = runId ? database.getRun(runId)?.run : undefined
    const prompt = run ? desktopHandoffPrompt(run) : `请在项目目录 ${workspace} 中开始一个新的编码会话。`
    clipboard.writeText(prompt)
    const error = process.platform === 'win32' && desktop.appPath.startsWith('shell:AppsFolder\\')
      ? await openWindowsStoreApp(desktop.appPath)
      : await shell.openPath(desktop.appPath)
    return error
      ? { opened: false, promptCopied: true, message: `接管提示已复制，但无法打开 ${desktop.appName}：${error}` }
      : { opened: true, promptCopied: true, message: `已打开 ${desktop.appName}，接管提示已复制到剪贴板` }
  })
  ipcMain.handle('runs:list', () => database.listRuns())
  ipcMain.handle('runs:get', (_event, runId: string) => database.getRun(runId))
  ipcMain.handle('runs:start', (_event, input: TaskInput) => orchestrator.start(validated(taskInputSchema, input)))
  ipcMain.handle('runs:approve', (_event, runId: string) => orchestrator.approve(runId))
  ipcMain.handle('runs:contract:update', (_event, runId: string, contract: import('../shared/contracts').ExecutionContract) => orchestrator.updateContract(runId, contract))
  ipcMain.handle('runs:command', (_event, runId: string, command: RunCommand) => orchestrator.command(runId, command))
  ipcMain.handle('runs:pause', (_event, runId: string) => orchestrator.pause(runId))
  ipcMain.handle('runs:resume', (_event, runId: string, instructions?: string) => orchestrator.resume(runId, instructions))
  ipcMain.handle('runs:cancel', (_event, runId: string) => orchestrator.cancel(runId))
  ipcMain.handle('runs:inspect', (_event, runId: string) => delivery.inspect(runId))
  ipcMain.handle('runs:merge', (_event, runId: string) => delivery.merge(runId))
  ipcMain.handle('runs:delivery-guide', (_event, runId: string) => delivery.guide(runId))
  ipcMain.handle('runs:delivery-step', (_event, runId: string, action: DeliveryGuideAction) => delivery.executeStep(runId, action))
  ipcMain.handle('runs:discard', (_event, runId: string) => delivery.discard(runId))
  ipcMain.handle('runs:retry', (_event, runId: string) => runLifecycle.retry(runId))
  ipcMain.handle('runs:delete', (_event, runId: string) => runLifecycle.delete(runId))
  ipcMain.handle('memory:list', (_event, workspace?: string) => memory.list(workspace))
  ipcMain.handle('memory:approve', (_event, id: string, version?: number) => memory.decide(id, 'approve', version))
  ipcMain.handle('memory:reject', (_event, id: string, version?: number) => memory.decide(id, 'reject', version))
  ipcMain.handle('memory:forget', (_event, id: string) => memory.forget(id))
  ipcMain.handle('memory:stats', (_event, workspace?: string) => memory.stats(workspace))
  ipcMain.handle('memory:probe', (_event, settings?: AppSettings) => memory.probe(settings ? validated(appSettingsSchema, settings) : database.getSettings()))
  ipcMain.handle('memory:tencentdb:setup', () => tencentDbSetup.prepareAndLaunch())
  ipcMain.handle('settings:choose-workspace', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'], title: '选择已有项目或创建空文件夹', buttonLabel: '在 Foreman 中打开' })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('workspace:open', (_event, path: string) => shell.openPath(path))
  ipcMain.handle('workspace:terminal', async (_event, path: string) => {
    const workspace = resolve(path)
    const info = await stat(workspace)
    if (!info.isDirectory()) throw new Error('只能在文件夹中打开命令行')
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/K'], { cwd: workspace, detached: true, stdio: 'ignore', windowsHide: false })
      : process.platform === 'darwin'
        ? spawn('/usr/bin/open', ['-a', 'Terminal', workspace], { detached: true, stdio: 'ignore' })
        : spawn('x-terminal-emulator', ['--working-directory', workspace], { detached: true, stdio: 'ignore' })
    await new Promise<void>((done, reject) => { child.once('spawn', done); child.once('error', reject) })
    child.unref()
    return ''
  })
  ipcMain.handle('goals:create', (_event, input: GoalInput) => goalRuntime.create(validated(goalInputSchema, input)))
  ipcMain.handle('goals:list', () => goalRuntime.list())
  ipcMain.handle('goals:get', (_event, id: string) => goalRuntime.get(id))
  ipcMain.handle('goals:command', (_event, id: string, command: GoalCommand) => goalRuntime.command(id, command))
}

app.whenReady().then(() => {
  configureCliEnvironment()
  app.setAppUserModelId('com.modelforeman.app')
  const defaultWorkspace = process.cwd()
  database = new ForemanDatabase(join(app.getPath('userData'), 'foreman.db'), defaultWorkspace)
  database.recoverInterruptedRuns()
  registry = new ExecutorRegistry([new CodexExecutor(), new ClaudeExecutor(), new CustomApiExecutor((id) => database.getSettings().models.custom.find((model) => model.id === id))])
  modelRuntime = new ModelRuntimeGate(registry)
  agentEnvironment = new AgentEnvironmentService()
  repositories = new RepositoryService()
  const workspaceManager = new GitWorktreeManager(join(app.getPath('userData'), 'worktrees'))
  const eventSink = (event: import('../shared/contracts').RunEvent) => mainWindow?.webContents.send('runs:event', event)
  memory = new ForemanMemoryModule(database)
  tencentDbSetup = new TencentDbSetupService(join(app.getPath('userData'), 'integrations'))
  orchestrator = new Orchestrator(database, registry, workspaceManager, eventSink, memory, undefined, undefined, modelRuntime)
  delivery = new DeliveryService(database, workspaceManager, eventSink, memory)
  runLifecycle = new RunLifecycleService(database, orchestrator, delivery)
  goalRuntime = new GoalRuntime(database, orchestrator, delivery)
  scheduler = new DurableScheduler(goalRuntime)
  registerIpc()
  createWindow()
  scheduler.start()
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
app.on('before-quit', () => { scheduler?.stop(); orchestrator?.shutdown() })

function desktopHandoffPrompt(run: import('../shared/contracts').RunSummary): string {
  return [
    '你正在从 Model Foreman 接管一个本地开发任务。请先检查当前仓库状态与已有改动，不要重复已完成的工作。',
    `任务：${run.title}`,
    `目标：${run.objective}`,
    `工作目录：${run.executionWorkspace ?? run.workspace}`,
    `分支：${run.branch ?? '当前分支'}`,
    `Foreman 状态：${run.status}`,
    run.plan ? `已批准计划：\n${run.plan}` : '',
    run.result ? `执行报告：\n${run.result}` : '',
    run.review ? `审核结果：\n${run.review}` : '',
    '继续前请核对 git diff，并在完成后给出修改文件、验证命令和遗留风险。'
  ].filter(Boolean).join('\n\n')
}

async function openWindowsStoreApp(appPath: string): Promise<string> {
  return new Promise((resolveError) => {
    try {
      const child = spawn('explorer.exe', [appPath], { detached: true, stdio: 'ignore', windowsHide: true })
      child.once('error', (error) => resolveError(error.message))
      child.once('spawn', () => { child.unref(); resolveError('') })
    } catch (error) { resolveError(error instanceof Error ? error.message : String(error)) }
  })
}
