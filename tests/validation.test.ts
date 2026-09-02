import { describe, expect, it } from 'vitest'
import { appSettingsSchema, goalInputSchema, taskInputSchema, validated } from '../src/main/validation'

describe('validation', () => {
  it('拒绝空模型和越界返工次数', () => {
    expect(() => validated(appSettingsSchema, {
      workspace: '/tmp/repo', maxReviewLoops: 20,
      roles: {
        planner: { executor: 'codex', model: '', effort: 'high', prompt: 'plan' },
        implementer: { executor: 'codex', model: 'model', effort: 'high', prompt: 'build' },
        reviewer: { executor: 'codex', model: 'model', effort: 'high', prompt: 'review' }
      }
    })).toThrow()
  })

  it('规范化合法任务输入', () => {
    expect(validated(taskInputSchema, { title: ' task ', objective: ' do work ', workspace: ' /tmp/repo ' }))
      .toEqual({ title: 'task', objective: 'do work', workspace: '/tmp/repo' })
  })

  it('Goal 必须有成功标准和有界循环', () => {
    expect(() => validated(goalInputSchema, { title:'g',objective:'o',workspace:'/repo',successCriteria:[],constraints:[],priority:1,maxIterations:0,maxTaskAttempts:1 })).toThrow()
    expect(validated(goalInputSchema, { title:' g ',objective:' o ',workspace:'/repo',successCriteria:[' done '],constraints:[],priority:1,maxIterations:3,maxTaskAttempts:1 }).successCriteria).toEqual(['done'])
  })
})
