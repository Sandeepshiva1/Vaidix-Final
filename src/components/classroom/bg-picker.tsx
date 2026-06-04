'use client'

import { useCallback, useState } from 'react'
import { motion } from 'framer-motion'
import { useLocalParticipant } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { X, Loader2, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

type PresetNone  = { id: string; label: string; type: 'none' }
type PresetBlur  = { id: string; label: string; type: 'blur'; strength: number }
type PresetImage = { id: string; label: string; type: 'image'; src: string }
type Preset = PresetNone | PresetBlur | PresetImage

const PRESETS: Preset[] = [
  { id: 'none',         label: 'None',       type: 'none' },
  { id: 'blur-light',   label: 'Soft blur',  type: 'blur', strength: 8  },
  { id: 'blur-strong',  label: 'Heavy blur', type: 'blur', strength: 22 },
  // Real photoreal/3D-render wallpapers, downloaded from Unsplash and
  // bundled in /public/bg as 1920x1080 JPEGs. These replace the previous
  // hand-drawn SVG gradients which couldn't compete with Teams/Zoom.
  { id: 'aurora',       label: 'Aurora',     type: 'image', src: '/bg/aurora.jpg'   },
  { id: 'liquid',       label: 'Liquid',     type: 'image', src: '/bg/liquid.jpg'   },
  { id: 'spectrum',     label: 'Spectrum',   type: 'image', src: '/bg/spectrum.jpg' },
  { id: 'waves',        label: 'Waves',      type: 'image', src: '/bg/waves.jpg'    },
  { id: 'pastel',       label: 'Pastel',     type: 'image', src: '/bg/pastel.jpg'   },
  { id: 'cosmic',       label: 'Cosmic',     type: 'image', src: '/bg/cosmic.jpg'   },
  { id: 'sunset',       label: 'Sunset',     type: 'image', src: '/bg/sunset.jpg'   },
  { id: 'studio',       label: 'Studio',     type: 'image', src: '/bg/studio2.jpg'  },
  // Vaidix-branded SVG kept for institutional branding scenarios. Already
  // has explicit width/height so it rasterizes correctly.
  { id: 'vaidix',       label: 'Vaidix',     type: 'image', src: '/bg/vaidix.svg'   },
]

export function BgPicker({ onClose }: { onClose: () => void }) {
  const { localParticipant, isCameraEnabled } = useLocalParticipant()
  const [active, setActive]   = useState<string>('none')
  const [applying, setApplying] = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)

  const apply = useCallback(async (preset: Preset) => {
    setApplying(preset.id)
    setError(null)
    try {
      // isCameraEnabled is the authoritative LiveKit reactive state. Checking
      // pub/track separately caused false "Camera is off" errors because the
      // track publication is populated asynchronously after enablement and
      // isn't reliably available the instant the picker opens.
      if (!isCameraEnabled) {
        setError('Camera is off — turn it on first')
        return
      }
      const pub   = localParticipant.getTrackPublication(Track.Source.Camera)
      const track = pub?.track
      if (!track) {
        // Track not yet published — camera is enabling, wait a beat and retry.
        setError('Camera is starting up — try again in a moment')
        return
      }

      const mod = await import('@livekit/track-processors')
      if (!mod.supportsBackgroundProcessors()) {
        setError('Background filters not supported in this browser')
        return
      }

      if (preset.type === 'none') {
        await track.stopProcessor()
      } else if (preset.type === 'blur') {
        const proc = mod.BackgroundProcessor({ mode: 'background-blur', blurRadius: preset.strength })
        await track.setProcessor(proc)
      } else {
        // Pre-load the image so we surface a clear error if the SVG path is
        // bad / 404s, instead of letting the processor silently render with
        // a transparent texture (looks like "background change not working").
        await new Promise<void>((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve()
          img.onerror = () => reject(new Error(`Image failed to load: ${preset.src}`))
          img.src = preset.src
        })
        const proc = mod.BackgroundProcessor({ mode: 'virtual-background', imagePath: preset.src })
        await track.setProcessor(proc)
      }

      setActive(preset.id)
    } catch (err) {
      console.error('[BgPicker]', err)
      const msg = (err as Error)?.message ?? ''
      setError(msg.includes('Image failed') ? "Couldn't load that wallpaper" : 'Not supported in this browser')
    } finally {
      setApplying(null)
    }
    // isCameraEnabled must be in deps — without it, the memoized callback
    // closes over a stale boolean and reports "Camera is off" even after
    // the user just enabled it.
  }, [localParticipant, isCameraEnabled])

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0,  scale: 1    }}
      exit={{    opacity: 0, y: 10, scale: 0.95 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-60 bg-zinc-900/97 backdrop-blur-2xl border border-white/8 rounded-2xl shadow-2xl shadow-black/70 overflow-hidden z-50"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/7">
        <span className="text-xs font-semibold text-white/60 tracking-wide uppercase">
          Background
        </span>
        <button
          onClick={onClose}
          className="text-white/30 hover:text-white/80 p-1 rounded-lg hover:bg-white/8 transition-all"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Preset grid — image presets use the actual wallpaper as their
          thumbnail (browser caches it once, so swapping later is instant). */}
      <div className="grid grid-cols-3 gap-2 p-3">
        {PRESETS.map((preset) => {
          const isActive  = active    === preset.id
          const isLoading = applying  === preset.id

          return (
            <button
              key={preset.id}
              onClick={() => apply(preset)}
              disabled={!!applying}
              className={cn(
                'group flex flex-col items-center gap-1.5 rounded-xl p-1.5 transition-all duration-150 disabled:pointer-events-none',
                isActive
                  ? 'bg-teal-500/15 ring-1 ring-teal-500/50'
                  : 'hover:bg-white/5'
              )}
            >
              {/* Swatch */}
              <div className="w-full aspect-video rounded-lg relative overflow-hidden bg-zinc-800">
                {preset.type === 'image' && (
                  // Native <img> here — Next/Image would need a remote
                  // pattern config and these are local /public/bg assets.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preset.src}
                    alt={preset.label}
                    className="absolute inset-0 size-full object-cover"
                    loading="lazy"
                    draggable={false}
                  />
                )}
                {preset.type === 'none' && (
                  <div className="absolute inset-0 bg-zinc-800 border border-white/10 rounded-lg" />
                )}
                {/* Blur visualisation */}
                {preset.type === 'blur' && (
                  <div className="absolute inset-0 bg-zinc-700 flex items-center justify-center">
                    <div
                      className="w-6 h-6 rounded-full bg-white/25"
                      style={{
                        filter: `blur(${preset.strength <= 10 ? '2px' : '5px'})`,
                      }}
                    />
                  </div>
                )}

                {/* Spinner overlay */}
                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
                    <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                  </div>
                )}

                {/* Active tick */}
                {isActive && !isLoading && (
                  <div className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-teal-400 flex items-center justify-center shadow-md">
                    <Check className="w-2 h-2 text-zinc-900" strokeWidth={3} />
                  </div>
                )}
              </div>

              <span
                className={cn(
                  'text-[10px] leading-none transition-colors',
                  isActive
                    ? 'text-teal-400'
                    : 'text-white/40 group-hover:text-white/70'
                )}
              >
                {preset.label}
              </span>
            </button>
          )
        })}
      </div>

      {error && (
        <p className="px-4 pb-3 text-[11px] text-red-400 text-center">{error}</p>
      )}
    </motion.div>
  )
}
