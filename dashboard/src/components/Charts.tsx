import { ArrowUpRight, CircleHelp, GitBranch, Timer, Workflow } from 'lucide-react'
import { categories, domainLabels, type ErrorCategory, type Evaluation } from '../types'
import { duration, median, percent, summarize } from '../lib/metrics'

export function FailureChart({ rows, active, onSelect }: { rows: Evaluation[]; active: string; onSelect: (c: ErrorCategory) => void }) {
  const failures = rows.filter(r => r.taskSuccess === false)
  const counts = categories.map(c => ({ ...c, count: failures.filter(r => (r.diagnosis?.category ?? 'unknown') === c.id).length }))
  let offset = 0
  return <section className="panel failure-panel">
    <div className="panel-heading"><div><h2>Phân bố lỗi</h2><p>Một nhóm lỗi chính cho mỗi mẫu thất bại</p></div><span className="tag neutral">{failures.length} FAIL</span></div>
    <div className="failure-body">
      <div className="donut-wrap"><svg className="donut" viewBox="0 0 180 180" role="img" aria-label={`${failures.length} mẫu thất bại trên ${rows.length} mẫu`}>
        <circle cx="90" cy="90" r="68" fill="none" stroke="#242c35" strokeWidth="13" />
        {counts.filter(c => c.count).map(c => {
          const portion = c.count / failures.length * 100, start = offset; offset += portion
          return <circle key={c.id} cx="90" cy="90" r="68" pathLength="100" fill="none" stroke={c.color} strokeWidth="13" strokeDasharray={`${Math.max(0, portion - 1.4)} ${100 - Math.max(0, portion - 1.4)}`} strokeDashoffset={-start} transform="rotate(-90 90 90)"><title>{c.label}: {c.count}</title></circle>
        })}
        <text x="90" y="88" textAnchor="middle" className="donut-number">{failures.length.toString().padStart(2, '0')}</text><text x="90" y="110" textAnchor="middle" className="donut-caption">MẪU THẤT BẠI</text>
      </svg><span className="chart-footnote"><CircleHelp size={11} /> Nhãn lỗi ≠ bằng chứng nhân quả</span></div>
      <div className="cause-list">{counts.filter(c => c.id !== 'unknown' || c.count > 0).map(c => <button key={c.id} className={`cause-row ${active === c.id ? 'selected' : ''}`} onClick={() => onSelect(c.id)} title={`${c.description}. Bấm để lọc phiên chạy.`}>
        <span className="cause-name"><i style={{ background: c.color }} />{c.label}</span><span className="cause-count mono">{c.count}</span><span className="cause-percent mono">{percent(failures.length ? c.count / failures.length : null)}</span>
        <span className="cause-track"><span style={{ width: `${failures.length ? c.count / failures.length * 100 : 0}%`, background: c.color }} /></span>
      </button>)}</div>
    </div>
    <div className="panel-footer"><span className="status-dot" /><span>Bấm vào nhóm lỗi để xem các ca tương ứng</span><ArrowUpRight size={13} /></div>
  </section>
}

export function PipelinePanel({ rows }: { rows: Evaluation[] }) {
  const summary = summarize(rows)
  const stages = [{ key: 'speech', label: 'Speech recognition', icon: '01', color: '#71a7f5' }, { key: 'planning', label: 'Agent planning', icon: '02', color: '#62d9ad' }, { key: 'tools', label: 'Tool execution', icon: '03', color: '#b6a0e5' }]
  const values = stages.map(stage => {
    const data = rows.flatMap(r => typeof r.timings[stage.key] === 'number' ? [r.timings[stage.key]] : []).sort((a, b) => a - b)
    return { ...stage, value: median(data), n: data.length }
  })
  const total = values.reduce((s, v) => s + (v.value ?? 0), 0)
  return <section className="panel pipeline-panel"><div className="panel-heading"><div><h2><Workflow size={15} /> Pipeline latency</h2><p>Trung vị từng giai đoạn được ghi log</p></div><Timer size={15} className="muted" /></div>
    <div className="pipeline-content">{values.map(s => <div className="pipeline-stage" key={s.key}>
      <div className="stage-top"><span className="stage-index mono">{s.icon}</span><span>{s.label}</span><strong className="mono">{duration(s.value)}</strong></div>
      <div className="stage-track"><span style={{ background: s.color, width: `${total ? (s.value ?? 0) / total * 100 : 0}%` }} /></div>
    </div>)}</div>
    <div className="latency-footer"><span><small>END-TO-END · P50</small><strong className="mono">{duration(summary.medianLatency)}</strong></span><span><small>P95</small><strong className="mono">{duration(summary.p95Latency)}</strong></span></div>
  </section>
}

export function StratifiedAnalysis({ rows }: { rows: Evaluation[] }) {
  const groups = [...new Set(rows.flatMap(r => r.domains))]
  const accents = ['Bắc', 'Trung', 'Nam', 'Unknown']
  return <section className="panel analysis-panel"><div className="panel-heading"><div><h2><GitBranch size={15} /> Phân tầng theo domain & giọng nói</h2><p>Task success / số mẫu có nhãn · giọng synthetic được đánh dấu riêng trong bảng</p></div></div>
    <div className="table-scroll"><table className="strata-table"><thead><tr><th>DOMAIN</th>{accents.map(a => <th key={a}>{a === 'Unknown' ? 'CHƯA CÓ NHÃN' : a.toUpperCase()}</th>)}<th>TỔNG</th></tr></thead><tbody>{groups.map(group => <tr key={group}><td>{domainLabels[group] ?? group}</td>{[...accents, 'all'].map(accent => {
      const data = rows.filter(r => r.domains.includes(group) && (accent === 'all' || r.accent === accent) && r.taskSuccess !== null)
      const pass = data.filter(r => r.taskSuccess).length
      return <td key={accent}><span className={data.length ? pass / data.length >= .75 ? 'cell-pass' : 'cell-fail' : 'muted'}>{data.length ? `${pass}/${data.length}` : '—'}</span>{data.length > 0 && <small className="muted"> {percent(pass / data.length)}</small>}</td>
    })}</tr>)}</tbody></table></div><div className="panel-footer">Một mẫu có thể thuộc nhiều domain. Không có nhãn accent sẽ không được tự suy đoán.</div>
  </section>
}
