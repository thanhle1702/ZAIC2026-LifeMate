import type { Dataset, Diagnosis, Evaluation, ToolCall, TraceStep } from '../types'
import { equal } from './metrics'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {}
const text = (v: unknown): string | null => typeof v === 'string' ? v : null
const bool = (v: unknown): boolean | null => typeof v === 'boolean' ? v : null
const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
const readCalls = (v: unknown): ToolCall[] | null => {
  if (!Array.isArray(v)) return null
  if (!v.every(c => typeof obj(c).name === 'string' && !Array.isArray(obj(c).arguments) && (obj(c).arguments === undefined || obj(c).arguments === null || typeof obj(c).arguments === 'object'))) throw new Error('Tool calls phải có name và arguments dạng object.')
  return v.map(c => ({ name: String(obj(c).name), arguments: obj(obj(c).arguments) }))
}
const seed = (id: string): Evaluation => ({
  id, accent: 'Unknown', synthetic: false, domains: [], intent: 'Chưa có transcript', referenceText: null, asrText: null,
  audioFile: null, predictedCalls: [], expectedCalls: null, predictedHash: null, expectedHash: null,
  sequenceMatch: null, hashMatch: null, taskSuccess: null, isOos: null, predictedOos: null,
  latencyMs: null, timings: {}, context: null, history: [], steps: [], expectedState: null, actualState: null,
  diagnosis: null, status: 'unknown', stopReason: null,
  rawAsrText: null, usage: {}, toolF1: null, toolPrecision: null, toolRecall: null,
  planningTrace: [],
  localScore: null, engine: 'datyth', taskState: null, modelRequests: null,
  operationIssues: [], blockCounts: {},
})
export function identifyDiagnosis(row: Evaluation): Diagnosis | null {
  if (row.status === 'incomplete') return { category: 'unknown', summary: `Chưa hoàn tất: ${row.stopReason ?? 'chưa rõ điểm dừng'}.`, evidence: 'Trạng thái thực thi từ runner; độc lập với điểm chất lượng và ground truth.', confidence: 'observed' }
  if (row.taskSuccess !== false && row.hashMatch !== false && row.sequenceMatch !== false && !['execution_error','incomplete'].includes(row.status)) return null
  const failures: Record<string, string> = {
    output_error: 'Phản hồi model không đúng hợp đồng JSON sau các lần sửa giới hạn; không đồng nghĩa model đã tắt.',
    connection_error: 'Không kết nối được API model.',
    http_error: 'API model trả lỗi HTTP; xem mã lỗi trong trace.',
  }
  if (failures[row.status]) return { category: 'unknown', summary: failures[row.status],
    evidence: row.stopReason ?? 'Xem raw response và lỗi từng request trong Model decisions.', confidence: 'observed' }
  if (['deadline', 'asr_error', 'model_error', 'context_overflow', 'execution_error', 'step_limit', 'schema_error'].includes(row.status)) return {
    category: 'unknown', summary: row.status === 'deadline' ? 'Mẫu dừng vì vượt thời gian xử lý.' : `Lỗi thực thi: ${row.status}.`,
    evidence: `Điểm dừng từ executor: ${row.stopReason ?? row.status}. Xem trace để phân biệt lỗi thời gian, kết nối và nội dung model.`, confidence: 'observed',
  }
  const schema = row.steps.find(s => s.validationError)
  if (schema) return { category: 'schema', summary: schema.validationError!, evidence: 'Trace ghi nhận lỗi validation. Cần kiểm tra nguồn gây ra tham số sai.', confidence: 'observed' }
  if (row.expectedCalls?.some(c => c.name === 'sys.ask_missing_info') !== row.predictedCalls.some(c => c.name === 'sys.ask_missing_info') && row.expectedCalls !== null) return {
    category: 'missing_info', summary: 'Quyết định hỏi thông tin khác ground truth.', evidence: 'Đối chiếu sự xuất hiện của sys.ask_missing_info; chưa xác nhận nguyên nhân sâu hơn.', confidence: 'heuristic',
  }
  if (row.sequenceMatch === false && row.expectedCalls !== null && !equal(row.predictedCalls.map(c => c.name), row.expectedCalls.map(c => c.name))) return {
    category: 'sequence', summary: 'Chuỗi tên tool không khớp tham chiếu.', evidence: 'Có thể sai lựa chọn, thứ tự hoặc thiếu bước. Cần đọc context để xác nhận.', confidence: 'heuristic',
  }
  if (row.hashMatch === false) return {
    category: 'state', summary: 'State hash khác ground truth.', evidence: 'Đây là dấu hiệu kết quả cuối khác nhau, chưa phải kết luận nguyên nhân. Chỉ so sánh state khi có snapshot được xuất hợp lệ.', confidence: 'observed',
  }
  return { category: 'unknown', summary: 'Chưa đủ bằng chứng xác định nguyên nhân.', evidence: 'Mở trace và đối chiếu arguments. WER cao riêng lẻ không chứng minh ASR gây thất bại.', confidence: 'heuristic' }
}
function complete(row: Evaluation, predictionKnown: boolean): Evaluation {
  if (row.planningTrace && (!Array.isArray(row.planningTrace) || row.planningTrace.some(p => !p || !Number.isSafeInteger(p.step) || typeof p.action !== 'string' || typeof p.rawResponse !== 'string' || !p.arguments || typeof p.arguments !== 'object' || Array.isArray(p.arguments)))) throw new Error('Planning trace không hợp lệ.')
  for (const value of [row.toolF1, row.toolPrecision, row.toolRecall, row.localScore]) if (value !== null && value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) throw new Error('Tool metric phải trong [0,1].')
  if (row.usage && (typeof row.usage !== 'object' || Array.isArray(row.usage) || Object.values(row.usage).some(v => !Number.isFinite(v) || v < 0))) throw new Error('Token usage không hợp lệ.')
  if (row.predictedHash?.startsWith('mock:') || row.expectedHash?.startsWith('mock:')) throw new Error('Không nhận hash minh họa. Hãy nhập artifact từ run thực tế.')
  if (typeof row.id !== 'string' || !row.id || row.id.length > 300) throw new Error('Sample ID không hợp lệ.')
  for (const key of ['sequenceMatch', 'hashMatch', 'taskSuccess', 'isOos', 'predictedOos'] as const) {
    if (row[key] !== null && typeof row[key] !== 'boolean') throw new Error(`${row.id}: ${key} phải là boolean hoặc null.`)
  }
  for (const key of ['referenceText', 'asrText'] as const) {
    if (row[key] !== null && (typeof row[key] !== 'string' || row[key]!.length > 20000)) throw new Error(`${row.id}: transcript không hợp lệ hoặc quá dài (20.000 ký tự).`)
  }
  for (const key of ['predictedHash', 'expectedHash', 'audioFile'] as const) if (row[key] !== null && typeof row[key] !== 'string') throw new Error(`${row.id}: ${key} phải là chuỗi hoặc null.`)
  if (typeof row.synthetic !== 'boolean' || typeof row.status !== 'string') throw new Error(`${row.id}: synthetic/status không hợp lệ.`)
  if (row.stopReason !== undefined && row.stopReason !== null && typeof row.stopReason !== 'string') throw new Error(`${row.id}: stopReason không hợp lệ.`)
  if (row.context !== null && (typeof row.context !== 'object' || Array.isArray(row.context))) throw new Error(`${row.id}: context phải là object hoặc null.`)
  if (typeof row.intent !== 'string' || typeof row.accent !== 'string' || !Array.isArray(row.domains) || !row.domains.every(d => typeof d === 'string') || !Array.isArray(row.history)) throw new Error(`${row.id}: metadata mẫu không hợp lệ.`)
  if (row.latencyMs !== null && number(row.latencyMs) === null) throw new Error(`${row.id}: latencyMs phải là số không âm hoặc null.`)
  if (!Array.isArray(row.steps) || row.steps.some(s => !s || typeof s.name !== 'string' || !s.arguments || Array.isArray(s.arguments) || typeof s.arguments !== 'object')) throw new Error(`${row.id}: steps không hợp lệ.`)
  if (!row.timings || typeof row.timings !== 'object' || Array.isArray(row.timings) || Object.values(row.timings).some(v => number(v) === null)) throw new Error(`${row.id}: timings không hợp lệ.`)
  if (row.diagnosis && (!['observed', 'heuristic'].includes(row.diagnosis.confidence) || !['asr', 'sequence', 'schema', 'missing_info', 'state', 'unknown'].includes(row.diagnosis.category) || typeof row.diagnosis.summary !== 'string' || typeof row.diagnosis.evidence !== 'string')) throw new Error(`${row.id}: diagnosis không hợp lệ.`)
  if (predictionKnown && row.expectedCalls !== null && row.sequenceMatch === null) row.sequenceMatch = equal(row.predictedCalls, row.expectedCalls)
  if (row.predictedHash && row.expectedHash && row.hashMatch === null) row.hashMatch = row.predictedHash === row.expectedHash
  // Keep evaluator task_success; do not invent the competition's scoring semantics.
  if (!row.domains.length) row.domains = [...new Set([...row.predictedCalls, ...(row.expectedCalls ?? [])].map(c => c.name.split('.')[0]).filter(s => s !== 'sys'))]
  if (!row.intent || row.intent === 'Chưa có transcript') row.intent = row.referenceText ?? row.asrText ?? 'Chưa có transcript'
  if (!row.diagnosis) row.diagnosis = identifyDiagnosis(row)
  return row
}
export function parseContent(content: string): unknown {
  const s = content.replace(/^\uFEFF/, '').trim()
  if (!s) throw new Error('File trống.')
  try { return JSON.parse(s) }
  catch {
    const lines = s.split(/\r?\n/).filter(l => l.trim())
    if (lines.length > 100000) throw new Error('Trace vượt giới hạn 100.000 sự kiện. Hãy chia nhỏ file.')
    return lines.map((line, i) => { try { return JSON.parse(line) } catch { throw new Error(`JSONL không hợp lệ tại dòng ${i + 1}.`) } })
  }
}
export function importEvaluations(inputs: { name: string; content: string }[]): Dataset {
  const rows = new Map<string, Evaluation>()
  const traces: Obj[] = []
  const supplements: Obj[] = []
  const seen = new Set<string>(), finished = new Set<string>(), asrEvidence = new Set<string>()
  let mode: string | null = null
  const run: NonNullable<Dataset['run']> = {}
  let model = 'Chưa có model metadata', split = 'Imported', name = `Imported · ${inputs[0]?.name ?? 'run'}`, source: Dataset['source'] = 'import', recognized = 0
  const get = (id: string) => { if (!rows.has(id)) rows.set(id, seed(id)); return rows.get(id)! }
  // Parse all non-trace files first, so input ordering cannot overwrite merged trace data.
  for (const file of inputs) {
    const data = parseContent(file.content)
    const root = obj(data), metadata = obj(root.metadata)
    if (root.source_files && root.effective_config) {
      model = text(obj(obj(root.effective_config).llm).model) ?? model
      split = text(root.mode) ?? split
      mode = text(root.mode) ?? mode
      run.id = text(root.run_id) ?? run.id
      run.startedAt = text(root.started_at) ?? text(root.created_at) ?? run.startedAt
      recognized++; continue
    }
    if (metadata.name) name = String(metadata.name)
    if (metadata.model) model = String(metadata.model)
    if (metadata.split) split = String(metadata.split)
    if (metadata.mode) mode = String(metadata.mode)
    run.id = text(metadata.run_id) ?? run.id
    run.startedAt = text(metadata.started_at) ?? text(metadata.created_at) ?? run.startedAt
    run.expectedTotal = number(metadata.expected_total) ?? run.expectedTotal
    run.evaluatorVersion = text(metadata.evaluator_revision) ?? run.evaluatorVersion
    if (['mock', 'demo'].includes(String(metadata.source)) || ['mock', 'demo'].includes(String(root.source))) throw new Error('Không nhận bộ dữ liệu minh họa. Hãy nhập artifact từ run thực tế.')
    const records = Array.isArray(data) ? data : Array.isArray(root.samples) ? root.samples : [root]
    for (const value of records) {
      const r = obj(value)
      if (r.event_type && r.sample_id) { traces.push(r); recognized++; continue }
      const id = text(r.sample_id) ?? text(r.id)
      if (!id) continue
      const normalized = Array.isArray(r.predictedCalls)
      const isMetrics = Array.isArray(r.pred_calls)
      const isDataset = 'audio' in r && ('context' in r || 'label' in r)
      const isPrediction = Array.isArray(r.tool_calls)
      if (!normalized && !isMetrics && !isDataset && !isPrediction) continue
      if (isDataset && !normalized && !isMetrics && !isPrediction) { supplements.push(r); recognized++; continue }
      const family = normalized ? 'normalized' : isMetrics ? 'metrics' : isDataset ? 'dataset' : 'prediction'
      const identity = `${family}:${id}`
      if (seen.has(identity)) throw new Error(`Trùng sample ${id} trong cùng loại artifact. Chỉ nhập các file của một run.`)
      seen.add(identity)
      recognized++
      const row = get(id)
      if (normalized) {
        for (const key of Object.keys(seed(id))) if (Object.hasOwn(r, key)) (row as unknown as Obj)[key] = r[key]
        if (typeof r.audioUrl === 'string') row.audioUrl = r.audioUrl
        row.predictedCalls = readCalls(r.predictedCalls)!
        row.expectedCalls = readCalls(r.expectedCalls)
        row.steps = Array.isArray(r.steps) ? r.steps as TraceStep[] : []
        continue
      }
      const label = obj(r.label)
      const predicted = readCalls(r.pred_calls ?? r.tool_calls)
      const expected = readCalls(r.gold_calls ?? label.tool_calls)
      if (predicted !== null) row.predictedCalls = predicted
      if (expected !== null) row.expectedCalls = expected
      row.sequenceMatch = bool(r.sequence_exact_match) ?? row.sequenceMatch
      row.hashMatch = bool(r.state_hash_match) ?? row.hashMatch
      row.taskSuccess = bool(r.task_success) ?? row.taskSuccess
      row.toolF1 = number(r.f1) ?? row.toolF1
      row.localScore = number(r.local_formula_score) ?? row.localScore
      row.toolPrecision = number(r.precision) ?? row.toolPrecision
      row.toolRecall = number(r.recall) ?? row.toolRecall
      row.predictedHash = text(r.pred_hash) ?? text(r.state_hash) ?? row.predictedHash
      row.expectedHash = text(r.gold_hash) ?? row.expectedHash
      row.referenceText = text(r.reference_text) ?? text(r.audio_text) ?? row.referenceText
      row.asrText = text(r.transcript) ?? text(r.asr_text) ?? row.asrText
      if (typeof r.asr_text === 'string') asrEvidence.add(id)
      row.audioFile = text(r.audio) ?? row.audioFile
      row.context = Object.keys(obj(r.context)).length ? obj(r.context) : row.context
      row.history = Array.isArray(r.history) ? r.history : row.history
      row.isOos = bool(r.is_oos) ?? row.isOos
      row.predictedOos = bool(r.predicted_oos) ?? (r.status === 'oos' ? true : row.predictedOos)
      row.accent = text(r.accent) ?? row.accent
      row.synthetic = bool(r.synthetic) ?? row.synthetic
      row.latencyMs = number(r.elapsed_seconds) === null ? row.latencyMs : Number(r.elapsed_seconds) * 1000
      row.status = text(r.status) ?? row.status
      row.stopReason = text(r.stop_reason) ?? row.stopReason
      // label.final_state is intentionally ignored: no environment data read/replay/hash generation here.
    }
  }
  for (const event of traces) {
    const row = get(String(event.sample_id))
    if (event.event_type === 'sample_started') row.status = 'running'
    if (event.event_type === 'sample_finished' || event.event_type === 'inference_sample' && !finished.has(row.id)) {
      if (finished.has(row.id)) throw new Error(`Trace có nhiều sample_finished cho ${row.id}. Hãy nhập từng run riêng.`)
      finished.add(row.id)
      const calls = readCalls(event.tool_calls)
      if (calls && seen.has(`metrics:${row.id}`) && !equal(calls, row.predictedCalls)) throw new Error(`Trace và metrics của ${row.id} không khớp tool calls. Có thể bạn đang trộn hai run.`)
      row.predictedCalls = readCalls(event.tool_calls) ?? row.predictedCalls
      row.predictedHash = text(event.state_hash) ?? row.predictedHash
      row.asrText = text(event.transcript) ?? row.asrText
      row.latencyMs = number(event.elapsed_seconds) === null ? row.latencyMs : Number(event.elapsed_seconds) * 1000
      row.timings = Object.fromEntries(Object.entries(obj(event.stage_seconds)).flatMap(([k, v]) => number(v) === null ? [] : [[k, Number(v) * 1000]]))
      row.status = text(event.status) ?? row.status
      row.stopReason = text(event.stop_reason) ?? row.stopReason
      if (Array.isArray(event.operationIssues)) row.operationIssues = event.operationIssues
      if (event.blockCounts) row.blockCounts = obj(event.blockCounts) as Record<string, number>
      if (event.status === 'oos') row.predictedOos = true
    }
    if (event.event_type === 'transcripts') {
      row.asrText = text(event.latest) ?? row.asrText
      row.history = Array.isArray(event.history) ? event.history : row.history
    }
    if (event.event_type === 'transcription' && event.stage === 'latest') {
      row.rawAsrText = text(event.raw_text) ?? row.rawAsrText
      row.asrText = text(event.normalized_text) ?? text(event.raw_text) ?? row.asrText
      asrEvidence.add(row.id)
    }
    if (event.event_type === 'tool_executed') {
      const call = { name: String(event.tool_name ?? 'unknown'), arguments: obj(event.arguments) }
      row.steps.push({ ...call, observation: event.result, step: typeof event.step === 'number' ? event.step : undefined })
      if (!seen.has(`metrics:${row.id}`) && !finished.has(row.id)) row.predictedCalls.push(call)
    }
    if (event.event_type === 'agent_step' && event.validation_ok === false) row.steps.push({
      name: String(event.tool_name ?? 'unknown'), arguments: obj(event.arguments), validationError: String(event.validation_error ?? 'Validation rejected'),
      step: typeof event.step === 'number' ? event.step : undefined,
    })
    if (event.event_type === 'candidate_blocked' && (event.tool_name || event.source === 'harness_guard')) row.steps.push({
      name: String(event.tool_name ?? ''), arguments: obj(event.arguments),
      ...(event.source === 'harness_guard' ? { guardError: text(event.error) ?? 'Harness rejected candidate' }
        : { validationError: text(event.error) ?? 'Candidate rejected' }),
      step: typeof event.step === 'number' ? event.step : undefined,
    })
    if (event.event_type === 'model_response') {
      const entry = obj(event.planning_entry)
      if (typeof entry.step === 'number' && typeof entry.action === 'string' && typeof entry.rawResponse === 'string') {
        row.planningTrace ??= []
        row.planningTrace = row.planningTrace.filter(p => p.step !== entry.step)
        row.planningTrace.push(entry as unknown as NonNullable<Evaluation['planningTrace']>[number])
      }
    }
    if (event.event_type === 'agent_termination') {
      if (Array.isArray(event.operationIssues)) row.operationIssues = event.operationIssues
      if (event.blockCounts) row.blockCounts = obj(event.blockCounts) as Record<string, number>
    }
    if (event.event_type === 'task_state') {
      row.engine = 'task-plan'
      row.taskState = Object.keys(obj(event.task_state)).length ? obj(event.task_state) : null
    }
    if (event.event_type === 'sample_evaluated') {
      row.localScore = number(event.local_formula_score) ?? row.localScore
      row.toolF1 = number(event.f1) ?? row.toolF1
      row.toolPrecision = number(event.precision) ?? row.toolPrecision
      row.toolRecall = number(event.recall) ?? row.toolRecall
      row.hashMatch = bool(event.state_hash_match) ?? bool(event.hash_match) ?? row.hashMatch
      row.sequenceMatch = bool(event.sequence_exact_match) ?? row.sequenceMatch
      row.taskSuccess = bool(event.task_success) ?? row.taskSuccess
      row.expectedHash = text(event.gold_hash) ?? row.expectedHash
      row.predictedHash = text(event.pred_hash) ?? row.predictedHash
      row.expectedCalls = readCalls(event.gold_calls) ?? row.expectedCalls
    }
    if (event.event_type === 'sample_finished') {
      row.engine = text(event.engine) ?? row.engine
      row.taskState = event.taskState === null ? null : Object.keys(obj(event.taskState)).length ? obj(event.taskState) : row.taskState
      row.modelRequests = number(event.modelRequests) ?? row.modelRequests
      row.usage = Object.fromEntries(Object.entries(obj(event.usage)).filter(([, v]) => number(v) !== null)) as Record<string, number>
      if (Array.isArray(event.planningTrace)) row.planningTrace = event.planningTrace as Evaluation['planningTrace']
    }
  }
  // Enrich only evaluated IDs. A full train.jsonl must not add unrun training cases to a validation run.
  for (const r of supplements) {
    const id = text(r.sample_id) ?? text(r.id)
    if (!id || !rows.has(id)) continue
    const row = rows.get(id)!, expected = readCalls(obj(r.label).tool_calls)
    if (expected && row.expectedCalls && !equal(expected, row.expectedCalls)) throw new Error(`Nhãn dataset của ${id} khác metrics. Kiểm tra phiên bản dataset.`)
    row.expectedCalls = expected ?? row.expectedCalls
    row.referenceText = text(r.audio_text) ?? text(r.reference_text) ?? row.referenceText
    row.audioFile = text(r.audio) ?? row.audioFile
    row.context = Object.keys(obj(r.context)).length ? obj(r.context) : row.context
    row.history = row.history.length ? row.history : Array.isArray(r.history) ? r.history : row.history
    row.isOos = bool(r.is_oos) ?? row.isOos
    row.accent = text(r.accent) ?? row.accent
    row.synthetic = bool(r.synthetic) ?? row.synthetic
  }
  if (!recognized || !rows.size) throw new Error('Không tìm thấy sample. Chọn sample_metrics.json, trace.jsonl, manifest.json và/hoặc dataset JSONL của LifeMate.')
  if (rows.size > 10000) throw new Error('Tối đa 10.000 mẫu mỗi lần nhập. Hãy chia nhỏ run.')
  for (const row of rows.values()) {
    // The executor logs transcript in gold-text mode too. That is not ASR evidence.
    if (mode === 'gold-text' || mode !== 'full-asr' && !asrEvidence.has(row.id) && !seen.has(`normalized:${row.id}`)) {
      if (row.intent === 'Chưa có transcript') row.intent = row.referenceText ?? row.asrText ?? row.intent
      row.asrText = null
    }
  }
  return { name, source, model, split, run: { ...run, mode: mode ?? undefined }, samples: [...rows.values()].map(row => complete(row, ['metrics', 'prediction', 'normalized'].some(family => seen.has(`${family}:${row.id}`)) || finished.has(row.id))), files: inputs.map(f => f.name) }
}
