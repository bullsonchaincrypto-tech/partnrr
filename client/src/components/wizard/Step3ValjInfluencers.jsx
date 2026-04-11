import { useState } from 'react'
import { CheckSquare, ArrowRight, ArrowLeft, Mail, ExternalLink, AlertTriangle, Check, CreditCard } from 'lucide-react'

const SAMARBETSTYPER = [
  { id: 'logotyp', label: 'Logotyp på hemsida', icon: '🌐', desc: 'Sponsorns logotyp visas på er webbplats' },
  { id: 'content', label: 'Omnämning i content', icon: '📱', desc: 'Nämns i sociala medier, nyhetsbrev, etc.' },
  { id: 'turnering', label: 'Turneringssponsring', icon: '🏆', desc: 'Sponsorn namnger en turnering eller liga' },
  { id: 'banner', label: 'Bannerplats/annons', icon: '📢', desc: 'Annonsplats på er plattform' },
  { id: 'rabattkod', label: 'Exklusiv rabattkod', icon: '🏷️', desc: 'Sponsorns rabattkod till era användare' },
  { id: 'ovrigt', label: 'Annat', icon: '✨', desc: 'Beskriv ert erbjudande i nästa steg' },
]

export default function Step3ValjInfluencers({ foretag, outreachType, influencers, setInfluencers, sponsorQuestions, setSponsorQuestions, next, prev }) {
  const [editingEmail, setEditingEmail] = useState(null)
  const [emailInput, setEmailInput] = useState('')
  const isSponsor = outreachType === 'sponsor'

  const selected = influencers.filter((i) => i.vald)
  const withEmail = selected.filter((i) => i.kontakt_epost)
  const withoutEmail = selected.filter((i) => !i.kontakt_epost)

  const startEditEmail = (inf) => {
    setEditingEmail(inf.id)
    setEmailInput(inf.kontakt_epost || '')
  }

  const saveEmail = (id) => {
    setInfluencers((prev) => prev.map((i) =>
      i.id === id ? { ...i, kontakt_epost: emailInput || null } : i
    ))
    setEditingEmail(null)
    setEmailInput('')
  }

  const getAboutUrl = (kanalnamn) => {
    const name = (kanalnamn || '').replace(/^@/, '')
    return `https://youtube.com/@${name}/about`
  }

  if (selected.length === 0) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-6">
          <CheckSquare className="w-6 h-6 text-purple-500" />
          <h2 className="text-xl font-bold">Steg 3: E-post & Förbered</h2>
        </div>
        <p className="text-gray-400 text-center py-8">Inga influencers valda. Gå tillbaka till Steg 2 och välj minst en.</p>
        <button onClick={prev} className="flex items-center gap-2 text-gray-400 hover:text-white px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Tillbaka
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <CheckSquare className="w-6 h-6 text-purple-500" />
        <h2 className="text-xl font-bold">Steg 3: E-post & Förbered</h2>
      </div>

      {/* Sammanfattning */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 text-center">
          <div className="text-2xl font-bold text-purple-400">{selected.length}</div>
          <div className="text-sm text-gray-400">Valda influencers</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 text-center">
          <div className="text-2xl font-bold text-green-400">{withEmail.length}</div>
          <div className="text-sm text-gray-400">Med e-post</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 text-center">
          <div className={`text-2xl font-bold ${withoutEmail.length > 0 ? 'text-yellow-400' : 'text-green-400'}`}>{withoutEmail.length}</div>
          <div className="text-sm text-gray-400">Saknar e-post</div>
        </div>
      </div>

      {withoutEmail.length > 0 && (
        <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 mb-4">
          <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-yellow-300 font-medium">{withoutEmail.length} valda influencers saknar e-post</p>
            <p className="text-yellow-300/60 text-xs mt-0.5">
              Lägg till e-post manuellt eller öppna deras YouTube About-sida. Meddelanden utan e-post kan inte skickas.
            </p>
          </div>
        </div>
      )}

      {/* Lista valda influencers */}
      <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
        {selected.map((inf) => (
          <div
            key={inf.id}
            className={`rounded-lg border p-3 ${
              inf.kontakt_epost ? 'border-green-500/20 bg-green-500/5' : 'border-yellow-500/20 bg-yellow-500/5'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                inf.kontakt_epost ? 'bg-green-500/20' : 'bg-yellow-500/20'
              }`}>
                {inf.kontakt_epost ? (
                  <Check className="w-3 h-3 text-green-400" />
                ) : (
                  <Mail className="w-3 h-3 text-yellow-400" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <span className="font-medium text-white text-sm">{inf.namn}</span>
                <span className="text-xs text-gray-500 ml-2">@{inf.kanalnamn} · {inf.foljare}</span>
              </div>

              {inf.kontakt_epost ? (
                <span className="text-xs text-green-400">{inf.kontakt_epost}</span>
              ) : (
                <span className="text-xs text-yellow-400">Saknar e-post</span>
              )}
            </div>

            {/* E-postredigering */}
            <div className="flex items-center gap-2 mt-2 ml-9">
              {editingEmail === inf.id ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="namn@example.com"
                    className="text-xs bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white flex-1 focus:border-purple-500 focus:outline-none"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && saveEmail(inf.id)}
                  />
                  <button onClick={() => saveEmail(inf.id)} className="text-xs text-green-400 hover:text-green-300">Spara</button>
                  <button onClick={() => setEditingEmail(null)} className="text-xs text-gray-500 hover:text-gray-400">Avbryt</button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => startEditEmail(inf)}
                    className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
                  >
                    <Mail className="w-3 h-3" /> {inf.kontakt_epost ? 'Ändra' : 'Lägg till e-post'}
                  </button>
                  <a
                    href={getAboutUrl(inf.kanalnamn)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-gray-500 hover:text-gray-400 flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" /> YouTube About
                  </a>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Sponsor-specifika frågor — visa före nästa steg */}
      {isSponsor && selected.length > 0 && (
        <>
          <div className="mt-8 pt-8 border-t border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-blue-400" />
              </div>
              Sponsorsamarbete
            </h3>

            {/* Fråga 1: Vilken typ av samarbete */}
            <div className="mb-8">
              <label className="block text-sm font-medium text-gray-300 mb-3">Vilken typ av samarbete?</label>
              <p className="text-sm text-gray-400 mb-4">Välj vad ni vill erbjuda sponsorn. Välj en eller flera.</p>
              <div className="space-y-2">
                {SAMARBETSTYPER.map(typ => {
                  const selected = sponsorQuestions.samarbetstyper.includes(typ.id)
                  return (
                    <button key={typ.id} type="button"
                      onClick={() => setSponsorQuestions(prev => ({
                        ...prev,
                        samarbetstyper: prev.samarbetstyper.includes(typ.id)
                          ? prev.samarbetstyper.filter(t => t !== typ.id)
                          : [...prev.samarbetstyper, typ.id]
                      }))}
                      className={`flex items-center gap-3 w-full text-left px-4 py-3 rounded-xl border-2 transition-all ${
                        selected ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700 hover:border-gray-600'
                      }`}>
                      <span className="text-xl">{typ.icon}</span>
                      <div className="flex-1">
                        <div className="font-medium text-white text-sm">{typ.label}</div>
                        <div className="text-xs text-gray-400">{typ.desc}</div>
                      </div>
                      {selected && <Check className="w-4 h-4 text-blue-400" />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Fråga 2: Erbjudande & pris */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Vad erbjuder ni sponsorn?</label>
                <textarea
                  value={sponsorQuestions.vadNiErbjuder}
                  onChange={(e) => setSponsorQuestions(prev => ({ ...prev, vadNiErbjuder: e.target.value }))}
                  rows={3}
                  className="w-full bg-gray-800/50 border border-gray-700 focus:border-blue-500 rounded-xl text-white text-base py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors resize-none"
                  placeholder="T.ex. Logotyp i sidfoten på hemsidan + omnämning i 2 sociala medier-inlägg per månad + bannerplats vid turneringar"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Pris / ersättning</label>
                <input
                  type="text"
                  value={sponsorQuestions.sponsorPris}
                  onChange={(e) => setSponsorQuestions(prev => ({ ...prev, sponsorPris: e.target.value }))}
                  className="w-full bg-gray-800/50 border border-gray-700 focus:border-blue-500 rounded-xl text-white text-lg py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors"
                  placeholder="T.ex. 5 000 SEK/mån"
                />
              </div>
            </div>
          </div>
        </>
      )}

      <div className="flex gap-3 mt-6">
        <button onClick={prev} className="flex items-center gap-2 text-gray-400 hover:text-white px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Tillbaka
        </button>
        {selected.length > 0 && (
          <button onClick={next} disabled={isSponsor && (sponsorQuestions.samarbetstyper.length === 0 || !sponsorQuestions.vadNiErbjuder.trim())} className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg font-medium transition-colors">
            Generera outreach för {selected.length} influencers <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
