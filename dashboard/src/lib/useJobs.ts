import { useEffect, useState } from 'react'
import type { Dataset } from '../types'
import type { RunSummary } from './runHistory'
import type { ExecutionHealth } from './execution'

export type Job = { id: string; name: string; state: string; created_at: string; started_at?: string; message?: string; identity?: unknown;
  config: { kind: 'train-test' | 'public-test'; mode: string; limit: number; subset?: 'validation' | 'regression' | 'all'; engine?: 'task-plan' | 'step-policy' | 'native' | 'datyth' }; processed: number; total: number | null;
  validation?: { ready_to_submit: boolean; valid: boolean; errors: string[]; sha256?: string; checked: number; expected: number; rows?: number; incomplete_samples: string[] };
  health?: ExecutionHealth;
  zaic?: { score: number }; paired?: { groups: Record<string, string[]>; note: string } }
export async function api<T = any>(path: string, value?: unknown): Promise<T> {
  const response = await fetch('/_lifemate/' + path, { cache: 'no-store', ...(value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
  return result
}
export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]), [history, setHistory] = useState<RunSummary[]>([]), [warning, setWarning] = useState('')
  useEffect(() => {
    let closed = false, timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const list = await api<Job[]>('jobs'), records = await api<RunSummary[]>('history')
        if (!closed) { setJobs(list); setHistory(records); setWarning('') }
      } catch (e) { if (!closed) setWarning(e instanceof Error ? e.message : 'Mất kết nối job service.') }
      finally { if (!closed) timer = setTimeout(() => void poll(), 1500) }
    }
    void poll(); return () => { closed = true; clearTimeout(timer) }
  }, [])
  return { jobs, history, warning }
}
export const jobDataset = (id: string, mode?: string) => api<Dataset>(`jobs/${id}/data?mode=${encodeURIComponent(mode ?? '')}`)
