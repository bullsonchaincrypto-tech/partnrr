import { useState, useEffect } from 'react'
import { Building, Search, CheckSquare, MessageSquare, Send, ArrowRight, ArrowLeft, Loader2, Check, Pencil, Save, ExternalLink, Mail, Instagram, CheckCircle, XCircle } from 'lucide-react'
import * as api from '../../services/api'

const STEPS = [
  { label: 'Välj Företag', icon: Building },
  { label: 'Hitta Prospects', icon: Search },
  { label: 'Välj & Generera', icon: MessageSquare },
  { label: 'Granska & Skicka', icon: Send },
]

export default function SponsorWizard() {
  const [step, setStep] = useState(0)
  const [foretag, setForetag] = useState(null)
  const [foretagList, setForetagList] = useState([])
  const [prospects, setProspects] = useState([])
  const [messages, setMessages] = useState([])
  const [kanal, setKanal] = useState('email')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [editAmne, setEditAmne] = useState('')
  const [sendResults, setSendResults] = useState(null)
  const [authStatus, setAuthStatus] = useState(null)

  useEffect(() => {
    api.getForetag().then(setForetagList).catch(console.error)
    api.getAuthStatus().then(setAuthStatus).catch(console.error)
  }, [])

  const next = () => setStep(s => Math.min(s + 1, 3))
  const prev = () => setStep(s => Math.max(s - 1, 0))

  // Step 0: Select company
  const handleSelectForetag = (f) => { setForetag(f); next() }

  // Step 1: Find prospects
  const handleFindProspects = async () => {
    setLoading(true); setError('')
    try {
      const result = await api.findSponsorProspects(foretag.id)
      setProspects(result)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const toggleProspect = async (id) => {
    try {
      const updated = await api.toggleSponsorProspect(id)
      setProspects(prev => prev.map(p => p.id === id ? updated : p))
    } catch (e) { console.error(e) }
  }

  // Step 2: Generate pitches
  const handleGenerate = async () => {
    setLoading(true); setError('')
    try {
      const result = await api.generateSponsorOutreach(foretag.id, kanal)
      setMessages(result)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const saveEdit = async (id) => {
    try {
      const updated = await api.updateSponsorOutreach(id, { meddelande: editText, amne: editAmne })
      setMessages(prev => prev.map(m => m.id === id ? updated : m))
      setEditingId(null)
    } catch (e) { console.error(e) }
  }

  // Step 3: Send
  const handleSend = async () => {
    setLoading(true); setError('')
    try {
      const emailMsgs = messages.filter(m => m.prospect_epost)
      const results = await api.sendSponsorOutreach(emailMsgs.map(m => m.id))
      setSendResults(results)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const selectedCount = prospects.filter(p => p.vald).length

  return (
    <div>
      {/* Progress */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            return (
              <button key={i} onClick={() => i <= step && setStep(i)} className="flex flex-col items-center gap-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                  i === step ? 'bg-blue-600 text-white' : i < step ? 'bg-blue-600/30 text-blue-400' : 'bg-gray-800 text-gray-500'
                }`}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className={`text-xs font-medium ${i === step ? 'text-blue-400' : i < step ? 'text-gray-400' : 'text-gray-600'}`}>{s.label}</span>
              </button>
            )
          })}
        </div>
        <div className="mt-3 h-1 bg-gray-800 rounded-full">
          <div className="h-1 bg-blue-600 rounded-full transition-all duration-300" style={{ width: `${(step / 3) * 100}%` }} />
        </div>
      </div>

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">

        {/* STEP 0: Select Foretag */}
        {step === 0 && (
          <div>
            <h2 className="text-xl font-bold flex items-center gap-3 mb-6">
              <Building className="w-6 h-6 text-blue-500" /> Välj företag
            </h2>
            {foretagList.length === 0 ? (
              <p className="text-gray-400">Inga företag skapade. Gå till Influencer Outreach och skapa ett företag först.</p>
            ) : (
              <div className="space-y-2">
                {foretagList.map(f => (
                  <button key={f.id} onClick={() => handleSelectForetag(f)}
                    className="w-full text-left p-4 rounded-lg border border-gray-700 hover:border-blue-500 bg-gray-800/30 transition-colors">
                    <div className="font-medium text-white">{f.namn}</div>
                    <div className="text-sm text-gray-400">{f.epost} {f.bransch && `· ${f.bransch}`}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* STEP 1: Find Prospects */}
        {step === 1 && (
          <div>
            <h2 className="text-xl font-bold flex items-center gap-3 mb-6">
              <Search className="w-6 h-6 text-blue-500" /> Hitta sponsorprospects
            </h2>
            <p className="text-gray-400 mb-4">
              AI söker svenska företag som passar som sponsorer för <span className="text-blue-400 font-medium">{foretag?.namn}</span>.
            </p>
            <button onClick={handleFindProspects} disabled={loading}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg font-medium transition-colors mb-6">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
              {loading ? 'Söker prospects...' : 'Hitta sponsorprospects med AI'}
            </button>
            {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

            {prospects.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-800">
                      <th className="pb-2 pr-4">Företag</th>
                      <th className="pb-2 pr-4">Bransch</th>
                      <th className="pb-2 pr-4">E-post</th>
                      <th className="pb-2 pr-4">Telefon</th>
                      <th className="pb-2 pr-4">Hemsida</th>
                      <th className="pb-2 pr-4" title="Google-omdöme (1-5 stjärnor)">Omdöme</th>
                      <th className="pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prospects.map(p => (
                      <tr key={p.id} className="border-b border-gray-800/50">
                        <td className="py-2 pr-4 font-medium text-white">{p.namn}</td>
                        <td className="py-2 pr-4 text-gray-300">{p.bransch}</td>
                        <td className="py-2 pr-4 text-gray-400">{p.epost || '-'}</td>
                        <td className="py-2 pr-4 text-gray-400">{p.telefon || '-'}</td>
                        <td className="py-2 pr-4 text-gray-400">
                          {p.hemsida ? <a href={p.hemsida} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{p.hemsida.replace(/^https?:\/\/(www\.)?/, '').slice(0, 30)}</a> : '-'}
                        </td>
                        <td className="py-2 pr-4 text-yellow-400" title={p.betyg ? `Google-omdöme: ${p.betyg} av 5 stjärnor` : ''}>{p.betyg ? `⭐ ${p.betyg}` : '-'}</td>
                        <td className="py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${p.kalla === 'google_maps' ? 'bg-green-900/50 text-green-400' : 'bg-purple-900/50 text-purple-400'}`}
                            title={p.kalla === 'google_maps' ? 'Hittad via Google — verifierat företag' : 'AI-genererat förslag'}>
                            {p.kalla === 'google_maps' ? 'Verifierat' : 'AI'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <button onClick={prev} className="flex items-center gap-2 text-gray-400 hover:text-white px-4 py-2 rounded-lg border border-gray-700 transition-colors">
                <ArrowLeft className="w-4 h-4" /> Tillbaka
              </button>
              {prospects.length > 0 && (
                <button onClick={next} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors">
                  Fortsätt <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* STEP 2: Select + Generate */}
        {step === 2 && (
          <div>
            <h2 className="text-xl font-bold flex items-center gap-3 mb-6">
              <MessageSquare className="w-6 h-6 text-blue-500" /> Välj prospects & generera pitch
            </h2>

            {/* Channel selection */}
            <div className="flex gap-3 mb-6">
              <button onClick={() => setKanal('email')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${kanal === 'email' ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-gray-700 text-gray-400'}`}>
                <Mail className="w-4 h-4" /> E-post
              </button>
              <button onClick={() => setKanal('instagram_dm')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${kanal === 'instagram_dm' ? 'border-pink-500 bg-pink-500/10 text-pink-400' : 'border-gray-700 text-gray-400'}`}>
                <Instagram className="w-4 h-4" /> Instagram DM
              </button>
            </div>

            {/* Prospect selection */}
            <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
              {prospects.map(p => (
                <button key={p.id} onClick={() => toggleProspect(p.id)}
                  className={`w-full flex items-center gap-4 p-3 rounded-lg border transition-colors text-left ${
                    p.vald ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-800 bg-gray-800/30 hover:border-gray-700'
                  }`}>
                  <div className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${p.vald ? 'bg-blue-600 border-blue-600' : 'border-gray-600'}`}>
                    {p.vald && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <div className="flex-1">
                    <span className="font-medium text-white">{p.namn}</span>
                    <span className="text-xs text-gray-400 ml-2">{p.bransch}</span>
                    {p.betyg && <span className="text-xs text-yellow-400 ml-2" title={`Google-omdöme: ${p.betyg} av 5 stjärnor`}>⭐ {p.betyg}</span>}
                  </div>
                  {p.kalla === 'google_maps' && <span className="text-xs px-1.5 py-0.5 rounded bg-green-900/50 text-green-400" title="Hittad via Google — verifierat företag">Verifierat</span>}
                  {p.epost && <span className="text-xs text-green-400">E-post</span>}
                  {p.telefon && <span className="text-xs text-blue-400">Tel</span>}
                  {p.instagram_handle && <span className="text-xs text-pink-400">IG</span>}
                </button>
              ))}
            </div>

            {selectedCount > 0 && messages.length === 0 && (
              <button onClick={handleGenerate} disabled={loading}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg font-medium transition-colors mb-4">
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <MessageSquare className="w-5 h-5" />}
                {loading ? 'Genererar pitchar...' : `Generera ${kanal === 'instagram_dm' ? 'DM' : 'e-post'} för ${selectedCount} prospects`}
              </button>
            )}
            {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

            {/* Generated messages */}
            {messages.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm text-gray-400">{messages.length} pitchar genererade</p>
                {messages.map(msg => (
                  <div key={msg.id} className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-medium text-white">{msg.prospect_namn}</span>
                        <span className="text-xs text-gray-400 ml-2">{msg.prospect_bransch}</span>
                        <span className={`text-xs ml-2 px-2 py-0.5 rounded-full ${msg.kanal === 'instagram_dm' ? 'bg-pink-900/50 text-pink-300' : 'bg-blue-900/50 text-blue-300'}`}>
                          {msg.kanal === 'instagram_dm' ? 'Instagram DM' : 'E-post'}
                        </span>
                      </div>
                      {editingId === msg.id ? (
                        <button onClick={() => saveEdit(msg.id)} className="flex items-center gap-1 text-green-400 hover:text-green-300 text-sm">
                          <Save className="w-4 h-4" /> Spara
                        </button>
                      ) : (
                        <button onClick={() => { setEditingId(msg.id); setEditText(msg.meddelande); setEditAmne(msg.amne) }}
                          className="flex items-center gap-1 text-gray-400 hover:text-white text-sm">
                          <Pencil className="w-4 h-4" /> Redigera
                        </button>
                      )}
                    </div>
                    {editingId === msg.id ? (
                      <div className="space-y-2">
                        <input type="text" value={editAmne} onChange={e => setEditAmne(e.target.value)}
                          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                        <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={6}
                          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white resize-y" />
                      </div>
                    ) : (
                      <div>
                        <div className="text-xs text-blue-400 mb-1">Ämne: {msg.amne}</div>
                        <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans">{msg.meddelande}</pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <button onClick={prev} className="flex items-center gap-2 text-gray-400 hover:text-white px-4 py-2 rounded-lg border border-gray-700 transition-colors">
                <ArrowLeft className="w-4 h-4" /> Tillbaka
              </button>
              {messages.length > 0 && (
                <button onClick={next} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors">
                  Granska & Skicka <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* STEP 3: Review + Send */}
        {step === 3 && (
          <div>
            <h2 className="text-xl font-bold flex items-center gap-3 mb-6">
              <Send className="w-6 h-6 text-blue-500" /> Granska & Skicka
            </h2>

            {/* E-poststatus */}
            <div className={`mb-6 p-4 rounded-lg border ${authStatus?.authenticated ? 'border-green-700 bg-green-900/20' : 'border-yellow-700 bg-yellow-900/20'}`}>
              <div className="flex items-center gap-3">
                <Mail className={`w-5 h-5 ${authStatus?.authenticated ? 'text-green-400' : 'text-yellow-400'}`} />
                {authStatus?.authenticated ? (
                  <span className="text-green-300">E-post anslutet: {authStatus.email} {authStatus.provider && <span className="text-green-400/60 capitalize">({authStatus.provider})</span>}</span>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-yellow-300">E-post ej anslutet</span>
                    <span className="text-sm text-gray-400">Gå till Utskick-fliken för att ansluta din e-post</span>
                  </div>
                )}
              </div>
            </div>

            {!sendResults && (
              <div>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 text-center">
                    <div className="text-2xl font-bold text-blue-400">{messages.length}</div>
                    <div className="text-sm text-gray-400">Pitchar</div>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 text-center">
                    <div className="text-2xl font-bold text-blue-400">{messages.filter(m => m.prospect_epost).length}</div>
                    <div className="text-sm text-gray-400">Med e-post</div>
                  </div>
                </div>

                <div className="space-y-2 mb-6">
                  {messages.map(msg => (
                    <div key={msg.id} className="flex items-center gap-3 p-3 bg-gray-800/30 rounded-lg border border-gray-700">
                      <Mail className="w-4 h-4 text-gray-400" />
                      <div className="flex-1">
                        <span className="text-white">{msg.prospect_namn}</span>
                        <span className="text-xs text-gray-400 ml-2">{msg.prospect_epost || 'Ingen e-post'}</span>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${msg.kanal === 'instagram_dm' ? 'bg-pink-900/50 text-pink-300' : 'bg-blue-900/50 text-blue-300'}`}>
                        {msg.kanal === 'instagram_dm' ? 'DM' : 'E-post'}
                      </span>
                    </div>
                  ))}
                </div>

                <button onClick={handleSend} disabled={loading || !authStatus?.authenticated}
                  className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-medium transition-colors text-lg">
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  {loading ? 'Skickar...' : 'Skicka alla pitchar'}
                </button>
                {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
              </div>
            )}

            {sendResults && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-green-900/20 border border-green-700 rounded-lg p-4 text-center">
                    <div className="text-3xl font-bold text-green-400">{sendResults.filter(r => r.status === 'skickat').length}</div>
                    <div className="text-sm text-green-300">Skickade</div>
                  </div>
                  <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 text-center">
                    <div className="text-3xl font-bold text-red-400">{sendResults.filter(r => r.status === 'misslyckat').length}</div>
                    <div className="text-sm text-red-300">Misslyckade</div>
                  </div>
                </div>
                {sendResults.map(r => {
                  const msg = messages.find(m => m.id === r.id)
                  return (
                    <div key={r.id} className="flex items-center gap-3 p-3 bg-gray-800/30 rounded-lg border border-gray-700">
                      {r.status === 'skickat' ? <CheckCircle className="w-5 h-5 text-green-400" /> : <XCircle className="w-5 h-5 text-red-400" />}
                      <span className="text-white">{msg?.prospect_namn || 'Okänd'}</span>
                      {r.error && <span className="text-xs text-red-400">{r.error}</span>}
                    </div>
                  )
                })}
              </div>
            )}

            {!sendResults && (
              <div className="flex gap-3 mt-6">
                <button onClick={prev} className="flex items-center gap-2 text-gray-400 hover:text-white px-4 py-2 rounded-lg border border-gray-700 transition-colors">
                  <ArrowLeft className="w-4 h-4" /> Tillbaka
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
