import { chromium } from 'playwright'
const BASE = 'http://localhost:3000'
const browser = await chromium.launch()
const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
const page = await ctx.newPage()
let ok = false
for (let i = 0; i < 4 && !ok; i++) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#identifier', 'meera.krishnan@vaidix.local'); await page.fill('#password', 'Test@12345')
  await page.click('button[type=submit]').catch(() => {}); await page.waitForTimeout(3500)
  ok = !page.url().includes('/login')
}
console.log('LOGIN:', ok ? 'OK' : 'FAILED')
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500)
const linkBtn = page.locator('button:has-text("Link")').first()
console.log('Link button count:', await linkBtn.count())
await linkBtn.click().catch((e) => console.log('click err', e.message))
await page.waitForTimeout(900)
const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => 'READ_FAIL'))
console.log('clipboard after click:', clip)
console.log('became Copied:', await page.locator('button:has-text("Copied")').count() > 0)
await browser.close()
