// ════════════════════════════════════════════════════════════════════════════
// Mentor Response (Gemini-backed)
// ════════════════════════════════════════════════════════════════════════════
// Generates the next message in a case conversation. The mentor follows the
// 5-stage Socratic dialogue (Patient Story → Observation → Hypothesis →
// Investigation → Reflection). Output is a SHORT message (≤120 words) keeping
// the Oslerian tone of "difficult but fair senior doctor" — no fluff.
//
// A future iteration will replace this with the same call shape backed by Vaidix Core +
// RAG retrieval. Caller (cases-service.sendMessage) treats this as a plain
// async function: { role, content }.

import {
  geminiGenerate,
  tryParseJson,
} from '@/server/services/ai/gemini';
import { CaseStage } from '@prisma/client';

export interface ConversationMessage {
  role: 'PATIENT' | 'AI' | 'RESIDENT' | 'FACULTY';
  content: string;
}

export interface MentorResponseInput {
  /** Selected fields from CaseTemplate. Null is tolerated — the model has
   *  enough context from the conversation history alone. */
  template:
    | {
        title: string;
        condition: string;
        patientName: string;
        patientAgeYears: number;
        patientSex: string;
        description: string;
        oslerianPrinciples: string[];
        bloomsLevel: number;
      }
    | null;
  stageBefore: CaseStage;
  stageAfter: CaseStage;
  history: ConversationMessage[];
}

export interface MentorResponseResult {
  role: 'AI' | 'PATIENT';
  content: string;
}

const SYSTEM_INSTRUCTION = [
  'You are a senior ophthalmology faculty member running a Socratic teaching session with a resident.',
  'Style: difficult but fair. Brief praise when warranted; direct correction when wrong. Never fluffy.',
  'Stage progression follows William Osler\'s clinical method:',
  '  PATIENT_STORY → OBSERVATION → HYPOTHESIS → INVESTIGATION → REFLECTION → COMPLETED.',
  'You will receive the new stage you must drive the resident into.',
  'If the new stage is REFLECTION, ask the resident to step back and articulate what they learned.',
  'If COMPLETED, give a 1-line summary of the key teaching point and close the case.',
  'Output STRICT JSON: { "role": "AI"|"PATIENT", "content": "..." }. Use "PATIENT" only when the resident has just asked the patient something directly and a patient voice is the most natural reply.',
  'Keep content ≤ 120 words. No markdown. Indian clinical context where relevant (LVPEI patient names, conditions, drugs).',
].join('\n');

interface RawResponse {
  role?: string;
  content?: string;
}

export async function generateMentorResponse(
  input: MentorResponseInput
): Promise<MentorResponseResult> {
  const transcript = input.history
    .slice(-20) // bounded — mentor doesn't need more than the last ~20 turns
    .map((m) => `[${m.role}] ${m.content}`)
    .join('\n');

  const prompt = [
    input.template
      ? [
          'CASE CONTEXT:',
          `Title: ${input.template.title}`,
          `Condition: ${input.template.condition}`,
          `Patient: ${input.template.patientName}, ${input.template.patientAgeYears}y, ${input.template.patientSex}`,
          `Synopsis: ${input.template.description}`,
          input.template.oslerianPrinciples.length > 0
            ? `Oslerian principles: ${input.template.oslerianPrinciples.join(', ')}`
            : '',
          `Bloom's level: ${input.template.bloomsLevel}`,
        ]
          .filter(Boolean)
          .join('\n')
      : '',
    '',
    'CONVERSATION SO FAR:',
    transcript,
    '',
    `STAGE BEFORE: ${input.stageBefore}`,
    `STAGE AFTER (drive the conversation here): ${input.stageAfter}`,
    '',
    'Produce the next mentor or patient message as JSON.',
  ]
    .filter(Boolean)
    .join('\n');

  const raw = await geminiGenerate({
    systemInstruction: SYSTEM_INSTRUCTION,
    userParts: [{ text: prompt }],
    responseMimeType: 'application/json',
    temperature: 0.4,
  });

  const parsed = tryParseJson<RawResponse>(raw);
  const role: MentorResponseResult['role'] = parsed.role === 'PATIENT' ? 'PATIENT' : 'AI';
  const content = (parsed.content ?? '').trim();
  if (!content) {
    throw new Error('Empty mentor response from Gemini');
  }
  return { role, content: content.slice(0, 1200) };
}
