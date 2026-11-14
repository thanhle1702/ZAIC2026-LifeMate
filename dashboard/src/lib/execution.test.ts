import { describe, expect, it } from 'vitest'
import { executionHealth, executionFailed, observedFailure } from './execution'
import type { Evaluation } from '../types'

describe('execution failures are independent from ground-truth scoring', () => {
  it('reports recovered operations as warnings, without fabricating task success', () => {
    const health=executionHealth([{id:'r',status:'completed',stopReason:'recovered_with_errors'}])
    expect(health).toMatchObject({completed:1,failed:0,recovered:1})
    for (const reason of ['retry_budget_exhausted','search_unresolved','unresolved_tool_error','output_truncated','invalid_protocol'])
      expect(executionFailed({status:'incomplete',stopReason:reason})).toBe(true)
  })
  it('counts the 19 incomplete public samples without inventing task success', () => {
    const rows = Array.from({ length: 634 }, (_, i) => ({ id: `public_${i}`, status: i < 615 ? 'completed' : 'incomplete',
      stopReason: i < 615 ? 'completed_write' : i < 623 ? 'tool_error' : 'duplicate_loop' }))
    const health = executionHealth(rows, 'full-asr')
    expect(health.completed).toBe(615); expect(health.failed).toBe(19)
    expect(health.reasons).toEqual({ tool_error: 8, duplicate_loop: 11 })
    expect(health.failedSamples).toHaveLength(19)
  })
  it('does not equate missing information, no action or a running sample with an execution error', () => {
    for (const reason of ['missing_information', 'unsupported', 'no_action', 'completed_write'])
      expect(executionFailed({ status: 'completed', stopReason: reason })).toBe(false)
    expect(executionFailed({ status: 'running' })).toBe(false)
    expect(executionFailed({ status: 'unknown' })).toBe(false)
  })
  it('keeps unscored execution failures in the failure filter', () => {
    expect(observedFailure({ status: 'incomplete', stopReason: 'duplicate_loop', taskSuccess: null, hashMatch: null, sequenceMatch: null } as Evaluation)).toBe(true)
  })
})
