// Logs in the seeded faculty + resident via the real /login form and saves
// their authenticated storage state for the specs. Runs as the 'setup' project
// (after the dev server is up); the 'chromium' project depends on it.

import { test as setup, expect } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'

const state = JSON.parse(readFileSync('e2e/.state.json', 'utf8')) as {
  facultyEmail: string; residentEmail: string; password: string
}

async function login(page: import('@playwright/test').Page, identifier: string, password: string) {
  await page.goto('/login')
  await page.locator('#identifier').fill(identifier)
  await page.locator('#password').fill(password)
  await page.locator('button[type="submit"]').click()
  // Credentials sign-in does redirect:false then router.push(callbackUrl=/dashboard).
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

setup('authenticate faculty', async ({ page }) => {
  mkdirSync('e2e/.auth', { recursive: true })
  await login(page, state.facultyEmail, state.password)
  await expect(page).toHaveURL(/\/dashboard/)
  await page.context().storageState({ path: 'e2e/.auth/faculty.json' })
})

setup('authenticate resident', async ({ page }) => {
  mkdirSync('e2e/.auth', { recursive: true })
  await login(page, state.residentEmail, state.password)
  await expect(page).toHaveURL(/\/dashboard/)
  await page.context().storageState({ path: 'e2e/.auth/resident.json' })
})
