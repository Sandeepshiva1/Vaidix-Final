// Visual probe: open the start datetime picker and capture a screenshot
// so we can eyeball the new layout (no Confirm button, aligned time row).
import { chromium } from 'playwright'

const EMAIL = process.env.PROBE_EMAIL ?? 'w5e2e.faculty@vaidix.local'
const PASSWORD = process.env.PROBE_PASSWORD ?? 'TestPass123!'
const BASE = process.env.PROBE_BASE ?? 'http://localhost:3000'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await ctx.newPage()

  await page.goto(`${BASE}/login`)
  await page.getByLabel(/email/i).fill(EMAIL)
  await page.getByLabel(/password/i).fill(PASSWORD)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 }),
    page.getByRole('button', { name: /sign in|log in/i }).click(),
  ])

  await page.goto(`${BASE}/calendar/new`)
  await page.waitForSelector('text=Schedule Session')

  // Step 1: title, then Continue
  await page.locator('form input').first().fill('PROBE-PickerUI')
  await page.getByRole('button', { name: /^continue$/i }).click()

  // Step 2: open the Start picker
  await page.waitForSelector('text=Host & timing')
  await page.getByRole('button', { name: /select date|tap to pick/i }).first().click()
  await page.waitForTimeout(400) // allow open animation

  // Locate the picker panel (portaled to body, fixed-positioned z-9999) and screenshot just it
  const panel = page.locator('div.fixed.z-9999').first()
  await panel.waitFor({ state: 'visible', timeout: 5_000 })
  await panel.screenshot({ path: 'scripts/probe-picker-ui.png' })
  console.log('saved scripts/probe-picker-ui.png')

  // Verify Confirm button is gone
  const hasConfirm = await page.locator('button', { hasText: /confirm/i }).count()
  console.log('confirm-button count (expect 0):', hasConfirm)

  // Verify time inputs are present and properly sized
  const timeInputs = await page.locator('input[type="number"]').count()
  console.log('time inputs (expect 2):', timeInputs)

  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
