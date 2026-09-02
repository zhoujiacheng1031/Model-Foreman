import type { DeliveryChangeCounts, RunSummary, WorkspaceInspection } from '../../shared/contracts'

export interface PreparedWorkspace {
  path: string
  branch: string
  baseCommit: string
  isolated: boolean
  sourceDirty: boolean
  initializedRepository: boolean
}

export interface WorkspaceManager {
  prepare(run: RunSummary): Promise<PreparedWorkspace>
  inspect(run: RunSummary): Promise<WorkspaceInspection>
  merge(run: RunSummary): Promise<{ commit: string; cleanupWarning?: string }>
  discard(run: RunSummary): Promise<{ cleanupWarning?: string }>
  inspectDelivery?(run: RunSummary): Promise<WorkspaceDeliveryState>
  protectSource?(run: RunSummary): Promise<void>
  commitTask?(run: RunSummary): Promise<string>
  mergeCommitted?(run: RunSummary): Promise<string>
  restoreSource?(run: RunSummary): Promise<void>
  cleanupMerged?(run: RunSummary): Promise<void>
}

export interface WorkspaceDeliveryState {
  sourceChanges: DeliveryChangeCounts
  taskChanges: DeliveryChangeCounts
  sourceFiles: string[]
  taskFiles: string[]
  protectedRef?: string
  merged: boolean
  commit: string
}
