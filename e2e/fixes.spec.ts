import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

const state = JSON.parse(readFileSync('e2e/.state.json', 'utf8')) as {
  sessionPresent: string
  sessionLate: string
  sessionQuestions: string
}

// ════════════════════════════════════════════════════════════════════════════
// Fix #3 — live-hook delivery gating (present-at-fire-time, no backlog flood)
// ════════════════════════════════════════════════════════════════════════════
// Exercises the REAL HTTP route + auth + listLiveHooksForParticipant. The
// learner overlay polls exactly this endpoint (`?mine=true`), so what it returns
// is what the learner is prompted with.
test.describe('hook delivery gating (resident)', () => {
  test.use({ storageState: 'e2e/.auth/resident.json' })

  test('present-at-fire-time learner is offered the hooks', async ({ page }) => {
    const res = await page.request.get(
      `/api/classroom/sessions/${state.sessionPresent}/hooks?mine=true`,
    )
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.ok).toBe(true)
    // Joined before the hooks fired → sees both open hooks.
    expect(body.data.hooks.length).toBe(2)
  })

  test('late joiner gets ZERO backlog — no continuous flood', async ({ page }) => {
    const res = await page.request.get(
      `/api/classroom/sessions/${state.sessionLate}/hooks?mine=true`,
    )
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.ok).toBe(true)
    // Joined AFTER the hooks fired → sees none; catches the next round instead.
    expect(body.data.hooks.length).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Fix #2 — pre-conference "Incoming Questions" completes only after review
// ════════════════════════════════════════════════════════════════════════════
test.describe('incoming-questions step (faculty/host)', () => {
  test.use({ storageState: 'e2e/.auth/faculty.json' })

  // Reads "{done} of {total} steps complete" off the /pre readiness header.
  async function doneCount(page: import('@playwright/test').Page): Promise<number> {
    const txt = await page.getByText(/\d+ of \d+ steps complete/).first().textContent()
    const m = /(\d+) of \d+ steps complete/.exec(txt ?? '')
    if (!m) throw new Error(`Could not read step count from: ${txt}`)
    return Number(m[1])
  }

  test('a learner question alone does NOT complete the step; review does', async ({ page }) => {
    // Before: the session HAS a learner question but it has not been reviewed,
    // so the step must NOT be counted complete (this is the bug we fixed —
    // previously `counts.questions > 0` lit it up immediately).
    await page.goto(`/session/${state.sessionQuestions}/pre`)
    await expect(page.getByText('Incoming Questions').first()).toBeVisible()
    const before = await doneCount(page)

    // Act: review the questions via the (now wired) CTA.
    await page.goto(`/session/${state.sessionQuestions}/questions`)
    await page.getByRole('button', { name: /Mark questions reviewed/i }).click()
    await page.waitForURL(`**/session/${state.sessionQuestions}/pre`, { timeout: 30_000 })

    // After: exactly one more step is complete. Nothing else changed between the
    // two /pre loads, so the +1 is the Incoming Questions step.
    const after = await doneCount(page)
    expect(after).toBe(before + 1)
  })
})
