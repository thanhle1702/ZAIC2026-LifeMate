import { expect, it } from 'vitest'
import { jobProgress, parentJob } from './progress'
import type { Job } from './useJobs'
import type { LiveMeta } from './liveTypes'

const job: Job = { id: 'a'.repeat(32), name: 'test-only', state: 'running', created_at: '2026-11-08T00:00:00Z', processed: 0, total: 40,
  config: { kind: 'train-test', mode: 'paired', limit: 20 } }
it('labels paired progress as evaluation passes rather than unique samples', () => {
  expect(jobProgress(job)).toEqual({ count: '0/40 lượt đánh giá', detail: '20 mẫu × 2 nhánh (transcript vàng + audio)', percent: 0 })
  expect(jobProgress({ ...job, processed: 20 }).percent).toBe(50)
  expect(jobProgress({ ...job, total: null }).detail).toContain('— mẫu')
})
it('keeps single-phase counts in samples and does not infer totals from configured limits', () => {
  const single = { ...job, total: 15, config: { ...job.config, mode: 'full-asr' } }
  expect(jobProgress(single).count).toBe('0/15 mẫu')
  expect(jobProgress(single).detail).toBe('Audio → ASR')
})
it('matches a live phase to its parent for both Windows and slash paths', () => {
  for (const separator of ['/', '\\']) {
    expect(parentJob({ path: ['results', 'train-test', job.id, 'gold-text'].join(separator) } as LiveMeta, [job])).toBe(job)
  }
  expect(parentJob({ path: `results/train-test/${'b'.repeat(32)}/gold-text` } as LiveMeta, [job])).toBeUndefined()
  expect(parentJob(null, [job])).toBeUndefined()
})
