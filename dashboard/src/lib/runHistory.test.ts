import { describe, expect, it } from 'vitest'
import { importEvaluations } from './importer'
import { readHistory, summarizeRun, upsertRun } from './runHistory'
import type { LiveMeta } from './liveTypes'

function dataset(pass: boolean | null = true, id = 'case') {
  return importEvaluations([{ name: 'metrics.json', content: JSON.stringify({ metadata: { name: `run-${pass}`, split: 'validation', mode: 'full-asr' },
    samples: [{ id, predictedCalls: [], expectedCalls: [], taskSuccess: pass }] }) }])
}
const live: LiveMeta = { run_id: 'a', name: 'run', path: '', state: 'completed', phase: 'scoring', model: 'model', split: 'validation', mode: 'full-asr',
  total: 1, processed: 1, scored: 1, current_sample: null, step: null, started_at: '2026-11-08T01:00:00Z', elapsed_seconds: 1, catching_up: false,
  local_score: 32.5, score_samples: 1 }
describe('real run comparison history', () => {
  it('never invents a zero score for unscored data, but retains measured zero', async () => {
    const unscored = dataset(null); unscored.samples[0].expectedCalls = null; unscored.samples[0].sequenceMatch = null
    expect(await summarizeRun(unscored)).toBeNull()
    expect((await summarizeRun(dataset(false)))?.metrics.task).toMatchObject({ value: 0, n: 1 })
  })
  it('groups identical sample sets, but separates different samples, modes, labels and coverage', async () => {
    const a = (await summarizeRun(dataset(true)))!, b = (await summarizeRun(dataset(false)))!
    expect(a.metrics.task!.cohort).toBe(b.metrics.task!.cohort)
    expect((await summarizeRun(dataset(false, 'different')))!.metrics.task!.cohort).not.toBe(a.metrics.task!.cohort)
    const mode = dataset(); mode.run!.mode = 'gold-text'
    expect((await summarizeRun(mode))!.metrics.task!.cohort).not.toBe(a.metrics.task!.cohort)
    const label = dataset(); label.samples[0].expectedCalls = [{ name: 'changed', arguments: {} }]
    expect((await summarizeRun(label))!.metrics.task!.cohort).not.toBe(a.metrics.task!.cohort)
    const partial = dataset(); partial.samples.push({ ...partial.samples[0], id: 'other', taskSuccess: null })
    expect((await summarizeRun(partial))!.metrics.task!.cohort).not.toBe(a.metrics.task!.cohort)
  })
  it('only archives complete live runs, using evaluator local score and actual time', async () => {
    for (const change of [{ state: 'running' }, { catching_up: true }, { processed: 0 }, { total: 2 }]) expect(await summarizeRun(dataset(), { ...live, ...change })).toBeNull()
    const point = (await summarizeRun(dataset(), live))!
    expect(point.metrics.local!.value).toBe(32.5)
    expect(point.timeSource).toBe('run'); expect(point.at).toBe('2026-11-08T01:00:00.000Z')
    const missingScore = (await summarizeRun(dataset(), { ...live, local_score: null }))!
    expect(missingScore.metrics.local).toBeUndefined()
  })
  it('deduplicates reimports and updates the same run without changing its original time', async () => {
    const a = (await summarizeRun(dataset(), undefined, '2026-11-08T02:00:00Z'))!
    const history = upsertRun([], a)
    const later = (await summarizeRun(dataset(), undefined, '2026-11-09T02:00:00Z'))!
    expect(upsertRun(history, later)).toBe(history)
    const update = upsertRun(history, { ...later, metrics: { ...later.metrics, local: { value: 11, n: 1, cohort: later.metrics.task!.cohort } } })
    expect(update).toHaveLength(1); expect(update[0].at).toBe(a.at)
    expect(readHistory(JSON.stringify(update))).toEqual(update)
  })
  it('rejects invalid persisted scores and preserves an empty history', () => {
    expect(readHistory(null)).toEqual([])
    expect(() => readHistory('{}')).toThrow()
    expect(() => readHistory('[{"id":"invalid"}]')).toThrow()
  })
})
