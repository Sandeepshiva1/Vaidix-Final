'use client'

import { useEffect, useRef, useState } from 'react'
import {
  BotMessageSquare,
  Check,
  ChevronRight,
  HelpCircle,
  Lightbulb,
  Send,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const BOT_CHAT_KEY = 'vaidix-bot-chat-v1'

interface CaseExample {
  title: string
  scenario: string
  insight: string
}

interface QuizItem {
  question: string
  options: string[]
  correct: number
  explanation: string
}

interface ReflectiveQs {
  questions: string[]
}

type MsgPhase = 'answer' | 'quiz-prompt' | 'quiz' | 'reflection' | 'done'

interface BotMsg {
  id: string
  role: 'user' | 'bot'
  text: string
  caseExample?: CaseExample
  quiz?: QuizItem
  reflection?: ReflectiveQs
  phase?: MsgPhase
  quizAnswer?: number | null
  reflectAnswers?: string[]
}

const KNOWLEDGE_BASE: {
  keywords: string[]
  answer: string
  caseExample: CaseExample
  quiz: QuizItem
  reflection: ReflectiveQs
}[] = [
  {
    keywords: ['dril', 'diabetic', 'macular', 'dme', 'edema', 'oedema'],
    answer: 'Disorganisation of Retinal Inner Layers (DRIL) is an OCT biomarker defined as the inability to distinguish boundaries between the ganglion cell–inner plexiform, inner nuclear, and outer plexiform layers. It is a strong negative prognostic marker in diabetic macular oedema (DME) — eyes with DRIL at baseline have significantly worse visual outcomes after anti-VEGF treatment. DRIL is partially reversible with early, aggressive treatment.',
    caseExample: {
      title: 'Clinical Case — DME with DRIL',
      scenario: 'A 54-year-old with 12-year type 2 DM presents with BCVA 6/18 OD. OCT shows centre-involving DME (CST 440µm) with DRIL spanning the central 1mm zone. HbA1c is 9.8%.',
      insight: 'Despite borderline DRIL, early intravitreal anti-VEGF was started. After 3 injections (6 months), DRIL resolved, CST normalised to 280µm, and VA improved to 6/9. Early treatment before permanent DRIL is critical.',
    },
    quiz: {
      question: 'Which OCT finding is the STRONGEST negative prognostic marker for visual recovery in centre-involving DME?',
      options: ['Hyperreflective foci', 'Disorganisation of retinal inner layers (DRIL)', 'Subretinal fluid', 'Vitreomacular traction'],
      correct: 1,
      explanation: 'DRIL at baseline has the strongest association with poor VA outcomes after anti-VEGF in DME, outperforming other OCT biomarkers. It reflects inner retinal structural damage that may not be fully reversible.',
    },
    reflection: {
      questions: [
        'In your own words, why does DRIL predict a worse visual outcome compared to simple cystoid oedema?',
        'If you saw a patient with DRIL but only mild vision loss (6/9), would you treat immediately or monitor? What factors would guide your decision?',
        'How would you explain DRIL and its significance to a patient during a clinic consultation?',
      ],
    },
  },
  {
    keywords: ['glaucoma', 'iop', 'intraocular', 'optic disc', 'rnfl', 'visual field', 'ohts', 'oht'],
    answer: 'Glaucoma management requires a structured approach: confirm diagnosis with structural (OCT RNFL, Bruch\'s membrane opening) and functional (HVF 24-2) assessment, establish a risk-based target IOP (20–30% reduction for moderate risk, 30–40% for high risk), and choose treatment based on patient factors. The OHTS risk calculator uses age, IOP, CCT, vertical C/D ratio, and PSD to guide treatment decisions in OHT. First-line treatment options include prostaglandin analogues, SLT laser, and in selected cases, MIGS.',
    caseExample: {
      title: 'Clinical Case — Glaucoma Suspect',
      scenario: 'A 58-year-old presents for a routine check. IOP 26 mmHg OU, CCT 510µm OU, VF: normal 24-2 OU, OCT: inferior RNFL 72µm OD (below 5th percentile). No family history. OHTS risk score: 18%.',
      insight: 'This patient has structural evidence of early damage (RNFL thinning) without functional loss — structural-functional dissociation. The OHTS score of 18% favours treatment. Latanoprost was initiated; target IOP ≤18 mmHg OD. Repeat RNFL and VF at 6 months.',
    },
    quiz: {
      question: 'A patient with OHT has OHTS 5-year conversion risk of 22%. Which finding would MOST change your management from monitoring to immediate treatment?',
      options: ['IOP of 24 mmHg on 2 visits', 'Disc haemorrhage on the inferior rim', 'CCT of 555µm', 'Mild PSD elevation on VF'],
      correct: 1,
      explanation: 'A disc haemorrhage is a strong clinical indicator of active glaucomatous damage even in the absence of VF changes. It significantly elevates the conversion risk and is a well-established trigger for initiating IOP-lowering treatment.',
    },
    reflection: {
      questions: [
        'How does structural evidence (RNFL thinning) change your approach compared to relying solely on IOP and VF?',
        'What is your personal threshold for starting treatment in a low-risk OHT patient, and how do you communicate this decision to the patient?',
        'Reflect on a case where you treated vs. monitored a glaucoma suspect — what was the outcome and what would you do differently?',
      ],
    },
  },
  {
    keywords: ['anti-vegf', 'vegf', 'ranibizumab', 'bevacizumab', 'aflibercept', 'injection', 'intravitreal'],
    answer: 'Anti-VEGF therapy is the cornerstone of treatment for wet AMD, centre-involving DME, and macular oedema due to retinal vein occlusion. The key agents are: Bevacizumab (off-label, lower cost), Ranibizumab (CATT/IVAN data: non-inferior to bevacizumab for VA), Aflibercept (DRCR Protocol T: superior in eyes with VA ≤6/12 at baseline), and Faricimab (dual anti-VEGF/Ang-2, longer durability). Treatment protocols include fixed monthly, treat-and-extend (T&E), and PRN — T&E is most widely used in clinical practice.',
    caseExample: {
      title: 'Clinical Case — Refractory DME',
      scenario: 'A 61-year-old, IOP 14 mmHg, BCVA 6/18 OD, centre-involving DME (CST 380µm) after 6 monthly bevacizumab injections. HbA1c improved from 9.1 to 7.4. No improvement in VA or CST.',
      insight: 'This represents refractory DME (≥5 injections without response). The appropriate next step is switching to a dexamethasone implant (Ozurdex) given the improved glycaemic control. IOP monitoring is mandatory. Alternative: switch to aflibercept before trialling steroids.',
    },
    quiz: {
      question: 'According to DRCR Protocol T, which anti-VEGF agent showed SUPERIOR visual outcomes in eyes with baseline BCVA ≤6/12?',
      options: ['Bevacizumab', 'Ranibizumab', 'Aflibercept', 'All three were equivalent'],
      correct: 2,
      explanation: 'Protocol T showed that for eyes with worse baseline VA (≤6/12), aflibercept produced significantly better visual gains at 1 year compared to bevacizumab and ranibizumab. For eyes with better baseline VA, all three were equivalent.',
    },
    reflection: {
      questions: [
        'How do you define treatment failure in anti-VEGF therapy for DME — is it based on VA, anatomical response, or both?',
        'When would you choose a steroid implant over switching to another anti-VEGF agent?',
        'How do you counsel a patient about the frequency and duration of intravitreal injections when starting treatment?',
      ],
    },
  },
]

const DEFAULT_RESPONSE = {
  answer: 'This is a great clinical question. The key principle here is to integrate structural and functional findings, consider the patient\'s risk profile, and align management with current evidence-based guidelines. I recommend reviewing the relevant trial data and applying it to your specific patient context.',
  caseExample: {
    title: 'Clinical Reasoning Case',
    scenario: 'A 55-year-old presents with a new complaint. Examination reveals findings that do not fit a clear single diagnosis. Multiple differentials are possible.',
    insight: 'In complex cases, systematic clinical reasoning — history, examination, investigations, then management — ensures no diagnosis is prematurely anchored. Use Bayesian reasoning: update your prior probability with each new piece of evidence.',
  },
  quiz: {
    question: 'Which approach BEST describes evidence-based clinical decision making?',
    options: ['Applying guidelines rigidly without considering patient context', 'Integrating best evidence with clinical expertise and patient values', 'Relying solely on personal clinical experience', 'Following the most expensive treatment option'],
    correct: 1,
    explanation: 'Evidence-based medicine is the integration of the best available research evidence with clinical expertise and patient preferences — not the rigid application of guidelines.',
  },
  reflection: {
    questions: [
      'What aspects of this topic do you feel most uncertain about, and how would you address those gaps?',
      'How would you explain this clinical concept to a junior colleague or medical student?',
      'Can you recall a patient case that challenged your understanding of this topic? What did you learn?',
    ],
  },
}

function matchKnowledge(query: string) {
  const q = query.toLowerCase()
  for (const kb of KNOWLEDGE_BASE) {
    if (kb.keywords.some((kw) => q.includes(kw))) return kb
  }
  return null
}

function uid() { return Math.random().toString(36).slice(2) }

const GREETING: BotMsg = {
  id: 'greeting',
  role: 'bot',
  text: 'How may I assist you today? Ask me anything about your clinical sessions, ophthalmology concepts, or management guidelines. I\'ll answer with a real case example and offer a quick quiz to reinforce your learning.',
}

export default function BotPage() {
  const [messages, setMessages]       = useState<BotMsg[]>([GREETING])
  const [input, setInput]             = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number | null>>({})
  const [reflectInputs, setReflectInputs] = useState<Record<string, string[]>>({})
  const [quizPhase, setQuizPhase]     = useState<Record<string, MsgPhase>>({})
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BOT_CHAT_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as BotMsg[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate one-time hydration of persisted chat from localStorage on mount
          setMessages(parsed)
        }
      }
    } catch { /* fine */ }
  }, [])

  useEffect(() => {
    if (messages.length > 1) {
      try { localStorage.setItem(BOT_CHAT_KEY, JSON.stringify(messages)) } catch { /* fine */ }
    }
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const clearHistory = () => {
    setMessages([GREETING])
    setQuizAnswers({})
    setReflectInputs({})
    setQuizPhase({})
    try { localStorage.removeItem(BOT_CHAT_KEY) } catch { /* fine */ }
    setShowSettings(false)
  }

  const sendMessage = () => {
    const text = input.trim()
    if (!text) return
    setInput('')

    const userMsg: BotMsg = { id: uid(), role: 'user', text }
    setMessages((prev) => [...prev, userMsg])

    setTimeout(() => {
      const match = matchKnowledge(text)
      const kb = match ?? DEFAULT_RESPONSE
      const botId = uid()
      const botMsg: BotMsg = {
        id: botId,
        role: 'bot',
        text: match ? match.answer : DEFAULT_RESPONSE.answer,
        caseExample: kb.caseExample,
        quiz: kb.quiz,
        reflection: kb.reflection,
        phase: 'quiz-prompt',
      }
      setMessages((prev) => [...prev, botMsg])
      setQuizPhase((prev) => ({ ...prev, [botId]: 'quiz-prompt' }))
    }, 700)
  }

  const startQuiz = (msgId: string) => {
    setQuizPhase((prev) => ({ ...prev, [msgId]: 'quiz' }))
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, phase: 'quiz' } : m))
  }

  const answerQuiz = (msgId: string, ansIdx: number) => {
    setQuizAnswers((prev) => ({ ...prev, [msgId]: ansIdx }))
    setTimeout(() => {
      setQuizPhase((prev) => ({ ...prev, [msgId]: 'reflection' }))
      setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, phase: 'reflection', quizAnswer: ansIdx } : m))
      setReflectInputs((prev) => ({ ...prev, [msgId]: Array(3).fill('') }))
    }, 1200)
  }

  const updateReflect = (msgId: string, idx: number, val: string) => {
    setReflectInputs((prev) => {
      const arr = [...(prev[msgId] ?? ['', '', ''])]
      arr[idx] = val
      return { ...prev, [msgId]: arr }
    })
  }

  const submitReflect = (msgId: string) => {
    setQuizPhase((prev) => ({ ...prev, [msgId]: 'done' }))
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, phase: 'done' } : m))
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-56px-64px)] max-w-3xl flex-col">
      {/* Header */}
      <div className="flex items-center justify-between pb-4">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-linear-to-br from-teal-500 to-emerald-600 shadow-md">
            <BotMessageSquare className="size-5 text-white" />
          </div>
          <div>
            <div className="text-[16px] font-bold tracking-tight">Teaching &amp; Reflection Bot</div>
            <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
              AI Co-Facilitator · Chat history saved
            </div>
          </div>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className="grid size-9 place-items-center rounded-full border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <Settings className="size-4" />
          </button>
          {showSettings && (
            <div className="absolute right-0 top-11 z-20 w-52 overflow-hidden rounded-2xl border border-border/60 bg-popover shadow-lg">
              <div className="border-b border-border/60 px-4 py-2.5 text-[11.5px] font-semibold text-muted-foreground">Bot Settings</div>
              <button
                type="button"
                onClick={clearHistory}
                className="flex w-full items-center gap-2 px-4 py-3 text-[12.5px] text-rose-600 transition-colors hover:bg-rose-50"
              >
                <Trash2 className="size-4" />
                Clear chat history
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.map((msg) => (
          <div key={msg.id} className={cn('flex flex-col gap-2', msg.role === 'user' && 'items-end')}>
            {msg.role === 'user' ? (
              <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-slate-700 px-4 py-2.5 text-[13px] text-white">
                {msg.text}
              </div>
            ) : (
              <div className="flex items-start gap-2.5 max-w-full">
                <div className="grid size-7 shrink-0 place-items-center rounded-full bg-linear-to-br from-teal-500 to-emerald-600 mt-1">
                  <Sparkles className="size-3.5 text-white" />
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  {/* Answer text */}
                  <div className="rounded-2xl rounded-tl-sm border border-border/60 bg-card px-4 py-3 text-[13px] leading-relaxed">
                    {msg.text}
                  </div>

                  {/* Case example — always shown */}
                  {msg.caseExample && (
                    <div className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50">
                      <div className="flex items-center gap-2 border-b border-amber-200 px-3 py-2">
                        <Lightbulb className="size-3.5 text-amber-600" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Case Example</span>
                      </div>
                      <div className="p-3">
                        <div className="text-[12px] font-semibold text-amber-900">{msg.caseExample.title}</div>
                        <p className="mt-1 text-[11.5px] leading-snug text-amber-800">{msg.caseExample.scenario}</p>
                        <div className="mt-2 rounded-xl bg-amber-100/70 px-2.5 py-2">
                          <span className="text-[9.5px] font-bold uppercase text-amber-600 tracking-wider">Insight </span>
                          <span className="text-[11.5px] text-amber-800">{msg.caseExample.insight}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Quiz prompt */}
                  {(quizPhase[msg.id] === 'quiz-prompt' || msg.phase === 'quiz-prompt') && (
                    <button
                      type="button"
                      onClick={() => startQuiz(msg.id)}
                      className="inline-flex items-center gap-2 rounded-full border border-teal-300 bg-teal-50 px-4 py-2 text-[12px] font-semibold text-teal-700 transition-colors hover:bg-teal-100"
                    >
                      <HelpCircle className="size-4" />
                      Take a follow-up quiz on this topic
                      <ChevronRight className="size-4" />
                    </button>
                  )}

                  {/* Quiz */}
                  {(quizPhase[msg.id] === 'quiz' || quizPhase[msg.id] === 'reflection' || quizPhase[msg.id] === 'done') && msg.quiz && (
                    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
                      <div className="flex items-center gap-2 border-b border-border/60 bg-foreground/[0.025] px-3 py-2">
                        <HelpCircle className="size-3.5 text-teal-600" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quick Quiz</span>
                      </div>
                      <div className="p-3">
                        <p className="text-[13px] font-medium text-foreground mb-3">{msg.quiz.question}</p>
                        <div className="space-y-2">
                          {msg.quiz.options.map((opt, i) => {
                            const answered = quizAnswers[msg.id] !== undefined && quizAnswers[msg.id] !== null
                            const chosen = quizAnswers[msg.id] === i
                            const correct = i === msg.quiz!.correct
                            return (
                              <button
                                key={i}
                                type="button"
                                disabled={answered}
                                onClick={() => !answered && answerQuiz(msg.id, i)}
                                className={cn(
                                  'flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left text-[12.5px] transition-all',
                                  !answered ? 'border-border/60 hover:border-teal-400 hover:bg-teal-50/50' :
                                  chosen && correct  ? 'border-emerald-400 bg-emerald-50 text-emerald-800' :
                                  chosen && !correct ? 'border-rose-400 bg-rose-50 text-rose-800' :
                                  correct            ? 'border-emerald-300 bg-emerald-50/50 text-emerald-700' :
                                                       'border-border/40 opacity-50'
                                )}
                              >
                                <div className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                                  !answered ? 'bg-foreground/5' :
                                  chosen && correct  ? 'bg-emerald-500 text-white' :
                                  chosen && !correct ? 'bg-rose-500 text-white' :
                                  correct            ? 'bg-emerald-400 text-white' :
                                                       'bg-foreground/5'
                                )}>
                                  {answered && correct ? <Check className="size-3" /> : String.fromCharCode(65 + i)}
                                </div>
                                {opt}
                              </button>
                            )
                          })}
                        </div>
                        {quizAnswers[msg.id] !== undefined && quizAnswers[msg.id] !== null && (
                          <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50 p-2.5">
                            <span className="text-[9.5px] font-bold uppercase text-teal-600 tracking-wider">Explanation </span>
                            <span className="text-[11.5px] text-teal-800">{msg.quiz.explanation}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Reflective questions */}
                  {(quizPhase[msg.id] === 'reflection' || quizPhase[msg.id] === 'done') && msg.reflection && (
                    <div className="overflow-hidden rounded-2xl border border-violet-200 bg-violet-50">
                      <div className="flex items-center gap-2 border-b border-violet-200 px-3 py-2">
                        <Sparkles className="size-3.5 text-violet-600" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-violet-700">Reflective Practice</span>
                      </div>
                      <div className="space-y-3 p-3">
                        {msg.reflection.questions.map((q, i) => (
                          <div key={i}>
                            <div className="text-[12px] font-medium text-violet-800 mb-1.5">{i + 1}. {q}</div>
                            {quizPhase[msg.id] === 'reflection' ? (
                              <textarea
                                rows={2}
                                value={reflectInputs[msg.id]?.[i] ?? ''}
                                onChange={(e) => updateReflect(msg.id, i, e.target.value)}
                                placeholder="Write your reflection…"
                                className="w-full rounded-xl border border-violet-300 bg-white px-3 py-2 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-violet-400 placeholder:text-violet-300"
                              />
                            ) : (
                              <div className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-[12px] text-gray-600 italic min-h-[2.5rem]">
                                {reflectInputs[msg.id]?.[i] || <span className="text-violet-300">No response recorded</span>}
                              </div>
                            )}
                          </div>
                        ))}
                        {quizPhase[msg.id] === 'reflection' && (
                          <button
                            type="button"
                            onClick={() => submitReflect(msg.id)}
                            className="inline-flex items-center gap-2 rounded-full bg-violet-500 px-4 py-2 text-[12px] font-semibold text-white hover:bg-violet-400"
                          >
                            <Check className="size-3.5" />
                            Submit reflections
                          </button>
                        )}
                        {quizPhase[msg.id] === 'done' && (
                          <div className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-violet-600">
                            <Check className="size-3.5" /> Reflections saved · Well done!
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Suggested questions */}
      {messages.length === 1 && (
        <div className="py-3">
          <div className="mb-2 text-[11px] font-semibold text-muted-foreground">Suggested questions</div>
          <div className="flex flex-wrap gap-2">
            {[
              'What is DRIL and why does it matter in DME?',
              'When should I treat a glaucoma suspect?',
              'How do I choose between anti-VEGF agents in DME?',
            ].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => { setInput(q) }}
                className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-[11.5px] text-teal-700 transition-colors hover:bg-teal-100"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="pt-3 pb-1 border-t border-border/60">
        <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-background/80 pl-4 pr-2 py-1.5 shadow-sm focus-within:border-teal-400 focus-within:ring-2 focus-within:ring-teal-400/20">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            placeholder="Ask a clinical question…"
            className="flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={!input.trim()}
            className="grid size-9 place-items-center rounded-xl bg-slate-700 text-white transition-colors hover:bg-slate-600 disabled:opacity-40"
          >
            <Send className="size-4" />
          </button>
        </div>
        <div className="mt-1.5 text-center text-[10.5px] text-muted-foreground">
          AI-assisted clinical teaching · Answers always include a case example · Chat saved automatically
        </div>
      </div>
    </div>
  )
}
