// ════════════════════════════════════════════════════════════════════════════
// Blueprint Service — Phase A
// ════════════════════════════════════════════════════════════════════════════
// Generates a Precision Ophthalmology Education Blueprint for a topic — a
// curriculum/instructional-design plan, NOT slide content. Faculty use this
// when designing a new module from scratch and want the pedagogic scaffold
// (learner profile / VARK adaptation / theory / tactics / feedback / OSCE)
// before they author slides or wet-lab sessions.

import { db } from '@/lib/db';
import {
  geminiGenerate,
  GeminiUnavailableError,
  GeminiUnparseableError,
} from '@/server/services/ai/gemini';
import { env } from '@/lib/env';

const SYSTEM_PROMPT = `You are an expert Ophthalmology Medical Educator, Curriculum Designer, and Instructional Strategist at LV Prasad Eye Institute. For the topic provided, generate a Precision Education Blueprint tailored to the learner, content, and clinical context. Your response must be specific to ophthalmology, practical for postgraduate / fellowship-level teaching, and free of generic educational filler.

AUDIENCE INPUTS — when the user provides them, treat them as HARD constraints, not suggestions:
- Session length (minutes): allocate tactic time and faculty hours so they sum to roughly this duration. Do not propose a 90-minute wet-lab if the session is 45 minutes.
- Clinical setting (OPD / OT / wet-lab / emergency / retina clinic / simulation lab / etc.): anchor every tactic to this setting. A "wet-lab" blueprint must include hands-on microsurgical or model-eye drills; an "OPD" blueprint leans on live patient encounters and slit-lamp teaching.
- Prior knowledge assumed: do NOT re-teach what the faculty has stated learners already know. Pitch the blueprint one rung above this baseline.
- Constraints / available resources: if the faculty has declared a piece of equipment unavailable (e.g. "no Heidelberg Spectralis", "single shared OCT"), DO NOT recommend tactics or assessments that require it. Substitute with what is available and call out the substitution in Faculty/Resource Needs.

OUTPUT FORMAT — markdown only, no JSON, no preamble. Use these headings IN THIS ORDER:

# Topic/Module
# Target Learner
# Prior Knowledge Assumed
# Clinical Context
# Learning Style Adaptation
# Required Learning Attributes
# Best-Fit Learning Theory
# Instructional Tactics
# Feedback Loop
# Competency Assessment
# Mastery Indicators
# Common Learner Errors
# Faculty/Resource Needs
# Additional Instruction

CONTENT RULES
- Anchor every recommendation to the specific topic — never give generic educational advice. Where relevant, name ophthalmic tools and contexts: slit-lamp, fundoscopy, OCT, FFA, ICGA, ultrasonography (A/B-scan, UBM), lasers (PRP, YAG, SLT), wet-lab, microsurgery, counseling, interdisciplinary care.
- Target Learner: state intern / PGY-1 / PGY-2 / senior resident / fellow / optometrist / practicing ophthalmologist explicitly. Include prior knowledge expected and the clinical setting (OPD, emergency, OT, retina clinic, uveitis service, pediatric clinic, simulation lab).
- Learning Style Adaptation: list four bullets V / A / R / K — each with topic-specific examples (e.g. "V: serial OCT cube comparison of NPDR → severe NPDR → DME"; not "use visuals").
- Required Learning Attributes: only the attributes truly needed for mastery. Cognitive (pattern recognition, Bayesian reasoning, risk stratification), psychomotor (microsurgical hand-eye, 3D anatomical mapping), affective (counseling under uncertainty, breaking bad news re: vision loss). Skip irrelevant ones.
- Best-Fit Learning Theory: pick ONE primary theory plus an optional secondary support theory from {Cognitive Load Theory, Deliberate Practice, Experiential Learning, Situated Learning, Social Constructivism, Mastery Learning, Retrieval Practice, Dual Coding, Apprenticeship Model}. Justify in 1-2 sentences why it fits THIS topic, briefly note why other theories are less central.
- Instructional Tactics: 3-5 tactics, MULTIMODAL — must include at least one strong V, one A, one K tactic; optionally one R. Each tactic states (a) the activity, (b) why it suits THIS topic, (c) the learner level it best fits, (d) faculty / resources required.
- Feedback Loop: type (immediate corrective / coached / reflective debrief / delayed summative / peer / checklist), timing, who provides it, how delivered for max learning impact.
- Competency Assessment: name the specific tools (MCQs / SAQs / key-feature questions / OSCE / OSPE / DOPS / Mini-CEX / viva / image-based / surgical rubric / entrustment / case presentation). Cover knowledge, clinical reasoning, procedural skill (if relevant), and professional behavior (if relevant).
- Mastery Indicators: bullet list of "what counts as competent performance" — observable, behavior-anchored.
- Common Learner Errors: bullets of where residents most often go wrong on this topic.
- Faculty/Resource Needs: concrete equipment + faculty time (e.g. "Heidelberg Spectralis × 1, faculty 90 min, wet-lab pig eyes × 2/resident").
- Additional Instruction: any topic-specific caveats (regional disease pattern, scarcity of equipment, ethical issues, language considerations).

Be concise but sufficiently detailed — this is a working teaching document, not a textbook.`;

export class BlueprintError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface GenerateBlueprintInput {
  requestedById: string;
  topic: string;
  learnerLevel?: string;
  sessionLengthMinutes?: number;
  clinicalSetting?: string;
  priorKnowledgeAssumed?: string;
  constraints?: string;
}

export interface BlueprintRow {
  id: string;
  topic: string;
  learnerLevel: string | null;
  sessionLengthMinutes: number | null;
  clinicalSetting: string | null;
  priorKnowledgeAssumed: string | null;
  constraints: string | null;
  content: string;
  source: string;
  createdAt: Date;
}

const BLUEPRINT_SELECT = {
  id: true,
  topic: true,
  learnerLevel: true,
  sessionLengthMinutes: true,
  clinicalSetting: true,
  priorKnowledgeAssumed: true,
  constraints: true,
  content: true,
  source: true,
  createdAt: true,
} as const;

export async function generateBlueprint(input: GenerateBlueprintInput): Promise<BlueprintRow> {
  if (!env.GEMINI_API_KEY) {
    throw new BlueprintError('AI_UNAVAILABLE', 'GEMINI_API_KEY is not set');
  }
  const audienceLines: string[] = [`Topic/Module: ${input.topic}`];
  if (input.learnerLevel) audienceLines.push(`Intended learner: ${input.learnerLevel}`);
  if (input.sessionLengthMinutes)
    audienceLines.push(`Session length: ${input.sessionLengthMinutes} minutes (allocate tactic time so the total fits this budget)`);
  if (input.clinicalSetting)
    audienceLines.push(`Clinical setting: ${input.clinicalSetting} (anchor every tactic to this setting)`);
  if (input.priorKnowledgeAssumed)
    audienceLines.push(`Prior knowledge assumed: ${input.priorKnowledgeAssumed} (do not re-teach this)`);
  if (input.constraints)
    audienceLines.push(`Constraints / available resources: ${input.constraints} (do not recommend tactics that violate this)`);

  const userPrompt = `${audienceLines.join('\n')}

Generate the Precision Education Blueprint now.`;

  let content: string;
  try {
    content = await geminiGenerate({
      systemInstruction: SYSTEM_PROMPT,
      userParts: [{ text: userPrompt }],
      responseMimeType: 'text/plain',
      temperature: 0.4,
    });
  } catch (err) {
    if (err instanceof GeminiUnavailableError || err instanceof GeminiUnparseableError) {
      throw new BlueprintError('AI_UNAVAILABLE', err.message);
    }
    throw err;
  }

  const cleaned = content.trim();
  if (cleaned.length < 200) {
    throw new BlueprintError('EMPTY_OUTPUT', 'AI returned an empty or too-short blueprint');
  }

  const row = await db.blueprint.create({
    data: {
      requestedById: input.requestedById,
      topic: input.topic.trim().slice(0, 280),
      learnerLevel: input.learnerLevel?.trim().slice(0, 80) ?? null,
      sessionLengthMinutes: input.sessionLengthMinutes ?? null,
      clinicalSetting: input.clinicalSetting?.trim().slice(0, 400) ?? null,
      priorKnowledgeAssumed: input.priorKnowledgeAssumed?.trim().slice(0, 1000) ?? null,
      constraints: input.constraints?.trim().slice(0, 1000) ?? null,
      content: cleaned,
      // Persisted source label is provider-neutral. Concrete provider routing
      // lives in env config and logs — never in the DB or API surface.
      source: 'ai',
    },
    select: BLUEPRINT_SELECT,
  });
  return row;
}

export async function listBlueprintsForUser(userId: string): Promise<
  Array<Pick<BlueprintRow, 'id' | 'topic' | 'learnerLevel' | 'createdAt'>>
> {
  return db.blueprint.findMany({
    where: { requestedById: userId },
    select: { id: true, topic: true, learnerLevel: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

export async function getBlueprintForUser(
  blueprintId: string,
  userId: string,
): Promise<BlueprintRow | null> {
  const row = await db.blueprint.findUnique({
    where: { id: blueprintId },
    select: { ...BLUEPRINT_SELECT, requestedById: true },
  });
  if (!row || row.requestedById !== userId) return null;
  // strip the requestedById from the return shape
  const { requestedById: _omit, ...rest } = row;
  void _omit;
  return rest;
}

export async function deleteBlueprintForUser(
  blueprintId: string,
  userId: string,
): Promise<boolean> {
  const row = await db.blueprint.findUnique({
    where: { id: blueprintId },
    select: { requestedById: true },
  });
  if (!row || row.requestedById !== userId) return false;
  await db.blueprint.delete({ where: { id: blueprintId } });
  return true;
}
