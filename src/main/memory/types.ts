import type { AppSettings, MemoryEntry, MemoryProviderHealth, MemoryStats, RoleKey, RunSummary } from '../../shared/contracts'

export interface MemoryContext { workspace: string; objective: string; role: RoleKey }
export interface MemoryPacket { entries: MemoryEntry[]; text: string }

export interface MemoryModule {
  prepare(context: MemoryContext, settings: AppSettings): Promise<MemoryPacket>
  captureVerifiedOutcome(run: RunSummary, evidence: { commit: string; changedFiles: string[] }, settings: AppSettings): Promise<MemoryEntry[]>
  list(workspace?: string): MemoryEntry[]
  decide(id: string, decision: 'approve' | 'reject'): MemoryEntry
  forget(id: string): void
  stats(workspace?: string): MemoryStats
  probe(settings: AppSettings): Promise<MemoryProviderHealth>
}
