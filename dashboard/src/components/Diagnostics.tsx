import { useEffect, useState } from 'react'
import type { Evaluation } from '../types'
import { percent, summarize, equal } from '../lib/metrics'
import { diagnostics, wilson } from '../lib/diagnostics'
import { jobDataset, type Job } from '../lib/useJobs'

export default function Diagnostics({ rows, jobs }: { rows: Evaluation[]; jobs: Job[] }) {
  const d = diagnostics(rows), s = summarize(rows), ci = wilson(s.passed, s.passed + s.failed)
  const [a, setA] = useState(''), [b, setB] = useState(''), [comparison, setComparison] = useState<{ improved: string[]; regressed: string[]; sameFail: string[]; n: number } | null>(null), [error, setError] = useState('')
  const options = jobs.filter(j => j.config.kind === 'train-test' && j.processed > 0).flatMap(j => (j.config.mode === 'paired' ? ['gold-text', 'full-asr'] : [j.config.mode]).map(mode => ({ id: `${j.id}:${mode}`, name: `${j.name} / ${mode}` })))
  const optionIds = options.map(o => o.id).join('|')
  useEffect(() => {
    if (a && !optionIds.split('|').includes(a) || b && !optionIds.split('|').includes(b)) { setA(''); setB(''); setComparison(null) }
  }, [optionIds, a, b])
  async function compare() {
    setError(''); setComparison(null)
    try {
      const [idA, modeA] = a.split(':'), [idB, modeB] = b.split(':')
      const [left, right] = await Promise.all([jobDataset(idA, modeA), jobDataset(idB, modeB)])
      const references = (data: Evaluation[]) => data.map(r => ({ id: r.id, calls: r.expectedCalls, hash: r.expectedHash })).sort((a, b) => a.id.localeCompare(b.id))
      if (modeA !== modeB || !equal(references(left.samples), references(right.samples))) throw new Error('Tập mẫu/nhãn/chế độ khác nhau. Dùng đối chứng gold/audio riêng hoặc chọn hai run cùng cấu hình đánh giá.')
      const rightMap = new Map(right.samples.map(r => [r.id, r])), result = { improved: [] as string[], regressed: [] as string[], sameFail: [] as string[], n: 0 }
      for (const r of left.samples) {
        const other = rightMap.get(r.id)!
        if (r.taskSuccess === null || other.taskSuccess === null) continue
        result.n++
        if (!r.taskSuccess && other.taskSuccess) result.improved.push(r.id)
        if (r.taskSuccess && !other.taskSuccess) result.regressed.push(r.id)
        if (!r.taskSuccess && !other.taskSuccess) result.sameFail.push(r.id)
      }
      setComparison(result)
    } catch (e) { setError(e instanceof Error ? e.message : 'Không đối chiếu được artifact.') }
  }
  return <section className="panel diagnostics-panel" aria-label="Phân tích nguyên nhân điểm thấp"><div className="panel-heading"><div><h2>Chẩn đoán điểm thấp</h2><p>Bằng chứng từ executor/evaluator; giả thuyết nhân quả cần đối chứng</p></div></div>
    <div className="diagnostic-grid">{[
      ['Tool precision', percent(d.precision.value), `n=${d.precision.n}`], ['Tool recall', percent(d.recall.value), `n=${d.recall.n}`], ['Tool F1', percent(d.f1.value), `n=${d.f1.n}`],
      ['CER chuẩn hóa', percent(d.cer), `${d.charN} ký tự tham chiếu`], ['Missing-info precision', percent(d.missingPrecision), `n=${d.missingN}`], ['Missing-info recall', percent(d.missingRecall), `n=${d.missingN}`],
      ['Sai arguments cùng tool', rows.length ? String(d.badArgs) : '—', 'So sánh theo vị trí; không phải scorer fuzzy'], ['Candidate bị schema chặn', rows.length ? String(d.schema) : '—', 'Không đồng nghĩa tool đã thực thi bị reject'],
      ['Observation done=false', rows.length ? String(d.noEffect) : '—', 'Có thể hợp lệ; cần đọc mục tiêu/context'], ['Tổng token được log', d.tokens === null ? '—' : d.tokens.toLocaleString(), `Có usage: ${d.tokenN}/${rows.length} mẫu`],
      ['Task success · CI 95%', ci ? `${percent(ci[0])} – ${percent(ci[1])}` : '—', `Wilson; n=${s.passed + s.failed}, phụ thuộc tính đại diện tập mẫu`], ['Entity preservation', 'Chưa đo', 'Cần annotation thực thể; không suy ra từ WER'],
    ].map(([label, value, note]) => <div className="diagnostic-stat" key={label}><span>{label}</span><strong className="mono">{value}</strong><small>{note}</small></div>)}</div>
    <div className="diagnostic-tables"><div><h3>Trạng thái thực thi</h3>{Object.entries(d.statuses).map(([k, n]) => <p key={k}><code>{k}</code><strong>{n}</strong></p>)}{!rows.length && <p className="muted">Chưa có mẫu.</p>}</div><div><h3>Tool tham chiếu → dự đoán</h3>{Object.entries(d.confusions).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => <p key={k}><code>{k}</code><strong>{n}</strong></p>)}<small>Đếm sai lệch theo vị trí; lệch thứ tự có thể tạo nhiều dòng.</small></div></div>
    <div className="diagnostic-reasons"><h3>Nhóm cần điều tra trước</h3>{Object.entries(d.reasons).sort((a, b) => b[1].count - a[1].count).slice(0, 12).map(([reason, detail]) => <details key={reason}><summary>{detail.count} mẫu · {reason}</summary><p className="mono tiny">{detail.ids.join(', ')}</p></details>)}<p className="tiny muted">WER cao và hash khác nhau chưa đủ để kết luận ASR gây fail. Dùng Chạy train test → Đối chứng cả hai để khoanh vùng.</p></div>
    <div className="ab-controls"><h3>So sánh A → B: mẫu được sửa / regression</h3><div className="job-fields"><label>Run A<select aria-label="Run A" value={a} onChange={e => setA(e.target.value)}><option value="">Chọn run</option>{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label><label>Run B<select aria-label="Run B" value={b} onChange={e => setB(e.target.value)}><option value="">Chọn run</option>{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label></div><button className="button secondary" disabled={!a || !b || a === b} onClick={() => void compare()}>Đối chiếu kết quả</button>
      {error && <p role="alert" className="text-danger">{error}</p>}{comparison && <div className="history-selected"><div><strong>Được sửa: {comparison.improved.length}/{comparison.n}</strong><p className="mono tiny">{comparison.improved.join(', ') || '—'}</p></div><div><strong>Regression: {comparison.regressed.length}</strong><p className="mono tiny">{comparison.regressed.join(', ') || '—'}</p></div><div><strong>Cả hai sai: {comparison.sameFail.length}</strong><p className="mono tiny">{comparison.sameFail.join(', ') || '—'}</p></div></div>}
      <p className="tiny muted">Đối chiếu cùng tập/nhãn/mode. Giữ cùng evaluator khi đánh giá cải thiện; đây không phải suy đoán điểm private test.</p></div>
  </section>
}
