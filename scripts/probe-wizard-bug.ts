// Probe: does clicking Continue on Audience step auto-create the session?
// Run: npx tsx scripts/probe-wizard-bug.ts
import { chromium } from 'playwright'

const EMAIL = process.env.PROBE_EMAIL ?? 'w5e2e.faculty@vaidix.local'
const PASSWORD = process.env.PROBE_PASSWORD ?? 'TestPass123!'
const BASE = process.env.PROBE_BASE ?? 'http://localhost:3000'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  const apiCalls: { method: string; url: string; status?: number }[] = []
  page.on('request', (req) => {
    if (req.url().includes('/api/classroom/sessions')) {
      apiCalls.push({ method: req.method(), url: req.url() })
    }
  })
  page.on('response', async (res) => {
    if (res.url().includes('/api/classroom/sessions') && res.request().method() === 'POST') {
      const idx = apiCalls.findIndex((c) => c.url === res.url() && c.status === undefined)
      if (idx >= 0) apiCalls[idx].status = res.status()
    }
  })

  console.log('→ login')
  await page.goto(`${BASE}/login`)
  await page.getByLabel(/email/i).fill(EMAIL)
  await page.getByLabel(/password/i).fill(PASSWORD)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 }),
    page.getByRole('button', { name: /sign in|log in/i }).click(),
  ])

  // Pre-fill start/end via URL params to skip the custom DateTimePicker UI
  const startISO = new Date(Date.now() + 2 * 3600_000).toISOString()
  const endISO = new Date(Date.now() + 3 * 3600_000).toISOString()
  const url = `${BASE}/calendar/new?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`
  console.log('→ ' + url)
  await page.goto(url)
  await page.waitForSelector('text=Schedule Session')

  // Step 1: title
  console.log('→ step 1: fill title + Continue')
  await page.locator('form input').first().fill('PROBE-WizardBug')
  await page.getByRole('button', { name: /^continue$/i }).click()

  // Step 2: schedule — dates already pre-filled, host defaults to self for FACULTY
  console.log('→ step 2: Continue (dates pre-filled via URL)')
  await page.waitForSelector('text=Host & timing')
  await page.getByRole('button', { name: /^continue$/i }).click()

  // Step 3: audience — visibility defaults to OPEN_TO_ALL
  console.log('→ step 3 (Audience): about to click Continue')
  await page.waitForSelector('text=Who can join?')

  // Snapshot all buttons in the form and add submit listener
  const formInfo = await page.evaluate(() => {
    const form = document.querySelector('form')!
    const allButtons = Array.from(form.querySelectorAll('button')).map((b) => ({
      text: b.textContent?.trim().slice(0, 40),
      type: b.type,
      formAction: b.getAttribute('formaction'),
    }))
    // Install a submit listener to log when form submits and what triggered it
    let submitTrace: string | null = null
    form.addEventListener('submit', (e) => {
      const target = (e as SubmitEvent).submitter
      submitTrace = `submit fired. submitter=${target ? `<${target.tagName} type=${(target as HTMLButtonElement).type} text="${target.textContent?.trim().slice(0, 30)}">` : 'null (programmatic?)'}`
      console.log('[FORM SUBMIT]', submitTrace)
      ;(window as unknown as { __submitTrace: string }).__submitTrace = submitTrace
    }, true)
    return { allButtons }
  })
  console.log('   Form buttons:', JSON.stringify(formInfo.allButtons, null, 2))

  page.on('console', (msg) => {
    if (msg.text().includes('FORM SUBMIT')) console.log('   [browser]', msg.text())
  })

  const apiCallsBefore = apiCalls.length
  await page.getByRole('button', { name: /^continue$/i }).click()
  await page.waitForTimeout(500)
  const submitTrace = await page.evaluate(() => (window as unknown as { __submitTrace?: string }).__submitTrace ?? null).catch(() => null)
  console.log('   submit trace:', submitTrace)

  // Wait a tick for any state changes
  await page.waitForTimeout(800)

  console.log('   API calls during click:', apiCalls.length - apiCallsBefore)
  console.log('   API call details:', JSON.stringify(apiCalls, null, 2))
  console.log('   Current URL:', page.url())

  // What's on screen now?
  const isOnFinishStep = await page.locator('text=Almost there!').isVisible().catch(() => false)
  const isOnCalendar = page.url().includes('/calendar') && !page.url().includes('/calendar/new')
  console.log('   On Finish step?', isOnFinishStep)
  console.log('   Redirected to /calendar?', isOnCalendar)

  // Take screenshot
  await page.screenshot({ path: 'scripts/probe-wizard-bug-after-step3-click.png', fullPage: true })
  console.log('→ screenshot: scripts/probe-wizard-bug-after-step3-click.png')

  await browser.close()

  // Verdict
  if (apiCalls.length > apiCallsBefore) {
    console.log('\nBUG CONFIRMED: clicking Continue on Audience step fired POST /api/classroom/sessions')
    process.exit(1)
  }
  if (isOnFinishStep) {
    console.log('\nNo bug: advanced to Finish step as expected')
  } else {
    console.log('\nUnclear: did not advance, did not submit. Inspect screenshot.')
  }
}

main().catch((e) => { console.error(e); process.exit(2) })
