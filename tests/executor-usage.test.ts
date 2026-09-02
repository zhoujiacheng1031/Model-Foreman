import { describe, expect, it } from 'vitest'
import { ProcessExecutor } from '../src/main/executors/process-executor'
import type { ExecuteRequest } from '../src/main/executors/types'

class UsageExecutor extends ProcessExecutor {
  execute(request: ExecuteRequest) { return this.runProcess('/bin/sh',['-c',`printf '%s\\n' '{"usage":{"input_tokens":120,"cache_read_input_tokens":30,"output_tokens":45},"total_cost_usd":0.12}'`],request) }
  protected extractOutput() { return 'ok' }
}

describe('executor usage evidence',()=>{
  it('从 CLI JSON 事件提取 token 与费用',async()=>{
    const result=await new UsageExecutor().execute({runId:'r',role:'planner',model:'m',effort:'high',workspace:process.cwd(),prompt:'x',emit:()=>{}})
    expect(result.usage).toEqual({inputTokens:150,outputTokens:45,costUsd:.12})
  })
})
