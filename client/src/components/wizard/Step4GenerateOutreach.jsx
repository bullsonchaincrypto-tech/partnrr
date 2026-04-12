import { useState, useEffect, useRef, useCallback } from 'react'
import { MessageSquare, ArrowRight, ArrowLeft, Loader2, Pencil, Save, ChevronDown, ChevronUp, RefreshCw, Check, Gift, Megaphone, PenLine } from 'lucide-react'
import * as api from '../../services/api'

// ─── Markdown renderer ───
function renderMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>')
}

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

// CTA-alternativ — influencers
const INFLUENCER_CTA_OPTIONS = [
  { id: 'skapa_video', label: 'Skapa en video', icon: '🎬' },
  { id: 'testa_plattform', label: 'Testa plattformen & dela upplevelsen', icon: '🎮' },
  { id: 'posta_story', label: 'Posta en story / reel', icon: '📱' },
  { id: 'boka_mote', label: 'Boka ett möte / samtal', icon: '📞' },
  { id: 'dela_lank', label: 'Dela en länk / referral-kod', icon: '🔗' },
  { id: 'annat', label: 'Annat', icon: '✏️' },
]

// CTA-alternativ — sponsorer
const SPONSOR_CTA_OPTIONS = [
  { id: 'boka_mote', label: 'Boka ett möte / samtal', icon: '📞' },
  { id: 'svara_epost', label: 'Svara på detta mail', icon: '📧' },
  { id: 'se_mediakit', label: 'Se vårt mediakit / sponsorpaket', icon: '📊' },
  { id: 'testa_plattform', label: 'Testa vår plattform', icon: '🎮' },
  { id: 'besoka_hemsida', label: 'Besöka vår hemsida', icon: '🌐' },
  { id: 'annat', label: 'Annat', icon: '✏️' },
]

const TOTAL_BRIEF_QUESTIONS = 3

export default function Step4GenerateOutreach({ foretag, outreachType, outreachBrief, setOutreachBrief, messages, setMessages, sponsorQuestions, next, prev }) {
  // ─── Brief state ───
  const [briefDone, setBriefDone] = useState(!!outreachBrief?.erbjudande)
  const [q, setQ] = useState(0)
  const [direction, setDirection] = useState('right')
  const [erbjudande, setErbjudande] = useState(outreachBrief?.erbjudande || '')
  const [ctaVal, setCtaVal] = useState(outreachBrief?.cta || [])
  const [extraInfo, setExtraInfo] = useState(outreachBrief?.extra || '')

  // ─── Generate state ───
  const [loading, setLoading] = useState(false)
  const [generatingId, setGeneratingId] = useState(null)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [editAmne, setEditAmne] = useState('')
  const [expandedIds, setExpandedIds] = useState(new Set())

  const isSponsor = outreachType === 'sponsor'

  // ─── Brief navigation ───
  const goNext = useCallback(() => {
    setDirection('right')
    setQ(prev => Math.min(prev + 1, TOTAL_BRIEF_QUESTIONS - 1))
  }, [])

  const goBack = useCallback(() => {
    setDirection('left')
    setQ(prev => Math.max(prev - 1, 0))
  }, [])

  // Keyboard
  useEffect(() => {
    if (briefDone) return
    const handler = (e) => {
      if (e.key === 'Escape' && q > 0) goBack()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [q, goBack, briefDone])

  const toggleCta = (id) => {
    setCtaVal(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id])
  }

  // Spara brief och starta generering
  const handleBriefFinish = async () => {
    const brief = { erbjudande, cta: ctaVal, extra: extraInfo }
    setOutreachBrief(brief)
    setBriefDone(true)

    // Auto-generera meddelanden direkt
    setLoading(true)
    setError('')
    try {
      // Spara brief till company_profile
      if (foretag?.id) {
        try {
          await api.saveCompanyProfile(foretag.id, {
            company_profile: { outreach_brief: brief },
            brief_answers: brief,
          })
        } catch (e) { console.log('Kunde inte spara brief:', e.message) }
      }

      if (isSponsor) {
        const result = await api.generateSponsorOutreach(foretag.id, 'email', sponsorQuestions)
        setMessages(result)
        if (result.length > 0) setExpandedIds(new Set([result[0].id]))
      } else {
        const result = await api.generateOutreach(foretag.id)
        setMessages(result)
        if (result.length > 0) setExpandedIds(new Set([result[0].id]))
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ─── Generate helpers ───
  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const expandAll = () => setExpandedIds(new Set(messages.map(m => m.id)))
  const collapseAll = () => setExpandedIds(new Set())

  const handleRegenerate = async (msgId) => {
    setGeneratingId(msgId)
    try {
      if (isSponsor) {
        const result = await api.generateSponsorOutreach(foretag.id, 'email', sponsorQuestions)
        const regenerated = result.find(r => r.id === msgId)
        if (regenerated) setMessages(prev => prev.map(m => m.id === msgId ? regenerated : m))
      } else {
        const result = await api.regenerateOutreach(msgId).catch(() => null)
        if (result) {
          setMessages(prev => prev.map(m => m.id === msgId ? result : m))
        } else {
          const allResult = await api.generateOutreach(foretag.id)
          const regenerated = allResult.find(r => r.influencer_namn === messages.find(m => m.id === msgId)?.influencer_namn)
          if (regenerated) setMessages(prev => prev.map(m => m.id === msgId ? { ...regenerated, id: msgId } : m))
        }
      }
    } catch (err) {
      console.error('Regenerate failed:', err)
    } finally {
      setGeneratingId(null)
    }
  }

  const startEdit = (msg) => {
    setEditingId(msg.id)
    setEditText(msg.meddelande)
    setEditAmne(msg.amne)
    setExpandedIds(prev => new Set([...prev, msg.id]))
  }

  const saveEdit = async (id) => {
    try {
      const updateFn = isSponsor ? api.updateSponsorOutreach : api.updateOutreach
      const updated = await updateFn(id, { meddelande: editText, amne: editAmne })
      setMessages(prev => prev.map(m => m.id === id ? updated : m))
      setEditingId(null)
    } catch (err) {
      console.error(err)
    }
  }

  // Om brief redan är gjord och meddelanden finns, gå direkt till regenerering-knapp
  const handleRegenerateAll = async () => {
    setLoading(true)
    setError('')
    try {
      if (foretag?.id && outreachBrief) {
        try {
          await api.saveCompanyProfile(foretag.id, {
            company_profile: { outreach_brief: outreachBrief },
            brief_answers: outreachBrief,
          })
        } catch {}
      }
      if (isSponsor) {
        const result = await api.generateSponsorOutreach(foretag.id, 'email', sponsorQuestions)
        setMessages(result)
        if (result.length > 0) setExpandedIds(new Set([result[0].id]))
      } else {
        const result = await api.generateOutreach(foretag.id)
        setMessages(result)
        if (result.length > 0) setExpandedIds(new Set([result[0].id]))
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ═══════════════════════════════════════════════════════
  // RENDER: Brief-frågor (om inte klara)
  // ═══════════════════════════════════════════════════════
  if (!briefDone && messages.length === 0) {
    const renderBriefQuestion = () => {
      switch (q) {
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
                    ? 'T.ex. Vi erbjuder exponering mot 50 000+ aktiva användare inom fantasy sport.'
                    : 'T.ex. 300 SEK per video + 10 SEK per signup med din referral-kod. Gratis tillgång till vår premium-plattform.'}
                />
                <div className="flex items-center gap-3 mt-5">
                  <button type="button" onClick={goNext} disabled={!erbjudande.trim()}
                    className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors">
                    OK <Check className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-gray-500">Ctrl+Enter</span>
                </div>
              </div>
            </SlideIn>
          )

        case 1:
          return (
            <SlideIn key="brief-q1" direction={direction}>
              <div className="max-w-xl">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                    <Megaphone className="w-5 h-5 text-purple-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-white">{isSponsor ? 'Vad ska sponsorn göra?' : 'Vad ska mottagaren göra?'}</h2>
                </div>
                <p className="text-sm text-gray-400 mb-6">Välj en eller flera — detta blir call-to-action i meddelandet.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {(isSponsor ? SPONSOR_CTA_OPTIONS : INFLUENCER_CTA_OPTIONS).map((opt) => {
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
                  <button type="button" onClick={goNext} disabled={ctaVal.length === 0}
                    className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors">
                    OK <Check className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-gray-500">{ctaVal.length} valda</span>
                </div>
              </div>
            </SlideIn>
          )

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
                  Valfritt — en kampanjdeadline, specifik produkt, att ni redan pratat med andra {isSponsor ? 'sponsorer' : 'influencers'}, eller annan kontext.
                </p>
                <textarea
                  autoFocus
                  value={extraInfo}
                  onChange={(e) => setExtraInfo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      handleBriefFinish()
                    }
                  }}
                  rows={3}
                  className="w-full bg-gray-800/50 border border-gray-700 focus:border-purple-500 rounded-xl text-white text-base py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors resize-none"
                  placeholder="T.ex. Vi lanserar en ny Allsvenskan-säsong i maj och vill ha allt content ute innan dess."
                />
                <div className="flex items-center gap-3 mt-5">
                  <button type="button" onClick={handleBriefFinish}
                    className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors">
                    {extraInfo.trim() ? 'Generera meddelanden' : 'Hoppa över & generera'} <ArrowRight className="w-4 h-4" />
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
      <div className="flex flex-col">
        <div className="flex items-center gap-3 mb-2">
          <MessageSquare className={`w-6 h-6 ${isSponsor ? 'text-blue-500' : 'text-purple-500'}`} />
          <h2 className="text-xl font-bold">Generera utskick</h2>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          Besvara några snabba frågor så skapar AI personliga meddelanden åt dig.
        </p>

        <ProgressDots current={q} total={TOTAL_BRIEF_QUESTIONS} />

        <div className="flex-1 flex items-start">
          {renderBriefQuestion()}
        </div>

        {q > 0 && (
          <div className="mt-8 pt-4 border-t border-gray-800/50">
            <button type="button" onClick={goBack}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> Tillbaka
            </button>
          </div>
        )}
        {q === 0 && (
          <div className="mt-8">
            <button onClick={prev}
              className="flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors">
              <ArrowLeft className="w-4 h-4" /> {isSponsor ? 'Tillbaka till sponsorer' : 'Tillbaka till influencers'}
            </button>
          </div>
        )}
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════
  // RENDER: Generering / Meddelanden
  // ═══════════════════════════════════════════════════════
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 mb-6">
        <MessageSquare className={`w-6 h-6 ${isSponsor ? 'text-blue-500' : 'text-purple-500'}`} />
        <h2 className="text-xl font-bold">Generera utskick</h2>
      </div>

      {/* Laddar */}
      {loading && messages.length === 0 && (
        <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center gap-3 mb-3">
            <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
            <span className="text-gray-300">AI genererar personliga meddelanden...</span>
          </div>
          <p className="text-xs text-gray-500 ml-8">Detta kan ta 15-30 sekunder beroende på antal {isSponsor ? 'sponsorer' : 'influencers'}.</p>
        </div>
      )}

      {/* Error */}
      {error && !loading && messages.length === 0 && (
        <div className="space-y-3">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={handleRegenerateAll} className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors">
            <RefreshCw className="w-4 h-4" /> Försök igen
          </button>
        </div>
      )}

      {/* Brief-sammanfattning */}
      {outreachBrief?.erbjudande && messages.length > 0 && (
        <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg px-4 py-3 mb-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-purple-300/60">
              <span className="font-medium text-purple-300">Erbjudande:</span> {outreachBrief.erbjudande.slice(0, 80)}{outreachBrief.erbjudande.length > 80 ? '...' : ''}
              {outreachBrief.cta?.length > 0 && (
                <span className="ml-3"><span className="font-medium text-purple-300">CTA:</span> {outreachBrief.cta.length} valda</span>
              )}
            </div>
            <button
              onClick={() => { setBriefDone(false); setQ(0); setMessages([]) }}
              className="text-xs text-purple-400 hover:text-purple-300 px-2 py-1 rounded hover:bg-purple-500/10 transition-colors"
            >
              Ändra brief
            </button>
          </div>
        </div>
      )}

      {/* Meddelanden */}
      {messages.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">{messages.length} meddelanden genererade</p>
            <div className="flex items-center gap-2">
              <button onClick={expandAll} className="text-xs text-purple-400 hover:text-purple-300">Expandera alla</button>
              <span className="text-gray-700">|</span>
              <button onClick={collapseAll} className="text-xs text-gray-400 hover:text-gray-300">Minimera alla</button>
            </div>
          </div>

          {messages.map((msg) => {
            const isExpanded = expandedIds.has(msg.id)
            const isEditing = editingId === msg.id
            const isRegenerating = generatingId === msg.id

            return (
              <div key={msg.id} className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-800/70 transition-colors"
                  onClick={() => !isEditing && toggleExpand(msg.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white text-sm">{msg.influencer_namn || msg.prospect_namn}</span>
                      <span className="text-xs text-gray-500">{msg.plattform || msg.prospect_bransch} {msg.kanalnamn ? `· ${msg.kanalnamn}` : ''}</span>
                    </div>
                    <div className={`text-xs ${isSponsor ? 'text-blue-400' : 'text-purple-400'} mt-0.5`}>
                      {msg.amne}
                    </div>
                    {(msg.kontakt_epost || msg.prospect_epost) && (
                      <div className="text-xs text-gray-500 mt-0.5">Till: {msg.kontakt_epost || msg.prospect_epost}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isRegenerating ? (
                      <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); handleRegenerate(msg.id) }}
                        className="text-gray-500 hover:text-purple-400 transition-colors p-1" title="Regenerera">
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {!isEditing && (
                      <button onClick={(e) => { e.stopPropagation(); startEdit(msg) }}
                        className="text-gray-500 hover:text-white transition-colors p-1" title="Redigera">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-700 p-4">
                    {isEditing ? (
                      <div className="space-y-2">
                        <input type="text" value={editAmne} onChange={(e) => setEditAmne(e.target.value)}
                          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:border-purple-500 focus:outline-none"
                          placeholder="Ämne" />
                        <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={10}
                          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white resize-y focus:border-purple-500 focus:outline-none" />
                        <div className="flex gap-2">
                          <button onClick={() => saveEdit(msg.id)} className="flex items-center gap-1 text-green-400 hover:text-green-300 text-sm px-3 py-1 bg-green-500/10 rounded">
                            <Save className="w-3.5 h-3.5" /> Spara
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-white text-sm px-3 py-1">Avbryt</button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-300 leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.meddelande) }} />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Sticky bottom CTA */}
      {messages.length > 0 && (
        <div className="sticky bottom-0 bg-gray-900 pt-4 pb-1 -mx-6 px-6 mt-4 border-t border-gray-800/50">
          <div className="flex gap-3">
            <button onClick={prev} className="flex items-center gap-2 text-gray-400 hover:text-white px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors">
              <ArrowLeft className="w-4 h-4" /> Tillbaka
            </button>
            <button onClick={next} className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors">
              Fortsätt till kontrakt <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {messages.length === 0 && !loading && !error && (
        <div className="flex gap-3 mt-6">
          <button onClick={prev} className="flex items-center gap-2 text-gray-400 hover:text-white px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Tillbaka
          </button>
        </div>
      )}
    </div>
  )
}
