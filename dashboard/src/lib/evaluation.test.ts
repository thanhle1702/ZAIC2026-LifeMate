import { describe, expect, it } from 'vitest'
import { importEvaluations, parseContent } from './importer'
import { diffFields, editDistance, equal, median, summarize, wordDiff } from './metrics'
import { csvCell } from './download'

describe('diagnostic metrics and missing evidence', () => {
  it('derives counts only from supplied evaluator flags', () => {
    const data = importEvaluations([{ name: 'sample_metrics.json', content: JSON.stringify([
      { sample_id: 'a', pred_calls: [], gold_calls: [], task_success: true, sequence_exact_match: true },
      { sample_id: 'b', pred_calls: [], gold_calls: [], task_success: false, sequence_exact_match: false },
      { sample_id: 'c', pred_calls: [] },
    ]) }])
    const summary = summarize(data.samples)
    expect(data.source).toBe('import')
    expect(summary.total).toBe(3)
    expect(summary.passed).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.unscored).toBe(1)
    expect(summary.sequence.value).toBe(.5)
    expect(summary.oosPrecision).toBeNull()
    expect(summary.oosRecall).toBeNull()
  })
  it('leaves unknown metrics empty when no run exists', () => {
    expect(summarize([])).toMatchObject({ total: 0, passed: 0, failed: 0, wer: null, medianLatency: null,
      sequence: { value: null, n: 0 }, hash: { value: null, n: 0 }, oosPrecision: null, oosRecall: null })
  })
  it('rejects explicitly illustrative datasets and invented hashes', () => {
    for (const source of ['mock', 'demo']) expect(() => importEvaluations([{ name: 'data.json', content: JSON.stringify({ metadata: { source }, samples: [{ id: 'a', predictedCalls: [] }] }) }])).toThrow(/minh họa/)
    expect(() => importEvaluations([{ name: 'data.json', content: JSON.stringify({ id: 'a', tool_calls: [], state_hash: 'mock:123' }) }])).toThrow(/minh họa/)
  })
  it('does not turn public predictions, missing hashes, or [] into pass/fail or OOS labels', () => {
    const data = importEvaluations([{ name: 'public.jsonl', content: JSON.stringify({ id: 'p01', tool_calls: [], state_hash: 'provided-by-env' }) }])
    expect(data.samples[0].expectedCalls).toBeNull()
    expect(data.samples[0].taskSuccess).toBeNull()
    expect(data.samples[0].isOos).toBeNull()
    expect(summarize(data.samples)).toMatchObject({ unscored: 1, failed: 0, passed: 0, wer: null, oosPrecision: null, oosRecall: null })
  })
  it('treats known empty gold sequence differently from absent gold', () => {
    const data = importEvaluations([{ name: 'metrics.json', content: JSON.stringify([{ sample_id: 'noop', pred_calls: [], gold_calls: [], sequence_exact_match: true, task_success: true, pred_hash: 'x', gold_hash: 'x' }]) }])
    expect(data.samples[0].sequenceMatch).toBe(true)
    expect(data.samples[0].hashMatch).toBe(true)
    expect(data.samples[0].isOos).toBeNull()
  })
  it('calculates micro WER, including insertions and Unicode normalization', () => {
    const rows = importEvaluations([{ name: 'predictions.json', content: JSON.stringify([{ id: 'a', tool_calls: [] }, { id: 'b', tool_calls: [] }]) }]).samples
    rows[0].referenceText = 'Xin chào.'; rows[0].asrText = 'xin chào bạn'
    rows[1].referenceText = 'Một hai ba bốn năm sáu bảy tám'; rows[1].asrText = 'Một hai ba bốn năm sáu bảy tám'
    expect(summarize(rows).wer).toBe(.1) // one edit / ten reference words, not mean of sample WERs
    expect(editDistance(['a'], ['b', 'c'])).toBe(2)
    expect(wordDiff('một triệu', 'một trăm').some(p => p.type === 'removed' && p.text === 'triệu')).toBe(true)
  })
  it('ignores object key order while preserving arrays, value types and missing keys', () => {
    expect(equal({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(equal([1, 2], [2, 1])).toBe(false)
    expect(equal({ amount: 100 }, { amount: '100' })).toBe(false)
    expect(diffFields({ pickup: 'nhà', amount: 100 }, { amount: 10 }).filter(f => f.changed)).toHaveLength(2)
  })
  it('uses the arithmetic median for even-sized latency samples', () => {
    expect(median([1000, 3000, 4000, 2000])).toBe(2500)
    expect(median([])).toBeNull()
  })
})

describe('actual evaluator and tracer adapters', () => {
  const metrics = { name: 'sample_metrics.json', content: JSON.stringify([{ sample_id: 'train_demo', pred_calls: [{ name: 'alarm.create', arguments: { time: '06:00' } }], gold_calls: [{ name: 'sys.ask_missing_info', arguments: { tool_name: 'alarm.create', params: ['time'] } }], pred_hash: 'a', gold_hash: 'b', sequence_exact_match: false, state_hash_match: false, task_success: false }]) }
  const trace = { name: 'trace.jsonl', content: [
    { event_type: 'transcription', sample_id: 'train_demo', stage: 'latest', normalized_text: 'Mai báo thức nhé' },
    { event_type: 'transcripts', sample_id: 'train_demo', latest: 'Mai báo thức nhé', history: [] },
    { event_type: 'tool_executed', sample_id: 'train_demo', step: 0, tool_name: 'alarm.create', arguments: { time: '06:00' }, result: { ok: true } },
    { event_type: 'sample_finished', sample_id: 'train_demo', transcript: 'Mai báo thức nhé', tool_calls: [{ name: 'alarm.create', arguments: { time: '06:00' } }], state_hash: 'a', status: 'completed', elapsed_seconds: 2.5, stage_seconds: { speech: .6, planning: 1.8, tools: .1 } },
  ].map(r => JSON.stringify(r)).join('\n') }
  const dataset = { name: 'train.jsonl', content: JSON.stringify({ id: 'train_demo', audio: 'sample.wav', audio_text: 'Mai đặt báo thức nhé', context: { timezone: 'Asia/Ho_Chi_Minh' }, label: { tool_calls: [{ name: 'sys.ask_missing_info', arguments: { tool_name: 'alarm.create', params: ['time'] } }], final_state: { should_not_be_used: true } } }) }
  it('joins metrics, trace and gold text by ID independently of file order', () => {
    const a = importEvaluations([trace, metrics, dataset]), b = importEvaluations([dataset, metrics, trace])
    expect(a.samples).toEqual(b.samples)
    expect(a.samples[0]).toMatchObject({ asrText: 'Mai báo thức nhé', referenceText: 'Mai đặt báo thức nhé', latencyMs: 2500, accent: 'Unknown', expectedState: null, actualState: null, timings: { speech: 600 }, diagnosis: { category: 'missing_info' } })
    expect(a.samples[0].steps).toHaveLength(1)
    expect(a.samples[0].steps[0].observation).toEqual({ ok: true })
  })
  it('accepts BOM and valid JSONL, rejects corrupt or unrelated files', () => {
    expect(parseContent('\uFEFF{"a":1}\n{"a":2}')).toHaveLength(2)
    expect(() => parseContent('{}\nwrong')).toThrow(/dòng 2/)
    expect(() => importEvaluations([{ name: 'irrelevant.json', content: '{"hello":"world"}' }])).toThrow(/Không tìm thấy sample/)
    expect(() => importEvaluations([{ name: 'bad.json', content: JSON.stringify([{ id: 'bad', tool_calls: [{ name: 'x', arguments: [] }] }]) }])).toThrow(/arguments/)
  })
  it('enriches evaluated IDs without accidentally adding the whole training set', () => {
    const extra = { id: 'not_in_validation', audio: 'other.wav', audio_text: 'Other', context: {}, label: { tool_calls: [] } }
    const result = importEvaluations([metrics, { name: 'full_train.jsonl', content: dataset.content + '\n' + JSON.stringify(extra) }])
    expect(result.samples).toHaveLength(1)
    expect(result.samples[0].referenceText).toBe('Mai đặt báo thức nhé')
  })
  it('rejects mixed runs, duplicate records and incorrectly typed normalized metrics', () => {
    expect(() => importEvaluations([metrics, metrics])).toThrow(/Trùng sample/)
    const badTrace = { ...trace, content: trace.content.replace('"time":"06:00"', '"time":"07:00"').replaceAll('"time":"06:00"', '"time":"07:00"') }
    expect(() => importEvaluations([metrics, badTrace])).toThrow(/không khớp tool calls/)
    const normalized = { id: 'bad', predictedCalls: [], taskSuccess: 'false' }
    expect(() => importEvaluations([{ name: 'bad.json', content: JSON.stringify({ samples: [normalized] }) }])).toThrow(/boolean/)
  })
  it('does not report perfect ASR from a gold-text executor transcript', () => {
    const manifest = { name: 'manifest.json', content: JSON.stringify({ source_files: {}, mode: 'gold-text', effective_config: { llm: { model: 'example' } } }) }
    const run = importEvaluations([metrics, trace, dataset, manifest])
    expect(run.samples[0].asrText).toBeNull()
    expect(summarize(run.samples).wer).toBeNull()
  })
  it('escapes spreadsheet formulas and quotes on CSV export', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell(null)).toBe('""')
  })
})
