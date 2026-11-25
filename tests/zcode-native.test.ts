import { describe, expect, it } from 'vitest'
import { decodeZcodeResult } from './helpers/zcode-native'

describe('native ZCode acceptance result decoding', () => {
  it('decodes the installed CLI JSON response', () => {
    expect(decodeZcodeResult(JSON.stringify({ sessionId: 'sess_test', response: '{"summary":"done"}', usage: { inputTokens: 12, outputTokens: 4 } }))).toMatchObject({ sessionId: 'sess_test', response: '{"summary":"done"}' })
  })
  it('uses the final result after stream events instead of treating tool chatter as the answer', () => {
    const raw = [{ type: 'turn.started', sessionId: 'sess_test' }, { type: 'session.updated', payload: {} }, { type: 'result', sessionId: 'sess_test', response: 'OK' }].map((value) => JSON.stringify(value)).join('\n')
    expect(decodeZcodeResult(raw).response).toBe('OK')
  })
  it('rejects truncated and error results', () => {
    expect(() => decodeZcodeResult('{"type":"turn.started"}\n')).toThrow('完整结果')
    expect(() => decodeZcodeResult('{"sessionId":"sess_test","response":"error","projection":{"status":"error"}}')).toThrow('失败或中断')
  })
})
