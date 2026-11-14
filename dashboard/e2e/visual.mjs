import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

await mkdir('docs', { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 1100 }, deviceScaleFactor: 1 })
  await page.goto('http://127.0.0.1:5173/')
  await page.screenshot({ path: 'docs/overview.png', fullPage: true, animations: 'disabled' })
  // Capture an inspector only if a real run has supplied a sample.
  const sample = page.locator('.sessions-table .sample-link').first()
  if (await sample.count()) {
    await sample.click()
    await page.screenshot({ path: 'docs/inspector.png', animations: 'disabled' })
    await page.getByRole('tab', { name: 'Tool & state diff' }).click()
    await page.screenshot({ path: 'docs/state-diff.png', animations: 'disabled' })
    await page.keyboard.press('Escape')
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'docs/mobile.png', fullPage: true, animations: 'disabled' })
  console.log('Saved QA screenshots of the current dashboard; no data was injected.')
} finally { await browser.close() }
