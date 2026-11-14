import type { Job } from './useJobs'
import type { LiveMeta } from './liveTypes'

export const modeLabel = (mode: string) => mode === 'gold-text' ? 'Transcript vàng' : mode === 'full-asr' ? 'Audio → ASR' : mode
export function jobProgress(job: Job) {
  const paired = job.config.mode === 'paired'
  const total = job.total
  const samples = total !== null && Number.isInteger(total / (paired ? 2 : 1)) ? total / (paired ? 2 : 1) : null
  return {
    count: `${job.processed}/${total ?? '—'} ${paired ? 'lượt đánh giá' : 'mẫu'}`,
    detail: paired ? `${samples ?? '—'} mẫu × 2 nhánh (transcript vàng + audio)` : modeLabel(job.config.mode),
    percent: total && total > 0 ? Math.max(0, Math.min(100, job.processed / total * 100)) : 0,
  }
}
/** Associate a phase only with its parent job, never another currently selected run. */
export function parentJob(run: LiveMeta | null, jobs: Job[]) {
  if (!run) return undefined
  const parts = run.path.replaceAll('\\', '/').split('/')
  if (parts[0] !== 'results' || !['train-test', 'public-test'].includes(parts[1])) return undefined
  return jobs.find(j => j.id === parts[2])
}
