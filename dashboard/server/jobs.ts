import { promises as fs, createReadStream } from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { importEvaluations } from '../src/lib/importer'
import { summarizeRun } from '../src/lib/runHistory'
import type { RunSummary } from '../src/lib/runHistory'
import { executionHealth, type ExecutionHealth } from '../src/lib/execution'

export type JobConfig = { kind: 'train-test' | 'public-test'; mode: 'full-asr' | 'gold-text' | 'paired'; limit: number; sample_seconds: number; request_seconds: number; max_steps: number; subset?: 'validation' | 'regression' | 'all'; engine?: 'task-plan' | 'step-policy' | 'native' | 'datyth' }
export function validateConfig(value: any): JobConfig {
  if (!value || !['train-test', 'public-test'].includes(value.kind) || !['full-asr', 'gold-text', 'paired'].includes(value.mode)) throw new Error('Loại run/chế độ không hợp lệ.')
  if (value.kind === 'public-test' && (value.mode !== 'full-asr' || value.limit !== 0)) throw new Error('Public test phải chạy toàn bộ bằng audio.')
  for (const [key, min, max] of [['limit', 0, 10000], ['sample_seconds', 30, 600], ['request_seconds', 5, 120], ['max_steps', 1, 32]] as const) {
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) throw new Error(`${key} ngoài phạm vi.`)
  }
  if (value.subset !== undefined && !['validation', 'regression', 'all'].includes(value.subset)) throw new Error('Invalid TRAIN subset.')
  if (value.engine !== undefined && !['datyth'].includes(value.engine)) throw new Error('Engine không hợp lệ.')
  if (value.subset && !['all', 'validation'].includes(value.subset)) throw new Error('Unsupported subset');
  return Object.fromEntries(['kind', 'mode', 'limit', 'sample_seconds', 'request_seconds', 'max_steps', ...(value.engine === undefined ? [] : ['engine']), ...(value.subset === undefined ? [] : ['subset'])].map(k => [k, value[k]])) as JobConfig
}
const jsonFile = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'))
async function atomic(file: string, value: unknown) {
  const temporary = file + '.' + randomUUID() + '.tmp'
  await fs.writeFile(temporary, JSON.stringify(value, null, 2)); await fs.rename(temporary, file)
}
const activeStates = ['queued', 'initializing', 'running', 'stopping', 'pausing', 'resuming']
export class JobManager {
  children = new Map<string, ChildProcess>()
  connection = { url: '', key: '', paidUnits: false }
  starting = false
  historyCache = new Map<string, { stamp: string; value: RunSummary }>()
  healthCache = new Map<string, { stamp: string; value: ExecutionHealth }>()
  constructor(readonly root: string, private launch: typeof spawn = spawn) {}
  get python() { return path.join(this.root, process.platform === 'win32' ? '.venv-local/Scripts/python.exe' : '.venv-local/bin/python') }
  setConnection(input: any) {
    const u = new URL(input?.url)
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !['', '/'].includes(u.pathname) ||
      !['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app'].some(s => u.hostname.endsWith(s))) throw new Error('Dùng URL HTTPS của tunnel Colab, không có path/query.')
    if (typeof input.key !== 'string' || input.key.length < 32 || input.key.length > 512 || /\s/.test(input.key)) throw new Error('Khóa cần 32–512 ký tự, không có khoảng trắng.')
    if (input.paidUnits !== true) throw new Error('Chế độ API cần Colab Pro/Pay As You Go còn compute units.')
    Object.assign(this.connection, { url: u.origin, key: input.key, paidUnits: true })
    return { configured: true, url: u.origin }
  }
  async check() {
    if (!this.connection.url) throw new Error('Chưa kết nối Colab.')
    const r = await fetch(this.connection.url + '/v1/models', { headers: { Authorization: 'Bearer ' + this.connection.key }, signal: AbortSignal.timeout(60000), redirect: 'error' })
    if (!r.ok) throw new Error(`Colab HTTP ${r.status}; kiểm tra phiên GPU, URL và khóa.`)
    const identity = await r.json() as any
    if (identity.release_revision !== '02080970ccd59a2e1aeec4fd66a17640da2cddf1' || !identity.data?.some((m: any) => m.id === 'lifemate')) throw new Error('Cần notebook Datyth Qwen3.5/p1 + Gipformer.');
    return { ready: true, data: identity.data, identity: identity.identity }
  }
  async directories() {
    const found: { id: string; directory: string }[] = []
    for (const kind of ['train-test', 'public-test']) {
      const base = path.join(this.root, 'results', kind)
      let entries; try { entries = await fs.readdir(base, { withFileTypes: true }) } catch (e: any) { if (e.code === 'ENOENT') continue; throw e }
      for (const entry of entries) if (entry.isDirectory() && /^[a-f0-9]{32}$/.test(entry.name)) found.push({ id: entry.name, directory: path.join(base, entry.name) })
    }
    return found
  }
  async directory(id: string) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Run ID không hợp lệ.')
    const d = (await this.directories()).find(r => r.id === id)
    if (!d) throw new Error('Không tìm thấy run.')
    const canonical = await fs.realpath(d.directory), relative = path.relative(path.join(this.root, 'results'), canonical)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Run ngoài results.')
    return canonical
  }
  async list() {
    const jobs = []
    for (const d of await this.directories()) {
      try {
        try { await fs.access(path.join(this.root, 'results/.discarded', `${d.id}.json`)); continue } catch {}
        const job = await jsonFile(path.join(d.directory, 'job.json'))
        if (activeStates.includes(job.state) && !this.children.has(job.id)) {
          let alive = false
          if (Number.isInteger(job.pid) && job.pid > 0) try { process.kill(job.pid, 0); alive = true } catch {}
          if (!alive) job.state = 'interrupted'
        }
        const stopping = await fs.access(path.join(d.directory, 'stop.request')).then(() => true, () => false)
        if (stopping && !['completed'].includes(job.state)) job.state = await this.workerAlive(job) ? 'pausing' : 'paused'
        try { job.validation = await jsonFile(path.join(d.directory, 'validation.json')) } catch {}
        try { job.paired = await jsonFile(path.join(d.directory, 'paired.json')) } catch {}
        try { job.zaic = await jsonFile(path.join(d.directory, 'zaic-score.json')) } catch {}
        const health: ExecutionHealth = { completed: 0, failed: 0, recovered: 0, reasons: {}, failedSamples: [] }
        let known = false
        for (const mode of job.config.mode === 'paired' ? ['gold-text', 'full-asr'] : [job.config.mode]) {
          try {
            const file = path.join(d.directory, job.config.mode === 'paired' ? mode : '', 'evaluations.json')
            const stat = await fs.stat(file), stamp = `${stat.mtimeMs}:${stat.size}`
            let cached = this.healthCache.get(file)
            if (!cached || cached.stamp !== stamp) {
              const raw = await jsonFile(file)
              cached = { stamp, value: executionHealth(raw.samples, mode) }; this.healthCache.set(file, cached)
            }
            known = true; health.completed += cached.value.completed; health.failed += cached.value.failed; health.recovered += cached.value.recovered
            health.failedSamples.push(...cached.value.failedSamples)
            for (const [reason, n] of Object.entries(cached.value.reasons)) health.reasons[reason] = (health.reasons[reason] ?? 0) + n
          } catch { /* Missing artifacts mean unknown health, never zero failures. */ }
        }
        if (known) job.health = health
        jobs.push(job)
      } catch { /* A partially written/corrupt job is not a completed result. */ }
    }
    return jobs.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
  async workerAlive(job: any) {
    if (this.children.has(job.id)) return true
    if (Number.isInteger(job.pid) && job.pid > 0) try { process.kill(job.pid, 0); return true } catch {}
    return false
  }
  launchWorker(directory: string, job: any) {
    const child = this.launch(this.python, ['-m', 'lifemate.dashboard_runner', directory], { cwd: this.root, windowsHide: true,
      env: { ...process.env, PYTHONPATH: path.join(this.root, 'src'), PYTHONIOENCODING: 'utf-8',
        LIFEMATE_MODEL_API_URL: this.connection.url, LIFEMATE_MODEL_API_KEY: this.connection.key }, stdio: ['ignore', 'ignore', 'ignore'] })
    this.children.set(job.id, child)
    const closed = async () => {
      try {
        const current = await jsonFile(path.join(directory, 'job.json'))
        if (current.launch_id !== job.launch_id) return
        if (activeStates.includes(current.state)) {
          const paused = await fs.access(path.join(directory, 'stop.request')).then(() => true, () => false)
          await atomic(path.join(directory, 'job.json'), { ...current, state: paused ? 'paused' : 'failed', message: paused ? 'Phiên đã tạm dừng.' : 'Runner đã thoát; xem trace/dependencies.' })
        }
      } finally { if (this.children.get(job.id) === child) this.children.delete(job.id) }
    }
    child.once('error', () => void closed().catch(() => {})); child.once('exit', () => void closed().catch(() => {}))
    return child
  }
  async start(input: any) {
    const config = validateConfig(input)
    if (!this.connection.url) throw new Error('Chưa kết nối model Colab.')
    if (this.starting) throw new Error('Đang khởi tạo một job khác.')
    this.starting = true
    try {
      if ((await this.list()).some(j => activeStates.includes(j.state))) throw new Error('Một job đang chạy. Dừng hoặc chờ hoàn tất.')
      await this.check()
      const id = randomUUID().replaceAll('-', ''), directory = path.join(this.root, 'results', config.kind, id)
      await fs.mkdir(directory, { recursive: true })
      const job = { id, name: typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 120) : `${config.kind} / ${new Date().toLocaleString('vi-VN')}`,
        state: 'queued', launch_id: randomUUID(), created_at: new Date().toISOString(), config, total: null, processed: 0 }
      await atomic(path.join(directory, 'job.json'), job)
      // No shell; credentials travel in the child environment, never CLI arguments/artifacts.
      this.launchWorker(directory, job)
      return job
    } finally { this.starting = false }
  }
  async stop(id: string) {
    const directory = await this.directory(id), job = await jsonFile(path.join(directory, 'job.json'))
    if (activeStates.includes(job.state)) await fs.writeFile(path.join(directory, 'stop.request'), '')
    return { stopping: activeStates.includes(job.state), message: 'Đang tạm dừng; chờ request model hiện tại (tối đa120giây). Sau đó chọn Tiếp tục hoặc Xóa phiên. Không tính vào lịch sử điểm.' }
  }
  async resume(id: string) {
    if (!this.connection.url) throw new Error('Nhập lại URL/khóa Colab trong Kết nối để tiếp tục; không cần nạp lại model.')
    if (this.starting) throw new Error('Đang xử lý một yêu cầu chạy khác.')
    this.starting = true
    try {
      const jobs = await this.list(), effective = jobs.find(j => j.id === id)
      if (!effective || !['paused', 'interrupted'].includes(effective.state)) throw new Error('Phiên chưa tạm dừng xong hoặc không thể tiếp tục.')
      if (await this.workerAlive(effective) || jobs.some(j => activeStates.includes(j.state))) throw new Error('Chờ worker hiện tại thoát trước khi tiếp tục.')
      const directory = await this.directory(id), job = await jsonFile(path.join(directory, 'job.json'))
      validateConfig(job.config)
      await fs.rm(path.join(directory, 'stop.request'), { force: true })
      const next = { ...job, state: 'resuming', launch_id: randomUUID(), pid: null, message: null, resume_count: (job.resume_count ?? 0) + 1, resumed_at: new Date().toISOString() }
      await atomic(path.join(directory, 'job.json'), next)
      this.launchWorker(directory, next)
      return { resumed: true, id, message: 'Tiếp tục cùng phiên; giữ mẫu đã ghi xong, chạy lại mẫu đang dở từ ToolEnv mới.' }
    } finally { this.starting = false }
  }
  async remove(id: string) {
    if (this.starting) throw new Error('Chờ yêu cầu khởi tạo/tiếp tục hoàn tất.')
    this.starting = true
    try {
    const directory = await this.directory(id), job = await jsonFile(path.join(directory, 'job.json'))
    const effective = (await this.list()).find(j => j.id === id)
    if (await this.workerAlive(job) || effective && activeStates.includes(effective.state)) throw new Error('Hãy dừng phiên và chờ worker thoát trước khi xóa.')
    const kind = validateConfig(job.config).kind
    const base = await fs.realpath(path.join(this.root, 'results', kind))
    if (path.dirname(directory) !== base || path.basename(directory) !== id || job.id !== id) throw new Error('Không xóa đường dẫn ngoài đúng thư mục phiên.')
    // Mark exclusion before removal so a busy/locked file can never create a history point.
    const markers = path.join(this.root, 'results/.discarded'); await fs.mkdir(markers, { recursive: true })
    await atomic(path.join(markers, `${id}.json`), { id, discarded_at: new Date().toISOString() })
    const registry = path.join(this.root, '.lifemate-live/latest.json')
    try {
      const original = await fs.readFile(registry, 'utf8'), pointer = JSON.parse(original)
      const relative = path.relative(directory, path.resolve(pointer.directory))
      if ((!relative || !relative.startsWith('..') && !path.isAbsolute(relative)) && await fs.readFile(registry, 'utf8') === original) await fs.unlink(registry)
    } catch (e: any) { if (e.code !== 'ENOENT') throw e }
    for (const key of this.historyCache.keys()) if (key.startsWith(id + ':')) this.historyCache.delete(key)
    await fs.rm(directory, { recursive: true, force: false, maxRetries: 5, retryDelay: 100 })
    return { removed: true, id, message: 'Đã xóa dữ liệu phiên, reset màn hình; không tính vào lịch sử điểm.' }
    } finally { this.starting = false }
  }
  async data(id: string, mode?: string | null) {
    let directory = await this.directory(id)
    const job = await jsonFile(path.join(directory, 'job.json'))
    if (job.config.mode === 'paired') {
      if (!['gold-text', 'full-asr'].includes(mode ?? '')) throw new Error('Chọn nhánh gold-text/full-asr.')
      directory = path.join(directory, mode!)
    }
    const file = path.join(directory, 'evaluations.json')
    if ((await fs.stat(file)).size > 50 * 1024 ** 2) throw new Error('Artifact vượt giới hạn đọc 50 MiB.')
    const dataset = importEvaluations([{ name: 'evaluations.json', content: await fs.readFile(file, 'utf8') }])
    dataset.samples.forEach(row => { if (row.audioFile) row.audioUrl = `/_lifemate/jobs/${id}/audio?id=${encodeURIComponent(row.id)}&mode=${encodeURIComponent(mode ?? '')}` })
    return dataset
  }
  async history() {
    const rows = []
    for (const job of await this.list()) {
      if (!['completed', 'failed'].includes(job.state)) continue
      if (job.state === 'failed' && (job.total == null || job.processed !== job.total)) continue
      for (const mode of job.config.mode === 'paired' ? ['gold-text', 'full-asr'] : [job.config.mode]) {
        try {
          const directory = await this.directory(job.id)
          const file = path.join(directory, job.config.mode === 'paired' ? mode : '', 'evaluations.json')
          const stamp = `${(await fs.stat(file)).mtimeMs}:${job.zaic?.score ?? ''}`, cacheKey = `${job.id}:${mode}`
          const cached = this.historyCache.get(cacheKey)
          if (cached?.stamp === stamp) { rows.push(cached.value); continue }
          const data = await this.data(job.id, mode)
          const summary = await summarizeRun(data)
          if (!summary) continue
          summary.kind = job.config.kind; summary.jobId = job.id; summary.mode = mode; summary.state = job.state
          if (job.zaic?.score !== undefined && job.config.kind === 'public-test') summary.metrics.zaic = { value: job.zaic.score, n: data.samples.length, cohort: summary.metrics.completion!.cohort }
          this.historyCache.set(cacheKey, { stamp, value: summary })
          rows.push(summary)
        } catch { /* No available samples: do not fabricate a score. */ }
      }
    }
    return rows.sort((a, b) => a.at.localeCompare(b.at))
  }
  async submission(id: string) {
    const directory = await this.directory(id), job = await jsonFile(path.join(directory, 'job.json'))
    const validation = await jsonFile(path.join(directory, 'validation.json'))
    if (job.config.kind !== 'public-test' || job.state !== 'completed' || validation.ready_to_submit !== true) throw new Error('Submission chưa hoàn tất/validate hoặc không đủ public test.')
    const file = path.join(directory, 'submission.jsonl'), buffer = await fs.readFile(file)
    if (createHash('sha256').update(buffer).digest('hex') !== validation.sha256) throw new Error('Submission đã thay đổi sau validation.')
    return { file, buffer, size: buffer.length, sha256: validation.sha256 }
  }
  async score(id: string, input: any) {
    const file = await this.submission(id)
    if (!Number.isFinite(input?.score) || input.score < 0 || input.score > 100 || input.sha256 !== file.sha256) throw new Error('Điểm hoặc checksum không hợp lệ.')
    await atomic(path.join(await this.directory(id), 'zaic-score.json'), { score: input.score, sha256: file.sha256, source: 'user-reported ZAIC score', recorded_at: new Date().toISOString() })
    return { saved: true }
  }
  async review(id: string, action: 'validate' | 'local-score') {
    if (this.starting) throw new Error('Một thao tác khác đang chạy.')
    this.starting = true
    try {
      const directory = await this.directory(id), job = await jsonFile(path.join(directory, 'job.json'))
      if (!['completed', 'failed'].includes(job.state) || await this.workerAlive(job)) throw new Error('Chờ phiên kết thúc trước khi validate/chấm.')
      if (action === 'local-score' && job.config.kind !== 'train-test') throw new Error('Public không có ground truth; lấy điểm chính thức từ ZAIC.')
      await new Promise<void>((resolve, reject) => {
        const child = this.launch(this.python, ['-m', 'lifemate.dashboard_review', directory, action], {
          cwd: this.root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
          env: { ...process.env, PYTHONPATH: path.join(this.root, 'src'), PYTHONIOENCODING: 'utf-8' },
        })
        let error = ''
        child.stderr?.on('data', chunk => { error = (error + chunk.toString()).slice(-4000) })
        child.once('error', reject)
        child.once('exit', code => code === 0 ? resolve() : reject(new Error(error || 'Không thể xử lý artifact.')))
      })
      return await jsonFile(path.join(directory, action === 'validate' ? 'manual-validation.json' : 'local-score.json'))
    } finally { this.starting = false }
  }
}

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 8192) throw new Error('Request quá lớn.'); chunks.push(chunk) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export function jobsPlugin(root: string): Plugin {
  const manager = new JobManager(root)
  // Preserve in-memory credentials/child ownership across Vite config reloads, never on disk.
  const key = Symbol.for('lifemate.job-runtimes')
  const registry = globalThis as typeof globalThis & { [key: symbol]: Map<string, { connection: JobManager['connection']; children: JobManager['children'] }> }
  registry[key] ??= new Map()
  const previous = registry[key].get(root)
  if (previous) { manager.connection = previous.connection; manager.children = previous.children }
  registry[key].set(root, { connection: manager.connection, children: manager.children })
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/_lifemate/')) return next()
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (!['/_lifemate/jobs', '/_lifemate/connection', '/_lifemate/history', '/_lifemate/colab-package', '/_lifemate/colab-notebook'].includes(url.pathname) && !url.pathname.startsWith('/_lifemate/jobs/')) return next()
    const json = (status: number, value: unknown) => { res.statusCode = status; res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || req.headers.origin && req.headers.origin !== url.origin || req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Local same-origin access only' })
    if (req.method === 'POST' && req.headers['content-type']?.split(';')[0] !== 'application/json') return json(415, { error: 'JSON required' })
    try {
      if (url.pathname === '/_lifemate/colab-notebook' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/x-ipynb+json'); res.setHeader('Content-Disposition', 'attachment; filename="lifemate_datyth_vllm_colab.ipynb"')
        createReadStream(path.join(root, 'notebooks/lifemate_datyth_vllm_colab.ipynb')).pipe(res); return
      }
      if (url.pathname === '/_lifemate/connection') {
        if (req.method === 'POST') return json(200, manager.setConnection(await body(req)))
        if (req.method === 'GET') return json(200, url.searchParams.has('check') ? await manager.check() : { configured: !!manager.connection.url, url: manager.connection.url })
      }
      if (url.pathname === '/_lifemate/history' && req.method === 'GET') return json(200, await manager.history())
      if (url.pathname === '/_lifemate/jobs') {
        if (req.method === 'GET') return json(200, await manager.list())
        if (req.method === 'POST') return json(202, await manager.start(await body(req)))
      }
      const match = url.pathname.match(/^\/_lifemate\/jobs\/([a-f0-9]{32})\/(stop|resume|delete|data|submission|score|audio|validate|local-score)$/)
      if (match) {
        const [, id, action] = match
        if ((action === 'validate' || action === 'local-score') && req.method === 'POST') return json(200, await manager.review(id, action))
        if (action === 'stop' && req.method === 'POST') return json(200, await manager.stop(id))
        if (action === 'resume' && req.method === 'POST') return json(200, await manager.resume(id))
        if (action === 'delete' && req.method === 'POST') return json(200, await manager.remove(id))
        if (action === 'score' && req.method === 'POST') return json(200, await manager.score(id, await body(req)))
        if (action === 'data' && req.method === 'GET') return json(200, await manager.data(id, url.searchParams.get('mode')))
        if (action === 'submission' && req.method === 'GET') {
          const file = await manager.submission(id)
          res.setHeader('Content-Type', 'application/x-ndjson'); res.setHeader('Content-Disposition', 'attachment; filename="submission.jsonl"')
          res.setHeader('Content-Length', file.size); res.setHeader('Cache-Control', 'no-store'); res.end(file.buffer); return
        }
        if (action === 'audio' && req.method === 'GET') {
          const job = (await manager.list()).find(j => j.id === id)!
          const data = await manager.data(id, url.searchParams.get('mode')), row = data.samples.find(r => r.id === url.searchParams.get('id'))
          if (!row?.audioFile) throw new Error('Không có audio.')
          const base = await fs.realpath(path.join(root, 'data', 'train+public_test', job.config.kind === 'train-test' ? 'train' : 'public_test'))
          const file = await fs.realpath(path.resolve(base, row.audioFile)), relative = path.relative(base, file)
          if (relative.startsWith('..') || path.isAbsolute(relative) || !/\.(wav|mp3|flac|ogg|m4a)$/i.test(file) || (await fs.stat(file)).size > 50 * 1024 ** 2) throw new Error('Audio ngoài dataset/không hợp lệ.')
          res.setHeader('Content-Type', 'audio/wav'); createReadStream(file).pipe(res); return
        }
      }
      return json(405, { error: 'Method/route not supported' })
    } catch (e) { return json(400, { error: e instanceof Error ? e.message : 'Job request failed' }) }
  }
  return { name: 'lifemate-jobs', configureServer(server) { server.middlewares.use((req, res, next) => { void middleware(req, res, next).catch(() => { res.statusCode = 500; res.end('Job service error') }) }) },
    configurePreviewServer(server) { server.middlewares.use((req, res, next) => { void middleware(req, res, next).catch(() => { res.statusCode = 500; res.end('Job service error') }) }) } }
}
