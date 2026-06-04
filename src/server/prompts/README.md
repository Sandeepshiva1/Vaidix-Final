# Prompt loader — VAIDIX

Single source of truth for every LLM system prompt the app sends.

## Why this exists

Before this directory existed, every LLM-calling service had its system prompt
hardcoded as a string in the `.ts` file. That meant:

- Two places to update when iterating on prompt language (the markdown design
  doc + the TS file) — they drifted.
- No way to support a new vertical (cardiology, dentistry, surgery) without
  rewriting all 22 prompts.
- No central place to declare which model + token budget each prompt expects.

This directory fixes those:

- **Single source:** every prompt lives in `_base/<id>.md`.
- **Multi-domain:** every prompt uses `{{PLACEHOLDER}}` substitution. Domain
  values live in `_domains/<domain>.ts`. Adding a new domain = one TS file,
  no prompt edits.
- **Self-describing:** each `.md` declares its target model + token budget +
  required placeholders.

## Layout

```
src/server/prompts/
├── _base/                    # 22 templated .md prompts
│   ├── 4.1.1.md              # Presentation Coach
│   ├── 4.1.2.md              # Promo Designer
│   ├── ...
│   └── 6.1.8.md              # Competency Dashboard
├── _domains/                 # Domain configs (TS for type safety)
│   ├── index.ts              # Registry + flattenDomainForInterpolation()
│   ├── ophthalmology.ts      # Today's only domain
│   └── (cardiology.ts, …)    # Tomorrow's domains
├── loader.ts                 # loadPrompt(id, { domain }) → LoadedPrompt
├── interpolate.ts            # {{PLACEHOLDER}} substitution
├── types.ts                  # DomainConfig, LoadedPrompt, etc.
└── README.md                 # This file
```

## Usage

```ts
import { loadPrompt } from '@/server/prompts/loader';

const prompt = await loadPrompt('6.1.4');             // default domain
// or
const prompt = await loadPrompt('6.1.4', { domain: 'cardiology' });

// prompt.text         → fully interpolated system prompt
// prompt.targetModel  → 'opus' | 'sonnet' | 'gemini' | 'auto'
// prompt.tokenBudget  → number (hint)
// prompt.expectsJson  → boolean
// prompt.placeholdersUsed → string[]  (audit which placeholders were substituted)
```

Then send through the central AI router:

```ts
import { aiReviewJson } from '@/server/services/ai/router';

const result = await aiReviewJson(prompt.text, userMessage, {
  maxTokens: prompt.tokenBudget,
});
```

## Adding a new domain (e.g. cardiology)

**1. Create the domain config**

```ts
// src/server/prompts/_domains/cardiology.ts
import type { DomainConfig } from '../types';

export const cardiology: DomainConfig = {
  id: 'cardiology',
  name: 'cardiology',
  nameTitle: 'Cardiology',
  nameUpper: 'CARDIOLOGY',
  adjective: 'cardiac',

  subspecialties: [
    'electrophysiology',
    'interventional',
    'heart_failure',
    'imaging',
    'preventive',
    'pediatric_cardiology',
    'general_cardiology',
  ],

  criticalConditions: [
    'STEMI',
    'Cardiogenic shock',
    'Acute aortic dissection',
    'Massive pulmonary embolism',
    'Sustained VT / VF',
    'Acute decompensated heart failure',
    'Cardiac tamponade',
  ],

  imagingModalities: [
    { name: 'ECG', code: 'ecg', readingPattern: 'Rate · rhythm · axis · intervals · waves · ST/T' },
    { name: 'Transthoracic echo', code: 'tte', readingPattern: 'Chambers · valves · function · pericardium' },
    // ...
  ],

  exampleVignette: 'A 58-year-old presents with crushing substernal chest pain radiating to the jaw, started 45 minutes ago...',
  examplePearl: 'Crescendo angina with new ECG changes is unstable until proven otherwise.',
  redFlagExamples: [
    'New left bundle branch block + chest pain → treat as STEMI',
    'Sinus tachycardia + hypoxia + clear lungs → think PE',
    // ...
  ],
  fellowTierExample: 'In a patient with cardiogenic shock post-MI, what hemodynamic profile would tip you from inotropic support to mechanical circulatory support, and which device first?',

  learnerRoles: ['resident', 'fellow', 'cardiology_nurse', 'echo_tech'],

  domainPedagogyNote: 'Cardiology education depends on integrating pattern recognition (ECG, echo) with hemodynamics in real time. Time-to-treatment determines outcome in most acute scenarios.',

  educationalDisclaimer: 'This content is for educational use by cardiology trainees. It is not a substitute for current clinical guidelines or attending judgment.',
};
```

**2. Register it**

```ts
// src/server/prompts/_domains/index.ts
import { cardiology } from './cardiology';

const DOMAINS: Record<string, DomainConfig> = {
  ophthalmology,
  cardiology,                    // ← add
};
```

**3. That's it.** All 22 prompts now work for cardiology. No prompt edits.

## When a prompt needs a NEW placeholder

If you're authoring a prompt and need a value that isn't in the current
`DomainConfig` shape (e.g. `{{DOMAIN_TYPICAL_DRUG_CLASSES}}`):

1. Add the field to `DomainConfig` in `types.ts`.
2. Add the field to `flattenDomainForInterpolation()` in `_domains/index.ts`.
3. Add the value to every existing `_domains/*.ts` (TypeScript will fail the
   build until you do — that's the point).
4. Use `{{DOMAIN_TYPICAL_DRUG_CLASSES}}` in the prompt.

This keeps domain configs in lockstep with the prompts that consume them.

## When the loader fails

The loader throws specific errors:

- `PromptNotFoundError` — `_base/<id>.md` doesn't exist
- `PromptParseError` — `.md` file is missing the `## Prompt` header or fenced
  text block
- `PromptInterpolationError` — prompt uses a `{{PLACEHOLDER}}` the domain
  doesn't provide. Error message lists the missing placeholders.

Treat all three as build-time bugs, not runtime errors. Add a smoke test
that calls `loadPrompt(id)` for every prompt + every domain in CI.

## Cache

`loadPrompt()` caches the parsed + interpolated result in memory keyed by
`(id, domain)`. Pass `{ noCache: true }` to bypass during dev iteration.
Call `clearPromptCache()` to wipe everything.

## Adding a new prompt

1. Drop the templated `.md` into `_base/<id>.md` following the existing
   structure: H1 title, "**Target model:** … · Token budget: …" line, a
   "## Domain placeholders required" section, then "## Prompt" with a fenced
   block.
2. **Fence convention:** wrap the prompt body in **4 backticks** so it can
   contain inner 3-backtick code blocks (json, text, etc.) naturally:

   ````markdown
   ## Prompt

   ```` `text
   ROLE
   You are a {{DOMAIN_NAME}} educator.

   OUTPUT JSON SCHEMA:
   ` ```json
   { "field": "value" }
   ` ```

   ...
   ```` `
   ````

   (3-backtick outer fences also work for prompts with no nested blocks.)
3. Use `{{DOMAIN_*}}` placeholders for any domain-specific content. Keep the
   structure (role, philosophy, output format, JSON schema) domain-agnostic.
4. Run the smoke test (see "When the loader fails" above) to verify every
   placeholder you used has a matching field in every domain config.
