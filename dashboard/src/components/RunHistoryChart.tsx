import { useEffect, useRef, useState } from 'react'
import { Download, TrendingUp } from 'lucide-react'
import { Empty } from './Primitives'
import { download } from '../lib/download'
import { historyMetrics, type HistoryMetric, type RunSummary } from '../lib/runHistory'

const score = (v: number | undefined) => v === undefined ? '—' : v.toFixed(2)
export default function RunHistoryChart({ history, warning }: { history: RunSummary[]; warning: string }) {
  const [metric, setMetric] = useState<HistoryMetric>('f1'), [scope, setScope] = useState('all'), [cohort, setCohort] = useState('all'), [selected, setSelected] = useState('')
  const filtered = history.filter(r => scope === 'all' || r.kind === scope)
  const available = filtered.filter(r => r.metrics[metric])
  const groups = [...new Set(available.map(r => r.metrics[metric]!.cohort))]
  const active = cohort === 'all' || groups.includes(cohort) ? cohort : 'all'
  const all = available.filter(r => active === 'all' || r.metrics[metric]!.cohort === active)
  const rows = all.slice(-50), current = rows.find(r => r.id === selected) ?? rows.at(-1)
  const series = [...new Set(rows.map(r => r.metrics[metric]!.cohort))]
  const plot = useRef<HTMLDivElement>(null), [width, setWidth] = useState(920)
  useEffect(() => {
    if (!plot.current) return
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, entries[0].contentRect.width)))
    observer.observe(plot.current); return () => observer.disconnect()
  }, [rows.length])
  const x = (i: number) => rows.length === 1 ? (width + 30) / 2 : 52 + i / (rows.length - 1) * (width - 74)
  const y = (value: number) => 240 - value * 2
  const name = (r: RunSummary) => `${r.name} · ${r.kind ?? r.split} · ${score(r.metrics[metric]?.value)} · n=${r.metrics[metric]?.n}/${r.total}`
  const groupName = (group: string) => { const r = available.find(r => r.metrics[metric]!.cohort === group)!; return `${r.kind ?? r.split} / ${r.mode} · n=${r.metrics[metric]!.n}/${r.total} · ${group.slice(0, 6)}` }
  const color = (r: RunSummary) => r.kind === 'public-test' ? '#175cd3' : '#087443'
  const delta = series.length === 1 && rows.length > 1 ? rows.at(-1)!.metrics[metric]!.value - rows.at(-2)!.metrics[metric]!.value : null
  return <section className="panel run-history-panel" aria-label="Lịch sử điểm các lần chạy">
    <div className="panel-heading"><div><h2><TrendingUp size={16} /> Điểm qua các lần chạy</h2><p>Train test và public test · điểm local = strict tool F1 × 100 · tự cập nhật từ results/</p></div><button className="button secondary" disabled={!history.length} onClick={() => download('lifemate-run-history.json', JSON.stringify(history, null, 2))}><Download size={14} /> Xuất lịch sử</button></div>
    <div className="history-controls"><label>Hiển thị<select className="select" aria-label="Hiển thị loại run" value={scope} onChange={e => { setScope(e.target.value); setCohort('all'); setSelected('') }}><option value="all">Tất cả</option><option value="train-test">Train test</option><option value="public-test">Public test</option></select></label>
      <label>Chỉ số<select className="select" aria-label="Chỉ số so sánh lịch sử" value={metric} onChange={e => { setMetric(e.target.value as HistoryMetric); setCohort('all') }}>{Object.entries(historyMetrics).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Tập so sánh<select className="select" aria-label="Tập so sánh lịch sử" value={active} onChange={e => setCohort(e.target.value)}><option value="all">Tất cả tập · mỗi tập một đường riêng</option>{groups.map(g => <option key={g} value={g}>{groupName(g)}</option>)}</select></label></div>
    {warning && <p className="live-warning" role="status">{warning}</p>}
    {!rows.length ? <Empty title="Chưa có điểm cho chỉ số đang chọn">Các run vẫn nằm trong bảng lịch sử. Public test không có GT sẽ không tự có task success; chọn Hoàn tất xử lý hoặc ghi điểm ZAIC sau nộp.</Empty> : <>
      <div className="history-stats"><span>{filtered.length} run · {available.length} có chỉ số này</span>{series.length === 1 ? <><span>Gần nhất <strong className="mono">{score(rows.at(-1)!.metrics[metric]!.value)}</strong></span><span>So với lần trước <strong className="mono">{delta === null ? '—' : `${delta > 0 ? '+' : ''}${score(delta)} điểm`}</strong></span></> : <span>Nhiều tập/chế độ: không tính chênh lệch chung</span>}</div>
      <div className="history-plot" ref={plot}><svg viewBox={`0 0 ${width} 290`} role="group" aria-label={`Biểu đồ đường ${historyMetrics[metric]}`}>
        {[0, 25, 50, 75, 100].map(t => <g key={t}><line x1="52" x2={width - 22} y1={y(t)} y2={y(t)} stroke="#d0d5dd" strokeDasharray="3 5" /><text x="38" y={y(t) + 4} textAnchor="end">{t}</text></g>)}
        {series.map((g, index) => { const members = rows.flatMap((r, i) => r.metrics[metric]!.cohort === g ? [{ r, i }] : []); return members.length > 1 && <polyline key={g} className="history-line" fill="none" stroke={color(members[0].r)} strokeDasharray={index % 2 ? '6 4' : undefined} strokeWidth="2" points={members.map(({ r, i }) => `${x(i)},${y(r.metrics[metric]!.value)}`).join(' ')} /> })}
        {rows.map((r, i) => <g key={r.id}><circle className="history-point" cx={x(i)} cy={y(r.metrics[metric]!.value)} r={current?.id === r.id ? 6 : 4} fill={current?.id === r.id ? color(r) : '#ffffff'} stroke={color(r)} strokeWidth="2" tabIndex={0} role="button" aria-label={name(r)} onClick={() => setSelected(r.id)} onKeyDown={e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); setSelected(r.id) } }}><title>{name(r)}</title></circle>{(i === 0 || i === rows.length - 1 || i % Math.max(1, Math.ceil(rows.length / (width < 500 ? 4 : 8))) === 0) && <text x={x(i)} y="265" textAnchor="middle">#{all.length - rows.length + i + 1}</text>}</g>)}
        <text x={width / 2} y="287" textAnchor="middle">Thứ tự thời gian →</text></svg></div>
      <div className="history-note">{series.map(g => <span key={g} style={{ display: 'inline-block', marginRight: 18, color: color(available.find(r => r.metrics[metric]!.cohort === g)!) }}>● {groupName(g)}</span>)}</div>
      {current && <div className="history-selected"><div><span className="eyebrow">RUN ĐANG XEM</span><strong>{current.name}</strong><code>{current.model}</code></div><div><span className="eyebrow">{historyMetrics[metric]}</span><strong className="mono">{score(current.metrics[metric]?.value)}</strong><span>n={current.metrics[metric]!.n}/{current.total}</span></div><div><span>{current.kind} / {current.mode}</span><span>{new Date(current.at).toLocaleString('vi-VN')}</span></div></div>}
    </>}
    <div className="table-scroll"><table className="strata-table history-table"><thead><tr><th>RUN</th><th>LOẠI</th><th>CHẾ ĐỘ / TRẠNG THÁI</th><th>THỜI GIAN</th><th>{historyMetrics[metric]}</th></tr></thead><tbody>{filtered.slice(-50).reverse().map(r => <tr key={r.id}><td>{r.name}</td><td>{r.kind ?? r.split}</td><td>{r.mode} / {r.state ?? '—'}</td><td>{new Date(r.at).toLocaleString('vi-VN')}</td><td>{score(r.metrics[metric]?.value)}<small> n={r.metrics[metric]?.n ?? '—'}/{r.total}</small></td></tr>)}</tbody></table></div>
    <div className="panel-footer history-footnote">Mỗi tập mẫu/nhãn/chế độ có đường riêng. Strict tool F1 là điểm diagnostic, không phải công thức ZAIC. TRAIN đã được p1 học. Điểm ZAIC ghi riêng. Hoàn tất xử lý không phải accuracy. Hiển thị tối đa 50 điểm gần nhất; artifact gốc vẫn nằm trong results/.</div>
  </section>
}
