import { expect, it } from 'vitest'
import { diagnostics, wilson, executedCallIndex } from './diagnostics'
import { importEvaluations } from './importer'
it('keeps missing diagnostic evidence unknown and computes bounded Wilson intervals', () => {
  expect(diagnostics([])).toMatchObject({ cer: null, tokens: null, missingPrecision: null, missingRecall: null })
  expect(wilson(0, 0)).toBeNull()
  expect(wilson(0, 10)![0]).toBe(0); expect(wilson(10, 10)![1]).toBe(1)
})
it('counts tool argument errors, schema blocks and no-op observations separately', () => {
  const data = importEvaluations([{ name: 'test.json', content: JSON.stringify({ samples: [{ id: 'a', predictedCalls: [{ name: 'x', arguments: { a: 2 } }], expectedCalls: [{ name: 'x', arguments: { a: 1 } }], status: 'completed', steps: [{ name: 'x', arguments: {}, validationError: 'required' }, { name: 'x', arguments: { a: 2 }, observation: { ok: true, done: false } }] }] }) }])
  expect(diagnostics(data.samples)).toMatchObject({ badArgs: 1, schema: 1, noEffect: 1 })
})
it('keeps harness blocks out of executed calls and schema-block counts', () => {
  const data = importEvaluations([{ name: 'trace.jsonl', content: [
    { event_type: 'sample_started', sample_id: 'a' },
    { event_type: 'candidate_blocked', sample_id: 'a', tool_name: 'sms.send', arguments: {}, source: 'harness_guard', error: 'Ungrounded ID' },
  ].map(e => JSON.stringify(e)).join('\n') }])
  expect(data.samples[0].steps[0].guardError).toBe('Ungrounded ID')
  expect(data.samples[0].predictedCalls).toEqual([])
  expect(diagnostics(data.samples).schema).toBe(0)
})
it('aligns executed calls after blocked candidates without shifting the ground truth', () => {
  const steps = [{ name: 'bad', arguments: {}, guardError: 'rejected' },
    { name: 'read', arguments: {}, observation: { ok: true } },
    { name: 'bad2', arguments: {}, validationError: 'schema' },
    { name: 'write', arguments: {}, observation: { ok: true } }]
  expect(steps.map((_, i) => executedCallIndex(steps, i))).toEqual([null, 0, null, 1])
  expect(executedCallIndex([{ name: 'x', arguments: {} }], 0, true)).toBe(0)
})
it('preserves rejected raw responses live and distinguishes output failure from a disconnection', () => {
  const entry = { step: 0, action: 'retry', rawResponse: '{"name":"x"}', rawResponseAvailable: true,
    toolName: '', arguments: {}, usage: { total_tokens: 15 }, errorKind: 'output_contract', responseError: 'action required', finishReason: 'stop' }
  const data = importEvaluations([{ name: 'trace.jsonl', content: [
    { event_type: 'sample_started', sample_id: 'a' },
    { event_type: 'model_response', sample_id: 'a', planning_entry: entry },
    { event_type: 'candidate_blocked', sample_id: 'a', tool_name: '', source: 'harness_guard', error: 'action required' },
  ].map(e => JSON.stringify(e)).join('\n') }])
  expect(data.samples[0].planningTrace?.[0]).toMatchObject(entry)
  expect(data.samples[0].steps[0].guardError).toBe('action required')
  const failed = importEvaluations([{ name: 'evaluations.json', content: JSON.stringify({ samples: [
    { id: 'a', predictedCalls: [], expectedCalls: [], taskSuccess: false, status: 'output_error', stopReason: 'repair exhausted', planningTrace: [entry] },
    { id: 'b', predictedCalls: [], expectedCalls: [], taskSuccess: false, status: 'connection_error' },
  ] }) }])
  expect(failed.samples[0].diagnosis?.summary).toContain('không đồng nghĩa model đã tắt')
  expect(failed.samples[1].diagnosis?.summary).toContain('Không kết nối')
})
it('imports real TaskPlan progress without inventing tool executions', () => {
  const state = { engine: 'task-plan', revision: 1, goals: [{ id: 'g', status: 'completed' }], operations: [], complete: true }
  const data = importEvaluations([{ name: 'trace.jsonl', content: [
    { event_type: 'sample_started', sample_id: 'a' },
    { event_type: 'task_state', sample_id: 'a', task_state: state },
    { event_type: 'sample_finished', sample_id: 'a', status: 'completed', tool_calls: [], engine: 'task-plan', taskState: state, modelRequests: 1 },
  ].map(e => JSON.stringify(e)).join('\n') }])
  expect(data.samples[0]).toMatchObject({ engine: 'task-plan', taskState: state, modelRequests: 1, predictedCalls: [] })
  const saved = importEvaluations([{ name: 'evaluations.json', content: JSON.stringify({ samples: [{ id: 'a', predictedCalls: [], engine: 'task-plan', taskState: state, modelRequests: 1 }] }) }])
  expect(saved.samples[0].taskState).toEqual(state)
})
