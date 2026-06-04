// ════════════════════════════════════════════════════════════════════════════
// Prompt loader smoke — proves every prompt × every domain parses + interpolates
// ════════════════════════════════════════════════════════════════════════════
// Run:
//   tsx --env-file=.env.local --env-file=.env scripts/smoke-prompts.ts
//
// What this proves:
//   - Every `_base/*.md` file the loader can find has a valid `## Prompt`
//     section with a closed fenced block (PromptParseError catches drift).
//   - Every {{PLACEHOLDER}} a prompt uses is provided by every registered
//     domain (PromptInterpolationError catches drift the other way).
//   - The target-model + token-budget metadata header parses cleanly.
//
// This is the CI gate the README §"When the loader fails" promised:
//   > Add a smoke test that calls loadPrompt(id) for every prompt + every
//   > domain in CI.
//
// Exit code: 0 on full green, 1 on any failure. Output is one line per
// (id, domain) pair so CI failures land on a discrete line.
// ════════════════════════════════════════════════════════════════════════════

import {
  loadPrompt,
  listPromptIds,
  PromptNotFoundError,
  PromptParseError,
  PromptInterpolationError,
} from '@/server/prompts/loader';
import { AVAILABLE_DOMAINS } from '@/server/prompts/_domains';

async function run(): Promise<void> {
  const ids = await listPromptIds();
  const domains = AVAILABLE_DOMAINS;
  if (ids.length === 0) {
    console.error('FAIL: no prompts found in _base/');
    process.exit(1);
  }
  if (domains.length === 0) {
    console.error('FAIL: no domains registered');
    process.exit(1);
  }

  console.log(`Smoking ${ids.length} prompts × ${domains.length} domain(s) = ${ids.length * domains.length} cases\n`);

  let passed = 0;
  let failed = 0;

  for (const id of ids) {
    for (const domain of domains) {
      try {
        const prompt = await loadPrompt(id, { domain, noCache: true });
        const placeholdersResolved = prompt.placeholdersUsed.length;
        const textLen = prompt.text.length;
        console.log(
          `  ✓ ${id.padEnd(14)} × ${domain.padEnd(14)}  model=${prompt.targetModel.padEnd(8)} budget=${String(prompt.tokenBudget).padStart(6)}  placeholders=${placeholdersResolved}  ${textLen}B`,
        );
        passed++;
      } catch (e) {
        let kind = 'UNKNOWN';
        if (e instanceof PromptNotFoundError) kind = 'NOT_FOUND';
        else if (e instanceof PromptParseError) kind = 'PARSE_ERROR';
        else if (e instanceof PromptInterpolationError) kind = 'PLACEHOLDER_DRIFT';
        console.error(
          `  ✗ ${id.padEnd(14)} × ${domain.padEnd(14)}  ${kind}  ${e instanceof Error ? e.message : String(e)}`,
        );
        failed++;
      }
    }
  }

  console.log('');
  if (failed === 0) {
    console.log(`Prompt smoke — PASS (${passed} / ${passed} cases)`);
    process.exit(0);
  } else {
    console.error(`Prompt smoke — FAIL (${failed} of ${passed + failed} failed)`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Smoke crashed:', err);
  process.exit(1);
});
