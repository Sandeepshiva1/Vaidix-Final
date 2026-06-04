/**
 * VAIDIX REPORT COACH — Personalised "education consultant" report
 *
 * Takes the full session: answered items + their scores, plus the topic.
 * Returns a warm, plain-English narrative report:
 *
 *   - One-sentence punch line read of the resident
 *   - 1-3 strengths (named in plain English, no jargon)
 *   - 1-4 growth areas, each with a teaching arc:
 *       * punch line of the concept they need to grasp
 *       * paragraph that opens from their actual answer
 *       * plain-English explanation with analogy if natural
 *       * close: "next time you're seeing a patient like this..."
 *       * one concrete next action
 *
 * The prompt is STRICT: never use the words PREP, HHH, Triple-H, axis,
 * knowledge, reasoning, communication, empathy, relevance, safety,
 * or "better answer". Read like a senior on rounds, not a grading rubric.
 *
 * Falls back to a deterministic generic report if Gemini is unreachable.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/server/services/api-helpers'
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const SYSTEM_PROMPT = `You are a senior ophthalmology consultant at LV Prasad Eye Institute. A resident has just finished a multi-question clinical learning test on a topic. You are writing them a short, personal post-test debrief — the kind of conversation you'd have over chai after rounds.

YOUR TONE:
- Warm but honest. Like a respected senior, not a textbook.
- Address the resident by their first name (provided in the RESIDENT field of the user message). Example format: "Hey Dr. [FirstName]..." — always use the actual name, never a placeholder.
- Plain English. Indian clinical context.
- Never condescending. Never crushing. But never sugar-coating either.
- Read it aloud — does it sound like a real teacher? If not, rewrite.

ABSOLUTE FORBIDDEN VOCABULARY (never use these words anywhere in the output):
- PREP
- HHH
- Triple-H
- HEAD, HEART, HANDS (as labels)
- "axis", "axes"
- "knowledge", "reasoning", "communication", "empathy", "relevance", "safety" (as labels — you can use them in normal sentences but never as scoring categories)
- "score", "scoring", "rubric"
- "grey area"
- "Better answer would have been..."
- "Your answer was wrong"
- "You scored..."

INSTEAD, USE:
- "What you showed me", "What I noticed", "Where I saw you stumble"
- "The piece I'd want you to add..."
- "The next time you're seeing a patient like this..."

THE STRUCTURE:

1. greetingPunchLine — ONE warm sentence reading the resident.
   Example: "You're confident on diabetic retinopathy basics, but you stumbled when I asked you the why behind ischaemic CRVO turning into glaucoma."

2. masteryHeadline — ONE short phrase describing their overall position.
   Example: "Solid foundation, with one clear gap to close."

3. strengths — array of 1 to 3 short positive observations.
   Each: { area: short title, observation: one sentence }
   - Lead with strengths to protect morale.
   - Be specific. "You consistently picked up red flags in the diabetic cases" is better than "You did well."

4. growthAreas — array of 1 to 4 themed growth areas, IN PRIORITY ORDER (worst first).
   Each growth area is a teaching arc with the following shape:
   {
     "title": "The mechanism behind why ischaemic CRVO turns into glaucoma",
     "openingPunchLine": "One sentence naming the concept they need to grasp.",
     "acknowledgment": "Quote what they actually said and validate the part they got right.",
     "teaching": "2-4 short paragraphs of plain-English explanation, ideally with an analogy.",
     "futureFraming": "Start with 'The next time you're seeing a patient like this' or similar real-clinical phrasing. Tell them what to KEEP IN MIND with the next patient. NEVER frame as 'next time someone asks you'.",
     "nextAction": "One concrete thing: 'Read JAM Pearl 21 (5 min)' or 'Try the CRVO with NVG case' or 'Spend 10 minutes with the OCT atlas section on serous detachments'."
   }

5. closingNote — ONE warm sentence wrapping the conversation. Optional but ideal.

OUTPUT STRICT JSON with this EXACT shape (no markdown):

{
  "greetingPunchLine": "...",
  "masteryHeadline": "...",
  "strengths": [
    { "area": "...", "observation": "..." }
  ],
  "growthAreas": [
    {
      "title": "...",
      "openingPunchLine": "...",
      "acknowledgment": "...",
      "teaching": "...",
      "futureFraming": "...",
      "nextAction": "..."
    }
  ],
  "closingNote": "..."
}

REMEMBER: this is a coffee-after-rounds conversation, not a grade slip. Make them feel taught, not corrected.`

interface ReportItem {
  itemId: string
  subTopic: string
  prompt: string
  audience?: string
  learnerAnswer: string
  modelAnswer?: string
  axisScores: Record<string, number>
  isCorrect: boolean
}

interface ReportRequest {
  topicLabel: string
  residentName?: string
  items: ReportItem[]
}

// Deterministic fallback so the report always renders even without Gemini
function buildFallbackReport(req: ReportRequest) {
  const total = req.items.length
  const strong = req.items.filter((i) => i.isCorrect).length
  const weak = req.items.filter((i) => !i.isCorrect)
  const name = req.residentName || 'Doctor'

  return {
    greetingPunchLine: `${name}, you finished the ${req.topicLabel} session — ${strong} of ${total} answers were on track, and there's clearly room to push deeper.`,
    masteryHeadline:
      strong / total > 0.7
        ? 'Strong overall, with a few specific gaps worth closing.'
        : strong / total > 0.4
          ? 'Building well — let us close the gaps before the next test.'
          : 'There is real ground to cover. Spend a few sessions in Learn mode before retesting.',
    strengths:
      strong > 0
        ? [
            {
              area: 'You stayed in the right neighbourhood',
              observation: `On ${strong} of the questions you correctly identified the core problem. That clinical instinct is the right starting point.`,
            },
          ]
        : [],
    growthAreas: weak.slice(0, 3).map((item) => ({
      title: `Going deeper on ${item.subTopic}`,
      openingPunchLine: `There is more depth to add to your reasoning around ${item.subTopic}.`,
      acknowledgment: `When I asked you about this, you said: "${item.learnerAnswer.slice(0, 200)}". You were on the right path.`,
      teaching: `Take a moment to revisit the underlying mechanism and the typical trajectory of this condition. The piece worth adding is the chain of cause and effect — not just the diagnosis but why it behaves the way it does in front of the patient.`,
      futureFraming: `The next time you are seeing a patient with ${item.subTopic}, keep in mind that naming the condition is only the start. The senior will want you to walk them through the mechanism and the practical next step.`,
      nextAction: `Spend 10 minutes in the ${req.topicLabel} Refresh tab on this sub-topic, then take a related case in Learn mode.`,
    })),
    closingNote: 'Come back when you have spent a little time in Learn — the next test will feel different.',
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const rl = await checkRateLimit({ bucket: `report-coach:${auth.user.id}`, ...LIMITS.REPORT_COACH })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Report coach throttled — please try again later.', fallback: true },
        { status: 429 }
      )
    }

    const body = (await req.json()) as ReportRequest

    if (!body.items || body.items.length === 0) {
      return NextResponse.json({ error: 'No items provided' }, { status: 400 })
    }

    if (!GEMINI_API_KEY) {
      return NextResponse.json({ ...buildFallbackReport(body), source: 'fallback' })
    }

    const userPrompt = `
TOPIC: ${body.topicLabel}
RESIDENT NAME (use this name in your greeting, not any example name): ${body.residentName ?? 'Doctor'}
QUESTIONS ANSWERED: ${body.items.length}

For each question below, you have: the prompt, the audience the resident was speaking to, the learner's actual answer, and the score they received.

Use the LEARNER ANSWERS to ground your debrief. When you write a growth area, quote what the resident actually said where natural.

${body.items
  .map(
    (it, i) => `
[${i + 1}] Sub-topic: ${it.subTopic}
Audience: ${it.audience ?? 'unspecified'}
Prompt: ${it.prompt}
Learner answered: """${it.learnerAnswer}"""
Was this scored as solid? ${it.isCorrect ? 'yes' : 'no'}
Per-area scores: ${Object.entries(it.axisScores).map(([k, v]) => `${k}=${v}`).join(', ')}
${it.modelAnswer ? `Reference clinical answer (for your knowledge — do NOT quote this verbatim, write your own teaching in your own words): ${it.modelAnswer}` : ''}
`
  )
  .join('\n')}

Now write the debrief following the rules in your system instruction. Output strict JSON only.
`

    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
        },
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      console.error('[Gemini ReportCoach] Error:', response.status, errBody)
      return NextResponse.json({ ...buildFallbackReport(body), source: 'fallback' })
    }

    const data = await response.json()
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''

    let parsed: ReturnType<typeof buildFallbackReport>
    try {
      parsed = JSON.parse(rawText)
    } catch {
      const m = rawText.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (m) {
        parsed = JSON.parse(m[1].trim())
      } else {
        console.error('[Gemini ReportCoach] Unparseable:', rawText)
        return NextResponse.json({ ...buildFallbackReport(body), source: 'fallback' })
      }
    }

    return NextResponse.json({ ...parsed, source: 'ai' })
  } catch (err) {
    console.error('[ReportCoach] Exception:', err)
    return NextResponse.json({ error: 'Internal report error' }, { status: 500 })
  }
}
