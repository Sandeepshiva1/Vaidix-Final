/**
 * Placeholder substitution for prompts.
 *
 * Syntax: {{PLACEHOLDER_NAME}} in the prompt text → replaced by the
 * matching field from a values record.
 *
 * - PLACEHOLDER_NAME is uppercase + underscores by convention.
 * - If a placeholder appears in the text but has no value, throws — never
 *   silently leaves {{...}} in the output sent to the model.
 */

const PLACEHOLDER_RE = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

export interface InterpolateResult {
  text: string;
  placeholdersUsed: string[];
}

export function findPlaceholders(text: string): string[] {
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((match = PLACEHOLDER_RE.exec(text)) !== null) {
    seen.add(match[1]);
  }
  return Array.from(seen).sort();
}

export function interpolate(
  text: string,
  values: Record<string, string | undefined>,
  context: { promptId: string; domain: string },
): InterpolateResult {
  const used = findPlaceholders(text);
  const missing: string[] = [];

  for (const name of used) {
    const value = values[name];
    if (value === undefined || value === null) {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    throw new PromptInterpolationError(
      `Prompt "${context.promptId}" requires placeholders not provided by domain "${context.domain}": ${missing.join(', ')}. ` +
        `Add these fields to the domain config in src/server/prompts/_domains/${context.domain}.ts.`,
      { promptId: context.promptId, domain: context.domain, missing },
    );
  }

  const out = text.replace(PLACEHOLDER_RE, (_full, name: string) => {
    const v = values[name];
    return v === undefined ? '' : v;
  });

  return { text: out, placeholdersUsed: used };
}

export class PromptInterpolationError extends Error {
  readonly promptId: string;
  readonly domain: string;
  readonly missing: string[];
  constructor(
    message: string,
    info: { promptId: string; domain: string; missing: string[] },
  ) {
    super(message);
    this.name = 'PromptInterpolationError';
    this.promptId = info.promptId;
    this.domain = info.domain;
    this.missing = info.missing;
  }
}
