/**
 * VAIDIX GEMINI GRADER — Multi-Dimensional Answer Scoring
 *
 * Receives a learner answer + the item context (scenario, prompt, audience,
 * rubric, axes scored), calls Gemini with a careful clinical-grading prompt,
 * and returns scores for each axis on the 0-100 scale plus optional follow-up
 * suggestion when the answer is too vague to score confidently.
 *
 * The pattern is adapted from HIMS hedt route, but the SYSTEM_PROMPT is
 * Vaidix-specific: it grades against the published 6-axis Triple-H+ rubric
 * and is explicitly told NOT to be lenient.
 *
 * Failure mode: if Gemini is unreachable or returns unparseable output,
 * the route returns a 503 and the client falls back to the rule-based
 * heuristic. The capture system records the disagreement.
 */

import { NextRequest, NextResponse } from 'next/server'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const SYSTEM_PROMPT = `You are a senior ophthalmology consultant at LV Prasad Eye Institute. You are scoring a resident's answer to a clinical learning case as if you were grading them on rounds.

You are NOT a clinical co-author. You are a SCORER and a TEACHER.

ABSOLUTE RULES — DO NOT VIOLATE:
1. Take the resident's answer EXACTLY as written. Do not infer what they meant. Do not complete their sentence. Do not give credit for what they "probably know."
2. Never rewrite or paraphrase the answer. Score what is there.
3. Be strict: most resident answers should score in the 40-75 range. Scores above 80 require genuine excellence, not just "they got the gist."
4. If they only named the disease without explaining mechanism, that is NOT solid reasoning even if they named it correctly.
5. If they used technical jargon to a patient family, that is a communication failure no matter how technically correct it is.

THE 6 AXES (score 0-100):
1. knowledge — factually correct, names the right entity, drug, mechanism?
2. reasoning — explains the WHY, mechanism, first principles, not just naming?
3. communication — language matched to the audience? jargon-free with patients, precise with peers, compressed with seniors?
4. empathy — patient-centered language, acknowledges fear and emotion explicitly?
5. relevance — only what matters, signal vs noise, appropriate length for the audience?
6. safety — surfaces red flags, avoids harm, recognises urgency?

Only score axes the item declares it tests. Set other axes to null.

AUDIENCE-SPECIFIC PENALTIES:
- patient_family: any technical jargon ("CNV", "VEGF", "necrosis", "vitritis", "hypopyon", "PCR", "RPE") MUST drop communication and empathy scores
- peer: just naming the disease without mechanism MUST drop reasoning scores below 60
- senior: rambling beyond 100 words MUST drop relevance scores

THE VERDICT — pick exactly ONE:
- "vague": answer is too short, generic, off-topic, or missing the requested element. Cannot be scored fairly.
- "shallow": answer is correct as far as it goes, but only partially complete. There is room to push deeper or wider on the SAME concept without changing topic.
- "solid": answer is complete enough at this difficulty. Score it and let the test move on.

WHEN TO GENERATE A FOLLOW-UP:

If verdict is "vague":
  followUpType = "clarification"
  followUpQuestion = a short question that asks them to be specific. Do NOT ask a different question. Ask them to elaborate the SAME answer.

If verdict is "shallow":
  followUpType = "escalation"
  followUpQuestion = a question that ADDS NEW CONSTRAINT or NEW DATA to the same scenario, forcing the resident to apply the same knowledge in a more demanding context. Examples:
    - "Now imagine this patient is also on aspirin for a stent. Does that change anything?"
    - "What two findings on FFA would make you reconsider PCV instead of typical wet AMD?"
    - "You see subretinal fluid and a notched PED. What does the notch tell you?"
  NEVER generate an escalation that:
    - introduces a completely different disease
    - asks about something the rubric does not test
    - requires knowledge outside the topic

If verdict is "solid":
  followUpType = null
  followUpQuestion = null

OUTPUT STRICT JSON with this EXACT shape (no markdown, no commentary):

{
  "verdict": "vague" | "shallow" | "solid",
  "followUpType": "clarification" | "escalation" | null,
  "followUpQuestion": "..." | null,
  "axisScores": {
    "knowledge": 70,
    "reasoning": 60,
    "communication": null,
    "empathy": null,
    "relevance": 65,
    "safety": null
  },
  "shortFeedback": "One sentence describing the dominant strength or weakness as a teacher would say it."
}

Final reminder: you score what is on the page. Never score what you imagine they meant.`

interface GradeRequest {
  audience?: 'patient_family' | 'peer' | 'senior'
  scenario: string
  prompt: string
  axesScored: string[]
  rubric: { good: string[]; poor: string[] }
  modelAnswer?: string
  learnerAnswer: string
  isFollowUp?: boolean
  previousAnswer?: string
}

export async function POST(req: NextRequest) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'AI grading is not configured on this environment', fallback: true },
        { status: 503 }
      )
    }

    const body = (await req.json()) as GradeRequest

    if (!body.learnerAnswer?.trim()) {
      return NextResponse.json({ error: 'No answer provided' }, { status: 400 })
    }

    const userPrompt = `
ITEM CONTEXT
============
Audience: ${body.audience ?? 'unspecified'}
Axes to score: ${body.axesScored.join(', ')}

Scenario:
${body.scenario}

Prompt to learner:
${body.prompt}

Rubric:
- Good answers contain ideas like: ${body.rubric.good.join('; ')}
- Poor answers contain ideas like: ${body.rubric.poor.join('; ')}
${body.modelAnswer ? `\nReference model answer:\n${body.modelAnswer}\n` : ''}

${body.isFollowUp && body.previousAnswer ? `PRIOR TURN
============
The learner's first answer was:
"""
${body.previousAnswer}
"""

You asked them a clarifying follow-up. Their second answer is below.
Score BOTH turns together as a single response.
` : ''}

LEARNER ANSWER
==============
${body.learnerAnswer}

Now score this answer following the rules in your system instruction. Output strict JSON only.
`

    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      // Upstream payload (errBody) stays in server logs only — never the wire.
      console.error('[grade] upstream failure', response.status, errBody)
      return NextResponse.json(
        { error: 'AI grading is temporarily unavailable. Please try again.', fallback: true },
        { status: 502 }
      )
    }

    const data = await response.json()
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''

    let parsed: {
      verdict?: 'vague' | 'shallow' | 'solid'
      followUpType?: 'clarification' | 'escalation' | null
      followUpQuestion?: string | null
      axisScores?: Record<string, number | null>
      shortFeedback?: string
    }
    try {
      parsed = JSON.parse(rawText)
    } catch {
      const m = rawText.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (m) {
        parsed = JSON.parse(m[1].trim())
      } else {
        console.error('[grade] unparseable upstream response', rawText)
        return NextResponse.json(
          { error: 'AI grading returned an unexpected response. Please try again.', fallback: true },
          { status: 502 }
        )
      }
    }

    // Sanitise: only return axes the item asked for, clamp 0-100
    const cleanScores: Record<string, number> = {}
    for (const axis of body.axesScored) {
      const v = parsed.axisScores?.[axis]
      if (typeof v === 'number') {
        cleanScores[axis] = Math.max(0, Math.min(100, Math.round(v)))
      }
    }

    const verdict = parsed.verdict ?? 'solid'
    // overallVerdict for backward compat with the existing client helper
    const legacyOverall: 'strong' | 'borderline' | 'weak' =
      verdict === 'solid' ? 'strong' : verdict === 'shallow' ? 'borderline' : 'weak'

    return NextResponse.json({
      verdict,
      followUpType: parsed.followUpType ?? null,
      followUpQuestion: parsed.followUpQuestion ?? null,
      needsFollowUp: verdict !== 'solid',
      axisScores: cleanScores,
      overallVerdict: legacyOverall,
      shortFeedback: parsed.shortFeedback ?? '',
    })
  } catch (err) {
    console.error('[Gemini Grade] Exception:', err)
    return NextResponse.json(
      { error: 'Internal grading error', fallback: true },
      { status: 500 }
    )
  }
}
