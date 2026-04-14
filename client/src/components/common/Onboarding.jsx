import { useState, useEffect, useCallback } from 'react'
import { X, Zap, ArrowRight, ArrowLeft, Building2, Search, MessageSquare, FileText, Send, Sparkles } from 'lucide-react'

const GUIDE_STEPS = [
  {
    icon: Zap,
    title: 'Välkommen till SparkCollab Outreach!',
    description: 'Hitta influencers eller sponsorer, generera personliga meddelanden med AI, bifoga kontrakt och skicka — allt i ett flöde.',
    detail: 'Låt oss gå igenom hur det fungerar steg för steg.',
    color: 'purple',
  },
  {
    icon: Building2,
    title: 'Steg 1 — Företagsprofil',
    description: 'Börja med att fylla i ert företagsnamn och e-post. Om ni har en hemsida kan AI:n automatiskt analysera er bransch.',
    detail: 'Välj sedan om ni söker influencers eller företagssponsorer, och välj 1–3 nischer. AI-briefen hjälper oss matcha rätt.',
    color: 'blue',
  },
  {
    icon: Search,
    title: 'Steg 2 — Hitta & Välj',
    description: 'AI:n söker fram de bästa matchningarna baserat på er profil, bransch och budget.',
    detail: 'Varje förslag visas med score, engagemang och AI-motivering. Bocka i de ni vill kontakta.',
    color: 'cyan',
  },
  {
    icon: MessageSquare,
    title: 'Steg 3 — Generera Outreach',
    description: 'AI:n skriver personliga meddelanden till varje vald influencer/sponsor — anpassade efter deras kanal och ert varumärke.',
    detail: 'Ni kan redigera varje meddelande innan det skickas. Allt betonar tydlig call-to-action för konvertering.',
    color: 'violet',
  },
  {
    icon: FileText,
    title: 'Steg 4 — Kontrakt (valfritt)',
    description: 'Vill ni bifoga ett avtal? Kontraktet genereras automatiskt med alla villkor ifyllda.',
    detail: '300 SEK per video, max 5 videos, 10 SEK per signup via referral-kod. Digital signering ingår.',
    color: 'amber',
  },
  {
    icon: Send,
    title: 'Steg 5 — Granska & Skicka',
    description: 'Se en sammanfattning av allt som ska skickas. Redigera, ta bort eller lägg till — sen skickar ni iväg allt med ett klick.',
    detail: 'Allt loggas i dashboarden. Uppföljning flaggas automatiskt efter 5 dagar utan svar.',
    color: 'green',
  },
]

const COLOR_MAP = {
  purple: {
    iconBg: 'bg-purple-500/10 border-purple-500/30',
    iconText: 'text-purple-400',
    dot: 'bg-purple-500',
    dotInactive: 'bg-purple-500/30',
    btn: 'bg-purple-600 hover:bg-purple-700',
  },
  blue: {
    iconBg: 'bg-blue-500/10 border-blue-500/30',
    iconText: 'text-blue-400',
    dot: 'bg-blue-500',
    dotInactive: 'bg-blue-500/30',
    btn: 'bg-blue-600 hover:bg-blue-700',
  },
  cyan: {
    iconBg: 'bg-cyan-500/10 border-cyan-500/30',
    iconText: 'text-cyan-400',
    dot: 'bg-cyan-500',
    dotInactive: 'bg-cyan-500/30',
    btn: 'bg-cyan-600 hover:bg-cyan-700',
  },
  violet: {
    iconBg: 'bg-violet-500/10 border-violet-500/30',
    iconText: 'text-violet-400',
    dot: 'bg-violet-500',
    dotInactive: 'bg-violet-500/30',
    btn: 'bg-violet-600 hover:bg-violet-700',
  },
  amber: {
    iconBg: 'bg-amber-500/10 border-amber-500/30',
    iconText: 'text-amber-400',
    dot: 'bg-amber-500',
    dotInactive: 'bg-amber-500/30',
    btn: 'bg-amber-600 hover:bg-amber-700',
  },
  green: {
    iconBg: 'bg-emerald-500/10 border-emerald-500/30',
    iconText: 'text-emerald-400',
    dot: 'bg-emerald-500',
    dotInactive: 'bg-emerald-500/30',
    btn: 'bg-emerald-600 hover:bg-emerald-700',
  },
}

export default function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0)
  const [isExiting, setIsExiting] = useState(false)
  const [direction, setDirection] = useState('right')

  const current = GUIDE_STEPS[step]
  const colors = COLOR_MAP[current.color]
  const Icon = current.icon
  const isFirst = step === 0
  const isLast = step === GUIDE_STEPS.length - 1

  const handleClose = useCallback(() => {
    setIsExiting(true)
    setTimeout(() => onComplete(), 300)
  }, [onComplete])

  const handleNext = () => {
    if (isLast) {
      handleClose()
    } else {
      setDirection('right')
      setStep(s => s + 1)
    }
  }

  const handlePrev = () => {
    if (!isFirst) {
      setDirection('left')
      setStep(s => s - 1)
    }
  }

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') handleNext()
      else if (e.key === 'ArrowLeft') handlePrev()
      else if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [step, isLast])

  return (
    <div className={`fixed inset-0 z-[9998] flex items-center justify-center transition-opacity duration-300 ${isExiting ? 'opacity-0' : 'opacity-100'}`}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={handleClose} />

      {/* Card */}
      <div
        className={`relative w-full max-w-lg mx-4 rounded-2xl border p-8 shadow-2xl transition-all duration-300 border-gray-700/50 ${isExiting ? 'scale-95 opacity-0' : 'scale-100 opacity-100'}`}
        style={{ background: 'rgba(17, 17, 27, 0.97)' }}
      >
        {/* Close */}
        <button onClick={handleClose} className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>

        {/* Step counter */}
        <div className="text-xs text-gray-500 mb-4 font-medium">
          {step + 1} / {GUIDE_STEPS.length}
        </div>

        {/* Icon — welcome step visar SparkCollab-logo, resten: step-ikon */}
        {step === 0 ? (
          <div className="mb-5 flex items-center gap-3">
            <img src="/sparkcollab-icon.svg" alt="" width="56" height="56" className="spark-flicker" />
          </div>
        ) : (
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-5 border ${colors.iconBg}`}>
            <Icon className={`w-7 h-7 ${colors.iconText}`} />
          </div>
        )}

        {/* Content */}
        <h2 className="text-xl font-bold text-white mb-3">{current.title}</h2>
        <p className="text-sm text-gray-300 leading-relaxed mb-3">
          {current.description}
        </p>
        <p className="text-sm text-gray-400 leading-relaxed mb-8">
          {current.detail}
        </p>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {GUIDE_STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => { setDirection(i > step ? 'right' : 'left'); setStep(i) }}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                i === step ? `${colors.dot} w-6` : i < step ? 'bg-gray-500' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {!isFirst && (
            <button
              onClick={handlePrev}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors text-gray-400 hover:text-white hover:bg-gray-800 border border-gray-700"
            >
              <ArrowLeft className="w-4 h-4" />
              Tillbaka
            </button>
          )}

          {isFirst && (
            <button
              onClick={handleClose}
              className="px-4 py-2.5 rounded-lg text-sm font-medium transition-colors text-gray-500 hover:text-gray-300"
            >
              Hoppa över
            </button>
          )}

          <button
            onClick={handleNext}
            className={`flex-1 flex items-center gap-2 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors justify-center ${colors.btn}`}
          >
            {isLast ? 'Starta!' : 'Nästa'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Keyboard hint */}
        <p className="text-center text-[10px] text-gray-600 mt-4">
          Använd piltangenter ← → eller Enter för att navigera
        </p>
      </div>
    </div>
  )
}
