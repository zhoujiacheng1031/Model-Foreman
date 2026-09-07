import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, DeliveryGuideAction, Effort, ExecutionContract, ExecutorKind, ForemanBridge, GoalCommand, GoalInput, ModelCapabilityTarget, ModelDefinition, RunCommand, RunEvent, TaskInput } from '../shared/contracts'

const bridge: ForemanBridge = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
  probeExecutors: () => ipcRenderer.invoke('executors:probe'),
  probeModel: (kind: ExecutorKind, model: string, effort: Effort, workspace: string) => ipcRenderer.invoke('models:probe', kind, model, effort, workspace),
  probeCustomModel: (model: ModelDefinition, workspace: string) => ipcRenderer.invoke('models:probe-custom', model, workspace),
  scanModelCapabilities: (targets: ModelCapabilityTarget[], workspace: string) => ipcRenderer.invoke('models:scan-capabilities', targets, workspace),
  inspectAgentEnvironment: (workspace: string) => ipcRenderer.invoke('agent-environment:inspect', workspace),
  inspectRepository: (workspace: string) => ipcRenderer.invoke('repository:inspect', workspace),
  inspectGitHubDelivery: (workspace: string) => ipcRenderer.invoke('repository:github-delivery', workspace),
  planGitOperation: (workspace: string, kind: import('../shared/contracts').GitOperationKind, message?: string) => ipcRenderer.invoke('repository:git-plan', workspace, kind, message),
  executeGitOperation: (planId: string, confirmation: string) => ipcRenderer.invoke('repository:git-execute', planId, confirmation),
  cloneGitHubRepository: (url: string) => ipcRenderer.invoke('repository:clone-github', url),
  openRepositoryRemote: (url: string) => ipcRenderer.invoke('repository:open-remote', url),
  handoffToDesktop: (kind: ExecutorKind, workspace: string, runId?: string) => ipcRenderer.invoke('desktop:handoff', kind, workspace, runId),
  listRuns: () => ipcRenderer.invoke('runs:list'),
  getRun: (runId: string) => ipcRenderer.invoke('runs:get', runId),
  startRun: (input: TaskInput) => ipcRenderer.invoke('runs:start', input),
  approvePlan: (runId: string) => ipcRenderer.invoke('runs:approve', runId),
  updateContract: (runId: string, contract: ExecutionContract) => ipcRenderer.invoke('runs:contract:update', runId, contract),
  commandRun: (runId: string, command: RunCommand) => ipcRenderer.invoke('runs:command', runId, command),
  pauseRun: (runId: string) => ipcRenderer.invoke('runs:pause', runId),
  resumeRun: (runId: string, instructions?: string) => ipcRenderer.invoke('runs:resume', runId, instructions),
  cancelRun: (runId: string) => ipcRenderer.invoke('runs:cancel', runId),
  inspectRun: (runId: string) => ipcRenderer.invoke('runs:inspect', runId),
  mergeRun: (runId: string) => ipcRenderer.invoke('runs:merge', runId),
  getDeliveryGuide: (runId: string) => ipcRenderer.invoke('runs:delivery-guide', runId),
  executeDeliveryStep: (runId: string, action: DeliveryGuideAction) => ipcRenderer.invoke('runs:delivery-step', runId, action),
  discardRun: (runId: string) => ipcRenderer.invoke('runs:discard', runId),
  retryRun: (runId: string) => ipcRenderer.invoke('runs:retry', runId),
  deleteRun: (runId: string) => ipcRenderer.invoke('runs:delete', runId),
  listMemories: (workspace?: string) => ipcRenderer.invoke('memory:list', workspace),
  approveMemory: (id: string, version?: number) => ipcRenderer.invoke('memory:approve', id, version),
  rejectMemory: (id: string, version?: number) => ipcRenderer.invoke('memory:reject', id, version),
  forgetMemory: (id: string) => ipcRenderer.invoke('memory:forget', id),
  getMemoryStats: (workspace?: string) => ipcRenderer.invoke('memory:stats', workspace),
  probeMemory: (settings?: AppSettings) => ipcRenderer.invoke('memory:probe', settings),
  setupTencentDbMemory: () => ipcRenderer.invoke('memory:tencentdb:setup'),
  chooseWorkspace: () => ipcRenderer.invoke('settings:choose-workspace'),
  openWorkspace: (path: string) => ipcRenderer.invoke('workspace:open', path),
  openTerminal: (path: string) => ipcRenderer.invoke('workspace:terminal', path),
  onRunEvent: (listener: (event: RunEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, runEvent: RunEvent) => listener(runEvent)
    ipcRenderer.on('runs:event', handler)
    return () => ipcRenderer.removeListener('runs:event', handler)
  },
  createGoal: (input: GoalInput) => ipcRenderer.invoke('goals:create', input),
  listGoals: () => ipcRenderer.invoke('goals:list'),
  getGoal: (goalId: string) => ipcRenderer.invoke('goals:get', goalId),
  commandGoal: (goalId: string, command: GoalCommand) => ipcRenderer.invoke('goals:command', goalId, command)
}

contextBridge.exposeInMainWorld('foreman', bridge)
