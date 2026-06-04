/**
 * Prompt loader.
 *
 * Reads a templated .md file from _base/, parses metadata + the prompt body,
 * interpolates {{PLACEHOLDER}} values from the requested domain, and returns
 * a LoadedPrompt ready to send to an LLM.
 *
 * Usage:
 *   const prompt = await loadPrompt('6.1.4');
 *   const result = await callRouter(prompt.text, userMessage, {
 *     model: prompt.targetModel,
 *     maxTokens: prompt.tokenBudget,
 *   });
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  flattenDomainForInterpolation,
  getDomain,
  DEFAULT_DOMAIN,
} from './_domains';
import { interpolate, findPlaceholders } from './interpolate';
import type {
  LoadedPrompt,
  PromptLoaderOptions,
  PromptMetadata,
  TargetModel,
} from './types';

const PROMPTS_DIR = path.join(process.cwd(), 'src', 'server', 'prompts', '_base');

const cache = new Map<string, LoadedPrompt>();

export async function loadPrompt(
  id: string,
  options: PromptLoaderOptions = {},
): Promise<LoadedPrompt> {
  const domain = options.domain ?? DEFAULT_DOMAIN;
  const cacheKey = `${id}::${domain}`;

  if (!options.noCache) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const filePath = path.join(PROMPTS_DIR, `${id}.md`);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    throw new PromptNotFoundError(
      `Prompt "${id}" not found at ${filePath}. ` +
        `Add a templated .md file at src/server/prompts/_base/${id}.md.`,
      { promptId: id, attemptedPath: filePath, cause: err },
    );
  }

  const meta = parseMetadata(id, raw);
  const body = extractPromptBody(id, raw);

  const domainCfg = getDomain(domain);
  const values = flattenDomainForInterpolation(domainCfg);

  const interpolated = interpolate(body, values, { promptId: id, domain });

  const loaded: LoadedPrompt = {
    ...meta,
    text: interpolated.text,
    domain,
    placeholdersUsed: interpolated.placeholdersUsed,
  };

  cache.set(cacheKey, loaded);
  return loaded;
}

/**
 * Clear the in-memory cache. Useful in tests + dev hot-reload.
 */
export function clearPromptCache(): void {
  cache.clear();
}

/**
 * List all prompt IDs available in _base/. Useful for diagnostic UIs + tests.
 */
export async function listPromptIds(): Promise<string[]> {
  const files = await fs.readdir(PROMPTS_DIR);
  return files
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .sort();
}

// ---------- internal: parse .md structure ----------

function parseMetadata(id: string, raw: string): PromptMetadata {
  // H1 title — first line starting with "# "
  const titleMatch = raw.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : id;

  // Target model: line of form "**Target model:** Sonnet (...) · Token budget: ~5k per ..."
  // or with ranges: "~3–5k per case" / "~6–10k output"
  let targetModel: TargetModel = 'auto';
  let tokenBudget = 4000;
  const tmMatch = raw.match(/\*\*Target model:\*\*\s*([^\n·]+?)(?:\s*[·\-]\s*Token budget:\s*([^\n]+))?$/im);
  if (tmMatch) {
    const modelText = tmMatch[1].toLowerCase();
    if (modelText.includes('opus')) targetModel = 'opus';
    else if (modelText.includes('sonnet')) targetModel = 'sonnet';
    else if (modelText.includes('gemini')) targetModel = 'gemini';

    if (tmMatch[2]) {
      // Handle ranges ("~3–5k per case") + plain ("~1k per call") + suffixes (k/K/m/M).
      // Strategy: find every number-with-optional-unit, prefer the LAST one carrying a
      // k/K/m/M suffix (that's the upper bound of a range), else the last numeric.
      const allMatches = Array.from(
        tmMatch[2].matchAll(/(\d+(?:\.\d+)?)\s*([kKmM])?/g),
      );
      let chosen: RegExpMatchArray | undefined;
      for (let i = allMatches.length - 1; i >= 0; i--) {
        if (allMatches[i][2]) {
          chosen = allMatches[i];
          break;
        }
      }
      if (!chosen && allMatches.length > 0) chosen = allMatches[allMatches.length - 1];
      if (chosen) {
        const num = parseFloat(chosen[1]);
        const unit = (chosen[2] ?? '').toLowerCase();
        const mult = unit === 'k' ? 1000 : unit === 'm' ? 1_000_000 : 1;
        tokenBudget = Math.round(num * mult);
      }
    }
  }

  // Heuristic: prompt expects JSON if body contains "JSON" + a fenced ```json block or "JSON SCHEMA" etc.
  const expectsJson = /JSON SCHEMA|json output|emit (?:exactly )?this JSON|conforming.*?JSON/i.test(raw);

  return { id, title, targetModel, tokenBudget, expectsJson };
}

/**
 * Extract the prompt body from the .md file.
 *
 * Authors should wrap the prompt in a 4-backtick fence so the body can contain
 * inner 3-backtick code blocks (json, text, etc.) without confusing the parser:
 *
 *     ## Prompt
 *
 *     \`\`\`\`text
 *     ROLE
 *     ...
 *     \`\`\`json
 *     { "example": "json inside the prompt" }
 *     \`\`\`
 *     ...
 *     \`\`\`\`
 *
 * For backward compat we also accept a plain 3-backtick outer fence (the loader
 * just grabs everything to the FIRST closing 3-backtick) — that works for
 * prompts with no nested code blocks, and matches the legacy convention from
 * the POC.
 */
function extractPromptBody(id: string, raw: string): string {
  const promptHeaderIdx = raw.search(/^##\s+Prompt\s*$/m);
  if (promptHeaderIdx === -1) {
    throw new PromptParseError(
      `Prompt "${id}" has no "## Prompt" section. ` +
        `Templated prompts must contain a "## Prompt" header followed by a fenced code block.`,
      { promptId: id },
    );
  }

  const tail = raw.slice(promptHeaderIdx);

  // Try 4-backtick outer fence first (preferred — supports nested 3-backtick blocks)
  const fourMatch = tail.match(/````(?:text)?\n([\s\S]*?)\n````/);
  if (fourMatch) return fourMatch[1];

  // Fall back to 3-backtick outer fence (works only when prompt has no nested fences)
  const threeMatch = tail.match(/```(?:text)?\n([\s\S]*?)\n```/);
  if (threeMatch) return threeMatch[1];

  throw new PromptParseError(
    `Prompt "${id}" has a "## Prompt" section but no fenced code block. ` +
      `Wrap the prompt text in \`\`\`\`text\\n…\\n\`\`\`\` (4 backticks, allows nested code blocks) ` +
      `or \`\`\`text\\n…\\n\`\`\` (3 backticks, no nesting).`,
    { promptId: id },
  );
}

// ---------- errors ----------

export class PromptNotFoundError extends Error {
  readonly promptId: string;
  readonly attemptedPath: string;
  readonly cause?: unknown;
  constructor(
    message: string,
    info: { promptId: string; attemptedPath: string; cause?: unknown },
  ) {
    super(message);
    this.name = 'PromptNotFoundError';
    this.promptId = info.promptId;
    this.attemptedPath = info.attemptedPath;
    this.cause = info.cause;
  }
}

export class PromptParseError extends Error {
  readonly promptId: string;
  constructor(message: string, info: { promptId: string }) {
    super(message);
    this.name = 'PromptParseError';
    this.promptId = info.promptId;
  }
}

// re-export the interpolation error for callers
export { PromptInterpolationError } from './interpolate';
// re-export findPlaceholders so tooling/sync scripts can use it
export { findPlaceholders };
