import { test, expect, type Page } from '@playwright/test'
import { importEvaluations } from '../src/lib/importer'
import { summarizeRun } from '../src/lib/runHistory'
import type { RunSummary } from '../src/lib/runHistory'

// Browser fixtures only; production has no sample/demo source or fallback.
function dataset(name: string, pass: boolean | null, split = 'train') {
  return importEvaluations([{ name: 'evaluations.json', content: JSON.stringify({ metadata: { name, model: 'test-only-model', split, mode: 'full-asr', run_id: name, started_at: '2026-11-08T09:00:00Z' },
    samples: [{ id: 'same-case', status: 'completed', predictedCalls: [{ name: 'alarm.create', arguments: { time: pass ? '07:00' : '06:00' } }], expectedCalls: pass === null ? null : [{ name: 'alarm.create', arguments: { time: '07:00' } }],
      taskSuccess: pass, predictedHash: pass ? 'expected' : 'actual', expectedHash: pass === null ? null : 'expected', referenceText: pass === null ? null : 'bảy giờ', asrText: 'sáu giờ', latencyMs: 1000, toolF1: pass === null ? null : Number(pass) }] }) }])
}
function job(id: string, name: string, kind = 'train-test', state = 'completed') { return { id: id.repeat(32), name, state, created_at: '2026-11-08T09:00:00Z', processed: 1, total: 1,
  config: { kind, mode: 'full-asr', limit: 0 }, validation: kind === 'public-test' ? { ready_to_submit: true, valid: true, checked: 1, expected: 1, incomplete_samples: [], errors: [], sha256: 'a'.repeat(64) } : undefined } }
async function setup(page: Page, options: { jobs?: any[]; records?: Record<string, any>; configured?: boolean } = {}) {
  const jobs = options.jobs ?? [], records = options.records ?? {}, history: RunSummary[] = []
  for (const j of jobs) if (records[j.id]) { const summary = await summarizeRun(records[j.id]); if (summary) history.push({ ...summary, kind: j.config.kind }) }
  await page.route('**/_lifemate/live?**', route => route.fulfill({ json: { run: null, samples: [], cursor: 0, reset: false } }))
  await page.route('**/_lifemate/connection**', route => route.fulfill({ json: route.request().url().includes('check') ? { ready: true, data: [{ id: 'test-only-model' }], identity: { device: 'test-only GPU' } } : { configured: options.configured ?? false, url: options.configured ? 'https://unit.trycloudflare.com' : '' } }))
  await page.route('**/_lifemate/history', route => route.fulfill({ json: history }))
  await page.route('**/_lifemate/jobs**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/data')) return route.fulfill({ json: records[path.split('/')[3]] })
    if (path.endsWith('/submission')) return route.fulfill({ body: '{"id":"test-only","tool_calls":[],"state_hash":"test-only"}\n', headers: { 'content-type': 'application/x-ndjson', 'content-disposition': 'attachment; filename="submission.jsonl"' } })
    if (path.endsWith('/stop')) return route.fulfill({ json: { stopping: true, message: 'Dừng sau request đang chạy.' } })
    return route.fulfill({ json: route.request().method() === 'POST' ? { id: 'f'.repeat(32) } : jobs })
  })
}

test('starts empty, removes manual run import, and requires a Colab connection', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await setup(page); await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Chưa có dữ liệu train/test' })).toBeVisible()
  await expect(page.locator('.sessions-table tbody tr')).toHaveCount(0)
  await expect(page.locator('.metric-sample .metric-value')).toHaveText('0')
  await expect(page.locator('.metric-hash .metric-value')).toHaveText('—')
  await expect(page.getByRole('button', { name: 'Chạy public test', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Chạy train test', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Nhập run|Dùng dữ liệu|Dữ liệu mẫu/ })).toHaveCount(0)
  await expect(page.locator('input[type=file]')).toHaveCount(0)
  expect(errors).toEqual([])
})
test('opens stored results with transcript/tool/hash differences and diagnostic metrics', async ({ page }) => {
  const j = job('a', 'Scored run')
  await setup(page, { jobs: [j], records: { [j.id]: dataset(j.name, false) } }); await page.goto('/')
  await page.getByRole('button', { name: 'Xem kết quả', exact: true }).click()
  await expect(page.getByRole('button', { name: 'same-case', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Phân tích nguyên nhân điểm thấp' })).toContainText('Tool F1')
  await page.getByRole('button', { name: 'same-case', exact: true }).click()
  const inspector = page.getByRole('dialog')
  await expect(inspector.locator('.diff-word.removed').first()).toBeVisible()
  await expect(inspector.locator('.hash-box')).toHaveClass(/hash-fail/)
  await inspector.getByRole('tab', { name: 'Tool & state diff' }).click()
  await expect(inspector.locator('.field-diff-row.changed').filter({ hasText: 'time' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByLabel('Tìm sample, intent hoặc tool').fill('not-found')
  await expect(page.getByRole('heading', { name: 'Không tìm thấy mẫu phù hợp' })).toBeVisible()
})
test('starts public test through controlled job API with full audio coverage', async ({ page }) => {
  await setup(page, { configured: true }); await page.goto('/')
  await page.getByRole('button', { name: 'Chạy public test', exact: true }).click()
  await expect(page.getByLabel('Agent engine')).toHaveValue('datyth')
  await page.getByLabel('Tên run').fill('Public candidate')
  const request = page.waitForRequest(r => r.url().endsWith('/_lifemate/jobs') && r.method() === 'POST')
  await page.getByRole('button', { name: 'Bắt đầu chạy', exact: true }).click()
  expect((await request).postDataJSON()).toMatchObject({ kind: 'public-test', mode: 'full-asr', limit: 0, name: 'Public candidate', engine: 'datyth' })
  await expect(page.getByRole('dialog')).not.toBeVisible()
})
test('shows runtime goals and compiler cost in the sample inspector', async ({ page }) => {
  const j = job('d', 'TaskPlan inspected run')
  const record = dataset(j.name, false)
  record.samples[0].engine = 'task-plan'
  record.samples[0].modelRequests = 2
  record.samples[0].taskState = { engine: 'task-plan', revision: 2,
    goals: [{ id: 'g', status: 'waiting_for_user' }], operations: [], complete: false }
  await setup(page, { jobs: [j], records: { [j.id]: record } }); await page.goto('/')
  await page.getByRole('button', { name: 'Xem kết quả', exact: true }).click()
  await page.getByRole('button', { name: 'same-case', exact: true }).click()
  const inspector = page.getByRole('dialog')
  await expect(inspector.getByText('TaskPlan runtime · goals / operations', { exact: true })).toBeVisible()
  await expect(inspector).toContainText('Model requests: 2')
  await expect(inspector).toContainText('waiting_for_user')
})
test('starts paired train evaluation and stops an active job without a download link', async ({ page }) => {
  await setup(page, { configured: true }); await page.goto('/')
  await page.getByRole('button', { name: 'Chạy train test', exact: true }).click()
  await page.getByLabel('Chế độ đánh giá').selectOption('paired')
  await page.getByLabel('Agent engine').selectOption('datyth')
  const request = page.waitForRequest(r => r.url().endsWith('/_lifemate/jobs') && r.method() === 'POST')
  await page.getByRole('button', { name: 'Bắt đầu chạy' }).click()
  expect((await request).postDataJSON()).toMatchObject({ kind: 'train-test', mode: 'paired', limit: 20, engine: 'datyth' })
  await page.unroute('**/_lifemate/jobs**')
  const j = job('b', 'Active run', 'public-test', 'running')
  await page.route('**/_lifemate/jobs', route => route.fulfill({ json: [j] }))
  await page.route('**/_lifemate/jobs/*/stop', route => route.fulfill({ json: { message: 'Dừng sau request đang chạy.' } }))
  await expect(page.getByRole('button', { name: 'Dừng', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Tải submission.jsonl' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Dừng', exact: true }).click()
  await expect(page.getByText('Dừng sau request đang chạy.', { exact: true })).toBeVisible()
})
test('offers submission download only for completed public run and preserves unknown quality', async ({ page }) => {
  const j = job('a', 'Public output', 'public-test')
  await setup(page, { jobs: [j], records: { [j.id]: dataset(j.name, null, 'public_test') } }); await page.goto('/')
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Tải submission.jsonl' }).click()
  expect((await download).suggestedFilename()).toBe('submission.jsonl')
  await page.getByRole('button', { name: 'Xem kết quả', exact: true }).click()
  await expect(page.locator('.sessions-table .badge')).toHaveText('CHƯA CHẤM')
  await expect(page.locator('.metric-hash .metric-value')).toHaveText('—')
  await expect(page.locator('.sessions-table').getByRole('button', { name: 'Nghe audio', exact: true })).toBeDisabled()
})
test('shows both run kinds, filters them, separates comparison lines, and restores history from disk API', async ({ page }, testInfo) => {
  const first = job('a', 'Before'), second = job('b', 'After'), pub = job('c', 'Public', 'public-test')
  await setup(page, { jobs: [first, second, pub], records: { [first.id]: dataset(first.name, false), [second.id]: dataset(second.name, true), [pub.id]: dataset(pub.name, null, 'public_test') } })
  await page.goto('/')
  const history = page.getByRole('region', { name: 'Lịch sử điểm các lần chạy' })
  await expect(history.locator('.history-table tbody tr')).toHaveCount(3)
  await expect(history.locator('.history-point')).toHaveCount(2)
  await expect(history.locator('.history-stats')).toContainText('+100.00 điểm')
  await page.getByLabel('Hiển thị loại run').selectOption('public-test')
  await expect(history.locator('.history-table tbody tr')).toHaveCount(1)
  await expect(history.locator('.history-point')).toHaveCount(0)
  await page.getByLabel('Chỉ số so sánh lịch sử').selectOption('completion')
  await expect(history.locator('.history-point')).toHaveCount(1)
  await page.getByLabel('Hiển thị loại run').selectOption('all')
  await expect(history.locator('.history-point')).toHaveCount(3)
  await history.screenshot({ path: testInfo.outputPath('history-both.png') })
  await page.reload()
  await expect(history.locator('.history-table tbody tr')).toHaveCount(3)
  await page.getByLabel('Hiển thị loại run').selectOption('train-test')
  await expect(history.locator('.history-table tbody tr')).toHaveCount(2)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await history.screenshot({ path: testInfo.outputPath('history-mobile.png') })
})
test('compares two stored train runs without rerunning models', async ({ page }) => {
  const a = job('a', 'Before'), b = job('b', 'After')
  const left = dataset(a.name, false), right = dataset(b.name, true)
  // Both runs must have exactly the same reference, regardless of prediction.
  left.samples[0].expectedCalls = right.samples[0].expectedCalls; left.samples[0].expectedHash = right.samples[0].expectedHash
  await setup(page, { jobs: [a, b], records: { [a.id]: left, [b.id]: right } }); await page.goto('/')
  await page.getByLabel('Run A').selectOption(`${a.id}:full-asr`)
  await page.getByLabel('Run B').selectOption(`${b.id}:full-asr`)
  await page.getByRole('button', { name: 'Đối chiếu kết quả' }).click()
  await expect(page.getByText('Được sửa: 1/1', { exact: true })).toBeVisible()
  await expect(page.getByText('Regression: 0', { exact: true })).toBeVisible()
})

test('prominently pauses, resumes the same session, then deletes/resets without a history point', async ({ page }, testInfo) => {
  const current = job('f', 'Current session', 'train-test', 'running')
  let present = true, resumeCount = 0, deletes = 0
  await setup(page, { configured: true })
  await page.route('**/_lifemate/jobs**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/stop')) { current.state = 'paused'; return route.fulfill({ json: { stopping: true, message: 'Phiên đang tạm dừng.' } }) }
    if (path.endsWith('/resume')) { current.state = 'running'; resumeCount++; return route.fulfill({ json: { resumed: true, id: current.id, message: 'Tiếp tục cùng phiên.' } }) }
    if (path.endsWith('/delete')) { present = false; deletes++; return route.fulfill({ json: { removed: true, id: current.id, message: 'Đã xóa phiên.' } }) }
    return route.fulfill({ json: present ? [current] : [] })
  })
  await page.goto('/')
  const controls = page.getByRole('region', { name: 'Điều khiển phiên hiện tại' })
  await expect(controls.getByRole('button', { name: 'Dừng phiên', exact: true })).toBeVisible()
  await controls.getByRole('button', { name: 'Dừng phiên', exact: true }).click()
  await expect(controls.getByRole('button', { name: 'Tiếp tục', exact: true })).toBeVisible()
  await expect(controls).toContainText('không tính vào lịch sử điểm')
  await expect(page.locator('.history-table tbody tr')).toHaveCount(0)
  await controls.getByRole('button', { name: 'Tiếp tục', exact: true }).click()
  expect(resumeCount).toBe(1)
  await expect(controls.getByRole('button', { name: 'Dừng phiên', exact: true })).toBeVisible()
  await controls.getByRole('button', { name: 'Dừng phiên', exact: true }).click()
  await expect(controls.getByRole('button', { name: 'Xóa phiên / Reset', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await controls.screenshot({ path: testInfo.outputPath('paused-controls-mobile.png') })
  await controls.getByRole('button', { name: 'Xóa phiên / Reset', exact: true }).click()
  await page.getByRole('button', { name: 'Giữ phiên', exact: true }).click()
  expect(deletes).toBe(0)
  await controls.getByRole('button', { name: 'Xóa phiên / Reset', exact: true }).click()
  await page.getByRole('button', { name: 'Xóa vĩnh viễn phiên này', exact: true }).click()
  await expect(controls).toHaveCount(0)
  await expect(page.locator('.job-row')).toHaveCount(0)
  await expect(page.locator('.history-point')).toHaveCount(0)
  expect(deletes).toBe(1)
})

test('uses identical overall paired progress and explicitly labels each 20-sample phase', async ({ page }, testInfo) => {
  const current = job('a', 'v0-20', 'train-test', 'running')
  current.total = 40; current.processed = 0; current.config.mode = 'paired'; current.config.limit = 20
  let mode = 'gold-text', processed = 0
  await setup(page, { configured: true, jobs: [current] })
  await page.route('**/_lifemate/live?**', route => route.fulfill({ json: { samples: [], cursor: processed, reset: true, run: {
    run_id: (mode === 'gold-text' ? 'b' : 'c').repeat(32), name: `v0-20 / ${mode}`, path: `results\\train-test\\${current.id}\\${mode}`,
    model: 'test-only', split: 'train', mode, state: 'running', phase: 'planning', total: 20, processed, scored: processed,
    current_sample: null, step: null, started_at: '2026-11-08T00:00:00Z', elapsed_seconds: 10, catching_up: false,
  } } }))
  await page.goto('/')
  const top = page.locator('.session-overall'), overall = page.locator('.live-overall>strong'), branch = page.locator('.live-branch')
  await expect(top).toHaveText('Toàn phiên: 0/40 lượt đánh giá')
  await expect(overall).toHaveText('Toàn phiên: 0/40 lượt đánh giá')
  await expect(branch).toContainText('Transcript vàng (1/2) · 0/20 mẫu đã xử lý')
  await expect(page.getByRole('progressbar', { name: 'Tiến độ toàn phiên', exact: true })).toHaveAttribute('aria-valuemax', '40')
  await expect(page.getByRole('progressbar', { name: 'Tiến độ nhánh hiện tại', exact: true })).toHaveAttribute('aria-valuemax', '20')
  current.processed = 20; mode = 'full-asr'; processed = 0
  await expect(top).toHaveText('Toàn phiên: 20/40 lượt đánh giá')
  await expect(overall).toHaveText('Toàn phiên: 20/40 lượt đánh giá')
  await expect(branch).toContainText('Audio → ASR (2/2) · 0/20 mẫu đã xử lý')
  current.processed = 21; processed = 1
  await expect(top).toHaveText('Toàn phiên: 21/40 lượt đánh giá')
  await expect(overall).toHaveText('Toàn phiên: 21/40 lượt đánh giá')
  await expect(branch).toContainText('1/20 mẫu đã xử lý')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('region', { name: 'Theo dõi realtime' }).screenshot({ path: testInfo.outputPath('paired-progress-mobile.png') })
})


test('Datyth evaluation defaults to diagnostic TRAIN without starting real inference', async ({ page }) => {
  await setup(page, { configured: true }); await page.goto('/')
  await page.getByRole('button', { name: 'Chạy train test', exact: true }).click()
  await expect(page.getByLabel('Tập đánh giá TRAIN')).toHaveValue('all')
  await page.getByLabel('Agent engine').selectOption('datyth')
  const request = page.waitForRequest(r => r.url().endsWith('/_lifemate/jobs') && r.method() === 'POST')
  await page.getByRole('button', { name: 'Bắt đầu chạy', exact: true }).click()
  expect((await request).postDataJSON()).toMatchObject({engine:'datyth', subset:'all', limit:20})
})


test('manual validation and local scoring work without Colab and default chart shows local points', async ({ page }) => {
  const j = job('a', 'Completed TRAIN', 'train-test')
  await setup(page, { jobs:[j], records:{[j.id]:dataset(j.name,true)}, configured:false })
  await page.route('**/_lifemate/jobs/*/validate', route => route.fulfill({json:{action:'validate',branches:{'full-asr':{samples:1,valid:true,errors:[]}}}}))
  await page.route('**/_lifemate/jobs/*/local-score', route => route.fulfill({json:{action:'local-score',branches:{'full-asr':{samples:1,strict_tool_f1_percent:50,sequence_em_percent:0,hash_match_percent:100}}}}))
  await page.goto('/')
  await expect(page.getByLabel('Chỉ số so sánh lịch sử')).toHaveValue('f1')
  await expect(page.locator('.history-point')).toHaveCount(1)
  await page.getByRole('button',{name:'Validate',exact:true}).click()
  await expect(page.getByRole('dialog')).toContainText('VALID · replay hợp lệ')
  await page.getByLabel('Đóng kết quả').click()
  await page.getByRole('button',{name:'Chấm điểm local',exact:true}).click()
  await expect(page.getByRole('dialog')).toContainText('Strict tool F1: 50.00%')
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme)).toBe('light')
  expect(await page.getByRole('button',{name:'Chấm điểm local',exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13)
})
