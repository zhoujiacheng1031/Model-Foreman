import type { VerificationReport, VerificationSettings } from '../../shared/contracts'

export interface VerificationModule {
  verify(workspace: string, settings: VerificationSettings, suggestedCommands?: string[], runId?: string): Promise<VerificationReport>
  cancel(runId?: string): void
}
