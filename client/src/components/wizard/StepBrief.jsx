import { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowLeft, ArrowRight, Check, Gift, Megaphone, PenLine } from 'lucide-react'

const TOTAL_QUESTIONS = 3

// ─── Animering ───
function SlideIn({ children, direction = 'right' }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.opacity = '0'
    el.style.transform = direction === 'right' ? 'translateX(40px)' : 'translateX(-40px)'
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.35s ease, transform 0.35s ease'
      el.style.opacity = '1'
      el.style.transform = 'translateX(0)'
    })
  }, [])
  return <div ref={ref}>{children}</div>
}

// ─── Progress dots ───
function ProgressDots({ current, total }) {
  return (
    <div className="flex items-center gap-3 mb-8">
      <span className="text-xs text-gray-500 font-mono">{current + 1}/{total}</span>
      <div className="flex gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === current ? 'w-6 bg-purple-500' : i < current ? 'w-3 bg-purple-500/40' : 'w-3 bg-gray-700'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

// CTA-alternativ
const CTA_OPTIONS = [
  { id: 'skapa_video', label: 'Skapa en video', icon: '🎬' },
  { id: 'testa_plattform', label: 'Testa plattformen & dela upplevelsen', icon: '🎮' },
  { id: 'posta_story', label: 'Posta en story / reel', icon: '📱' },
  { id: 'boka_mote', label: 'Boka ett möte / samtal', icon: '📞' },
  { id: 'dela_lank', label: 'Dela en länk / referral-kod', icon: '🔗' },
  { id: 'annat', label: 'Annat', icon: '✏️' },
]

export default function StepBrief({ outreachBrief, setOutreachBrief, outreachType, next, prev }) {
  const [q, setQ] = useState(0)
  const [direction, setDirection] = useState('right')

  // Brief-svar
  const [erbjudande, setErbjudande] = useState(outreachBrief?.erbjudande || '')
  const [ctaVal, setCtaVal] = useState(outreachBrief?.cta || [])
  const [extraInfo, setExtraInfo] = useState(outreachBrief?.extra || '')

  const isSponsor = outreachType === 'sponsor'

  const goNext = useCallback(() => {
    setDirection('right')
    setQ(prev => Math.min(prev + 1, TOTAL_QUESTIONS - 1))
  }, [])

  const goBack = useCallback(() => {
    setDirection('left')
    setQ(prev => Math.max(prev - 1, 0))
  }, [])

  // Keyboard
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && q > 0) goBack()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [q, goBack])

  // Spara brief och gå vidare till outreach-generering
  const handleFinish = () => {
    setOutreachBrief({
      erbjudande,
      cta: ctaVal,
      extra: extraInfo,
    })
    next()
  }

  const toggleCta = (id) => {
    setCtaVal(prev => {
      if (prev.includes(id)) return prev.filter(v => v !== id)
      return [...prev, id]
    })
  }

  const renderQuestion = () => {
    switch (q) {
      // ═══ FRÅGA 1: Erbjudande ═══
      case 0:
        return (
          <SlideIn key="brief-q0" direction={direction}>
            <div className="max-w-xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                  <Gift className="w-5 h-5 text-purple-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">Vad vill du erbjuda?</h2>
              </div>
              <p className="text-sm text-gray-400 mb-6">
                {isSponsor
                  ? 'Beskriv vad ni erbjuder sponsorn — exponering, målgrupp, kampanjformat etc.'
                  : 'Beskriv vad som gör samarbetet intressant för influencern — ersättning, tillgång till plattformen, exklusivitet etc.'}
              </p>
              <textarea
                autoFocus
                value={erbjudande}
                onChange={(e) => setErbjudande(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && erbjudande.trim()) {
                    e.preventDefault()
                    goNext()
                  }
                }}
                rows={3}
                className="w-full bg-gray-800/50 border border-gray-700 focus:border-purple-500 rounded-xl text-white text-base py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors resize-none"
                placeholder={isSponsor
                  ? 'T.ex. Vi erbjuder exponering mot 50 000+ aktiva användare inom fantasy sport, med möjlighet till co-branded kampanjer.'
                  : 'T.ex. 300 SEK per video + 10 SEK per signup med din referral-kod. Gratis tillgång till vår premium-plattform.'}
              />
              <div className="flex items-center gap-3 mt-5">
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!erbjudande.trim()}
                  className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors"
                >
                  OK <Check className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-500">Ctrl+Enter</span>
              </div>
            </div>
          </SlideIn>
        )

      // ═══ FRÅGA 2: CTA ═══
      case 1:
        return (
          <SlideIn key="brief-q1" direction={direction}>
            <div className="max-w-xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                  <Megaphone className="w-5 h-5 text-purple-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">Vad ska mottagaren göra?</h2>
              </div>
              <p className="text-sm text-gray-400 mb-6">Välj en eller flera — detta blir call-to-action i meddelandet.</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {CTA_OPTIONS.map((opt) => {
                  const isSelected = ctaVal.includes(opt.id)
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => toggleCta(opt.id)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all ${
                        isSelected
                          ? 'border-purple-500 bg-purple-500/10 text-purple-300'
                          : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                      }`}
                    >
                      <span className="text-lg">{opt.icon}</span>
                      <span className="text-sm font-medium">{opt.label}</span>
                      {isSelected && <Check className="w-4 h-4 ml-auto text-purple-400" />}
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center gap-3 mt-5">
                <button
                  type="button"
                  onClick={goNext}
                  disabled={ctaVal.length === 0}
                  className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors"
                >
                  OK <Check className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-500">{ctaVal.length} valda</span>
              </div>
            </div>
          </SlideIn>
        )

      // ═══ FRÅGA 3: Extra info (valfri) ═══
      case 2:
        return (
          <SlideIn key="brief-q2" direction={direction}>
            <div className="max-w-xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                  <PenLine className="w-5 h-5 text-purple-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">Något extra vi bör nämna?</h2>
              </div>
              <p className="text-sm text-gray-400 mb-6">
                Valfritt — en kampanjdeadline, specifik produkt, att ni redan pratat med andra influencers, eller annan kontext som gör meddelandet bättre.
              </p>
              <textarea
                autoFocus
                value={extraInfo}
                onChange={(e) => setExtraInfo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    handleFinish()
                  }
                }}
                rows={3}
                className="w-full bg-gray-800/50 border border-gray-700 focus:border-purple-500 rounded-xl text-white text-base py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors resize-none"
                placeholder="T.ex. Vi lanserar en ny Allsvenskan-säsong i maj och vill ha allt content ute innan dess."
              />
              <div className="flex items-center gap-3 mt-5">
                <button
                  type="button"
                  onClick={handleFinish}
                  className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors"
                >
                  {extraInfo.trim() ? 'Klar' : 'Hoppa över'} <ArrowRight className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-500">Ctrl+Enter</span>
              </div>
            </div>
          </SlideIn>
        )

      default:
        return null
    }
  }

  return (
    <div className="min-h-[400px] flex flex-col">
      <ProgressDots current={q} total={TOTAL_QUESTIONS} />

      <div className="flex-1 flex items-start">
        {renderQuestion()}
      </div>

      {q > 0 && (
        <div className="mt-8 pt-4 border-t border-gray-800/50">
          <button
            type="button"
            onClick={goBack}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Tillbaka
          </button>
        </div>
      )}
    </div>
  )
}
