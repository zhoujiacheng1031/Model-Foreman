import { describe, expect, it } from 'vitest'
import { LocalVerificationModule } from '../src/main/verification/local-verification'

describe('LocalVerificationModule', () => {
  it('独立记录命令退出码、输出和总门禁结果', async () => {
    const verification = new LocalVerificationModule()
    const report = await verification.verify(process.cwd(), {
      enabled: true, commands: ['node -e "console.log(\'evidence-ok\')"', 'node -e "process.exit(2)"'],
      timeoutSeconds: 30, stopOnFailure: true
    })

    expect(report.passed).toBe(false)
    expect(report).toMatchObject({ origin: 'foreman-local-verifier', status: 'failed' })
    expect(report.checks).toHaveLength(2)
    expect(report.checks[0]).toMatchObject({ passed: true, exitCode: 0 })
    expect(report.checks[0]?.output).toContain('evidence-ok')
    expect(report.checks[1]).toMatchObject({ passed: false, exitCode: 2 })
    expect(report.commit).toMatch(/^[a-f0-9]{40}$|unknown/)
    expect(report.workspaceFingerprint).toMatch(/^[a-f0-9]{64}$|unknown/)
  })

  it('没有发现门禁时明确记录 skipped 而不是伪装成通过', async () => {
    const report = await new LocalVerificationModule().verify('/tmp', { enabled: false, commands: [], timeoutSeconds: 30, stopOnFailure: true })
    expect(report).toMatchObject({ status: 'skipped', passed: false, checks: [] })
  })
})
