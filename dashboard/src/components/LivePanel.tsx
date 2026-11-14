import { Activity, Pause, Play, Radio, RefreshCw } from 'lucide-react'
import type { LiveMeta } from '../lib/liveTypes'
import { duration, percent } from '../lib/metrics'
import type { Job } from '../lib/useJobs'
import { jobProgress, modeLabel } from '../lib/progress'

const phases: Record<string, string> = { initializing: 'Đang chuẩn bị / nạp model', waiting: 'Chờ sample',
  sample: 'Đang xử lý sample', asr: 'Nhận dạng giọng nói', planning: 'LLM đang lập kế hoạch', tools: 'Đang thực thi tool',
  scoring: 'Đang chấm với ground truth', between_samples: 'Đã xử lý sample' }
const states: Record<string, string> = { initializing: 'KHỞI TẠO', running: 'ĐANG CHẠY', completed: 'HOÀN TẤT', failed: 'CÓ LỖI THỰC THI', interrupted: 'ĐÃ DỪNG', paused: 'ĐÃ TẠM DỪNG' }
export default function LivePanel({ enabled, showing, run, job, connection, warning, onToggle, onCurrent }: {
  enabled: boolean; showing: boolean; run: LiveMeta | null; connection: string; warning: string;
  job?: Job; onToggle: () => void; onCurrent: () => void;
}) {
  const progress = run && run.total ? Math.min(100, run.processed / run.total * 100) : 0
  return <section className={`panel live-panel ${enabled ? 'following' : ''}`} aria-label="Theo dõi realtime">
    <div className="live-heading"><div><Radio size={17} /><strong>Theo dõi realtime</strong>
      <span className={`tag ${warning || run?.state === 'failed' || (job?.health?.failed ?? 0)>0 ? 'warning' : enabled ? 'success' : 'neutral'}`}>{!enabled ? 'TẠM DỪNG THEO DÕI' : connection === 'error' ? 'MẤT KẾT NỐI' : run ? states[run.state] ?? run.state : 'CHỜ RUN MỚI'}</span></div>
      <button className="button secondary" onClick={onToggle}>{enabled ? <Pause size={13} /> : <Play size={13} />}{enabled ? 'Tắt tự cập nhật' : 'Theo dõi run mới nhất'}</button></div>
    {run ? <>
      {job && <div className="live-overall"><strong>Toàn phiên: {jobProgress(job).count}</strong><span className="tiny muted">{jobProgress(job).detail}</span><div className="live-progress" role="progressbar" aria-label="Tiến độ toàn phiên" aria-valuenow={job.processed} aria-valuemin={0} aria-valuemax={job.total ?? undefined}><i style={{ width: `${jobProgress(job).percent}%` }} /></div></div>}
      <div className="live-detail"><code title={run.path}>{run.name}</code><span className="live-branch">Nhánh hiện tại: <strong>{modeLabel(run.mode)}</strong>{job?.config.mode === 'paired' && ` (${run.mode === 'gold-text' ? '1' : '2'}/2)`} · <strong>{run.processed}/{run.total}</strong> mẫu đã xử lý · {run.scored} đã chấm trong nhánh</span><span className="mono">{duration(run.elapsed_seconds * 1000)} · {run.elapsed_seconds > 0 ? (run.processed / run.elapsed_seconds * 60).toFixed(1) : '—'} mẫu/phút của nhánh</span></div>
      {job?.health && <p className={job.health.failed ? 'execution-inline-error' : 'tiny'}>{job.health.completed} lượt xử lý xong · {job.health.failed} lượt lỗi / chưa hoàn tất{job.health.failed > 0 && ` · ${Object.entries(job.health.reasons).map(([r,n]) => `${r}: ${n}`).join(' · ')}`}</p>}
      <div className="live-progress branch-progress" role="progressbar" aria-label="Tiến độ nhánh hiện tại" aria-valuenow={run.processed} aria-valuemin={0} aria-valuemax={run.total}><i style={{ width: `${progress}%` }} /></div>
      {run.local_score !== null && run.local_score !== undefined && <div className="live-score"><strong>Ước lượng local: {run.local_score.toFixed(2)}/100</strong><span>Tool F1: {percent(run.mean_f1 ?? null)}</span><span>Tạm tính trên {run.score_samples} mẫu đã chấm · không phải điểm ZAIC</span></div>}
      <div className="live-bottom"><span><Activity size={13} />{['completed', 'failed', 'interrupted', 'paused'].includes(run.state) ? states[run.state] : phases[run.phase] ?? run.phase}{run.current_sample && <> · <button className="text-button mint" onClick={onCurrent}>{run.current_sample}</button></>}{run.step !== null && run.current_sample && ` · step ${run.step + 1}`}{run.catching_up && ' · đang đọc các log còn lại'}</span><span>{!enabled ? 'Giữ dữ liệu khi tắt tự cập nhật' : connection === 'error' ? 'Đang giữ dữ liệu đã nhận' : run.state === 'paused' ? 'Chọn Tiếp tục hoặc Xóa phiên ở phía trên' : showing ? 'Dữ liệu thật · cập nhật ~1 giây' : 'Chọn realtime để xem dữ liệu thật'}</span></div></>
      : <p className="live-wait"><RefreshCw size={13} />{enabled ? 'Bấm Chạy public test hoặc Chạy train test. Tiến độ và trace sẽ tự xuất hiện.' : 'Bật theo dõi để tự nhận run local mới nhất.'}</p>}
    {(warning || run?.message) && <p className="live-warning" role="status">{warning || run?.message}</p>}
    <p className="live-hint">Tắt tự cập nhật chỉ dừng đọc log. Để dừng xử lý mẫu, dùng nút Dừng phiên ở thanh điều khiển phía trên.</p>
  </section>
}
