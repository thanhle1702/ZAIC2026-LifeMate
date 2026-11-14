import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDown, ArrowDownToLine, ArrowRight, ArrowUp, ArrowUpRight, AudioLines, Braces, ChartNoAxesCombined, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Database, FileJson, Filter, Fingerprint, FlaskConical, FolderInput, GitBranch, Layers, ListFilter, ListTree, Search, ShieldCheck, Terminal, Upload, X } from 'lucide-react'
import type { Dataset, ErrorCategory, Evaluation } from './types'
import { categories, domainLabels } from './types'
import { duration, percent, summarize } from './lib/metrics'
import { csvCell, download } from './lib/download'
import { Badge, Empty } from './components/Primitives'
import AudioPlayer from './components/AudioPlayer'
import { FailureChart, PipelinePanel, StratifiedAnalysis } from './components/Charts'
import Inspector from './components/Inspector'
import LivePanel from './components/LivePanel'
import { useLiveRun } from './lib/useLiveRun'
import { useJobs, jobDataset, type Job } from './lib/useJobs'
import JobControls from './components/JobControls'
import Diagnostics from './components/Diagnostics'
import { parentJob } from './lib/progress'
import RunHistoryChart from './components/RunHistoryChart'
import { executionFailed, observedFailure, executionHealth } from './lib/execution'

const emptyDataset: Dataset = { name: 'Chưa có run', source: 'empty', model: '—', split: '—', samples: [], files: [] }
const navItems = [
  { id: 'overview', label: 'Tổng quan', subtitle: 'Overview', icon: ChartNoAxesCombined },
  { id: 'sessions', label: 'Phiên chạy', subtitle: 'Run explorer', icon: ListTree },
  { id: 'analysis', label: 'Phân tích lỗi', subtitle: 'Error analysis', icon: GitBranch },
  { id: 'data', label: 'Thông tin run', subtitle: 'Data sources', icon: Database },
]
type Filters = { search: string; accent: string; domain: string; error: string; status: string }
const cleanFilters: Filters = { search: '', accent: 'all', domain: 'all', error: 'all', status: 'all' }

function MetricCards({ rows }: { rows: Evaluation[] }) {
  const s = summarize(rows)
  const cards = [
    { icon: Layers, label: 'Mẫu đánh giá', value: String(s.total), note: <><span className="mint">{s.passed} pass</span><span className="metric-note-dot">/</span><span className="text-danger">{s.failed} fail</span>{s.unscored > 0 && <span className="muted"> / {s.unscored} chưa chấm</span>}</>, tooltip: 'Số mẫu trong bộ lọc hiện tại. Pass/fail được lấy từ task_success của evaluator.', graphic: 'sample' },
    { icon: Terminal, label: 'Tool sequence EM', value: percent(s.sequence.value), note: `Đúng thứ tự & arguments · n=${s.sequence.n}`, tooltip: 'Exact match toàn bộ chuỗi tên tool và arguments; không phải điểm leaderboard.', graphic: 'sequence' },
    { icon: Fingerprint, label: 'State hash match', value: percent(s.hash.value), note: `Hash khớp ground truth · n=${s.hash.n}`, tooltip: 'Đối chiếu state_hash của môi trường. Không tạo hash từ JSON tool calls.', graphic: 'hash' },
    { icon: AudioLines, label: 'ASR word error rate', value: percent(s.wer), note: `WER chuẩn hóa local · n=${s.werSamples}`, tooltip: 'Micro WER = tổng edit distance / tổng số từ tham chiếu. NFC, lowercase, bỏ punctuation. Không coi đây là metric chính thức.', graphic: 'asr' },
    { icon: ShieldCheck, label: 'Out-of-scope · P / R', value: `${percent(s.oosPrecision)} / ${percent(s.oosRecall)}`, note: `Cần nhãn OOS tường minh · n=${s.oosN}`, tooltip: 'Precision/Recall chỉ trên mẫu có cả nhãn OOS và quyết định OOS. Output [] không tự động được coi là OOS.', graphic: 'oos' },
  ]
  return <div className="metric-grid">{cards.map((c, i) => <section className={`metric-card metric-${c.graphic}`} key={c.label}><div className="metric-label"><c.icon size={15} /><span>{c.label}</span><CircleHelp size={12} className="metric-help" aria-label={c.tooltip}><title>{c.tooltip}</title></CircleHelp></div><div className={`metric-value mono ${i === 4 ? 'metric-value-pair' : ''}`}>{c.value}</div><div className="metric-note">{c.note}</div><div className="metric-baseline" aria-hidden="true">{i === 0 ? <><span style={{ width: `${s.total ? s.passed / s.total * 100 : 0}%`, background: '#62d9ad' }} /><span style={{ width: `${s.total ? s.failed / s.total * 100 : 0}%`, background: '#c27680' }} /></> : <span style={{ width: `${[0, s.sequence.value, s.hash.value, s.wer, s.oosRecall][i] === null ? 0 : Math.min(1, [0, s.sequence.value, s.hash.value, s.wer, s.oosRecall][i] ?? 0) * 100}%`, background: i === 3 ? '#71a7f5' : '#62d9ad' }} />}</div></section>)}</div>
}

function ToolSummary({ row }: { row: Evaluation }) {
  const gold = row.expectedCalls
  return <div className="tool-summary"><div><span className="tool-summary-label">PRED</span>{row.predictedCalls.length ? row.predictedCalls.slice(0, 2).map((c, i) => <code key={i} title={row.predictedCalls.map(t => t.name).join(' → ')} className={gold && gold[i]?.name !== c.name ? 'tool-wrong' : ''}>{c.name.split('.').at(-1)}{i < Math.min(1, row.predictedCalls.length - 1) && <span className="tool-arrow">→</span>}</code>) : <code className="muted">[]</code>}{row.predictedCalls.length > 2 && <small>+{row.predictedCalls.length - 2}</small>}</div><div><span className="tool-summary-label gold">GT</span><code className="muted">{gold === null ? 'không có nhãn' : gold.length ? gold.map(c => c.name.split('.').at(-1)).join(' → ') : '[]'}</code></div></div>
}

export default function App() {
  const [liveEnabled, setLiveEnabled] = useState(true), [useLive, setUseLive] = useState(true)
  const live = useLiveRun(liveEnabled)
  const jobState = useJobs()
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null)
  const [view, setView] = useState('overview'), [filters, setFilters] = useState<Filters>(cleanFilters), [selectedId, setSelectedId] = useState<string | null>(null)
  const [showExport, setShowExport] = useState(false), [page, setPage] = useState(0), [pageSize, setPageSize] = useState(6), [sort, setSort] = useState<'none' | 'asc' | 'desc'>('none')
  const [audioOverrides, setAudioOverrides] = useState<Record<string, string>>({}), [toast, setToast] = useState('')
  const allObjectUrls = useRef(new Set<string>()), searchRef = useRef<HTMLInputElement>(null), tableRef = useRef<HTMLElement>(null)
  const showingLive = useLive && live.dataset !== null
  const dataset = showingLive ? live.dataset! : selectedDataset ?? emptyDataset, allRows = dataset.samples
  const health = executionHealth(allRows)
  const datasetKey = showingLive ? `live:${live.run?.run_id}` : selectedDataset?.run?.id ?? 'empty'
  const rows = useMemo(() => {
    const q = filters.search.toLocaleLowerCase('vi').trim()
    const result = allRows.filter(r => (!q || [r.id, r.intent, r.asrText, r.status, r.stopReason, ...r.predictedCalls.map(c => c.name)].join(' ').toLocaleLowerCase('vi').includes(q)) &&
      (filters.accent === 'all' || filters.accent === 'Synthetic' && r.synthetic || filters.accent === r.accent) &&
      (filters.domain === 'all' || r.domains.includes(filters.domain)) &&
      (filters.error === 'all' || observedFailure(r) && (r.diagnosis?.category ?? 'unknown') === filters.error) &&
      (filters.status === 'all' || filters.status === 'pass' && r.taskSuccess === true || filters.status === 'fail' && observedFailure(r) || filters.status === 'runtime' && executionFailed(r) || filters.status === 'unscored' && r.taskSuccess === null && !executionFailed(r)))
    if (sort !== 'none') result.sort((a, b) => a.latencyMs === null ? 1 : b.latencyMs === null ? -1 : (a.latencyMs - b.latencyMs) * (sort === 'asc' ? 1 : -1))
    return result
  }, [allRows, filters, sort])
  const selectedIndex = rows.findIndex(r => r.id === selectedId), selected = rows[selectedIndex]
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize)), pageRows = rows.slice(page * pageSize, (page + 1) * pageSize)
  const filterCount = Object.entries(filters).filter(([k, v]) => k === 'search' ? v !== '' : v !== 'all').length
  useEffect(() => { setPage(0) }, [filters, pageSize, selectedDataset])
  useEffect(() => { if (useLive) { setFilters(cleanFilters); setSelectedId(null); setPage(0) } }, [live.run?.run_id, useLive])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])
  useEffect(() => () => { allObjectUrls.current.forEach(url => URL.revokeObjectURL(url)) }, [])
  useEffect(() => {
    const listener = (e: KeyboardEvent) => { if (e.key === '/' && !selectedId && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) { e.preventDefault(); if (view === 'data' || view === 'analysis') setView('sessions'); setTimeout(() => { tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); searchRef.current?.focus() }, 40) } }
    document.addEventListener('keydown', listener); return () => document.removeEventListener('keydown', listener)
  }, [view, selectedId])
  function changeFilter(key: keyof Filters, value: string) { setFilters(f => ({ ...f, [key]: value })) }
  function selectError(category: ErrorCategory) { changeFilter('error', filters.error === category ? 'all' : category); if (view === 'analysis') setView('sessions'); setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30) }
  function attach(file: File, id: string) {
    if (file.size > 50 * 1024 * 1024) { setToast('Audio tối đa 50 MiB mỗi file.'); return }
    const url = URL.createObjectURL(file); allObjectUrls.current.add(url)
    setAudioOverrides(old => { const key = `${datasetKey}:${id}`; if (old[key]) { URL.revokeObjectURL(old[key]); allObjectUrls.current.delete(old[key]) } return { ...old, [key]: url } })
  }
  async function openJob(job: Job, mode?: string) {
    try {
      const data = await jobDataset(job.id, mode)
      setSelectedDataset(data); setUseLive(false); setLiveEnabled(false); setFilters(cleanFilters); setSelectedId(null); setView('overview')
    } catch (e) { setToast(e instanceof Error ? e.message : 'Chưa có artifact cho nhánh này.') }
  }
  function exportData(format: 'json' | 'csv') {
    if (format === 'json') download('lifemate-evaluation.json', JSON.stringify({ metadata: { name: dataset.name, source: dataset.source, model: dataset.model, split: dataset.split, run_id: dataset.run?.id, started_at: dataset.run?.startedAt, mode: dataset.run?.mode }, samples: rows }, (key, value) => key === 'audioUrl' && typeof value === 'string' && value.startsWith('blob:') ? undefined : value, 2))
    else {
      const values = [['sample_id', 'task_success', 'sequence_exact_match', 'state_hash_match', 'latency_ms', 'accent', 'synthetic', 'error_category', 'intent', 'execution_status', 'stop_reason'], ...rows.map(r => [r.id, r.taskSuccess, r.sequenceMatch, r.hashMatch, r.latencyMs, r.accent, r.synthetic, r.diagnosis?.category, r.intent, r.status, r.stopReason])]
      download('lifemate-evaluation.csv', '\uFEFF' + values.map(r => r.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8')
    }
    setShowExport(false); setToast(`Đã xuất ${rows.length} mẫu theo bộ lọc hiện tại.`)
  }
  const currentNav = navItems.find(n => n.id === view)!
  return <div className="app-shell">
    <aside className="sidebar"><a href="#" className="brand" onClick={e => { e.preventDefault(); setView('overview') }} aria-label="LifeMate trang tổng quan"><span className="brand-mark"><i /><i /><i /></span><span className="brand-word">lifemate<span>evaluation lab</span></span><span className="brand-version mono">v1</span></a>
      <div className="workspace-label eyebrow">WORKSPACE <ChevronDown size={12} /></div><div className="workspace-name"><span className="workspace-avatar"><FlaskConical size={17} /></span><span>ZAIC 2026<small>LifeMate Challenge</small></span></div>
      <div className="nav-label eyebrow">OBSERVABILITY</div><nav aria-label="Điều hướng chính">{navItems.map(n => <button key={n.id} className={`nav-item ${view === n.id ? 'active' : ''}`} onClick={() => setView(n.id)} title={n.label}><n.icon size={17} /><span>{n.label}</span>{n.id === 'sessions' && <small className="mono">{allRows.length}</small>}{view === n.id && <i />}</button>)}</nav>

      <div className="sidebar-bottom"><div className="local-status"><span className="status-dot" /><span>Browser-local workspace</span></div><p>Không chạy model trên máy bạn.</p><div className="sidebar-user"><span className="user-avatar">LM</span><span>LifeMate team<small>Evaluation workspace</small></span><ChevronDown size={13} /></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><span className="breadcrumb-icon"><Layers size={14} /></span><span>Workspace</span><span className="slash">/</span><strong>{currentNav.subtitle}</strong></div><div className="topbar-right"><span className="privacy-label"><span className="status-dot" />Local files only</span><span className="topbar-separator" /><span className="tag neutral mono">ZAIC / 2026</span><span className="team-avatar">LM</span></div></header>
    <main><div className="page-heading"><div><div className="eyebrow page-eyebrow"><Activity size={12} /> AGENT OBSERVABILITY</div><h1>{view === 'overview' ? 'Tổng quan đánh giá' : currentNav.label}<span className="heading-dot">.</span></h1><p>Theo dõi lời nói, tool calls và trạng thái cuối trong cùng một workspace.</p></div><div className="heading-actions"><div className="export-wrap"><button className="button secondary" onClick={() => setShowExport(!showExport)} aria-expanded={showExport} disabled={!rows.length}><ArrowDownToLine size={15} /><span>Xuất dữ liệu</span><ChevronDown size={12} /></button>{showExport && <><button className="popover-dismiss" aria-label="Đóng menu xuất" onClick={() => setShowExport(false)} /><div className="export-menu"><button onClick={() => exportData('json')}><Braces size={14} /> JSON · có trace</button><button onClick={() => exportData('csv')}><ListFilter size={14} /> CSV · bảng thống kê</button></div></>}</div></div></div>
      <JobControls jobs={jobState.jobs} warning={jobState.warning} onOpen={(job, mode) => void openJob(job, mode)} onStarted={() => { setUseLive(true); setLiveEnabled(true); setSelectedDataset(null) }} onDeleted={() => { setSelectedDataset(null); setSelectedId(null); setFilters(cleanFilters); setUseLive(true); setLiveEnabled(true); setView('overview') }} />
      <LivePanel enabled={liveEnabled} showing={showingLive} run={live.run} job={parentJob(live.run, jobState.jobs)} connection={live.connection} warning={live.warning}
        onToggle={() => { if (liveEnabled) setLiveEnabled(false); else { setUseLive(true); setLiveEnabled(true) } }}
        onCurrent={() => { if (live.run?.current_sample) { setUseLive(true); setFilters(cleanFilters); setView('sessions'); setSelectedId(live.run.current_sample) } }} />
      <div className="source-banner imported"><span className="banner-icon"><Database size={15} /></span><p><strong>{dataset.source === 'empty' ? 'Chưa có dữ liệu chạy.' : showingLive ? 'Đang theo dõi run mới nhất.' : 'Kết quả đã lưu trong results/.'}</strong> Chọn chạy test hoặc mở kết quả từ danh sách phía trên. Thiếu ground truth sẽ không tự được chấm điểm.</p><button onClick={() => { setUseLive(true); setLiveEnabled(true); setSelectedDataset(null) }}>Theo dõi mới nhất<ArrowRight size={12} /></button></div>
      <div className="run-strip"><div className="run-identity"><GitBranch size={18} /><strong>{dataset.name}</strong></div><div className="run-meta"><span className="eyebrow">MODEL</span><code>{dataset.model}</code></div><div className="run-meta"><span className="eyebrow">SPLIT / MODE</span><code>{dataset.split} / {dataset.run?.mode ?? '—'}</code></div><div className="run-meta"><span className="eyebrow">SAMPLES</span><code>{allRows.length}</code></div></div>
      {health.failed > 0 && <section className="execution-alert" role="alert" aria-label="Cảnh báo lỗi thực thi"><strong>{health.failed} mẫu lỗi / chưa hoàn tất · {health.completed} mẫu xử lý xong</strong><p>{Object.entries(health.reasons).map(([reason,n]) => `${reason}: ${n}`).join(' · ')}. Đã xử lý hết mẫu không có nghĩa là tất cả đều hoàn tất thành công.</p><button className="button danger" onClick={() => { setFilters({...cleanFilters,status:'runtime'}); setView('sessions'); setTimeout(() => tableRef.current?.scrollIntoView({block:'start'}),30) }}>Xem {health.failed} mẫu lỗi</button></section>}
      {view !== 'data' && <><div className="scope-label"><span className="eyebrow">METRICS OVERVIEW</span><span className="tiny muted">{rows.length}/{allRows.length} mẫu theo bộ lọc · diagnostic metrics</span></div><MetricCards rows={rows} /></>}
      {(view === 'overview' || view === 'analysis') && <div className="charts-grid"><FailureChart rows={rows} active={filters.error} onSelect={selectError} /><PipelinePanel rows={rows} /></div>}
      {(view === 'overview' || view === 'analysis') && <RunHistoryChart history={jobState.history} warning={jobState.warning} />}
      {(view === 'overview' || view === 'analysis') && <Diagnostics rows={rows} jobs={jobState.jobs} />}
      {view === 'analysis' && <StratifiedAnalysis rows={rows} />}
      {(view === 'overview' || view === 'sessions') && <section className="panel sessions-panel" ref={tableRef}><div className="panel-heading session-heading"><div className="flex items-center gap-3"><h2>Phiên chạy</h2><span className="count-badge mono">{rows.length}</span></div><button className={`text-button only-errors ${filters.status === 'fail' ? 'mint' : ''}`} onClick={() => changeFilter('status', filters.status === 'fail' ? 'all' : 'fail')}><Filter size={13} />{filters.status === 'fail' ? 'Hiện tất cả trạng thái' : 'Chỉ ca thất bại'}<ArrowUpRight size={12} /></button></div>
        <div className="filters"><label className="search-box"><Search size={15} /><input ref={searchRef} aria-label="Tìm sample, intent hoặc tool" placeholder="Tìm sample, intent hoặc tool…" value={filters.search} onChange={e => changeFilter('search', e.target.value)} /><kbd>/</kbd></label><label className="filter-select"><AudioLines size={13} /><select aria-label="Lọc miền giọng nói" value={filters.accent} onChange={e => changeFilter('accent', e.target.value)}><option value="all">Giọng nói</option>{['Bắc', 'Trung', 'Nam', 'Synthetic', 'Unknown'].map(a => <option key={a} value={a}>{a === 'Unknown' ? 'Chưa có nhãn' : a}</option>)}</select><ChevronDown size={12} /></label><label className="filter-select"><Layers size={13} /><select aria-label="Lọc domain" value={filters.domain} onChange={e => changeFilter('domain', e.target.value)}><option value="all">Domain</option>{[...new Set(allRows.flatMap(r => r.domains))].map(d => <option key={d} value={d}>{domainLabels[d] ?? d}</option>)}</select><ChevronDown size={12} /></label><label className="filter-select"><ListFilter size={13} /><select aria-label="Lọc loại lỗi" value={filters.error} onChange={e => changeFilter('error', e.target.value)}><option value="all">Loại lỗi</option>{categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select><ChevronDown size={12} /></label><label className="filter-select status-select"><select aria-label="Lọc trạng thái" value={filters.status} onChange={e => changeFilter('status', e.target.value)}><option value="all">Trạng thái</option><option value="pass">Pass</option><option value="fail">Thất bại / sai kết quả</option><option value="runtime">Lỗi thực thi / chưa hoàn tất</option><option value="unscored">Chưa chấm</option></select><ChevronDown size={12} /></label>{filterCount > 0 && <button className="icon-button reset-filters" title="Xóa bộ lọc" aria-label="Xóa bộ lọc" onClick={() => setFilters(cleanFilters)}><X size={15} /></button>}</div>
        {filterCount > 0 && <div className="active-filters"><span>{filterCount} bộ lọc đang áp dụng</span>{Object.entries(filters).filter(([k, v]) => k === 'search' ? v : v !== 'all').map(([key, val]) => <button className="tag neutral" key={key} onClick={() => changeFilter(key as keyof Filters, key === 'search' ? '' : 'all')}>{key === 'error' ? categories.find(c => c.id === val)?.label : key === 'domain' ? domainLabels[val] ?? val : val}<X size={11} /></button>)}</div>}
        <div className="table-scroll"><table className="sessions-table"><thead><tr><th>SAMPLE ID</th><th>AUDIO</th><th>USER INTENT</th><th>PREDICTED / GROUND TRUTH</th><th>STATUS</th><th><button className="sort-button" onClick={() => setSort(sort === 'desc' ? 'asc' : 'desc')}>LATENCY{sort === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />}</button></th><th aria-label="Mở chi tiết" /></tr></thead><tbody>{pageRows.map(row => <tr key={row.id} onClick={() => setSelectedId(row.id)}><td><button className="sample-link mono" onClick={e => { e.stopPropagation(); setSelectedId(row.id) }}>{row.id}</button><span className="accent-label">{row.accent}{row.synthetic && <span className="synthetic-dot" title="Synthetic" />}</span></td><td><AudioPlayer src={audioOverrides[`${datasetKey}:${row.id}`] ?? row.audioUrl} compact /></td><td><p className="intent-text" title={row.intent}>{row.intent}</p><span className="domain-text">{row.domains.map(d => domainLabels[d] ?? d).join(' / ') || 'Chưa có domain'}</span></td><td><ToolSummary row={row} /></td><td><span className={`sample-health ${executionFailed(row) ? "sample-health-error" : ""}`}>{executionFailed(row) ? <span className="badge fail">LỖI THỰC THI</span> : <Badge value={row.taskSuccess} compact />}<span className="sample-run-status mono">{row.status !== "unknown" ? row.status : ""}</span>{row.stopReason && <strong className="sample-stop-reason mono">{row.stopReason}</strong>}</span></td><td><span className={`mono latency-value ${(row.latencyMs ?? 0) > 4000 ? 'latency-slow' : ''}`}>{duration(row.latencyMs)}</span></td><td><ChevronRight size={15} className="row-arrow" /></td></tr>)}</tbody></table></div>
        {!rows.length && (!allRows.length ? <Empty title={dataset.source === "empty" ? "Chưa có dữ liệu train/test" : "Run chưa có mẫu"}>Bảng và thống kê sẽ cập nhật khi có log từ run. Bấm Chạy public test hoặc Chạy train test ở phía trên.</Empty> : <Empty title="Không tìm thấy mẫu phù hợp"><span>Thử tìm từ khóa khác hoặc </span><button className="text-button mint inline-flex" onClick={() => setFilters(cleanFilters)}>xóa bộ lọc</button>.</Empty>)}
        <div className="table-footer"><span className="tiny muted">Hiển thị <strong>{rows.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, rows.length)}</strong> trên <strong>{rows.length}</strong> mẫu</span><div className="pagination"><label className="rows-per-page tiny muted">Mỗi trang <select aria-label="Số dòng mỗi trang" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>{[6, 12, 24].map(n => <option key={n}>{n}</option>)}</select></label><button className="icon-button" aria-label="Trang trước" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={15} /></button><span className="page-number mono">{Math.min(page + 1, totalPages)} / {totalPages}</span><button className="icon-button" aria-label="Trang sau" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight size={15} /></button></div></div>
      </section>}
      {view === 'data' && <Diagnostics rows={allRows} jobs={jobState.jobs} />}
      <footer className="page-footer"><span><span className="brand-mini">▥</span> LifeMate Evaluation Lab <span className="footer-separator">/</span> ZAIC 2026</span><span><span className="status-dot" />{dataset.source === 'empty' ? 'Chờ dữ liệu train/test' : showingLive ? 'Live artifacts · chỉ đọc' : 'Imported artifacts · chỉ đọc'}<span className="keyboard-tip">Nhấn <kbd>/</kbd> để tìm kiếm</span></span></footer>
    </main></div>

    {selected && <Inspector key={`${datasetKey}:${selected.id}`} sample={selected} index={selectedIndex} total={rows.length} audioUrl={audioOverrides[`${datasetKey}:${selected.id}`]} onClose={() => setSelectedId(null)} onMove={delta => setSelectedId(rows[selectedIndex + delta]?.id ?? selectedId)} onAttach={file => attach(file, selected.id)} />}
    {toast && <div className="toast" role="status"><Check size={15} />{toast}<button className="icon-button" aria-label="Đóng thông báo" onClick={() => setToast('')}><X size={13} /></button></div>}
  </div>
}
