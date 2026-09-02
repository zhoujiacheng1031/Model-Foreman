export type ExecutorKind = 'codex' | 'claude' | 'custom'
export type CustomModelProtocol = 'openai-responses' | 'anthropic-messages'
export type SkillMode = 'auto' | 'explicit'
export type SkillScope = 'project' | 'user' | 'plugin' | 'admin' | 'compatibility'
export type RoleKey = 'planner' | 'implementer' | 'reviewer'
export type RunStatus = 'queued' | 'planning' | 'awaiting_approval' | 'implementing' | 'verifying' | 'reviewing' | 'awaiting_review_approval' | 'paused' | 'completed' | 'failed' | 'cancelled'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type RunResolution = 'open' | 'merged' | 'discarded'
export type MemoryProviderKind = 'local' | 'tencentdb'
export type MemoryKind = 'fact' | 'decision' | 'lesson' | 'procedure' | 'constraint'
export type MemoryStatus = 'candidate' | 'approved' | 'rejected' | 'superseded' | 'needs_revalidation' | 'expired'
export type GoalStatus = 'active' | 'waiting_approval' | 'paused' | 'blocked' | 'completed' | 'failed' | 'cancelled'
export type GoalTaskStatus = 'pending' | 'ready' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'blocked' | 'invalidated'

export interface RoleConfig {
  executor: ExecutorKind
  model: string
  effort: Effort
  prompt: string
  skillMode: SkillMode
  skills: string[]
}

export interface AppSettings {
  workspace: string
  maxReviewLoops: number
  roles: Record<RoleKey, RoleConfig>
  memory: MemorySettings
  verification: VerificationSettings
  approvals: ApprovalSettings
  models: Record<ExecutorKind, ModelDefinition[]>
}

export interface ModelDefinition {
  id: string; label: string; efforts: Effort[]; source: 'builtin' | 'custom'
  protocol?: CustomModelProtocol; baseUrl?: string; apiKey?: string; remoteModel?: string
}
export interface ModelRuntimeStatus {
  kind: ExecutorKind; model: string; effort: Effort; available: boolean
  category: 'ready' | 'cli' | 'authentication' | 'model' | 'effort' | 'api' | 'quota' | 'unknown'
  message: string; checkedAt: string; cached: boolean
}
export interface ModelCapabilityTarget { role?: RoleKey; executor: ExecutorKind; model: string }
export interface ModelCapabilityResult {
  kind: ExecutorKind; model: string; roles: RoleKey[]
  availability: 'available' | 'partial' | 'unavailable'
  supportedEfforts: Effort[]; checks: ModelRuntimeStatus[]; message: string
}
export interface ModelCapabilityScan { checkedAt: string; models: ModelCapabilityResult[] }

export interface ApprovalPolicy { autoApprove: boolean; minConfidence: number }
export interface ApprovalSettings { planner: ApprovalPolicy; reviewer: ApprovalPolicy }

export interface VerificationSettings { enabled: boolean; commands: string[]; timeoutSeconds: number; stopOnFailure: boolean }

export type ContractStepStatus = 'pending' | 'approved' | 'completed' | 'blocked'
export interface ContractStep {
  id: string; title: string; description: string; acceptanceCriteria: string[]
  files: string[]; verificationCommands: string[]; status: ContractStepStatus
}
export interface ExecutionContract {
  version: 1; summary: string; assumptions: string[]; risks: string[]; steps: ContractStep[]; confidence?: number
}
export interface ImplementationReport { summary: string; filesChanged: string[]; commandsRun: string[]; unresolved: string[] }
export interface ReviewFinding { severity: 'critical' | 'major' | 'minor'; title: string; evidence: string; requiredChange: string }
export interface ReviewDecision { verdict: 'approved' | 'changes_requested' | 'blocked'; summary: string; findings: ReviewFinding[]; confidence: number }
export interface VerificationCheck { command: string; exitCode: number | null; passed: boolean; durationMs: number; output: string }
export interface VerificationReport { origin: 'foreman-local-verifier'; status: 'passed' | 'failed' | 'skipped'; passed: boolean; commit: string; workspaceFingerprint: string; startedAt: string; completedAt: string; checks: VerificationCheck[] }

export interface MemorySettings {
  enabled: boolean
  provider: MemoryProviderKind
  maxItems: number
  maxChars: number
  requireApproval: boolean
  tencentdb: { endpoint: string; serviceId: string; teamId: string; agentId: string; userId: string; gatewayTokenEnv: string; userKeyEnv: string }
}

export interface MemoryEntry {
  id: string
  workspace: string
  kind: MemoryKind
  title: string
  content: string
  status: MemoryStatus
  confidence: number
  sourceRunId?: string
  sourceCommit?: string
  sourceRef?: string
  sourceFiles: string[]
  supersedesId?: string
  createdAt: string
  updatedAt: string
  validUntil?: string
  usageCount: number
}

export interface MemoryStats { total: number; candidate: number; approved: number; stale: number }
export interface MemoryProviderHealth { provider: MemoryProviderKind; ok: boolean; message: string }
export interface TencentDbSetupResult {
  ok: boolean
  stage: 'prerequisites_ready' | 'prerequisite_missing' | 'repository_conflict' | 'clone_failed' | 'unsupported_repository' | 'terminal_failed' | 'terminal_opened'
  message: string
  endpoint: string
  directory?: string
}

export interface TaskInput {
  title: string
  objective: string
  workspace: string
}

export interface GoalInput {
  title: string; objective: string; workspace: string; successCriteria: string[]; constraints: string[]
  priority: number; timeBudgetSeconds?: number; tokenBudget?: number; costBudgetUsd?: number; maxIterations: number; maxTaskAttempts: number
}
export interface GoalEvidence { runId: string; commit?: string; workspaceFingerprint?: string; verificationStatus?: VerificationReport['status']; reviewerVerdict?: ReviewDecision['verdict']; merged: boolean }
export interface GoalTask {
  id: string; goalId: string; title: string; objective: string; status: GoalTaskStatus; dependencies: string[]
  order: number; attempt: number; maxAttempts: number; runId?: string; runHistoryIds: string[]; evidence?: GoalEvidence; createdAt: string; updatedAt: string
}
export interface GoalSummary {
  id: string; title: string; objective: string; workspace: string; successCriteria: string[]; constraints: string[]
  status: GoalStatus; priority: number; timeBudgetSeconds?: number; maxIterations: number; iteration: number
  tokenBudget?: number; costBudgetUsd?: number; tokensUsed: number; costUsedUsd: number
  currentTaskId?: string; workspaceFingerprint?: string; terminalReason?: string; createdAt: string; updatedAt: string
}
export interface GoalDetail { goal: GoalSummary; tasks: GoalTask[] }
export type GoalCommand = 'pause' | 'resume' | 'cancel' | 'revalidate' | 'replan'

export interface RunEvent {
  id?: number
  runId: string
  at: string
  phase: RunStatus
  kind: 'status' | 'stdout' | 'stderr' | 'result' | 'error'
  message: string
}

export type RunStageKind = 'planner' | 'implementer' | 'verifier' | 'reviewer'
export interface RunStageMetric {
  id: string
  stage: RunStageKind
  label: string
  attempt: number
  status: 'completed' | 'failed'
  executor: string
  model?: string
  startedAt: string
  completedAt: string
  durationMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  resourceDetail: string
  problem?: string
}

export interface RunSummary {
  id: string
  title: string
  objective: string
  workspace: string
  status: RunStatus
  createdAt: string
  updatedAt: string
  executionWorkspace?: string
  branch?: string
  baseCommit?: string
  isolated?: boolean
  resolution?: RunResolution
  plan?: string
  result?: string
  review?: string
  contract?: ExecutionContract
  implementationReport?: ImplementationReport
  reviewDecision?: ReviewDecision
  verification?: VerificationReport
  checkpointPhase?: RunStatus
  pauseReason?: 'user' | 'authorization' | 'preflight' | 'interrupted' | null
  additionalInstructions?: string
  reviewAttempt?: number
  usageTokens?: number
  costUsd?: number
  stageMetrics?: RunStageMetric[]
  error?: string
}

export interface ExecutorCapability {
  kind: ExecutorKind
  installed: boolean
  executable: string
  version: string
  authenticated: boolean
  authenticationMessage: string
}

export type RunCommand =
  | { type: 'pause' }
  | { type: 'resume'; instructions?: string }
  | { type: 'cancel' }
  | { type: 'approve_plan'; contract: ExecutionContract; feedback?: string }
  | { type: 'replan'; feedback: string }
  | { type: 'approve_review'; feedback?: string }
  | { type: 'request_changes'; feedback: string }

export interface DesktopCapability {
  kind: ExecutorKind
  installed: boolean
  appName: string
  appPath: string
  handoff: 'launcher' | 'cli-session'
  message: string
}

export interface AgentSkill {
  id: string
  provider: ExecutorKind
  name: string
  description: string
  invocation: string
  scope: SkillScope
  path: string
  enabled: boolean
  conflict: boolean
}

export interface AgentEnvironment {
  desktops: DesktopCapability[]
  skills: AgentSkill[]
  scannedAt: string
}

export interface DesktopHandoffResult {
  opened: boolean
  promptCopied: boolean
  message: string
}

export interface RepositoryBranch {
  name: string
  current: boolean
  upstream?: string
}

export interface RepositoryInspection {
  connected: boolean
  hasCommits: boolean
  bootstrapEligible: boolean
  bootstrapKind?: 'empty-directory' | 'empty-repository'
  workspace: string
  root?: string
  name?: string
  branch?: string
  detached: boolean
  head?: string
  upstream?: string
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
  conflicts: number
  clean: boolean
  remoteName?: string
  remoteUrl?: string
  remoteWebUrl?: string
  provider?: 'github' | 'other'
  branches: RepositoryBranch[]
  message: string
}

export interface GitHubCheckStatus {
  name: string
  status: string
  conclusion?: string
  url?: string
}

export interface GitHubPullRequestStatus {
  number: number
  title: string
  url: string
  state: string
  isDraft: boolean
  mergeStateStatus?: string
  reviewDecision?: string
  headRefName: string
  baseRefName: string
  checks: GitHubCheckStatus[]
}

export interface GitHubWorkflowRunStatus {
  id: number
  workflowName: string
  title: string
  status: string
  conclusion?: string
  event: string
  branch: string
  url: string
  updatedAt: string
}

export interface GitHubDeliveryStatus {
  available: boolean
  authenticated: boolean
  cliVersion?: string
  repository?: string
  pullRequest?: GitHubPullRequestStatus
  workflowRuns: GitHubWorkflowRunStatus[]
  polledAt: string
  message: string
}

export type GitOperationKind = 'commit' | 'push' | 'publish'
export interface GitOperationPlan {
  id: string
  kind: GitOperationKind
  workspace: string
  command: string
  summary: string
  impact: string[]
  blockers: string[]
  confirmationPhrase: string
  expiresAt: string
}

export interface GitOperationResult {
  kind: GitOperationKind
  output: string
  repository: RepositoryInspection
}

export interface WorkspaceInspection {
  diff: string
  stat: string
  filesChanged: number
  additions: number
  deletions: number
}

export type DeliveryGuideAction = 'protect_source' | 'commit_task' | 'merge_branch' | 'restore_source' | 'cleanup'
export interface DeliveryChangeCounts { staged: number; unstaged: number; untracked: number }
export interface DeliveryGuideStep {
  key: DeliveryGuideAction
  title: string
  description: string
  status: 'done' | 'ready' | 'pending' | 'attention'
  actionLabel?: string
}
export interface DeliveryGuide {
  runId: string
  sourceChanges: DeliveryChangeCounts
  taskChanges: DeliveryChangeCounts
  sourceFiles: string[]
  taskFiles: string[]
  protectedRef?: string
  merged: boolean
  steps: DeliveryGuideStep[]
}

export interface ForemanBridge {
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<AppSettings>
  probeExecutors(): Promise<ExecutorCapability[]>
  probeModel(kind: ExecutorKind, model: string, effort: Effort, workspace: string): Promise<ModelRuntimeStatus>
  probeCustomModel(model: ModelDefinition, workspace: string): Promise<ModelRuntimeStatus>
  scanModelCapabilities(targets: ModelCapabilityTarget[], workspace: string): Promise<ModelCapabilityScan>
  inspectAgentEnvironment(workspace: string): Promise<AgentEnvironment>
  inspectRepository(workspace: string): Promise<RepositoryInspection>
  inspectGitHubDelivery(workspace: string): Promise<GitHubDeliveryStatus>
  cloneGitHubRepository(url: string): Promise<RepositoryInspection | null>
  openRepositoryRemote(url: string): Promise<string>
  planGitOperation(workspace: string, kind: GitOperationKind, message?: string): Promise<GitOperationPlan>
  executeGitOperation(planId: string, confirmation: string): Promise<GitOperationResult>
  handoffToDesktop(kind: ExecutorKind, workspace: string, runId?: string): Promise<DesktopHandoffResult>
  listRuns(): Promise<RunSummary[]>
  getRun(runId: string): Promise<{ run: RunSummary; events: RunEvent[] } | null>
  startRun(input: TaskInput): Promise<RunSummary>
  approvePlan(runId: string): Promise<RunSummary>
  updateContract(runId: string, contract: ExecutionContract): Promise<RunSummary>
  commandRun(runId: string, command: RunCommand): Promise<RunSummary>
  pauseRun(runId: string): Promise<void>
  resumeRun(runId: string, instructions?: string): Promise<RunSummary>
  cancelRun(runId: string): Promise<void>
  inspectRun(runId: string): Promise<WorkspaceInspection>
  mergeRun(runId: string): Promise<RunSummary>
  getDeliveryGuide(runId: string): Promise<DeliveryGuide>
  executeDeliveryStep(runId: string, action: DeliveryGuideAction): Promise<DeliveryGuide | RunSummary>
  discardRun(runId: string): Promise<RunSummary>
  retryRun(runId: string): Promise<RunSummary>
  deleteRun(runId: string): Promise<void>
  listMemories(workspace?: string): Promise<MemoryEntry[]>
  approveMemory(id: string): Promise<MemoryEntry>
  rejectMemory(id: string): Promise<MemoryEntry>
  forgetMemory(id: string): Promise<void>
  getMemoryStats(workspace?: string): Promise<MemoryStats>
  probeMemory(settings?: AppSettings): Promise<MemoryProviderHealth>
  setupTencentDbMemory(): Promise<TencentDbSetupResult>
  chooseWorkspace(): Promise<string | null>
  openWorkspace(path: string): Promise<string>
  openTerminal(path: string): Promise<string>
  onRunEvent(listener: (event: RunEvent) => void): () => void
  createGoal(input: GoalInput): Promise<GoalDetail>
  listGoals(): Promise<GoalSummary[]>
  getGoal(goalId: string): Promise<GoalDetail | null>
  commandGoal(goalId: string, command: GoalCommand): Promise<GoalDetail>
}
