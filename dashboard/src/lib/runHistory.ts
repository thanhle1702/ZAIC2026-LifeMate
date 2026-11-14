import type { Dataset } from '../types'
import type { LiveMeta } from './liveTypes'
import { stable, summarize } from './metrics'

export const HISTORY_KEY = 'lifemate.run-history.v1'
export const historyMetrics = {
  task: 'Task success (%)', sequence: 'Tool sequence EM (%)', hash: 'State hash match (%)', local: 'Điểm proxy local (/100)',
  completion: 'Hoàn tất xử lý (%)', zaic: 'Điểm ZAIC do người dùng ghi (/100)', f1: 'Điểm local · strict tool F1 (/100)',
} as const
export type HistoryMetric = keyof typeof historyMetrics
export type HistoryPoint = { value: number; n: number; cohort: string }
export type RunSummary = {
  id: string; name: string; model: string; split: string; mode: string;
  at: string; timeSource: 'run' | 'import'; total: number; metrics: Partial<Record<HistoryMetric, HistoryPoint>>;
  kind?: 'train-test' | 'public-test'; jobId?: string; state?: string
}
async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value)))
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('')
}
/** Always summarize the entire run, never the table's filtered rows. No leaderboard formula. */
export async function summarizeRun(data: Dataset, live?: LiveMeta, now = new Date().toISOString()): Promise<RunSummary | null> {
  if (!data.samples.length || data.source === 'empty') return null
  if (live && (live.state !== 'completed' || live.catching_up || live.processed !== live.total || data.samples.length !== live.total)) return null
  const summary = summarize(data.samples)
  const mode = live?.mode ?? data.run?.mode ?? 'Chưa có mode'
  const split = live?.split ?? data.split
  const reference = data.samples.map(r => ({ id: r.id, calls: r.expectedCalls, hash: r.expectedHash })).sort((a, b) => a.id.localeCompare(b.id))
  const cohort = await digest({ split, mode, reference, evaluator: live?.evaluator_version ?? data.run?.evaluatorVersion ?? 'unverified' })
  const metrics: RunSummary['metrics'] = {}
  const total = Math.max(data.samples.length, data.run?.expectedTotal ?? data.samples.length)
  if (data.samples.every(r => r.status !== 'unknown')) metrics.completion = { value: data.samples.filter(r => r.status === 'completed').length / total * 100, n: data.samples.length, cohort }
  const f1 = data.samples.filter(r => typeof r.toolF1 === 'number')
  if (f1.length) metrics.f1 = { value: f1.reduce((s, r) => s + r.toolF1!, 0) / f1.length * 100, n: f1.length, cohort }
  for (const [key, get] of [
    ['task', (r: Dataset['samples'][number]) => r.taskSuccess],
    ['sequence', (r: Dataset['samples'][number]) => r.sequenceMatch],
    ['hash', (r: Dataset['samples'][number]) => r.hashMatch],
  ] as const) {
    const eligible = data.samples.filter(r => get(r) !== null)
    if (eligible.length) metrics[key] = { value: eligible.filter(r => get(r) === true).length / eligible.length * 100,
      n: eligible.length, cohort: await digest({ cohort, ids: eligible.map(r => r.id).sort() }) }
  }
  const scored = data.samples.filter(r => typeof r.localScore === 'number' && r.localScore >= 0 && r.localScore <= 1)
  if (scored.length) metrics.local = { value: scored.reduce((sum, r) => sum + r.localScore!, 0) / scored.length * 100, n: scored.length, cohort: await digest({ cohort, ids: scored.map(r => r.id).sort() }) }
  // Local score comes only from evaluator output, not from an invented weighted sum.
  if (live && typeof live.local_score === 'number' && Number.isFinite(live.local_score) && live.local_score >= 0 && live.local_score <= 100 &&
    Number.isSafeInteger(live.score_samples) && live.score_samples! > 0 && live.score_samples! <= summary.total) {
    const ids = data.samples.filter(r => r.taskSuccess !== null).map(r => r.id).sort()
    // Require known coverage so different subsets cannot silently share one comparison line.
    if (ids.length === live.score_samples) metrics.local = { value: live.local_score, n: live.score_samples!, cohort: await digest({ cohort, ids }) }
  }
  if (!Object.keys(metrics).length) return null
  const identity = live?.run_id ?? data.run?.id ?? await digest({ name: data.name, model: data.model, split, mode, samples: data.samples })
  const startedAt = live?.started_at ?? data.run?.startedAt
  const knownTime = startedAt && Number.isFinite(Date.parse(startedAt)) ? new Date(startedAt).toISOString() : null
  return { id: `${data.run?.id || live?.run_id ? 'run' : 'import'}:${identity}`, name: data.name, model: data.model, split, mode, kind: split === 'public_test' ? 'public-test' : 'train-test',
    at: knownTime ?? now, timeSource: knownTime ? 'run' : 'import', total, metrics }
}
export function upsertRun(history: RunSummary[], run: RunSummary) {
  const previous = history.find(r => r.id === run.id)
  const next = { ...run, at: previous?.at ?? run.at, timeSource: previous?.timeSource ?? run.timeSource }
  if (previous && stable(previous) === stable(next)) return history
  return [...history.filter(r => r.id !== run.id), next].sort((a, b) => a.at.localeCompare(b.at)).slice(-1000)
}
export function readHistory(raw: string | null): RunSummary[] {
  if (!raw) return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed) || parsed.length > 1000) throw new Error('Lịch sử điểm không hợp lệ.')
  for (const r of parsed) {
    if (!r || !['id', 'name', 'model', 'split', 'mode', 'at'].every(k => typeof r[k] === 'string' && r[k].length <= 2000) ||
      !Number.isFinite(Date.parse(r.at)) || !['run', 'import'].includes(r.timeSource) || !Number.isSafeInteger(r.total) || r.total < 1 ||
      !r.metrics || typeof r.metrics !== 'object' || Array.isArray(r.metrics) || !Object.keys(r.metrics).length ||
      Object.entries(r.metrics).some(([k, p]: [string, any]) => !Object.hasOwn(historyMetrics, k) || !p ||
        !Number.isFinite(p.value) || p.value < 0 || p.value > 100 || !Number.isSafeInteger(p.n) || p.n < 1 || p.n > r.total || typeof p.cohort !== 'string' || !/^[a-f0-9]{64}$/.test(p.cohort))) throw new Error('Lịch sử điểm không hợp lệ.')
  }
  return parsed as RunSummary[]
}
