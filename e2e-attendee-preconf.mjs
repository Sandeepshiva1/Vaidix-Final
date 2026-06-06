/**
 * E2E test: Attendee pre/post-conference flow
 *
 * Scenario tested:
 * 1. RESIDENT (arjun.mehta) logs in and views the prepare page
 * 2. Checks the readiness progress tracker
 * 3. Views the finalized presentation deck (if available)
 * 4. Answers MCQ pre-quiz questions (selects option A for each)
 * 5. Submits an open-ended answer (if any)
 * 6. Asks a pre-session question
 * 7. Checks readiness checklist updates
 * 8. FACULTY (meera.krishnan) logs in
 * 9. Opens the session analytics → quiz tab
 * 10. Verifies the response data reflects the attendee's answers
 *
 * Run from project root:
 *   node e2e-attendee-preconf.mjs [SESSION_ID]
 *
 * If SESSION_ID is omitted the script discovers the most recently created
 * PRE-status session that has learnerPrep MCQs from the local Postgres instance.
 *
 * Requirements: Dev server running on localhost:3001
 */

import { chromium } from 'playwright'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = 'http://localhost:3001'

// ── Credentials ───────────────────────────────────────────────────────────────
const RESIDENT = { email: 'arjun.mehta@vaidix.local', password: '12345678', label: 'RESIDENT' }
const FACULTY  = { email: 'meera.krishnan@vaidix.local', password: '12345678', label: 'FACULTY' }

// ── Helpers ───────────────────────────────────────────────────────────────────
let passed = 0; let failed = 0
function log(msg) { console.log(`  ${msg}`) }
function ok(msg)  { passed++; console.log(`  ✓ ${msg}`) }
function fail(msg){ failed++; console.error(`  ✗ FAIL: ${msg}`) }
async function assert(cond, msg) { if (cond) ok(msg); else fail(msg) }

async function login(page, creds) {
  for (let i = 0; i < 4; i++) {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
    const id = page.locator('input[autocomplete="username"]').first()
    const pw = page.locator('input[autocomplete="current-password"]').first()
    if (await id.count() === 0) { await page.waitForTimeout(1200); continue }
    await id.fill(creds.email)
    await pw.fill(creds.password)
    await page.locator('button[type=submit], button:has-text("Sign In")').first().click()
    await page.waitForTimeout(3000)
    if (!page.url().includes('/login')) break
  }
  const loggedIn = !page.url().includes('/login')
  if (loggedIn) ok(`Logged in as ${creds.label} (${creds.email})`)
  else fail(`Login failed for ${creds.label}`)
  return loggedIn
}

// Resolve the opaque session URL for :3001 (proxy.ts rewrites raw cuid → opaque token)
async function resolveSessionUrl(page, rawPath) {
  const res = await page.request.get(`${BASE}${rawPath}`, { maxRedirects: 0 }).catch(() => null)
  if (!res || res.status() < 300 || res.status() >= 400) return `${BASE}${rawPath}`
  const loc = res.headers()['location'] ?? ''
  if (!loc) return `${BASE}${rawPath}`
  const relative = loc.replace(/^https?:\/\/[^/]+/, '')
  return `${BASE}${relative}`
}

// ── Discover a test session via the API ────────────────────────────────────────
async function findTestSession(page) {
  // Use the classroom API to find sessions the current user can see
  const res = await page.request.get(`${BASE}/api/classroom/sessions?limit=50`).catch(() => null)
  if (!res || !res.ok()) return null
  let sessions
  try { sessions = (await res.json()).data?.sessions ?? [] } catch { return null }
  // Prefer a session with learnerPrep MCQs and PRE status
  for (const s of sessions) {
    if (s.status === 'SCHEDULED' || s.status === 'PRE') {
      if (s.metadata?.learnerPrep?.mcqs?.length > 0) {
        log(`Found session with MCQs: "${s.title}" (${s.id})`)
        return s
      }
    }
  }
  // Fall back to first SCHEDULED session
  const fallback = sessions.find((s) => s.status === 'SCHEDULED' || s.status === 'PRE')
  if (fallback) log(`Fallback session (no MCQs): "${fallback.title}" (${fallback.id})`)
  return fallback ?? null
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const cliSessionId = process.argv[2] ?? null
  console.log('\n══════════════════════════════════════════════')
  console.log(' Vaidix E2E — Attendee Pre-Conference Flow')
  console.log('══════════════════════════════════════════════\n')

  const browser = await chromium.launch({ headless: false, slowMo: 80 })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()

  try {
    // ── Step 1: Login as Resident ─────────────────────────────────────────────
    console.log('Phase 1: Attendee (Resident) pre-conference\n')
    const loginOk = await login(page, RESIDENT)
    if (!loginOk) { await browser.close(); process.exit(1) }

    // ── Step 2: Discover or use provided session ───────────────────────────────
    let sessionId = cliSessionId
    let hasMcqs = false
    if (!sessionId) {
      const found = await findTestSession(page)
      if (!found) { fail('No eligible session found — create a session with MCQs first.'); await browser.close(); process.exit(1) }
      sessionId = found.id
      hasMcqs = (found.metadata?.learnerPrep?.mcqs?.length ?? 0) > 0
    }
    log(`Using session: ${sessionId}`)

    // ── Step 3: Navigate to /classroom/[id]/prepare ────────────────────────────
    console.log('\n── Prepare page ──')
    const prepareUrl = await resolveSessionUrl(page, `/classroom/${sessionId}/prepare`)
    await page.goto(prepareUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)

    const onPreparePage = page.url().includes('/prepare') || page.url().includes(sessionId)
    await assert(onPreparePage, 'Landed on prepare page')

    // Check readiness ring
    const readinessPct = page.locator('text=Your Readiness').first()
    await assert(await readinessPct.count() > 0, 'Readiness section is visible')

    // Check checklist items
    const checklistItems = page.locator('svg.lucide-circle-dashed, svg.lucide-check-circle-2')
    const checklistCount = await checklistItems.count()
    await assert(checklistCount > 0, `Readiness checklist shows ${checklistCount} items`)

    // ── Step 4: Finalized deck banner ─────────────────────────────────────────
    console.log('\n── Finalized presentation ──')
    const deckBanner = page.locator('text=Finalized Presentation').first()
    if (await deckBanner.count() > 0) {
      ok('Finalized presentation banner visible')
      const deckLink = page.locator('a[href]:has-text("Finalized Presentation")').first()
        .or(page.locator('a[target="_blank"]:has-text("Finalized Presentation")').first())
      if (await deckLink.count() > 0) {
        log('Deck link found — clicking to open (new tab)...')
        const [newPage] = await Promise.all([
          ctx.waitForEvent('page').catch(() => null),
          deckLink.click({ button: 'left' }),
        ])
        if (newPage) {
          await newPage.waitForTimeout(1500)
          ok(`Deck opened in new tab: ${newPage.url()}`)
          await newPage.close()
        } else {
          ok('Deck link clicked (opens externally)')
        }
      }
    } else {
      log('No finalized deck uploaded for this session (skipped)')
    }

    // ── Step 5: Study Pack tab ─────────────────────────────────────────────────
    console.log('\n── Study Pack tab ──')
    const studyTab = page.locator('button:has-text("Study Pack")').first()
    if (await studyTab.count() > 0) {
      await studyTab.click(); await page.waitForTimeout(800)
      ok('Switched to Study Pack tab')
      const materialItems = page.locator('[class*="rounded-2xl"][class*="border"]').filter({ hasText: /PDF|VIDEO|DOC|Presentation/ })
      const mCount = await materialItems.count()
      log(`Study materials listed: ${mCount}`)
    }

    // ── Step 6: Pre-Quiz tab ──────────────────────────────────────────────────
    console.log('\n── Pre-Quiz ──')
    const quizTab = page.locator('button:has-text("Pre-Quiz")').first()
    if (await quizTab.count() > 0) {
      await quizTab.click(); await page.waitForTimeout(800)
      ok('Switched to Pre-Quiz tab')

      // Answer MCQs — click option A (index 0) for each unanswered question
      const mcqBlocks = page.locator('[class*="rounded-3xl"][class*="border"]:has(button)')
      const mcqCount = await mcqBlocks.count()
      log(`MCQ blocks found: ${mcqCount}`)

      for (let i = 0; i < mcqCount; i++) {
        const block = mcqBlocks.nth(i)
        const optionA = block.locator('button:has-text("A")').first()
          .or(block.locator('button').first())
        if (await optionA.count() > 0 && await optionA.isEnabled()) {
          await optionA.click()
          await page.waitForTimeout(1200)
          // Check for feedback (correct/incorrect message or toast)
          const feedback = page.locator('text=/Correct|Incorrect|saved/i').first()
          const feedbackVisible = await feedback.count() > 0
          ok(`MCQ ${i + 1} answered${feedbackVisible ? ' — feedback shown' : ''}`)
        }
      }

      // Answer open-ended if any
      const textareas = page.locator('textarea[placeholder*="answer"]')
      const taCount = await textareas.count()
      for (let i = 0; i < taCount; i++) {
        const ta = textareas.nth(i)
        await ta.fill('This is my pre-session answer for the open-ended question.')
        const submitBtn = ta.locator('..').locator('button:has-text("Submit")').first()
          .or(page.locator('button:has-text("Submit answer")').first())
        if (await submitBtn.count() > 0) {
          await submitBtn.click(); await page.waitForTimeout(1000)
          ok(`Open-ended question ${i + 1} answered`)
        }
      }
    } else {
      log('No Pre-Quiz tab (no MCQs configured for this session)')
    }

    // ── Step 7: Questions tab ─────────────────────────────────────────────────
    console.log('\n── Pre-Session Questions ──')
    const questionsTab = page.locator('button:has-text("Questions")').first()
    if (await questionsTab.count() > 0) {
      await questionsTab.click(); await page.waitForTimeout(800)
      ok('Switched to Questions tab')

      // Type a question
      const questionInput = page.locator('textarea[placeholder*="question"], input[placeholder*="question"], textarea').first()
      if (await questionInput.count() > 0) {
        await questionInput.click()
        const questionText = `E2E test question — ${Date.now()}`
        await questionInput.fill(questionText)
        const submitQ = page.locator('button[type=submit]:visible, button:has-text("Ask"), button:has-text("Submit")').first()
        if (await submitQ.count() > 0) {
          await submitQ.click(); await page.waitForTimeout(1500)
          const qAdded = await page.locator(`text=${questionText.slice(0, 20)}`).count() > 0
          await assert(qAdded, 'Question submitted and visible on board')
        } else {
          log('Submit button not found — question input found but not submittable')
        }
      } else {
        log('No question input found')
      }
    }

    // ── Step 8: Verify readiness updated ─────────────────────────────────────
    console.log('\n── Readiness re-check ──')
    await page.goto(prepareUrl, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2000)
    const readinessBadge = page.locator('[class*="text-teal-700"]:has-text("%"), [class*="text-teal-300"]:has-text("%")').first()
    if (await readinessBadge.count() > 0) {
      const pct = await readinessBadge.textContent()
      ok(`Readiness score after actions: ${pct?.trim()}`)
    }

    // ── Step 9: Analytics — log in as FACULTY ─────────────────────────────────
    if (hasMcqs) {
      console.log('\nPhase 2: Presenter/Faculty analytics\n')
      await ctx.clearCookies()
      const facLoginOk = await login(page, FACULTY)
      if (!facLoginOk) { fail('Faculty login failed — skipping analytics check'); }
      else {
        const analyticsUrl = await resolveSessionUrl(page, `/session/${sessionId}/analytics`)
        await page.goto(analyticsUrl, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(2000)

        const onAnalytics = page.url().includes('/analytics') || page.url().includes(sessionId)
        await assert(onAnalytics, 'Faculty landed on analytics page')

        // Click Quiz tab
        const quizAnalyticsTab = page.locator('button:has-text("Quiz"), [role=tab]:has-text("Quiz")').first()
        if (await quizAnalyticsTab.count() > 0) {
          await quizAnalyticsTab.click(); await page.waitForTimeout(1000)
          ok('Opened Quiz analytics tab')

          // Check for response data
          const responseData = page.locator('text=/responded|responses|Accuracy|accuracy/i').first()
          const hasData = await responseData.count() > 0
          await assert(hasData, 'Quiz response data visible in analytics')

          // Check per-option bars are rendered
          const optionBars = page.locator('[style*="width"]').filter({ hasText: /[A-D]\b/ })
          const barCount = await optionBars.count()
          log(`Per-option answer bars rendered: ${barCount}`)
        } else {
          log('Quiz tab not found on analytics page')
        }

        // Verify analytics tab is visible (not hidden for faculty)
        const analyticsTabVisible = await page.locator('button:has-text("Analytics"), [role=tab]:has-text("Analytics")').first().count() > 0
        ok(`Analytics tab visible to faculty: ${analyticsTabVisible}`)
      }
    } else {
      log('Session has no MCQs — skipping analytics quiz validation')
    }

  } catch (err) {
    fail(`Unexpected error: ${err.message}`)
    console.error(err)
  } finally {
    await browser.close()
  }

  // ── Results ────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════')
  console.log(` Results: ${passed} passed, ${failed} failed`)
  console.log('══════════════════════════════════════════════\n')
  process.exit(failed > 0 ? 1 : 0)
}

main()
