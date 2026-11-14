import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LiveBridge, TraceTail } from './liveBridge'

const roots: string[] = []
async function fixture(labeled = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lifemate-live-')); roots.push(root)
  const directory = path.join(root, 'experiments/runs/fixture'); await fs.mkdir(directory, { recursive: true })
  await fs.mkdir(path.join(root, '.lifemate-live'))
  const id = 'a'.repeat(32)
  await fs.writeFile(path.join(root, '.lifemate-live/latest.json'), JSON.stringify({ run_id: id, directory }))
  const metadata = { version: 1, run_id: id, pid: process.pid, name: 'fixture', model: 'fixture-only', split: 'train', mode: 'full-asr', total: 1, state: 'running', kind: labeled ? 'evaluation' : 'inference', started_at: new Date().toISOString(), updated_at: new Date().toISOString(), audio_root: root }
  await fs.writeFile(path.join(directory, 'live.json'), JSON.stringify(metadata))
  await fs.writeFile(path.join(directory, 'live-inputs.json'), JSON.stringify([{ id: 'case', audio: 'voice.wav', audio_text: labeled ? 'bật đèn' : undefined, context: {}, ...(labeled ? { label: { tool_calls: [{ name: 'light.on', arguments: {} }] } } : {}) }]))
  const trace = path.join(directory, 'trace.jsonl')
  const append = async (...events: unknown[]) => fs.appendFile(trace, events.map(e => JSON.stringify(e)).join('\n') + '\n')
  return { root, directory, id, metadata, trace, append, bridge: new LiveBridge(root) }
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const target = path.resolve(root)
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('lifemate-live-')) throw new Error('Unsafe test cleanup path')
    await fs.rm(target, { recursive: true, force: true })
  }
})

describe('local live bridge', () => {
  it('preserves operation recovery and block categories in a live trace without a GT score', async () => {
    const f=await fixture(false)
    const issues=[{name:'banking.transfer',state:'recovered',reason:'capacity'}]
    await f.append({event_type:'sample_started',sample_id:'case'},
      {event_type:'agent_termination',sample_id:'case',status:'recovered_with_errors',operationIssues:issues,blockCounts:{precondition:1}},
      {event_type:'sample_finished',sample_id:'case',status:'completed',stop_reason:'recovered_with_errors',tool_calls:[],elapsed_seconds:1,stage_seconds:{speech:.2,planning:.7,tools:.1},operationIssues:issues,blockCounts:{precondition:1}})
    const row=(await f.bridge.snapshot()).samples[0]
    expect(row.operationIssues).toEqual(issues);expect(row.blockCounts).toEqual({precondition:1})
    expect(row.timings).toEqual({speech:200,planning:700,tools:100});expect(row.taskSuccess).toBeNull()
    expect(row.stopReason).toBe('recovered_with_errors')
  })
  it('resets a shortened trace and previous scores on resume generation, keeping the same run ID', async () => {
    const f = await fixture()
    await f.append({ event_type: 'sample_started', sample_id: 'case' }, { event_type: 'sample_evaluated', sample_id: 'case', task_success: true, state_hash_match: true })
    const before = await f.bridge.snapshot()
    expect(before.samples[0].taskSuccess).toBe(true)
    await fs.writeFile(path.join(f.directory, 'live.json'), JSON.stringify({ ...f.metadata, generation: 'resume-attempt', state: 'running' }))
    await fs.writeFile(f.trace, JSON.stringify({ event_type: 'sample_started', sample_id: 'case' }) + '\n')
    const after = await f.bridge.snapshot(before.cursor, f.id, before.instance)
    expect(after.reset).toBe(true); expect(after.instance).not.toBe(before.instance)
    expect(after.samples[0].taskSuccess).toBeNull(); expect(after.run?.scored).toBe(0)
    expect(after.warning).toBeUndefined()
  })
  it('clears the last run when its registry has been removed', async () => {
    const f = await fixture()
    await f.append({ event_type: 'sample_started', sample_id: 'case' })
    const before = await f.bridge.snapshot()
    expect(before.run).not.toBeNull(); expect(before.samples).toHaveLength(1)
    await fs.unlink(path.join(f.root, '.lifemate-live/latest.json'))
    const after = await f.bridge.snapshot(before.cursor, f.id)
    expect(after.run).toBeNull(); expect(after.samples).toEqual([]); expect(after.cursor).toBe(0)
    // A later run must start from a fresh tail and fresh counters.
    await fs.writeFile(path.join(f.root, '.lifemate-live/latest.json'), JSON.stringify({ run_id: f.id, directory: f.directory }))
    expect((await f.bridge.snapshot()).samples).toHaveLength(1)
  })
  it('streams progress, preserves unknown scores until evaluator emits them, and returns deltas', async () => {
    const f = await fixture()
    expect((await f.bridge.snapshot()).run?.processed).toBe(0)
    await f.append({ event_type: 'sample_started', sample_id: 'case' }, { event_type: 'asr_started', sample_id: 'case', stage: 'latest' })
    const a = await f.bridge.snapshot()
    expect(a.samples[0].taskSuccess).toBeNull(); expect(a.run?.phase).toBe('asr')
    await f.append({ event_type: 'transcription', sample_id: 'case', stage: 'latest', raw_text: 'bật đèn', normalized_text: 'bật đèn' },
      { event_type: 'tool_executed', sample_id: 'case', tool_name: 'light.on', arguments: {}, result: { ok: true } })
    const b = await f.bridge.snapshot(a.cursor, f.id)
    expect(b.reset).toBe(false); expect(b.samples[0].predictedCalls).toHaveLength(1); expect(b.samples[0].taskSuccess).toBeNull()
    await f.append({ event_type: 'sample_finished', sample_id: 'case', status: 'completed', tool_calls: [{ name: 'light.on', arguments: {} }], state_hash: 'hash-from-fixture-env', elapsed_seconds: .8 },
      { event_type: 'sample_evaluated', sample_id: 'case', task_success: true, sequence_exact_match: true, state_hash_match: true, gold_hash: 'hash-from-fixture-env', gold_calls: [{ name: 'light.on', arguments: {} }], f1: 1, local_formula_score: 1 })
    const c = await f.bridge.snapshot(b.cursor, f.id)
    expect(c.run?.processed).toBe(1); expect(c.run?.scored).toBe(1); expect(c.samples[0].taskSuccess).toBe(true)
    expect(c.samples[0].predictedCalls).toHaveLength(1); expect(c.samples[0].hashMatch).toBe(true)
    expect(c.run?.local_score).toBe(100); expect(c.run?.score_samples).toBe(1)
    expect((await f.bridge.snapshot(c.cursor, f.id)).samples).toEqual([])
    expect((await f.bridge.snapshot(c.cursor, f.id, 'previous-server')).reset).toBe(true)
    expect((await f.bridge.snapshot(0, 'old-run')).samples).toHaveLength(1)
  })

  it('holds an incomplete multibyte JSONL line and resumes without corrupting Vietnamese', async () => {
    const f = await fixture(); const reader = new TraceTail()
    const line = Buffer.from(JSON.stringify({ event_type: 'transcription', sample_id: 'case', raw_text: 'đèn' }) + '\n')
    const split = line.indexOf(Buffer.from('đ')) + 1
    await fs.writeFile(f.trace, line.subarray(0, split))
    expect((await reader.read(f.trace)).events).toEqual([])
    await fs.appendFile(f.trace, line.subarray(split))
    expect((await reader.read(f.trace)).events[0].raw_text).toBe('đèn')
  })

  it('never invents public-test labels and rejects audio path traversal', async () => {
    const f = await fixture(false)
    await f.append({ event_type: 'sample_started', sample_id: 'case' }, { event_type: 'inference_sample', sample_id: 'case', status: 'completed', tool_calls: [], state_hash: 'fixture-env-only' })
    const packet = await f.bridge.snapshot()
    expect(packet.run?.processed).toBe(1); expect(packet.run?.scored).toBe(0)
    expect(packet.samples[0].taskSuccess).toBeNull(); expect(packet.samples[0].expectedCalls).toBeNull()
    expect(packet.samples[0].hashMatch).toBeNull()
    f.bridge.inputs.get('case')!.audio = '../outside.wav'
    await expect(f.bridge.audio('case', f.id)).rejects.toThrow()
    await expect(f.bridge.audio('case', 'another-run')).rejects.toThrow()
  })

  it('does not read registry targets outside the workspace or in environment folders', async () => {
    const f = await fixture()
    for (const directory of [os.tmpdir(), path.join(f.root, 'train_environment')]) {
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(path.join(f.root, '.lifemate-live/latest.json'), JSON.stringify({ run_id: f.id, directory }))
      const snapshot = await new LiveBridge(f.root).snapshot()
      expect(snapshot.warning).toBeTruthy(); expect(snapshot.run).toBeNull(); expect(snapshot.samples).toEqual([])
    }
  })

  it('reports stopped processes and keeps a corrupted trace warning until a new run', async () => {
    const f = await fixture()
    await fs.writeFile(path.join(f.directory, 'live.json'), JSON.stringify({ ...f.metadata, pid: 2147483647 }))
    expect((await f.bridge.snapshot()).run?.state).toBe('interrupted')
    await fs.writeFile(f.trace, 'not json\n')
    expect((await f.bridge.snapshot()).warning).toBeTruthy()
    await fs.writeFile(f.trace, '')
    expect((await f.bridge.snapshot()).warning).toBeTruthy()
  })
})
