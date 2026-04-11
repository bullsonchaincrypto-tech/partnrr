import { useState, useEffect, useRef, useCallback } from 'react'
import { Users, Building, ArrowRight, ArrowLeft, Loader2, Check, Globe, Mail, User, FileText, Package, Wrench, Sparkles, ExternalLink } from 'lucide-react'
import * as api from '../../services/api'

const TOTAL_QUESTIONS = 7

// ─── Animeringshjälp ───
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

// ─── Knapp-kort (för syfte & erbjudande) ───
function ChoiceCard({ icon: Icon, title, subtitle, selected, color = 'purple', onClick }) {
  const colors = {
    purple: { active: 'border-purple-500 bg-purple-500/10 text-purple-300 shadow-lg shadow-purple-500/10', ring: 'ring-purple-500' },
    blue: { active: 'border-blue-500 bg-blue-500/10 text-blue-300 shadow-lg shadow-blue-500/10', ring: 'ring-blue-500' },
    cyan: { active: 'border-cyan-500 bg-cyan-500/10 text-cyan-300 shadow-lg shadow-cyan-500/10', ring: 'ring-cyan-500' },
  }
  const c = colors[color] || colors.purple
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-4 px-6 py-5 rounded-xl border-2 transition-all duration-200 w-full text-left ${
        selected ? c.active : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300 hover:bg-gray-800/30'
      }`}
    >
      {selected && (
        <div className="absolute top-3 right-3">
          <Check className="w-4 h-4 text-green-400" />
        </div>
      )}
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${selected ? 'bg-white/10' : 'bg-gray-800'}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <div className="font-semibold text-base">{title}</div>
        <div className="text-sm opacity-60 mt-0.5">{subtitle}</div>
      </div>
    </button>
  )
}

// ─── Text-input fråga ───
function TextQuestion({ label, placeholder, value, onChange, onSubmit, type = 'text', optional = false, autoFocus = true }) {
  const inputRef = useRef(null)
  useEffect(() => { if (autoFocus) inputRef.current?.focus() }, [])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() || optional) onSubmit()
    }
  }

  return (
    <div className="max-w-lg">
      <label className="block text-2xl font-bold text-white mb-6">{label}</label>
      <input
        ref={inputRef}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full bg-transparent border-b-2 border-gray-600 focus:border-purple-500 text-white text-lg py-3 px-1 placeholder-gray-600 focus:outline-none transition-colors"
        placeholder={placeholder}
      />
      <div className="flex items-center gap-3 mt-6">
        <button
          type="button"
          onClick={onSubmit}
          disabled={!value.trim() && !optional}
          className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors"
        >
          OK <Check className="w-4 h-4" />
        </button>
        <span className="text-xs text-gray-500">eller tryck Enter ↵</span>
        {optional && (
          <button
            type="button"
            onClick={onSubmit}
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors ml-2"
          >
            Hoppa över →
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Textarea fråga ───
function TextareaQuestion({ label, placeholder, value, onChange, onSubmit }) {
  const textareaRef = useRef(null)
  useEffect(() => { textareaRef.current?.focus() }, [])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (value.trim()) onSubmit()
    }
  }

  return (
    <div className="max-w-xl">
      <label className="block text-2xl font-bold text-white mb-3">{label}</label>
      <p className="text-sm text-gray-400 mb-5">Det här är den viktigaste frågan — ju mer du beskriver, desto bättre matchning.</p>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={4}
        className="w-full bg-gray-800/50 border border-gray-700 focus:border-purple-500 rounded-xl text-white text-base py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors resize-none"
        placeholder={placeholder}
      />
      <div className="flex items-center gap-3 mt-4">
        <button
          type="button"
          onClick={onSubmit}
          disabled={!value.trim()}
          className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors"
        >
          OK <Check className="w-4 h-4" />
        </button>
        <span className="text-xs text-gray-500">Ctrl+Enter</span>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════
// HUVUDKOMPONENT
// ═══════════════════════════════════════════
export default function Step1Foretag({ foretag, setForetag, setKontaktperson, outreachType, setOutreachType, next }) {
  // Fyll i från befintligt företag om det finns
  const [q, setQ] = useState(0)
  const [direction, setDirection] = useState('right')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Fråge-svar
  const [syfte, setSyfte] = useState(foretag?.syfte || outreachType || 'influencers')
  const [kontaktpersonVal, setKontaktpersonVal] = useState(foretag?.kontaktperson || '')
  const [foretagNamn, setForetagNamn] = useState(foretag?.namn || '')
  const [orgNummer, setOrgNummer] = useState(foretag?.org_nummer || '')
  const [domain, setDomain] = useState(foretag?.hemsida || '')
  const [epost, setEpost] = useState(foretag?.epost || '')
  const [erbjudandeTyp, setErbjudandeTyp] = useState(foretag?.erbjudande_typ || '')
  const [beskrivning, setBeskrivning] = useState(foretag?.beskrivning || '')

  // Enrichment
  const [enriching, setEnriching] = useState(false)
  const [enrichmentData, setEnrichmentData] = useState(null)

  // Navigering
  const goNext = useCallback(() => {
    setDirection('right')
    setQ(prev => Math.min(prev + 1, TOTAL_QUESTIONS - 1))
  }, [])

  const goBack = useCallback(() => {
    setDirection('left')
    setQ(prev => Math.max(prev - 1, 0))
  }, [])

  // Keyboard: Escape = tillbaka
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && q > 0) goBack()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [q, goBack])

  // Bakgrunds-enrichment när domain anges
  const triggerEnrichment = useCallback(async (domainVal) => {
    if (!domainVal.trim()) return
    setEnriching(true)
    try {
      const data = await api.enrichDomain(domainVal.trim())
      setEnrichmentData(data)
      // Auto-fyll företagsnamn om tomt
      if (!foretagNamn && data.company_name) {
        setForetagNamn(data.company_name)
      }
    } catch (err) {
      console.log('[Enrichment] Kunde inte enricha:', err.message)
    } finally {
      setEnriching(false)
    }
  }, [foretagNamn])

  // Submit allt
  const handleFinalSubmit = async () => {
    setSaving(true)
    setError('')
    try {
      const submitData = {
        namn: foretagNamn,
        org_nummer: orgNummer || null,
        epost,
        kontaktperson: kontaktpersonVal,
        syfte: syfte === 'influencers' ? 'influencers' : 'sponsorer',
        erbjudande_typ: erbjudandeTyp,
        beskrivning,
        domain: domain || null,
        bransch: null, // Härleds av AI i Steg 2 baserat på beskrivning
      }

      let result
      if (foretag?.id) {
        result = await api.updateForetag(foretag.id, submitData)
      } else {
        result = await api.createForetag(submitData)
      }

      // Spara enrichment som company_profile om vi har det
      if (result?.id && enrichmentData) {
        try {
          await api.saveCompanyProfile(result.id, {
            enrichment_data: enrichmentData,
            company_profile: {
              company: foretagNamn,
              domain,
              industry: enrichmentData?.industry,
              beskrivning,
              erbjudande_typ: erbjudandeTyp,
              syfte,
            },
          })
        } catch (e) {
          console.log('Kunde inte spara profil:', e.message)
        }
      }

      // Synka outreachType i wizard
      setOutreachType(syfte === 'sponsorer' ? 'sponsor' : 'influencer')
      setForetag(result)
      if (kontaktpersonVal) setKontaktperson(kontaktpersonVal)
      next()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  // ─── Fråge-rendering ───
  const renderQuestion = () => {
    switch (q) {
      // ═══ FRÅGA 1: Syfte ═══
      case 0:
        return (
          <SlideIn key="q0" direction={direction}>
            <h2 className="text-2xl font-bold text-white mb-8">Söker du influencers eller sponsorer?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
              <ChoiceCard
                icon={Users}
                title="Influencers"
                subtitle="Hitta kreatörer på YouTube, TikTok & Instagram"
                selected={syfte === 'influencers'}
                color="purple"
                onClick={() => { setSyfte('influencers'); setTimeout(goNext, 250) }}
              />
              <ChoiceCard
                icon={Building}
                title="Sponsorer"
                subtitle="Hitta företag för B2B-partnerskap & sponsring"
                selected={syfte === 'sponsorer'}
                color="blue"
                onClick={() => { setSyfte('sponsorer'); setTimeout(goNext, 250) }}
              />
            </div>
          </SlideIn>
        )

      // ═══ FRÅGA 2: Namn ═══
      case 1:
        return (
          <SlideIn key="q1" direction={direction}>
            <TextQuestion
              label="Ditt namn"
              placeholder="T.ex. Jimmy"
              value={kontaktpersonVal}
              onChange={setKontaktpersonVal}
              onSubmit={goNext}
            />
          </SlideIn>
        )

      // ═══ FRÅGA 3: Företagsnamn + Orgnummer ═══
      case 2:
        return (
          <SlideIn key="q2" direction={direction}>
            <div className="max-w-lg">
              <label className="block text-2xl font-bold text-white mb-3">Företagsnamn</label>
              <input
                type="text"
                autoFocus
                value={foretagNamn}
                onChange={(e) => setForetagNamn(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && foretagNamn.trim()) goNext() }}
                className="w-full bg-transparent border-b-2 border-gray-600 focus:border-purple-500 text-white text-lg py-3 px-2 placeholder-gray-600 focus:outline-none transition-colors"
                placeholder="T.ex. RankLeague"
              />
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-400 mb-1.5">Organisationsnummer <span className="text-gray-600">(valfritt)</span></label>
                <input
                  type="text"
                  value={orgNummer}
                  onChange={(e) => setOrgNummer(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && foretagNamn.trim()) goNext() }}
                  className="w-full bg-transparent border-b-2 border-gray-700 focus:border-purple-500 text-white text-base py-2 px-2 placeholder-gray-600 focus:outline-none transition-colors"
                  placeholder="XXXXXX-XXXX"
                />
              </div>
              <div className="flex items-center gap-3 mt-5">
                <button type="button" onClick={goNext} disabled={!foretagNamn.trim()}
                  className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors">
                  OK ✓
                </button>
                <span className="text-xs text-gray-500">Enter ↵</span>
              </div>
            </div>
          </SlideIn>
        )

      // ═══ FRÅGA 4: Hemsida (valfri) ═══
      case 3:
        return (
          <SlideIn key="q3" direction={direction}>
            <div className="max-w-lg">
              <label className="block text-2xl font-bold text-white mb-3">Har ni en hemsida?</label>
              <p className="text-sm text-gray-400 mb-5">Valfritt — ger AI:n extra kontext för bättre matchning.</p>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                  type="text"
                  autoFocus
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (domain.trim()) triggerEnrichment(domain)
                      goNext()
                    }
                  }}
                  className="w-full bg-transparent border-b-2 border-gray-600 focus:border-purple-500 text-white text-lg py-3 pl-10 pr-2 placeholder-gray-600 focus:outline-none transition-colors"
                  placeholder="www.example.com"
                />
              </div>

              {enriching && (
                <p className="text-xs text-purple-400 mt-3 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyserar hemsida i bakgrunden...
                </p>
              )}

              {enrichmentData?.success && (
                <div className="mt-4 bg-purple-500/5 border border-purple-500/20 rounded-lg p-3 text-sm space-y-1">
                  <div className="flex items-center gap-1.5 text-purple-300 text-xs font-medium">
                    <Sparkles className="w-3.5 h-3.5" /> Hittade info
                  </div>
                  {enrichmentData.company_name && <p className="text-gray-300">{enrichmentData.company_name}</p>}
                  {enrichmentData.description && <p className="text-gray-500 text-xs line-clamp-2">{enrichmentData.description}</p>}
                </div>
              )}

              <div className="flex items-center gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => { if (domain.trim()) triggerEnrichment(domain); goNext() }}
                  className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors"
                >
                  {domain.trim() ? 'OK' : 'Hoppa över'} <ArrowRight className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-500">eller tryck Enter ↵</span>
              </div>
            </div>
          </SlideIn>
        )

      // ═══ FRÅGA 5: E-post ═══
      case 4:
        return (
          <SlideIn key="q4" direction={direction}>
            <TextQuestion
              label="Din e-postadress"
              placeholder="jimmy@rankleague.com"
              type="email"
              value={epost}
              onChange={setEpost}
              onSubmit={goNext}
            />
          </SlideIn>
        )

      // ═══ FRÅGA 6: Produkter / Tjänster / Både och ═══
      case 5:
        return (
          <SlideIn key="q5" direction={direction}>
            <h2 className="text-2xl font-bold text-white mb-8">Säljer ni produkter eller tjänster?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
              <ChoiceCard
                icon={Package}
                title="Produkter"
                subtitle="Fysiska eller digitala produkter"
                selected={erbjudandeTyp === 'produkter'}
                color="purple"
                onClick={() => { setErbjudandeTyp('produkter'); setTimeout(goNext, 250) }}
              />
              <ChoiceCard
                icon={Wrench}
                title="Tjänster"
                subtitle="SaaS, konsulting, plattformar"
                selected={erbjudandeTyp === 'tjanster'}
                color="blue"
                onClick={() => { setErbjudandeTyp('tjanster'); setTimeout(goNext, 250) }}
              />
              <ChoiceCard
                icon={() => (
                  <div className="flex -space-x-1">
                    <Package className="w-5 h-5" />
                    <Wrench className="w-5 h-5" />
                  </div>
                )}
                title="Både och"
                subtitle="Produkter + tjänster"
                selected={erbjudandeTyp === 'bade'}
                color="cyan"
                onClick={() => { setErbjudandeTyp('bade'); setTimeout(goNext, 250) }}
              />
            </div>
          </SlideIn>
        )

      // ═══ FRÅGA 7: Beskrivning ═══
      case 6:
        return (
          <SlideIn key="q6" direction={direction}>
            <div className="max-w-xl">
              <label className="block text-2xl font-bold text-white mb-3">Beskriv er verksamhet</label>
              <p className="text-sm text-gray-400 mb-2">
                Den här beskrivningen styr vilka {syfte === 'sponsorer' ? 'sponsorer' : 'influencers'} AI:n hittar. Var så specifik som möjligt.
              </p>
              <div className="text-xs text-gray-500 mb-5 space-y-1">
                <p className="text-gray-600">Skriv inte bara "gaming" — skriv t.ex. "fantasy fotboll-plattform för Allsvenskan riktad mot svenska sportfans".</p>
              </div>
              <textarea
                autoFocus
                value={beskrivning}
                onChange={(e) => setBeskrivning(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    if (beskrivning.trim()) handleFinalSubmit()
                  }
                }}
                rows={4}
                className="w-full bg-gray-800/50 border border-gray-700 focus:border-purple-500 rounded-xl text-white text-base py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors resize-none"
                placeholder="Beskriv er verksamhet här..."
              />
              <div className="flex items-center gap-3 mt-4">
                <button
                  type="button"
                  onClick={handleFinalSubmit}
                  disabled={!beskrivning.trim() || saving}
                  className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {saving ? 'Sparar...' : 'Klar'}
                </button>
                <span className="text-xs text-gray-500">Ctrl+Enter</span>
              </div>
            </div>

            {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
          </SlideIn>
        )

      default:
        return null
    }
  }

  return (
    <div className="min-h-[400px] flex flex-col">
      {/* Progress */}
      <ProgressDots current={q} total={TOTAL_QUESTIONS} />

      {/* Fråga */}
      <div className="flex-1 flex items-start">
        {renderQuestion()}
      </div>

      {/* Tillbaka-knapp */}
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
