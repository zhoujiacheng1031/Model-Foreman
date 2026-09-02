import type { VerificationReport, VerificationSettings } from '../../shared/contracts'

export interface VerificationModule {
  verify(workspace: string, settings: VerificationSettings, suggestedCommands?: string[]): Promise<VerificationReport>
  cancel(): void
}
