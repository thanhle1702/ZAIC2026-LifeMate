import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { JobManager, validateConfig } from './jobs'
const roots: string[] = []
async function root() { const p = await fs.mkdtemp(path.join(os.tmpdir(), 'lifemate-jobs-')); roots.push(p); return p }
afterEach(async () => { for (const p of roots.splice(0)) { if (path.dirname(p) !== os.tmpdir() || !path.basename(p).startsWith('lifemate-jobs-')) throw new Error('Unsafe cleanup'); await fs.rm(p, { recursive: true, force: true }) } })
const config = { kind: 'public-test', mode: 'full-asr', limit: 0, sample_seconds: 180, request_seconds: 90, max_steps: 12 }
describe('controlled local jobs and submissions', () => {
  it('reads execution health from old artifacts without a misleading zero from validation defaults', async () => {
    const m = new JobManager(await root()), id = 'f'.repeat(32), d = path.join(m.root, 'results/public-test', id)
    await fs.mkdir(d, { recursive: true })
    await fs.writeFile(path.join(d, 'job.json'), JSON.stringify({ id, state: 'failed', config, created_at: new Date().toISOString() }))
    await fs.writeFile(path.join(d, 'validation.json'), JSON.stringify({ valid: true, rows: 3, ready_to_submit: false }))
    await fs.writeFile(path.join(d, 'evaluations.json'), JSON.stringify({ samples: [
      { id: 'ok', status: 'completed', stopReason: 'no_action' },
      { id: 'broken', status: 'incomplete', stopReason: 'tool_error' },
      { id: 'loop', status: 'incomplete', stopReason: 'duplicate_loop' },
    ] }))
    expect((await m.list())[0].health).toMatchObject({ completed: 1, failed: 2, reasons: { tool_error: 1, duplicate_loop: 1 } })
  })
  it('rejects arbitrary commands/paths, invalid public coverage and unsafe model endpoints', async () => {
    const m = new JobManager(await root())
    expect(() => validateConfig({ ...config, mode: 'gold-text' })).toThrow()
    expect(() => validateConfig({ ...config, limit: 20 })).toThrow()
    expect(() => validateConfig({ ...config, max_steps: 0 })).toThrow()
    expect(() => validateConfig({ ...config, engine: 'arbitrary-command' })).toThrow()
    expect(validateConfig({ ...config, engine: 'datyth' }).engine).toBe('datyth')
    expect(validateConfig(config).engine).toBeUndefined() // Existing jobs remain step-policy.
    expect(() => m.setConnection({ url: 'http://127.0.0.1', key: 'x'.repeat(32), paidUnits: true })).toThrow()
    expect(() => m.setConnection({ url: 'https://old.run.app', key: 'x'.repeat(32), paidUnits: true })).toThrow()
    await expect(m.directory('../outside')).rejects.toThrow()
    await expect(m.start(config)).rejects.toThrow(/Colab/)
  })
  it('launches one allowlisted worker, passes secrets only through environment, and stops cooperatively', async () => {
    const calls: any[] = [], child = new EventEmitter()
    const m = new JobManager(await root(), ((...args: any[]) => { calls.push(args); return child }) as any)
    m.setConnection({ url: 'https://unit.trycloudflare.com', key: 'test-secret'.repeat(4), paidUnits: true })
    vi.spyOn(m, 'check').mockResolvedValue({ ready: true, data: [], identity: {} })
    const job = await m.start({ ...config, name: 'isolated fixture', command: 'never execute this' })
    expect(calls[0][1].slice(0, 2)).toEqual(['-m', 'lifemate.dashboard_runner'])
    expect(calls[0][2].shell).toBeUndefined(); expect(calls[0][2].windowsHide).toBe(true)
    expect(JSON.stringify(job)).not.toContain('test-secret')
    await expect(m.start(config)).rejects.toThrow(/job/)
    await m.stop(job.id)
    expect(await fs.readFile(path.join(await m.directory(job.id), 'stop.request'), 'utf8')).toBe('')
  })
  it('does not offer partial/invalid submissions and rechecks checksum before download or ZAIC score', async () => {
    const m = new JobManager(await root()), id = 'a'.repeat(32), d = path.join(m.root, 'results/public-test', id)
    await fs.mkdir(d, { recursive: true })
    await fs.writeFile(path.join(d, 'job.json'), JSON.stringify({ id, state: 'completed', config, created_at: new Date().toISOString() }))
    const content = '{"id":"test-only","tool_calls":[],"state_hash":"fixture"}\n'
    const sha256 = createHash('sha256').update(content).digest('hex')
    await fs.writeFile(path.join(d, 'submission.jsonl'), content)
    await fs.writeFile(path.join(d, 'validation.json'), JSON.stringify({ ready_to_submit: false, sha256 }))
    await expect(m.submission(id)).rejects.toThrow()
    await fs.writeFile(path.join(d, 'validation.json'), JSON.stringify({ ready_to_submit: true, sha256 }))
    expect((await m.submission(id)).sha256).toBe(sha256)
    await m.score(id, { score: 7.69, sha256 })
    expect(JSON.parse(await fs.readFile(path.join(d, 'zaic-score.json'), 'utf8')).source).toBe('user-reported ZAIC score')
    await fs.appendFile(path.join(d, 'submission.jsonl'), 'changed')
    await expect(m.submission(id)).rejects.toThrow(/thay đổi/)
    await expect(m.score(id, { score: 10, sha256 })).rejects.toThrow()
  })
  it('restores public history from disk without fabricating task success', async () => {
    const m = new JobManager(await root()), id = 'b'.repeat(32), d = path.join(m.root, 'results/public-test', id)
    await fs.mkdir(d, { recursive: true })
    await fs.writeFile(path.join(d, 'job.json'), JSON.stringify({ id, state: 'completed', config, created_at: new Date().toISOString() }))
    await fs.writeFile(path.join(d, 'evaluations.json'), JSON.stringify({ metadata: { name: 'test-only', split: 'public_test', mode: 'full-asr', run_id: id, started_at: '2026-11-08T01:00:00Z', expected_total: 2 }, samples: [{ id: 'case', status: 'completed', predictedCalls: [], taskSuccess: null }] }))
    const history = await m.history()
    expect(history).toHaveLength(1); expect(history[0].kind).toBe('public-test')
    expect(history[0].metrics.task).toBeUndefined(); expect(history[0].metrics.completion?.value).toBe(50)
    expect((await new JobManager(m.root).history())[0]).toEqual(history[0])
    expect((await m.history())[0]).toBe(history[0]) // unchanged artifacts use cached summaries
  })
  it('keeps paused and interrupted sessions out of history and resumes the same ID only once', async () => {
    const calls: any[] = [], child = new EventEmitter()
    const m = new JobManager(await root(), ((...args: any[]) => { calls.push(args); return child }) as any)
    const id = 'c'.repeat(32), d = path.join(m.root, 'results/public-test', id)
    await fs.mkdir(d, { recursive: true })
    await fs.writeFile(path.join(d, 'job.json'), JSON.stringify({ id, state: 'paused', config, created_at: '2026-11-08T01:00:00Z', processed: 10 }))
    await fs.writeFile(path.join(d, 'stop.request'), '')
    await fs.writeFile(path.join(d, 'evaluations.json'), JSON.stringify({ metadata: { name: 'paused fixture', split: 'public_test' }, samples: [{ id: 'a', predictedCalls: [], status: 'completed' }] }))
    expect(await m.history()).toEqual([])
    await expect(m.resume(id)).rejects.toThrow(/Colab/)
    m.setConnection({ url: 'https://unit.trycloudflare.com', key: 'test-only'.repeat(5), paidUnits: true })
    expect((await m.resume(id)).id).toBe(id)
    expect(calls).toHaveLength(1); expect(calls[0][1].at(-1)).toBe(d)
    expect((await m.directories())).toHaveLength(1)
    expect(JSON.parse(await fs.readFile(path.join(d, 'job.json'), 'utf8')).processed).toBe(10)
    await expect(m.resume(id)).rejects.toThrow()
    await expect(m.remove(id)).rejects.toThrow(/worker/)
  })
  it('deletes only a stopped session, removes its live pointer/cache and leaves other results/data intact', async () => {
    const m = new JobManager(await root()), id = 'd'.repeat(32), d = path.join(m.root, 'results/public-test', id)
    const other = path.join(m.root, 'results/train-test', 'e'.repeat(32)), data = path.join(m.root, 'data')
    await fs.mkdir(d, { recursive: true }); await fs.mkdir(other, { recursive: true }); await fs.mkdir(data)
    await fs.writeFile(path.join(other, 'keep.txt'), 'keep'); await fs.writeFile(path.join(data, 'keep.txt'), 'keep')
    await fs.writeFile(path.join(d, 'job.json'), JSON.stringify({ id, state: 'paused', config, created_at: new Date().toISOString() }))
    await fs.writeFile(path.join(d, 'trace.jsonl'), 'isolated test log')
    await fs.mkdir(path.join(m.root, '.lifemate-live'))
    await fs.writeFile(path.join(m.root, '.lifemate-live/latest.json'), JSON.stringify({ run_id: id, directory: path.join(d, 'full-asr') }))
    expect((await m.remove(id)).removed).toBe(true)
    await expect(fs.stat(d)).rejects.toThrow()
    await expect(fs.stat(path.join(m.root, '.lifemate-live/latest.json'))).rejects.toThrow()
    expect(await fs.readFile(path.join(other, 'keep.txt'), 'utf8')).toBe('keep')
    expect(await fs.readFile(path.join(data, 'keep.txt'), 'utf8')).toBe('keep')
    expect(await m.history()).toEqual([])
  })
})
