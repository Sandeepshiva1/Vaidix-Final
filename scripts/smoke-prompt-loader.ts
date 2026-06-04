/**
 * Smoke test: load every prompt for every domain, fail if any error.
 *
 * Run: npx tsx scripts/smoke-prompt-loader.ts
 */

import { loadPrompt, listPromptIds, clearPromptCache } from '../src/server/prompts/loader';
import { AVAILABLE_DOMAINS } from '../src/server/prompts/_domains';

async function main() {
  console.log('=== prompt-loader smoke test ===\n');

  const ids = await listPromptIds();
  console.log(`Found ${ids.length} prompt(s) in _base/: ${ids.join(', ')}`);
  console.log(`Found ${AVAILABLE_DOMAINS.length} domain(s): ${AVAILABLE_DOMAINS.join(', ')}\n`);

  let failures = 0;
  let successes = 0;

  for (const id of ids) {
    for (const domain of AVAILABLE_DOMAINS) {
      try {
        clearPromptCache();
        const prompt = await loadPrompt(id, { domain });
        const placeholderCount = prompt.placeholdersUsed.length;
        const tokenLen = prompt.text.length;
        console.log(
          `✓ ${id} [${domain}] target=${prompt.targetModel} budget=${prompt.tokenBudget} ` +
            `placeholders=${placeholderCount} chars=${tokenLen} expectsJson=${prompt.expectsJson}`,
        );
        successes++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`✗ ${id} [${domain}] FAILED: ${msg}`);
        failures++;
      }
    }
  }

  console.log(`\n${successes} ok · ${failures} failed`);

  if (failures > 0) {
    process.exit(1);
  }

  // Sanity: print a slice of the interpolated 6.1.4 to eyeball
  if (ids.includes('6.1.4')) {
    console.log('\n--- 6.1.4 [ophthalmology] interpolated preview (first 1000 chars) ---');
    const p = await loadPrompt('6.1.4', { domain: 'ophthalmology' });
    console.log(p.text.slice(0, 1000));
    console.log('...\n');

    console.log('--- placeholders that were substituted ---');
    console.log(p.placeholdersUsed.join(', '));
  }
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
