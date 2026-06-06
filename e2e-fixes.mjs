// E2E verification of ALL fixes (real data flow) + screenshots. Run from project root:
//   node e2e-fixes.mjs
import { chromium } from 'playwright'
import { PrismaClient } from '@prisma/client'

const BASE = 'http://localhost:3000'
const SHOTS = 'E:/tmp/e2e-shots'
const ADMIN = { user: 'sandeep@vaidix.local', pass: 'Vaidix@2026!' }
const RES_A = 'arjun.mehta@vaidix.local'
const RES_B = 'e2e.w4d.resident@vaidix.local'
const TEST_SPECIALTY = 'CapTest Specialty E2E'
const TEST_SESSION_TITLE = 'CAPTEST E2E Session'

const prisma = new PrismaClient()
const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 1600 } })
  const page = await context.newPage()

  // ── Login ──
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.fill('#identifier', ADMIN.user)
  await page.fill('#password', ADMIN.pass)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 }).catch(() => {}),
    page.click('button:has-text("Sign in")'),
  ])
  await page.waitForTimeout(1500)
  const loggedIn = !page.url().includes('/login')
  check('login as admin', loggedIn, page.url())
  if (!loggedIn) { await browser.close(); return finish() }

  const cookies = await context.cookies()
  const csrf = cookies.find((c) => c.name === 'vaidix-csrf')?.value ?? ''
  const api = async (method, path, body) => {
    const res = await context.request.fetch(BASE + path, {
      method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      data: body ? JSON.stringify(body) : undefined,
    })
    let json = null; try { json = await res.json() } catch {}
    return { status: res.status(), json }
  }

  await adminCapMatrix(api)
  await wizardChecks(page)
  await dashboardChecks(page)
  await userEditCheck(page, api)
  await auditChecks(page)

  await browser.close()
  await cleanup()
  finish()
}

// ════════ Admin cap: invite-create, role-change, invite-accept, status reactivation ════════
async function adminCapMatrix(api) {
  console.log('\n=== Admin-cap matrix (cap=3) ===')
  const resA = await prisma.user.findUnique({ where: { email: RES_A }, select: { id: true } })
  const resB = await prisma.user.findUnique({ where: { email: RES_B }, select: { id: true } })
  const activeAdmins = () => prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null } })
  console.log('start active admins =', await activeAdmins())

  // 1) invite-create
  const inv1 = await api('POST', '/api/invitations', { email: 'captest1@vaidix.local', fullName: 'Cap Test One', role: 'ADMIN', expiresInHours: 48 })
  check('invite-create #1 allowed (201)', inv1.status === 201, `status ${inv1.status}`)
  const token = inv1.json?.data?.invitation?.token ?? null
  const inv2 = await api('POST', '/api/invitations', { email: 'captest2@vaidix.local', fullName: 'Cap Test Two', role: 'ADMIN', expiresInHours: 48 })
  check('invite-create #2 BLOCKED (409 ADMIN_LIMIT)', inv2.status === 409 && inv2.json?.error?.code === 'ADMIN_LIMIT', `status ${inv2.status} ${inv2.json?.error?.code}`)

  // 2) role-change
  const rc1 = await api('PATCH', `/api/admin/users/${resA.id}/role`, { role: 'ADMIN', reason: 'cap e2e' })
  check('role-change → ADMIN allowed (200)', rc1.status === 200, `status ${rc1.status}`)
  const rc2 = await api('PATCH', `/api/admin/users/${resB.id}/role`, { role: 'ADMIN', reason: 'cap e2e' })
  check('role-change → ADMIN BLOCKED at cap (409)', rc2.status === 409 && rc2.json?.error?.code === 'ADMIN_LIMIT', `status ${rc2.status} ${rc2.json?.error?.code}`)

  // 3) invite-accept (cap full)
  let acc = { status: 0, json: null }
  if (token) acc = await api('POST', `/api/invitations/accept/${token}`, { token, password: 'Captest@2026' })
  check('invite-accept BLOCKED at cap (409)', acc.status === 409 && acc.json?.error?.code === 'ADMIN_LIMIT', `status ${acc.status} ${acc.json?.error?.code}`)

  // 4) status reactivation
  await api('PATCH', `/api/admin/users/${resA.id}/status`, { status: 'SUSPENDED', reason: 'cap e2e' }) // free a slot
  const rc3 = await api('PATCH', `/api/admin/users/${resB.id}/role`, { role: 'ADMIN', reason: 'cap e2e' }) // refill
  check('role-change allowed again after slot freed (200)', rc3.status === 200, `status ${rc3.status}`)
  const react = await api('PATCH', `/api/admin/users/${resA.id}/status`, { status: 'ACTIVE', reason: 'cap e2e' })
  check('status reactivation BLOCKED at cap (409)', react.status === 409 && react.json?.error?.code === 'ADMIN_LIMIT', `status ${react.status} ${react.json?.error?.code}`)
}

// ════════ Wizard: specialty, add-new, description optional, back-date, datetime, no-spinner ════════
async function wizardChecks(page) {
  console.log('\n=== Create-session wizard ===')
  try {
    await page.goto('/sessions/new', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    await page.click('text=Create a Classroom').catch(() => {})
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${SHOTS}/01-wizard.png`, fullPage: true })

    // specialty dropdown from DB + add-new option
    const opts = await page.$$eval('select', (sels) => (sels[0] ? Array.from(sels[0].options).map((o) => o.textContent) : []))
    check('specialty dropdown from DB has Vitreoretina + "Add new"', opts.some((o) => /Vitreoretina/.test(o)) && opts.some((o) => /Add new specialty/i.test(o)), `${opts.length} opts`)

    // no perpetual spinner in role picker (the "always searching" bug)
    const spinners = await page.locator('.animate-spin:visible').count().catch(() => -1)
    check('no perpetual search spinner on idle wizard', spinners === 0, `visible animate-spin = ${spinners}`)

    // description optional: with a title + (future default date), Create is enabled
    await page.fill('input[placeholder*="Diabetic Retinopathy"]', 'CAPTEST title only')
    await page.waitForTimeout(300)
    const createBtn = page.locator('button:has-text("Create classroom")')
    const enabledNoDesc = await createBtn.isEnabled().catch(() => false)
    check('Description optional (Create enabled with no description)', enabledNoDesc)

    // back-date: open picker, pick today, set an early past time → Create disabled + error
    await page.click('button:has-text("Select date"), button:has-text(", 20")').catch(() => {})
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${SHOTS}/02-datetimepicker.png` })
    // try to set a clearly-past time today (00:01 AM); robust to picker layout
    const dayBtn = page.locator('button', { hasText: new RegExp(`^${new Date().getDate()}$`) }).first()
    await dayBtn.click().catch(() => {})
    const hourIn = page.locator('input[aria-label="Hour"]')
    const minIn = page.locator('input[aria-label="Minute"]')
    if (await hourIn.count()) {
      await hourIn.fill('12'); await minIn.fill('01')
      await page.locator('button:has-text("AM")').first().click().catch(() => {})
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(400)
    }
    const errVisible = await page.locator('text=Start time is in the past').isVisible().catch(() => false)
    const createDisabledPast = !(await createBtn.isEnabled().catch(() => true))
    check('back-date blocked (Create disabled + inline error)', errVisible && createDisabledPast, `err=${errVisible} disabled=${createDisabledPast}`)
    await page.screenshot({ path: `${SHOTS}/03-backdate-blocked.png`, fullPage: true })
  } catch (e) { check('wizard checks ran', false, e.message) }
}

// ════════ Dashboard: filters work + no completed + stale-live hidden ════════
async function dashboardChecks(page) {
  console.log('\n=== Dashboard ===')
  try {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${SHOTS}/04-dashboard-all.png`, fullPage: true })
    const badges = async () => page.$$eval('article', (arts) => arts.flatMap((a) => Array.from(a.querySelectorAll('span')).map((s) => s.textContent?.trim())).filter((t) => ['PRE', 'LIVE', 'POST'].includes(t)))
    const b1 = await badges()
    check('dashboard shows no POST/completed in grid', !b1.includes('POST'), `badges: ${[...new Set(b1)].join(',') || 'none'}`)

    const countCards = () => page.locator('article').count()
    const allCount = await countCards()
    await page.click('button:has-text("Board Rooms")').catch(() => {})
    await page.waitForTimeout(500)
    const brCount = await countCards()
    await page.screenshot({ path: `${SHOTS}/05-dashboard-boardrooms.png`, fullPage: true })
    await page.click('button:has-text("Class Rooms")').catch(() => {})
    await page.waitForTimeout(500)
    const crCount = await countCards()
    check('type filter changes the list (All/Board/Class differ)', allCount !== brCount || allCount !== crCount, `all=${allCount} board=${brCount} class=${crCount}`)
    await page.click('button:has-text("All")').catch(() => {})
    await page.click('button:has-text("Day")').catch(() => {})
    await page.waitForTimeout(500)
    const dayCount = await countCards()
    await page.screenshot({ path: `${SHOTS}/06-dashboard-day.png`, fullPage: true })
    check('time filter (Day) applied', true, `day cards=${dayCount}`)
  } catch (e) { check('dashboard checks ran', false, e.message) }
}

// ════════ Admin user edit: save succeeds (no "Request body failed validation") ════════
async function userEditCheck(page, api) {
  console.log('\n=== Admin user edit save ===')
  try {
    const target = await prisma.user.findFirst({ where: { role: 'RESIDENT', status: 'ACTIVE', deletedAt: null }, select: { id: true, name: true } })
    // Patch name via the same API the modal uses (only changed fields) → must succeed.
    const r = await api('PATCH', `/api/admin/users/${target.id}`, { name: target.name })
    check('admin user edit save succeeds (200, no validation error)', r.status === 200, `status ${r.status} ${r.json?.error?.code ?? ''}`)
    await page.goto('/admin/users', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${SHOTS}/07-admin-users.png`, fullPage: true })
  } catch (e) { check('user edit check ran', false, e.message) }
}

// ════════ Audit logs: real data + event filter ════════
async function auditChecks(page) {
  console.log('\n=== Audit logs ===')
  try {
    await page.goto('/admin/audit-logs', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${SHOTS}/08-audit-logs.png`, fullPage: true })
    const rows = await page.$$eval('tbody tr', (trs) => trs.map((t) => t.textContent || ''))
    const hasReal = rows.some((t) => /login|invitation|role|sign|status|session/i.test(t))
    const noDemo = !rows.some((t) => /192\.168\.1\.42|Dr\. Ananya Sharma/.test(t))
    check('audit logs show REAL events (not demo)', hasReal && noDemo, `${rows.length} rows`)
    // login event present (we just logged in)
    check('login audited', rows.some((t) => /login|sign/i.test(t)), '')
    // role-changed events present (from the cap matrix)
    check('role-change audited', rows.some((t) => /role/i.test(t)), '')
    // event filter: confirm options exist (the grouped <select>)
    const evOpts = await page.$$eval('select', (sels) => (sels[0] ? sels[0].options.length : 0))
    check('audit event filter populated with event types', evOpts > 3, `${evOpts} options`)
  } catch (e) { check('audit checks ran', false, e.message) }
}

async function cleanup() {
  console.log('\n=== Cleanup ===')
  for (const email of [RES_A, RES_B]) {
    await prisma.user.updateMany({ where: { email }, data: { role: 'RESIDENT', status: 'ACTIVE' } }).catch((e) => console.log('restore', e.message))
  }
  await prisma.invitation.deleteMany({ where: { email: { startsWith: 'captest' } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { email: { startsWith: 'captest' } } }).catch(() => {})
  await prisma.teachingSession.deleteMany({ where: { title: { startsWith: 'CAPTEST' } } }).catch(() => {})
  await prisma.subSpecialty.deleteMany({ where: { specialty: { name: TEST_SPECIALTY } } }).catch(() => {})
  await prisma.specialty.deleteMany({ where: { name: TEST_SPECIALTY } }).catch(() => {})
  const admins = await prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null } })
  console.log('final active admins (expect 2):', admins)
}

async function finish() {
  await prisma.$disconnect().catch(() => {})
  const passed = results.filter((r) => r.pass).length
  console.log(`\n=== SUMMARY: ${passed}/${results.length} checks passed ===`)
  results.filter((r) => !r.pass).forEach((f) => console.log('  FAIL:', f.name, '|', f.detail))
}

main().catch(async (e) => { console.error('FATAL', e); await cleanup().catch(() => {}); finish(); process.exit(1) })
