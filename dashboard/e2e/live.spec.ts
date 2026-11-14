import { test, expect } from '@playwright/test'
import type { Evaluation } from '../src/types'

test('automatically follows progress, updates open inspector and scores, reconnects, and switches run without mixing ground truth', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  let phase = 0
  await page.route('**/_lifemate/jobs', route => route.fulfill({ json: [] }))
  await page.route('**/_lifemate/connection', route => route.fulfill({ json: { configured: false, url: '' } }))
  await page.route('**/_lifemate/history', route => route.fulfill({ json: phase >= 3 ? [{ id: 'test-only', name: 'fixture-live-run', model: 'fixture-only', split: 'train', mode: 'full-asr', kind: 'train-test', at: '2026-11-08T09:00:00Z', timeSource: 'run', total: 1, metrics: { task: { value: 100, n: 1, cohort: 'a'.repeat(64) }, local: { value: 100, n: 1, cohort: 'a'.repeat(64) } } }] : [] }))
  const row: Evaluation = { id: 'live_case', accent: 'Unknown', synthetic: false, domains: ['light'], intent: 'Bật đèn', referenceText: 'bật đèn', asrText: 'bật đèn', audioFile: null,
    predictedCalls: [], expectedCalls: [{ name: 'light.on', arguments: {} }], predictedHash: null, expectedHash: null,
    sequenceMatch: null, hashMatch: null, taskSuccess: null, isOos: null, predictedOos: null, latencyMs: null,
    timings: {}, context: {}, history: [], steps: [], expectedState: null, actualState: null, diagnosis: null, status: 'running' }
  await page.route('**/_lifemate/live?**', route => {
    if (phase === 5) return route.fulfill({ json: { run: null, samples: [], cursor: 0, reset: true } })
    const finished = phase >= 3
    const next = phase === 4
    const sample = { ...row }
    if (phase >= 2) { sample.predictedCalls = [{ name: 'light.on', arguments: {} }]; sample.steps = [{ name: 'light.on', arguments: {}, observation: { ok: true } }] }
    if (finished) { sample.taskSuccess = true; sample.hashMatch = true; sample.sequenceMatch = true; sample.status = 'completed'; sample.latencyMs = 1200; sample.predictedHash = 'fixture:env'; sample.expectedHash = 'fixture:env' }
    if (next) Object.assign(sample, { id: 'public_case', taskSuccess: null, hashMatch: null, sequenceMatch: null, expectedCalls: null, expectedHash: null, referenceText: null })
    return route.fulfill({ json: { cursor: phase, reset: true, run: {
      run_id: next ? 'b'.repeat(32) : 'a'.repeat(32), name: next ? 'fixture-public-run' : 'fixture-live-run', path: 'fixture-only',
      state: finished ? 'completed' : phase === 0 ? 'initializing' : 'running', phase: phase < 2 ? 'asr' : 'tools', model: 'fixture-only', split: next ? 'public_test' : 'train', mode: 'full-asr', total: 1,
      processed: finished ? 1 : 0, scored: finished && !next ? 1 : 0, current_sample: finished ? null : 'live_case', step: phase >= 2 ? 0 : null,
      started_at: new Date().toISOString(), elapsed_seconds: phase, catching_up: false,
      local_score: phase === 3 ? 100 : null, mean_f1: phase === 3 ? 1 : null, score_samples: phase === 3 ? 1 : 0,
    }, samples: phase ? [sample] : [] } })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Run chưa có mẫu' })).toBeVisible()
  phase = 1
  await expect(page.locator('.sessions-table .sample-link')).toHaveText('live_case')
  await expect(page.locator('.sessions-table .badge')).toHaveText('CHƯA CHẤM')
  await page.locator('.sessions-table .sample-link').click()
  const inspector = page.getByRole('dialog')
  await expect(inspector).toBeVisible()
  phase = 2
  await expect(inspector.getByText('light.on', { exact: true }).first()).toBeVisible()
  phase = 3
  await expect(page.locator('.live-score')).toContainText('100.00/100')
  const history = page.getByRole('region', { name: 'Lịch sử điểm các lần chạy' })
  await page.getByLabel('Chỉ số so sánh lịch sử').selectOption('local')
  await expect(history.locator('.history-point')).toHaveCount(1)
  await expect(history.locator('.history-selected')).toContainText('100.00')
  await expect(inspector.locator('.hash-box')).toHaveClass(/hash-pass/)
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.locator('.sessions-table .sample-link')).toHaveCount(1)
  await expect(page.locator('.sessions-table .sample-link')).toHaveText('live_case')
  await expect(page.locator('.sessions-table .badge')).toHaveText('PASS')
  await page.locator('.sessions-table .sample-link').click()
  phase = 4
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.locator('.sessions-table .sample-link')).toHaveText('public_case')
  await expect(page.locator('.sessions-table .badge')).toHaveText('CHƯA CHẤM')
  await expect(page.locator('.metric-hash .metric-value')).toHaveText('—')
  await expect(page.locator('.live-score')).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  phase = 5
  await expect(page.getByRole('heading', { name: 'Chưa có dữ liệu train/test' })).toBeVisible()
  await expect(page.locator('.sessions-table .sample-link')).toHaveCount(0)
  await expect(page.locator('.metric-sample .metric-value')).toHaveText('0')
  expect(errors).toEqual([])
})
