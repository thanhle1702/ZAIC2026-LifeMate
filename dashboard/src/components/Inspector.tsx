import { executedCallIndex } from '../lib/diagnostics'
import { useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, Braces, Check, ChevronDown, ExternalLink, FileAudio, GitCompareArrows, ListTree, ShieldCheck, X } from 'lucide-react'
import { categories, domainLabels, type Evaluation, type TraceStep } from '../types'
import { diffFields, duration, equal, percent, wordDiff, wordError } from '../lib/metrics'
import toolSchemas from '../data/toolSchemas.json'
import { executionFailed } from '../lib/execution'
import { Badge, CopyButton, Dialog, Empty, JsonView } from './Primitives'
import AudioPlayer from './AudioPlayer'

function HashBox({ sample }: { sample: Evaluation }) {
  return <section className={`hash-box ${sample.hashMatch === false ? 'hash-fail' : sample.hashMatch ? 'hash-pass' : ''}`}>
    <div className="flex items-center justify-between"><h3><ShieldCheck size={15} /> Final state verification</h3><Badge value={sample.hashMatch} /></div>
    <div className="hash-line"><span>EXPECTED</span><code>{sample.expectedHash ?? 'Không có ground truth hash'}</code></div>
    <div className="hash-line"><span>ACTUAL</span><code>{sample.predictedHash ?? 'Chưa có hash từ ToolEnv'}</code></div>
    <p className="tiny muted">Chỉ hiển thị hash có trong run; dashboard không tạo hay suy đoán hash.</p>
  </section>
}

function FieldDiff({ expected, actual, known = true }: { expected: unknown; actual: unknown; known?: boolean }) {
  if (!known) return <Empty title="Chưa có dữ liệu đối chiếu">Nhập ground truth tương ứng để xem diff.</Empty>
  const fields = diffFields(expected, actual)
  return <div className="field-diff"><div className="field-diff-head"><span>FIELD</span><span>GROUND TRUTH</span><span>PREDICTED</span></div>{fields.map(f => <div className={`field-diff-row ${f.changed ? 'changed' : ''}`} key={f.key}>
    <code title={f.key}>{f.key}</code><code className={f.changed ? 'expected-value' : ''}>{f.expected === undefined ? <em>∅ missing</em> : JSON.stringify(f.expected)}</code><code className={f.changed ? 'actual-value' : ''}>{f.actual === undefined ? <em>∅ missing</em> : JSON.stringify(f.actual)}</code>
  </div>)}</div>
}

export default function Inspector({ sample, index, total, audioUrl, onClose, onMove, onAttach }: {
  sample: Evaluation; index: number; total: number; audioUrl?: string;
  onClose: () => void; onMove: (delta: number) => void; onAttach: (file: File) => void;
}) {
  const [tab, setTab] = useState('trace'), [selectedStep, setSelectedStep] = useState(0)
  const wer = wordError(sample)
  const prediction = sample.predictedCalls[selectedStep], expected = sample.expectedCalls?.[selectedStep]
  const steps: TraceStep[] = sample.steps.length ? sample.steps : sample.predictedCalls
  const availableSchemas = toolSchemas.filter(t => [...sample.predictedCalls, ...(sample.expectedCalls ?? [])].some(c => c.name === t.name))
  const error = categories.find(c => c.id === sample.diagnosis?.category)
  return <Dialog onClose={onClose} labelId="inspector-title" className="inspector">
    <div className="inspector-header"><div className="flex items-center gap-3"><span className="inspector-glyph"><ListTree size={20} /></span><div><span className="eyebrow">SAMPLE INSPECTOR</span><h2 id="inspector-title" className="mono">{sample.id} <Badge value={sample.taskSuccess} /></h2>{executionFailed(sample) && <p className="execution-inline-error">LỖI THỰC THI · {sample.stopReason ?? sample.status}</p>}</div></div><div className="flex items-center gap-2"><span className="tiny mono muted">{index + 1} / {total}</span><button className="icon-button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Mẫu trước"><ArrowLeft size={17} /></button><button className="icon-button" onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Mẫu sau"><ArrowRight size={17} /></button><button className="icon-button close-button" onClick={onClose} aria-label="Đóng inspector"><X size={20} /></button></div></div>
    <div className="inspector-intent"><p>“{sample.intent}”</p><div className="flex flex-wrap items-center gap-2"><span className="tag neutral">{sample.accent}{sample.synthetic ? ' · Synthetic' : ''}</span>{sample.domains.map(d => <span key={d} className="tag neutral">{domainLabels[d] ?? d}</span>)}<span className="mono tiny muted">{duration(sample.latencyMs)} end-to-end</span></div></div>
    <div className="inspector-tabs" role="tablist" aria-label="Inspector views">{[{ id: 'trace', label: 'Input & trace', icon: ListTree }, { id: 'diff', label: 'Tool & state diff', icon: GitCompareArrows }, { id: 'raw', label: 'Raw JSON', icon: Braces }].map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}><t.icon size={14} />{t.label}</button>)}</div>
    <div className="inspector-scroll" role="tabpanel">
      {tab === 'trace' && <div className="inspector-split"><div className="input-pane">
        <div className="section-label"><span>01</span> INPUT & CONTEXT</div>
        <div className="inspector-card"><div className="flex items-center gap-2 mb-4"><FileAudio size={15} className="mint" /><code className="tiny">{sample.audioFile ?? 'audio chưa được đính kèm'}</code></div><AudioPlayer src={audioUrl ?? sample.audioUrl} onAttach={onAttach} /></div>
        <div className="inspector-card"><div className="flex items-center justify-between mb-4"><h3>Transcription diff</h3><span className="tag neutral mono">WER {wer ? percent(wer.errors / wer.words) : '—'}</span></div>
          <div className="transcript-block"><span className="eyebrow">GROUND TRUTH TEXT</span><p>{sample.referenceText ?? <span className="muted">Chưa có transcript tham chiếu</span>}</p></div>
          <div className="transcript-block"><span className="eyebrow">ASR OUTPUT</span><p>{sample.asrText ?? <span className="muted">Chưa có ASR output</span>}</p></div>
          {sample.rawAsrText != null && <div className="transcript-block"><span className="eyebrow">ASR RAW · TRƯỚC CHUẨN HÓA</span><p>{sample.rawAsrText}</p></div>}
          {sample.referenceText !== null && sample.asrText !== null && <div className="word-diff" aria-label="Đối chiếu từng từ">{wordDiff(sample.referenceText, sample.asrText).map((w, i) => <span className={`diff-word ${w.type}`} key={i}>{w.text} </span>)}</div>}
          <p className="tiny muted mt-3"><span className="diff-legend removed" />Từ tham chiếu bị mất/sai <span className="diff-legend added" />Từ ASR thêm/thay · WER chuẩn hóa local</p>
        </div>
        <details className="inspector-card context-details" open><summary><h3>Context từ dataset</h3><ChevronDown size={14} /></summary>{sample.context ? <JsonView value={sample.context} /> : <p className="muted tiny">Nhập dataset JSONL để bổ sung profile, thời gian và installed apps. Trace hiện tại không chứa toàn bộ prompt.</p>}</details>
        <details className="inspector-card context-details"><summary><h3>Conversation history <span className="mono muted">{sample.history.length}</span></h3><ChevronDown size={14} /></summary><JsonView value={sample.history} /></details>
        <details className="inspector-card context-details"><summary><h3>Tool schemas · catalog project</h3><ChevronDown size={14} /></summary><p className="tiny muted mb-3">Schema tham chiếu từ train_tools_catalog.json; không khẳng định đây là toàn bộ tools đã inject vào prompt của run.</p><JsonView value={availableSchemas} /></details>
      </div><div className="trace-pane"><div className="section-label"><span>02</span> AGENT EXECUTION <span className="ml-auto mono">{steps.length} STEPS</span></div>
        {sample.diagnosis && <div className="diagnostic-box"><div className="flex items-center gap-2"><AlertTriangle size={15} /><strong>{error?.label ?? 'Chẩn đoán'}</strong><span className="tag neutral ml-auto">{sample.diagnosis.confidence === 'heuristic' ? 'GIẢ THUYẾT' : 'OBSERVED'}</span></div><h3>{sample.diagnosis.summary}</h3><p>{sample.diagnosis.evidence}</p></div>}
        {!steps.length ? <div className="no-action"><ShieldCheck size={28} /><h3>Không có tool call</h3><code>output = []</code><p>{sample.isOos === true ? 'Yêu cầu nằm ngoài các app được hỗ trợ.' : 'Không suy ra out-of-scope chỉ từ output rỗng; cần nhãn hoặc quyết định agent.'}</p></div> : <div className="trace-timeline">{steps.map((step, i) => {
          const comparisonIndex = executedCallIndex(steps, i, !sample.steps.length)
          const exp = comparisonIndex === null ? undefined : sample.expectedCalls?.[comparisonIndex], match = comparisonIndex === null || sample.expectedCalls === null ? null : !!exp && equal({ name: step.name, arguments: step.arguments }, exp)
          const guardError = 'guardError' in step ? step.guardError : undefined
          const validationError = guardError ?? ('validationError' in step ? step.validationError : undefined)
          return <div className="trace-event" key={i}><span className={`trace-node ${match === false || validationError ? 'error' : ''}`}>{i + 1}</span><div className="trace-event-body"><div className="trace-event-heading"><span className="mono">{step.name || 'Planner decision'}</span><span className={`tiny mono ${match === false || validationError ? 'text-danger' : 'mint'}`}>{validationError ? 'BLOCKED · NOT EXECUTED' : match === null ? 'LOGGED' : match ? 'MATCH' : 'DIFF'}</span></div><div className="trace-event-meta"><span className="tag neutral">{step.name === 'sys.ask_missing_info' ? 'META' : /get_|list|search|read/.test(step.name) ? 'READ' : 'WRITE'}</span><span className="tiny muted">Step {'step' in step ? step.step ?? i + 1 : i + 1}</span><button className="text-button ml-auto" disabled={comparisonIndex === null} onClick={() => { if (comparisonIndex !== null) { setSelectedStep(comparisonIndex); setTab('diff') } }}><GitCompareArrows size={12} /> So sánh</button></div><JsonView value={step.arguments} />{validationError && <p className="validation-error"><X size={12} />{String(validationError)}</p>}{'observation' in step && step.observation !== undefined && <details className="observation"><summary><ArrowDown size={12} />Environment observation<ChevronDown size={12} /></summary><JsonView value={step.observation} /></details>}</div></div>
        })}</div>}
        {sample.taskState && <details className="inspector-card" open><summary><h3>TaskPlan runtime · goals / operations</h3></summary><p className="tiny muted">Engine: {sample.engine} · Model requests: {sample.modelRequests ?? 'đang chạy'} · Tiến độ do runtime cập nhật từ execution.</p><JsonView value={sample.taskState} /></details>}
        {!!sample.operationIssues?.length && <details className="inspector-card" open><summary><h3>Thao tác lỗi / đã phục hồi</h3></summary><p className="tiny muted">Recovered chỉ xác nhận thao tác tương ứng đã thực thi lại thành công; không chứng minh mọi yêu cầu đã hoàn tất hoặc state khớp đáp án.</p><JsonView value={sample.operationIssues} /></details>}
        {!!Object.keys(sample.blockCounts ?? {}).length && <details className="inspector-card"><summary><h3>Proposal bị chặn · theo nguyên nhân</h3></summary><JsonView value={sample.blockCounts} /></details>}
        <HashBox sample={sample} />
        {!!sample.planningTrace?.length && <details className="inspector-card"><summary><h3>Model decisions · raw / sau grounding</h3></summary>{sample.planningTrace.map((item, i) => <details key={i}><summary>Step {item.step + 1} · {item.action} · {item.toolName ?? 'finish'}</summary><p className="tiny muted">Prompt: {item.promptCharacters ?? '—'} ký tự · SHA256 {item.promptSha256 ?? 'chưa có'}</p><JsonView value={{ goal_id: item.goalId, operation_id: item.operationId, response_source: item.responseSource, request_attempted: item.requestAttempted, error_kind: item.errorKind, error: item.responseError, raw_response_available: item.rawResponseAvailable ?? !!item.rawResponse, raw_response: item.rawResponse || null, finish_reason: item.finishReason, response_format: item.responseFormat, schema_sha256: item.schemaSha256, http_status: item.httpStatus, grounded_arguments: item.arguments, usage: item.usage }} /></details>)}</details>}
        <div className="inspector-note"><Check size={13} /><span>Trace chỉ đọc. Không gọi tools, sửa state hay chạy model từ dashboard.</span></div>
      </div></div>}
      {tab === 'diff' && <div className="diff-pane"><div className="flex items-start justify-between gap-3 mb-4"><div><h3>Tool call comparison</h3><p className="muted tiny mt-1">So sánh theo vị trí trong chuỗi, bao gồm tên tool và arguments.</p></div><select aria-label="Chọn bước so sánh" className="select" value={selectedStep} onChange={e => setSelectedStep(Number(e.target.value))}>{Array.from({ length: Math.max(sample.predictedCalls.length, sample.expectedCalls?.length ?? 0, 1) }, (_, i) => <option key={i} value={i}>Step {i + 1}</option>)}</select></div>
        <div className="code-comparison"><div><div className="code-panel-title"><span>GROUND TRUTH</span><CopyButton value={expected ?? []} /></div><JsonView value={sample.expectedCalls === null ? undefined : expected ?? []} /></div><div><div className="code-panel-title"><span>PREDICTED</span><CopyButton value={prediction ?? []} /></div><JsonView value={prediction ?? []} /></div></div>
        <FieldDiff expected={expected} actual={prediction} known={sample.expectedCalls !== null} />
        {sample.taskState && <details className="inspector-card" open><summary><h3>TaskPlan runtime · goals / operations</h3></summary><p className="tiny muted">Engine: {sample.engine} · Model requests: {sample.modelRequests ?? 'đang chạy'} · Tiến độ do runtime cập nhật từ execution.</p><JsonView value={sample.taskState} /></details>}
        {!!sample.operationIssues?.length && <details className="inspector-card" open><summary><h3>Thao tác lỗi / đã phục hồi</h3></summary><p className="tiny muted">Recovered chỉ xác nhận thao tác tương ứng đã thực thi lại thành công; không chứng minh mọi yêu cầu đã hoàn tất hoặc state khớp đáp án.</p><JsonView value={sample.operationIssues} /></details>}
        {!!Object.keys(sample.blockCounts ?? {}).length && <details className="inspector-card"><summary><h3>Proposal bị chặn · theo nguyên nhân</h3></summary><JsonView value={sample.blockCounts} /></details>}
        <HashBox sample={sample} />
        <div className="flex items-center justify-between mt-7 mb-3"><h3>Environment state diff</h3><span className="tag neutral">ATTACHED SNAPSHOT</span></div>
        {sample.expectedState !== null && sample.actualState !== null ? <FieldDiff expected={sample.expectedState} actual={sample.actualState} /> : <Empty title="Không có state snapshot">Hash không cho phép suy ngược field bị sai. Cần snapshot được xuất hợp lệ từ môi trường; dashboard không đọc file environment để tự tạo diff.</Empty>}
      </div>}
      {tab === 'raw' && <div className="raw-pane"><div className="flex items-center justify-between mb-4"><span className="eyebrow">DASHBOARD SAMPLE OBJECT</span><CopyButton value={sample} /></div><JsonView value={sample} /></div>}
    </div>
    <div className="inspector-bottom"><span className="tiny muted mono">RUN ARTIFACT / {sample.status} · {sample.stopReason ?? 'Chưa có stop reason'}</span><button className="text-button" onClick={() => setTab('raw')}>Xem raw JSON <ExternalLink size={12} /></button></div>
  </Dialog>
}
