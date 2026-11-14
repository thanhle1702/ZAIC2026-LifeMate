import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { importEvaluations } from '../src/lib/importer'
import type { Evaluation } from '../src/types'
import type { LiveMeta, LivePacket } from '../src/lib/liveTypes'

type Obj = Record<string, any>
const within = (root: string, target: string) => { const r = path.relative(root, target); return r === '' || !r.startsWith('..') && !path.isAbsolute(r) }
const environment = (target: string) => target.split(/[\\/]/).some(p => p.endsWith('_environment'))
const visibleEvents = new Set(['model_request_finished', 'protocol_error', 'sample_error', 'agent_termination', 'model_response', 'sample_started', 'asr_started', 'planning_started', 'candidate', 'candidate_blocked',
  'transcription', 'transcripts', 'tool_executed', 'agent_step', 'sample_finished', 'sample_evaluated', 'inference_sample', 'asr_error'])

/** Incremental UTF-8 JSONL reader: never parse a partially written line. */
export class TraceTail {
  offset = 0
  pending = Buffer.alloc(0)
  async read(file: string) {
    let handle
    try { handle = await fs.open(file, 'r') } catch (e: any) { if (e.code === 'ENOENT') return { events: [], catchingUp: false }; throw e }
    try {
      const stat = await handle.stat()
      if (stat.size < this.offset) throw new Error('Trace bị thu ngắn; hãy tạo run mới.')
      const buffer = Buffer.alloc(Math.min(stat.size - this.offset, 4 * 1024 ** 2))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset)
      this.offset += bytesRead
      const combined = Buffer.concat([this.pending, buffer.subarray(0, bytesRead)])
      let start = 0
      const events: Obj[] = []
      for (let end = combined.indexOf(10); end !== -1; end = combined.indexOf(10, start)) {
        if (end - start > 8 * 1024 ** 2) throw new Error('Một dòng trace vượt giới hạn 8 MiB.')
        const line = combined.subarray(start, end).toString('utf8').trim(); start = end + 1
        if (!line) continue
        const event = JSON.parse(line)
        if (visibleEvents.has(event.event_type) && typeof event.sample_id === 'string') events.push(event)
      }
      this.pending = Buffer.from(combined.subarray(start))
      if (this.pending.length > 8 * 1024 ** 2) throw new Error('Một dòng trace vượt giới hạn 8 MiB.')
      return { events, catchingUp: this.offset < stat.size }
    } finally { await handle.close() }
  }
}

export class LiveBridge {
  readonly instance = randomUUID()
  root: string
  directory = ''
  id = ''
  cursor = 0
  tail = new TraceTail()
  metadata: Obj | null = null
  inputs = new Map<string, Obj>()
  histories = new Map<string, Obj[]>()
  samples = new Map<string, { row: Evaluation; version: number }>()
  finished = new Set<string>()
  scored = new Set<string>()
  scores = new Map<string, { score: number | null; f1: number }>()
  active: string | null = null
  step: number | null = null
  phase = 'waiting'
  catchingUp = false
  warning: string | undefined
  private updating: Promise<void> | null = null
  private traceFailure = false
  constructor(root: string) { this.root = path.resolve(root) }

  private async safeFile(file: string, directory = this.directory) {
    const canonical = await fs.realpath(file)
    if (!within(this.root, canonical) || !within(directory, canonical) || environment(canonical)) throw new Error('Đường dẫn không được phép.')
    return canonical
  }
  private async readJson(name: string, directory = this.directory) {
    const file = await this.safeFile(path.join(directory, name), directory)
    if ((await fs.stat(file)).size > 25 * 1024 ** 2) throw new Error('Artifact vượt 25 MiB.')
    return JSON.parse(await fs.readFile(file, 'utf8'))
  }
  private async refresh() {
    const registry = path.join(this.root, '.lifemate-live/latest.json')
    let pointer
    try { pointer = JSON.parse(await fs.readFile(await this.safeFile(registry, this.root), 'utf8')) }
    catch (e: any) {
      if (e.code !== 'ENOENT') throw e
      this.directory = ''; this.id = ''; this.cursor = 0; this.metadata = null
      this.tail = new TraceTail(); this.inputs.clear(); this.histories.clear(); this.samples.clear()
      this.finished.clear(); this.scored.clear(); this.scores.clear()
      this.active = null; this.step = null; this.phase = 'waiting'; this.catchingUp = false; this.traceFailure = false
      return
    }
    const directory = await fs.realpath(pointer.directory)
    if (!within(this.root, directory) || environment(directory) || !/^[a-f0-9]{32}$/.test(pointer.run_id)) throw new Error('Registry không hợp lệ.')
    const nextMetadata = await this.readJson('live.json', directory)
    if (pointer.run_id !== this.id || nextMetadata.generation !== this.metadata?.generation || directory !== this.directory) {
      this.directory = directory
      const metadata = await this.readJson('live.json')
      if (metadata.run_id !== pointer.run_id) throw new Error('Metadata không khớp run.')
      const input = await this.readJson('live-inputs.json')
      if (!Array.isArray(input) || input.length > 10000) throw new Error('Danh sách mẫu không hợp lệ.')
      this.id = pointer.run_id; this.tail = new TraceTail(); this.cursor = 0
      this.inputs = new Map(input.map(r => [r.id, r])); this.histories.clear(); this.samples.clear()
      this.finished.clear(); this.scored.clear(); this.active = null; this.step = null; this.phase = 'waiting'
      this.scores.clear()
      this.traceFailure = false
    }
    this.metadata = nextMetadata
    const metadata = this.metadata!
    if (metadata.run_id !== this.id || !Number.isInteger(metadata.total) || metadata.total !== this.inputs.size ||
        !['initializing', 'running', 'completed', 'failed', 'interrupted', 'paused'].includes(metadata.state)) throw new Error('Metadata không hợp lệ.')
    let traceFile = path.join(this.directory, 'trace.jsonl')
    try { traceFile = await this.safeFile(traceFile) } catch (e: any) { if (e.code !== 'ENOENT') throw e }
    if (this.traceFailure) throw new Error('Trace không hợp lệ.')
    let result
    try { result = await this.tail.read(traceFile) } catch (error) { this.traceFailure = true; throw error }
    const { events, catchingUp } = result
    this.catchingUp = catchingUp
    const changed = new Set<string>()
    for (const event of events) {
      const id = event.sample_id
      if (!this.inputs.has(id)) continue
      const history = this.histories.get(id) ?? []
      if (history.length >= 2000) throw new Error('Trace một mẫu vượt 2.000 sự kiện.')
      // Whitelist UI fields; do not relay raw prompts, request bodies or credentials.
      const keep = ['event_type', 'sample_id', 'timestamp', 'step', 'stage', 'index', 'status', 'stop_reason',
        'tool_name', 'arguments', 'result', 'validation_ok', 'validation_error', 'error', 'action', 'source',
        'raw_text', 'normalized_text', 'latest', 'history', 'transcript', 'tool_calls', 'state_hash',
        'elapsed_seconds', 'stage_seconds', 'pred_calls', 'gold_calls', 'pred_hash', 'gold_hash',
        'sequence_exact_match', 'state_hash_match', 'task_success', 'hash_match', 'local_formula_score', 'f1', 'precision', 'recall', 'usage', 'planningTrace', 'planning_entry', 'task_state', 'taskState', 'engine', 'modelRequests',
        'operationIssues', 'blockCounts', 'block_reason', 'outcome', 'error_kind', 'http_status']
      history.push(Object.fromEntries(keep.filter(k => k in event).map(k => [k, event[k]])))
      this.histories.set(id, history); changed.add(id)
      if (event.event_type === 'sample_started') { this.active = id; this.phase = 'sample'; this.step = null }
      if (event.event_type === 'asr_started') this.phase = 'asr'
      if (event.event_type === 'planning_started') { this.phase = 'planning'; this.step = event.step }
      if (event.event_type === 'tool_executed') this.phase = 'tools'
      if (['sample_finished', 'inference_sample'].includes(event.event_type)) { this.finished.add(id); this.phase = metadata.kind === 'evaluation' ? 'scoring' : 'between_samples' }
      if (event.event_type === 'sample_evaluated') {
        this.scored.add(id); this.phase = 'between_samples'
        if (Number.isFinite(event.f1) && event.f1 >= 0 && event.f1 <= 1) {
          this.scores.set(id, { score: Number.isFinite(event.local_formula_score) ? event.local_formula_score : null, f1: event.f1 })
        }
      }
    }
    for (const id of changed) {
      const manifest = { source_files: {}, effective_config: { llm: { model: metadata.model } }, mode: metadata.mode, metadata: { evaluator_revision: metadata.evaluator_revision } }
      const parsed = importEvaluations([
        { name: 'manifest.json', content: JSON.stringify(manifest) },
        { name: 'live-inputs.json', content: JSON.stringify([this.inputs.get(id)]) },
        { name: 'trace.jsonl', content: this.histories.get(id)!.map(e => JSON.stringify(e)).join('\n') },
      ])
      const row = parsed.samples[0]
      if (row.audioFile) row.audioUrl = `/_lifemate/audio?run=${this.id}&id=${encodeURIComponent(id)}`
      this.samples.set(id, { row, version: ++this.cursor })
    }
    this.warning = undefined
  }
  async snapshot(after = 0, run = '', instance?: string): Promise<LivePacket> {
    try {
      if (!this.updating) this.updating = this.refresh().finally(() => { this.updating = null })
      await this.updating
    } catch { this.warning = 'Không đọc được live artifact. Kiểm tra terminal và chạy trong thư mục run mới.' }
    if (!this.metadata) return { instance: this.instance, run: null, samples: [], cursor: 0, reset: false, warning: this.warning }
    const m = this.metadata
    let state = m.state
    if (['initializing', 'running'].includes(state)) {
      try { process.kill(m.pid, 0) } catch (e: any) { if (e.code !== 'EPERM') state = 'interrupted' }
    }
    const meta: LiveMeta = { run_id: this.id, name: m.name, path: path.relative(this.root, this.directory),
      state, phase: state === 'initializing' ? 'initializing' : this.phase, model: m.model,
      split: m.split, mode: m.mode, total: m.total, processed: this.finished.size, scored: this.scored.size,
      current_sample: ['initializing', 'running'].includes(state) ? this.active : null,
      step: this.step, started_at: m.started_at, elapsed_seconds: Math.max(0, (Date.now() - Date.parse(m.finished_at ?? m.updated_at ?? m.started_at)) / 1000),
      catching_up: this.catchingUp, message: state === 'interrupted' ? 'Tiến trình đã dừng trước khi hoàn tất run.' : m.message }
    // Duration of a running run starts at started_at; completed duration is frozen.
    meta.elapsed_seconds = Math.max(0, ((['initializing', 'running'].includes(state) ? Date.now() : Date.parse(m.updated_at)) - Date.parse(m.started_at)) / 1000)
    const identity = m.generation ? `${this.instance}:${m.generation}` : this.instance
    const reset = run !== this.id || after > this.cursor || instance !== undefined && instance !== identity
    const scores = [...this.scores.values()]
    const weighted = scores.filter(r => r.score !== null)
    meta.local_score = weighted.length ? weighted.reduce((s, r) => s + r.score!, 0) / weighted.length * 100 : null
    meta.mean_f1 = scores.length ? scores.reduce((s, r) => s + r.f1, 0) / scores.length : null
    meta.score_samples = weighted.length
    meta.evaluator_version = m.evaluator_revision
    return { instance: identity, run: meta, reset, cursor: this.cursor,
      samples: [...this.samples.values()].filter(s => reset || s.version > after).map(s => s.row), warning: this.warning }
  }
  async audio(id: string, run: string) {
    if (run !== this.id || !this.metadata || !this.inputs.has(id)) throw new Error('Unknown sample')
    const root = await fs.realpath(this.metadata.audio_root)
    const datasetRoot = await fs.realpath(path.join(this.root, 'data/train+public_test'))
    if (!within(datasetRoot, root) || environment(root)) throw new Error('Audio root outside workspace')
    const relative = this.inputs.get(id)?.audio
    if (typeof relative !== 'string') throw new Error('No audio')
    const file = await fs.realpath(path.resolve(root, relative))
    if (!within(root, file) || environment(file)) throw new Error('Audio outside dataset')
    if (!/\.(wav|mp3|flac|ogg|m4a)$/i.test(file)) throw new Error('Unsupported audio')
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > 50 * 1024 ** 2) throw new Error('Audio too large')
    return { file, size: stat.size }
  }
}

export function liveBridgePlugin(root: string): Plugin {
  const bridge = new LiveBridge(root)
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/_lifemate/')) return next()
    const json = (status: number, value: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
    res.setHeader('Cache-Control', 'no-store')
    let url: URL
    try {
      url = new URL(req.url, `http://${req.headers.host}`)
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || req.headers.origin && req.headers.origin !== url.origin || req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Local same-origin access only' })
    } catch { return json(400, { error: 'Invalid request' }) }
    if (!['GET', 'HEAD'].includes(req.method ?? '')) return json(405, { error: 'Read-only endpoint' })
    try {
      if (url.pathname === '/_lifemate/live') {
        const after = Number(url.searchParams.get('cursor') ?? 0)
        if (!Number.isSafeInteger(after) || after < 0) return json(400, { error: 'Invalid cursor' })
        return json(200, await bridge.snapshot(after, url.searchParams.get('run') ?? '', url.searchParams.get('instance') ?? ''))
      }
      if (url.pathname === '/_lifemate/audio') {
        const { file, size } = await bridge.audio(url.searchParams.get('id') ?? '', url.searchParams.get('run') ?? '')
        const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
        const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1
        if (start > end || start >= size) { res.setHeader('Content-Range', `bytes */${size}`); res.statusCode = 416; return res.end() }
        res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Length', end - start + 1)
        res.setHeader('Content-Type', file.endsWith('.wav') ? 'audio/wav' : file.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream')
        if (range) { res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`) }
        if (req.method === 'HEAD') return res.end()
        const handle = await fs.open(file, 'r')
        const stream = handle.createReadStream({ start, end, autoClose: true })
        res.on('close', () => stream.destroy()); stream.on('error', () => res.destroy()); stream.pipe(res)
        return
      }
      return json(404, { error: 'Unknown endpoint' })
    } catch { return json(404, { error: 'Artifact unavailable' }) }
  }
  return { name: 'lifemate-live-bridge', configureServer(server) { server.middlewares.use((req, res, next) => { void middleware(req, res, next) }) },
    configurePreviewServer(server) { server.middlewares.use((req, res, next) => { void middleware(req, res, next) }) } }
}
