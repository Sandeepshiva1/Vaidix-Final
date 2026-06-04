/**
 * VAIDIX VOICE API — Sarvam Saaras v3 Speech-to-Text
 *
 * Accepts audio/webm or audio/mp4 from the browser, sends to Sarvam,
 * returns transcript + detected language. Auto-handles Hindi-English
 * code-mixing typical in LVPEI consultations.
 *
 * Pattern adapted from E:\HIMS\hims-app\src\app\api\voice\route.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/server/services/api-helpers'
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit'

const SARVAM_API_KEY = process.env.SARVAM_API_KEY || ''
const SARVAM_STT_URL = 'https://api.sarvam.ai/speech-to-text'
const SARVAM_STT_MODEL = process.env.SARVAM_STT_MODEL || 'saaras:v3'

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response
    const rl = await checkRateLimit({ bucket: `voice:${auth.user.id}`, ...LIMITS.VOICE_STT })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Voice transcription throttled — please try again later.' },
        { status: 429 }
      )
    }

    if (!SARVAM_API_KEY) {
      return NextResponse.json(
        { error: 'SARVAM_API_KEY not configured' },
        { status: 503 }
      )
    }

    const formData = await req.formData()
    const audioFile = formData.get('file') as Blob | null

    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
    }

    // Strip codec suffix — Sarvam rejects "audio/webm;codecs=opus"
    const rawType = audioFile.type || 'audio/webm'
    const cleanType = rawType.split(';')[0]
    const cleanBlob = new Blob([await audioFile.arrayBuffer()], { type: cleanType })
    const ext = cleanType.includes('mp4') ? 'mp4' : 'webm'

    const sarvamForm = new FormData()
    sarvamForm.append('file', cleanBlob, `recording.${ext}`)
    sarvamForm.append('model', SARVAM_STT_MODEL)
    sarvamForm.append('mode', 'transcribe')

    const response = await fetch(SARVAM_STT_URL, {
      method: 'POST',
      headers: {
        'api-subscription-key': SARVAM_API_KEY,
      },
      body: sarvamForm,
    })

    if (!response.ok) {
      const errBody = await response.text()
      console.error('[Sarvam STT] Error:', response.status, errBody)
      return NextResponse.json(
        { error: 'Sarvam STT failed', detail: errBody },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json({
      transcript: data.transcript || '',
      language: data.language_code || 'unknown',
    })
  } catch (err: unknown) {
    console.error('[Sarvam STT] Exception:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
