/**
 * Types for the prompt loader + domain system.
 *
 * Adding a new domain (e.g. cardiology, dentistry):
 * 1. Create _domains/<domain>.ts exporting `const <domain>: DomainConfig = { ... }`
 * 2. Register it in _domains/index.ts
 * 3. Done. All 22 prompts automatically work for the new domain.
 */

export type TargetModel = 'opus' | 'sonnet' | 'gemini' | 'auto';

export interface PromptMetadata {
  /** Prompt ID, e.g. "6.1.4" — matches the .md filename */
  id: string;
  /** Title parsed from H1 of the .md file */
  title: string;
  /** Model the prompt declares for itself */
  targetModel: TargetModel;
  /** Approximate token budget hint */
  tokenBudget: number;
  /** Whether the prompt expects JSON output */
  expectsJson: boolean;
}

export interface LoadedPrompt extends PromptMetadata {
  /** The fully interpolated prompt text, ready to send to the model */
  text: string;
  /** Domain used for interpolation */
  domain: string;
  /** Set of placeholder names found in the raw prompt */
  placeholdersUsed: string[];
}

/**
 * One domain config = the variables that get substituted into prompt placeholders.
 *
 * Every {{PLACEHOLDER}} a prompt uses must have a corresponding field here.
 * If a prompt requires a placeholder a domain doesn't provide, loadPrompt() throws.
 */
export interface DomainConfig {
  /** Stable identifier, e.g. "ophthalmology" */
  id: string;

  // ---------- Naming ----------
  /** Lowercase noun, e.g. "ophthalmology" */
  name: string;
  /** Title-case, e.g. "Ophthalmology" */
  nameTitle: string;
  /** UPPERCASE, e.g. "OPHTHALMOLOGY" */
  nameUpper: string;
  /** Possessive adjective, e.g. "ophthalmic" / "cardiac" / "dental" */
  adjective: string;

  // ---------- Subspecialty / structure ----------
  /** Subspecialty taxonomy. Tag values used in unit metadata. */
  subspecialties: string[];
  /** Subspecialty taxonomy as a human-readable bullet list (auto-derived from `subspecialties` if not provided) */
  subspecialtiesBullets?: string;

  // ---------- Clinical content ----------
  /** Critical / sight-threatening / time-sensitive conditions. Auto-tagged urgency=critical. */
  criticalConditions: string[];
  /** Critical conditions as human-readable bullet list */
  criticalConditionsBullets?: string;

  /** Imaging or examination modalities used in this domain. Each: code + reading-pattern essentials */
  imagingModalities: Array<{ name: string; code: string; readingPattern: string }>;
  /** Imaging modalities as a markdown table */
  imagingModalitiesTable?: string;

  // ---------- Examples (for prompts that include worked examples) ----------
  /** Sample clinical vignette opening (1-3 sentences) */
  exampleVignette: string;
  /** Sample one-liner pearl */
  examplePearl: string;
  /** Sample red-flag findings (3-5 examples) */
  redFlagExamples: string[];
  /** Sample fellow-tier nuance question */
  fellowTierExample: string;
  /** Common conditions in this domain (used for "examples include X, Y, Z" lists) */
  commonConditions: string[];
  /** What's "at stake" in this domain — short phrase, e.g. "vision loss" / "cardiac arrest" / "tooth loss" */
  stakesPhrase: string;
  /** Typical patient fears in this domain, e.g. "going blind", "losing independence" */
  patientFears: string[];
  /** Procedures / techniques relevant to this domain — for pharm/proc-heavy prompts */
  procedureExamples: string[];
  /** Drug / pharmacology examples relevant to this domain */
  drugExamples: string[];
  /** Anatomy-focused terms — for prompts about visual diagnosis or anatomy */
  anatomyFocus: string[];
  /** Difficult conversations specific to this domain (for empathy / Heart prompts) */
  difficultConversations: string[];
  /** Typical practice settings (e.g. "outpatient clinic, OT, on-call, emergency, screening camp") */
  practiceSettings: string[];
  /** Board / exam names (e.g. "OKAP, FRCS, FRCOphth") */
  boardExamNames: string[];
  /** A few short clinical hook openers — used by attention-hook + reels prompts */
  hookOpeners: string[];
  /** Sample WhatsApp pearl text — used by 6.1.1 */
  exampleWhatsAppPearl: string;
  /** Sample reel/script idea — used by 6.1.2 */
  exampleReelHook: string;
  /** Sample teaching moment ("Explain X again") — used by 6.1.3 teaching bot */
  exampleTeachBackTopic: string;

  // ---------- Roles + audience ----------
  /** Learner roles relevant to this domain */
  learnerRoles: string[]; // e.g. ["resident", "fellow", "optometrist", "technician"]
  /** Learner roles as bullet list */
  learnerRolesBullets?: string;

  // ---------- Curriculum tags (optional) ----------
  /** Curriculum tag formats supported */
  curriculumTagFormats?: string[];

  // ---------- Domain-specific design rules ----------
  /** A 1-3 line statement of what's special about this domain's pedagogy */
  domainPedagogyNote: string;

  // ---------- Disclaimer text ----------
  /** Educational disclaimer used at end of generated content */
  educationalDisclaimer: string;
}

export interface PromptLoaderOptions {
  /** Domain to interpolate. Defaults to env.VAIDIX_DEFAULT_DOMAIN or "ophthalmology". */
  domain?: string;
  /** Bypass cache and re-read from disk. Useful in dev. */
  noCache?: boolean;
}
