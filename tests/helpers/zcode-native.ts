import { readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { ZcodeExecutor } from '../../src/main/executors/zcode'
import type { ExecuteRequest } from '../../src/main/executors/types'

export { decodeZcodeResult } from '../../src/main/executors/zcode'

// Real acceptance exercises the production executor; this subclass only adds fixture assertions.
export class ZcodeNativeExecutor extends ZcodeExecutor {
  readonly observations: Array<{ sessionId: string; model: string; providerId?: string; role: string; reasoningControl: string }> = []
  override async execute(request: ExecuteRequest) {
    const workspace = realpathSync(request.workspace)
    if (!workspace.startsWith(realpathSync(tmpdir()) + sep + 'foreman-recovery-') || !workspace.includes(sep + '.foreman' + sep + 'worktrees' + sep)) throw new Error('ZCode 验收只允许运行于专用临时 worktree')
    const prompt = request.role === 'implementer' ? request.prompt + '\n完成文件编辑后执行 git status --short 检查实际改动（不要自行提交），把真实运行的命令列入 commandsRun。' : request.prompt
    const result = await super.execute({ ...request, prompt })
    // Inspect model identifiers only, immediately before the native diagnostic rotation.
    const trace = await readFile(join(homedir(), '.zcode', 'cli', 'rollout', 'model-io-' + result.sessionId + '.jsonl'), 'utf8')
    const records = trace.split('\n').filter(Boolean).map((line) => JSON.parse(line))
    const selected = records.find((entry) => typeof entry.model?.modelId === 'string')?.model
    if (!selected || (process.env.FOREMAN_ZCODE_EXPECT_MODEL && selected.modelId !== process.env.FOREMAN_ZCODE_EXPECT_MODEL)) throw new Error('ZCode 原生实际模型与验收预期不一致')
    this.observations.push({ sessionId: result.sessionId, model: selected.modelId, providerId: selected.providerId, role: request.role, reasoningControl: 'native-client-default' })
    return result
  }
}
