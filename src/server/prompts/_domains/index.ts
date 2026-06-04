import type { DomainConfig } from '../types';
import { ophthalmology } from './ophthalmology';

/**
 * Registry of all available domains.
 *
 * To add a new domain (e.g., cardiology):
 * 1. Create _domains/cardiology.ts exporting `const cardiology: DomainConfig`
 * 2. Import + add to the map below
 * 3. Done. Every prompt now works for cardiology — no prompt rewrites.
 */
const DOMAINS: Record<string, DomainConfig> = {
  ophthalmology,
};

export const AVAILABLE_DOMAINS = Object.keys(DOMAINS);

export const DEFAULT_DOMAIN =
  (typeof process !== 'undefined' && process.env?.VAIDIX_DEFAULT_DOMAIN) ||
  'ophthalmology';

export function getDomain(domainId: string): DomainConfig {
  const cfg = DOMAINS[domainId];
  if (!cfg) {
    throw new Error(
      `Unknown domain: "${domainId}". Available: ${AVAILABLE_DOMAINS.join(', ')}. ` +
        `Add a new domain by creating src/server/prompts/_domains/${domainId}.ts and registering it in _domains/index.ts.`,
    );
  }
  return cfg;
}

/**
 * Expand a DomainConfig into a flat key→string record for placeholder
 * substitution. This is where we materialize the auto-derived bullet lists,
 * tables, etc. from the structured arrays in the config.
 */
export function flattenDomainForInterpolation(d: DomainConfig): Record<string, string> {
  const subspecialtiesBullets =
    d.subspecialtiesBullets ?? d.subspecialties.map((s) => `- ${s}`).join('\n');

  const criticalConditionsBullets =
    d.criticalConditionsBullets ?? d.criticalConditions.map((c) => `- ${c}`).join('\n');

  const imagingModalitiesTable =
    d.imagingModalitiesTable ??
    [
      '| Modality | Code | Reading pattern |',
      '|---|---|---|',
      ...d.imagingModalities.map((m) => `| ${m.name} | \`${m.code}\` | ${m.readingPattern} |`),
    ].join('\n');

  const learnerRolesBullets =
    d.learnerRolesBullets ?? d.learnerRoles.map((r) => `- ${r}`).join('\n');

  const redFlagExamplesBullets = d.redFlagExamples.map((r) => `- ${r}`).join('\n');

  const curriculumTagsBullets = (d.curriculumTagFormats ?? [])
    .map((c) => `- ${c}`)
    .join('\n');

  return {
    DOMAIN_NAME: d.name,
    DOMAIN_NAME_TITLE: d.nameTitle,
    DOMAIN_NAME_UPPER: d.nameUpper,
    DOMAIN_ADJECTIVE: d.adjective,
    DOMAIN_SUBSPECIALTIES: subspecialtiesBullets,
    DOMAIN_SUBSPECIALTIES_INLINE: d.subspecialties.map((s) => `\`${s}\``).join(' · '),
    DOMAIN_CRITICAL_CONDITIONS: criticalConditionsBullets,
    DOMAIN_IMAGING_MODALITIES: imagingModalitiesTable,
    DOMAIN_LEARNER_ROLES: learnerRolesBullets,
    DOMAIN_LEARNER_ROLES_INLINE: d.learnerRoles.join(' / '),
    DOMAIN_EXAMPLE_VIGNETTE: d.exampleVignette,
    DOMAIN_EXAMPLE_PEARL: d.examplePearl,
    DOMAIN_RED_FLAG_EXAMPLES: redFlagExamplesBullets,
    DOMAIN_FELLOW_TIER_EXAMPLE: d.fellowTierExample,
    DOMAIN_CURRICULUM_TAGS: curriculumTagsBullets,
    DOMAIN_PEDAGOGY_NOTE: d.domainPedagogyNote,
    DOMAIN_DISCLAIMER: d.educationalDisclaimer,
    DOMAIN_COMMON_CONDITIONS: d.commonConditions.map((c) => `- ${c}`).join('\n'),
    DOMAIN_COMMON_CONDITIONS_INLINE: d.commonConditions.join(', '),
    DOMAIN_STAKES_PHRASE: d.stakesPhrase,
    DOMAIN_PATIENT_FEARS: d.patientFears.map((f) => `- ${f}`).join('\n'),
    DOMAIN_PATIENT_FEARS_INLINE: d.patientFears.join(', '),
    DOMAIN_PROCEDURE_EXAMPLES: d.procedureExamples.map((p) => `- ${p}`).join('\n'),
    DOMAIN_PROCEDURE_EXAMPLES_INLINE: d.procedureExamples.join(', '),
    DOMAIN_DRUG_EXAMPLES: d.drugExamples.map((dr) => `- ${dr}`).join('\n'),
    DOMAIN_DRUG_EXAMPLES_INLINE: d.drugExamples.join(', '),
    DOMAIN_ANATOMY_FOCUS: d.anatomyFocus.map((a) => `- ${a}`).join('\n'),
    DOMAIN_ANATOMY_FOCUS_INLINE: d.anatomyFocus.join(', '),
    DOMAIN_DIFFICULT_CONVERSATIONS: d.difficultConversations.map((c) => `- ${c}`).join('\n'),
    DOMAIN_DIFFICULT_CONVERSATIONS_INLINE: d.difficultConversations.join('; '),
    DOMAIN_PRACTICE_SETTINGS: d.practiceSettings.map((s) => `- ${s}`).join('\n'),
    DOMAIN_PRACTICE_SETTINGS_INLINE: d.practiceSettings.join(', '),
    DOMAIN_BOARD_EXAM_NAMES: d.boardExamNames.join(', '),
    DOMAIN_HOOK_OPENERS: d.hookOpeners.map((h) => `- "${h}"`).join('\n'),
    DOMAIN_EXAMPLE_WHATSAPP_PEARL: d.exampleWhatsAppPearl,
    DOMAIN_EXAMPLE_REEL_HOOK: d.exampleReelHook,
    DOMAIN_EXAMPLE_TEACHBACK_TOPIC: d.exampleTeachBackTopic,
  };
}
