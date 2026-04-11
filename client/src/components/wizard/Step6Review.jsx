import { useState } from 'react'
import { Eye, ArrowRight, ArrowLeft, Trash2, Mail, FileText, AlertTriangle, ExternalLink, ChevronDown, ChevronUp, Send, Download, Pencil, Save, X, Loader2 } from 'lucide-react'
import * as api from '../../services/api'

function renderMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>')
}

export default function Step6Review({ foretag, outreachType, messages, setMessages, attachContracts, kontaktperson, kontraktBrief, next, prev }) {
  const [editingEmail, setEditingEmail] = useState(null)
  const [emailInput, setEmailInput] = useState('')
  const [expandedIds, setExpandedIds] = useState(new Set())
  const [showConfirm, setShowConfirm] = useState(false)

  // Redigering av meddelande
  const [editingMsgId, setEditingMsgId] = useState(null)
  const [editAmne, setEditAmne] = useState('')
  const [editMeddelande, setEditMeddelande] = useState('')
  const [savingMsg, setSavingMsg] = useState(false)

  // Kontrakt-nedladdning
  const [downloadingId, setDownloadingId] = useState(null)

  const isSponsor = outreachType === 'sponsor'

  const getEmail = (m) => m.kontakt_epost || m.prospect_epost
  const getName = (m) => m.influencer_namn || m.prospect_namn
  const getKanalnamn = (m) => m.kanalnamn || m.prospect_bransch || ''

  const withEmail = messages.filter((m) => getEmail(m))
  const withoutEmail = messages.filter((m) => !getEmail(m))

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDelete = async (id) => {
    try {
      if (isSponsor) {
        setMessages((prev) => prev.filter((m) => m.id !== id))
      } else {
        await api.deleteOutreach(id)
        setMessages((prev) => prev.filter((m) => m.id !== id))
      }
    } catch (err) {
      console.error(err)
    }
  }

  const startEditEmail = (msg) => {
    setEditingEmail(msg.id)
    setEmailInput(getEmail(msg) || '')
  }

  const saveEmail = (msgId) => {
    const emailField = isSponsor ? 'prospect_epost' : 'kontakt_epost'
    setMessages((prev) => prev.map((m) =>
      m.id === msgId ? { ...m, [emailField]: emailInput || null } : m
    ))
    setEditingEmail(null)
    setEmailInput('')
  }

  // Redigera meddelande
  const startEditMsg = (msg) => {
    setEditingMsgId(msg.id)
    setEditAmne(msg.amne || '')
    setEditMeddelande(msg.meddelande || '')
    // Expandera meddelandet om det inte redan är
    setExpandedIds(prev => new Set([...prev, msg.id]))
  }

  const cancelEditMsg = () => {
    setEditingMsgId(null)
    setEditAmne('')
    setEditMeddelande('')
  }

  const saveEditMsg = async (msgId) => {
    setSavingMsg(true)
    try {
      if (isSponsor) {
        await api.updateSponsorOutreach(msgId, { amne: editAmne, meddelande: editMeddelande })
      } else {
        await api.updateOutreach(msgId, { amne: editAmne, meddelande: editMeddelande })
      }
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, amne: editAmne, meddelande: editMeddelande } : m
      ))
      setEditingMsgId(null)
    } catch (err) {
      console.error('Kunde inte spara:', err)
    } finally {
      setSavingMsg(false)
    }
  }

  // Ladda ner kontrakt
  const handleDownloadContract = async (msg) => {
    setDownloadingId(msg.id)
    try {
      const blob = await api.generateKontrakt(msg.id, kontaktperson || foretag?.kontaktperson)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `kontrakt_${(getName(msg) || 'influencer').replace(/\s/g, '_')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Kontrakt-nedladdning fel:', err)
    } finally {
      setDownloadingId(null)
    }
  }

  const handlePreviewContract = async (msg) => {
    setDownloadingId(msg.id)
    try {
      const blob = await api.generateKontrakt(msg.id, kontaktperson || foretag?.kontaktperson)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
    } catch (err) {
      console.error('Kontrakt-förhandsgranskning fel:', err)
    } finally {
      setDownloadingId(null)
    }
  }

  const getAboutUrl = (kanalnamn) => {
    const name = (kanalnamn || '').replace(/^@/, '')
    return `https://youtube.com/@${name}/about`
  }

  const handleSendClick = () => {
    setShowConfirm(true)
  }

  const confirmSend = () => {
    setShowConfirm(false)
    next()
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 mb-6">
        <Eye className={`w-6 h-6 ${isSponsor ? 'text-blue-500' : 'text-purple-500'}`} />
        <h2 className="text-xl font-bold">Granska</h2>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 text-center">
          <div className={`text-2xl font-bold ${isSponsor ? 'text-blue-400' : 'text-purple-400'}`}>{messages.length}</div>
          <div className="text-sm text-gray-400">Meddelanden</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 text-center">
          <div className={`text-2xl font-bold ${withEmail.length > 0 ? 'text-green-400' : 'text-yellow-400'}`}>{withEmail.length}</div>
          <div className="text-sm text-gray-400">Med e-post</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 text-center">
          <div className={`text-2xl font-bold ${attachContracts ? 'text-green-400' : 'text-gray-500'}`}>{attachContracts ? 'Ja' : 'Nej'}</div>
          <div className="text-sm text-gray-400">Kontrakt bifogat</div>
        </div>
      </div>

      {/* Kontrakt-info box */}
      {attachContracts && kontraktBrief?.vill_skapa === 'ja' && (
        <div className="flex items-start gap-3 bg-green-500/5 border border-green-500/20 rounded-lg px-4 py-3 mb-4">
          <FileText className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-green-300 font-medium text-sm">Kontrakt bifogas med varje meddelande</p>
            <p className="text-green-300/60 text-xs mt-1">
              {kontraktBrief.ersattning_per_video} SEK/video, max {kontraktBrief.max_videos} st, {kontraktBrief.provision_per_signup} SEK/signup, {kontraktBrief.avtalstid} dagars avtalstid
              {kontraktBrief.kontaktperson && ` — kontaktperson: ${kontraktBrief.kontaktperson}`}
            </p>
          </div>
        </div>
      )}

      {/* Warning: missing emails */}
      {withoutEmail.length > 0 && (
        <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 mb-4">
          <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-yellow-300 font-medium">
              {withoutEmail.length} av {messages.length} meddelanden saknar e-post
            </p>
            <p className="text-yellow-300/60 text-xs mt-0.5">
              Meddelanden utan e-post kan inte skickas. Klicka på ett meddelande för att lägga till e-post{!isSponsor && ' eller öppna deras YouTube About-sida'}.
            </p>
          </div>
        </div>
      )}

      {/* Message list */}
      <div className="space-y-2">
        {messages.map((msg) => {
          const isExpanded = expandedIds.has(msg.id)
          const email = getEmail(msg)
          const isEditing = editingMsgId === msg.id
          const isDownloading = downloadingId === msg.id

          return (
            <div key={msg.id} className={`bg-gray-800/30 rounded-lg border overflow-hidden ${email ? 'border-gray-700' : 'border-yellow-500/30'}`}>
              {/* Header */}
              <div
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-800/50 transition-colors"
                onClick={() => toggleExpand(msg.id)}
              >
                <Mail className={`w-4 h-4 flex-shrink-0 ${email ? 'text-green-400' : 'text-yellow-400'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white text-sm">{getName(msg)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full bg-gray-800 ${isSponsor ? 'text-blue-400' : 'text-gray-400'}`}>
                      {isSponsor ? (msg.prospect_bransch || 'Sponsor') : (msg.plattform || 'YouTube')}
                    </span>
                    {attachContracts && !isSponsor && <FileText className="w-3.5 h-3.5 text-green-400" title="Kontrakt bifogat" />}
                  </div>
                  <div className={`text-xs ${isSponsor ? 'text-blue-400/70' : 'text-purple-400/70'} mt-0.5 truncate`}>
                    {msg.amne}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Redigera-knapp */}
                  {!isEditing && (
                    <button
                      onClick={(e) => { e.stopPropagation(); startEditMsg(msg) }}
                      className="text-gray-500 hover:text-purple-400 p-1 transition-colors"
                      title="Redigera meddelande"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {/* Kontrakt-nedladdning */}
                  {attachContracts && !isSponsor && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDownloadContract(msg) }}
                      disabled={isDownloading}
                      className="text-green-500/60 hover:text-green-400 p-1 transition-colors disabled:opacity-50"
                      title="Ladda ner kontrakt"
                    >
                      {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(msg.id) }}
                    className="text-red-400/50 hover:text-red-400 p-1 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                  )}
                </div>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div className="border-t border-gray-700/50 p-4">
                  {/* Email row */}
                  <div className="text-xs mb-3">
                    {editingEmail === msg.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Till:</span>
                        <input
                          type="email"
                          value={emailInput}
                          onChange={(e) => setEmailInput(e.target.value)}
                          placeholder="namn@example.com"
                          className="text-xs bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white flex-1 focus:border-purple-500 focus:outline-none"
                          autoFocus
                          onKeyDown={(e) => e.key === 'Enter' && saveEmail(msg.id)}
                        />
                        <button onClick={() => saveEmail(msg.id)} className="text-xs text-green-400 hover:text-green-300">Spara</button>
                        <button onClick={() => setEditingEmail(null)} className="text-xs text-gray-500 hover:text-gray-400">Avbryt</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Till:</span>
                        {email ? (
                          <span className="text-green-400">{email}</span>
                        ) : (
                          <span className="text-yellow-400">Ingen e-post</span>
                        )}
                        <button
                          onClick={() => startEditEmail(msg)}
                          className="text-purple-400 hover:text-purple-300 ml-1"
                        >
                          {email ? 'Ändra' : 'Lägg till'}
                        </button>
                        {!isSponsor && msg.kanalnamn && (
                          <a
                            href={getAboutUrl(msg.kanalnamn)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-500 hover:text-gray-400 flex items-center gap-0.5 ml-1"
                          >
                            <ExternalLink className="w-3 h-3" /> YouTube
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Redigeringsläge ELLER visningsläge */}
                  {isEditing ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Ämne</label>
                        <input
                          type="text"
                          value={editAmne}
                          onChange={(e) => setEditAmne(e.target.value)}
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Meddelande</label>
                        <textarea
                          value={editMeddelande}
                          onChange={(e) => setEditMeddelande(e.target.value)}
                          rows={8}
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none resize-y"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => saveEditMsg(msg.id)}
                          disabled={savingMsg}
                          className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg transition-colors"
                        >
                          {savingMsg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          Spara
                        </button>
                        <button
                          onClick={cancelEditMsg}
                          className="flex items-center gap-1.5 text-gray-400 hover:text-white text-xs px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" /> Avbryt
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className={`text-xs ${isSponsor ? 'text-blue-400' : 'text-purple-400'} mb-2 font-medium`}>
                        Ämne: {msg.amne}
                      </div>
                      <div
                        className="text-sm text-gray-300 leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.meddelande) }}
                      />
                    </>
                  )}

                  {/* Kontrakt-sektion i expanded view */}
                  {attachContracts && !isSponsor && !isEditing && (
                    <div className="mt-4 pt-3 border-t border-gray-700/50">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-green-400" />
                          <span className="text-xs text-green-400 font-medium">Kontrakt bifogas</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handlePreviewContract(msg)}
                            disabled={isDownloading}
                            className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 px-2 py-1 rounded hover:bg-purple-500/10 transition-colors disabled:opacity-50"
                          >
                            {isDownloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                            Visa PDF
                          </button>
                          <button
                            onClick={() => handleDownloadContract(msg)}
                            disabled={isDownloading}
                            className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 px-2 py-1 rounded hover:bg-green-500/10 transition-colors disabled:opacity-50"
                          >
                            <Download className="w-3 h-3" /> Ladda ner
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {messages.length === 0 && (
        <p className="text-gray-500 text-center py-8">Inga meddelanden att granska. Gå tillbaka och generera outreach.</p>
      )}

      {/* Sticky bottom CTA */}
      <div className="sticky bottom-0 bg-gray-900 pt-4 pb-1 -mx-6 px-6 mt-4 border-t border-gray-800/50">
        <div className="flex gap-3">
          <button onClick={prev} className="flex items-center gap-2 text-gray-400 hover:text-white px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Tillbaka
          </button>
          {messages.length > 0 && withEmail.length > 0 && (
            <button onClick={handleSendClick} className={`flex items-center gap-2 ${isSponsor ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'} text-white px-6 py-2.5 rounded-lg font-medium transition-colors`}>
              <Send className="w-4 h-4" /> Skicka {withEmail.length} meddelanden
            </button>
          )}
          {messages.length > 0 && withEmail.length === 0 && (
            <div className="flex items-center gap-2 text-yellow-400 text-sm px-4 py-2">
              <AlertTriangle className="w-4 h-4" />
              Lägg till minst en e-postadress för att kunna skicka
            </div>
          )}
        </div>
      </div>

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => setShowConfirm(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">Bekräfta utskick</h3>
            <p className="text-sm text-gray-300 mb-1">
              Du kommer att skicka <span className="text-white font-medium">{withEmail.length} mail</span> till {withEmail.length} {isSponsor ? 'företag' : 'influencers'}.
            </p>
            {attachContracts && !isSponsor && (
              <p className="text-sm text-green-400 mb-1">
                <FileText className="w-4 h-4 inline mr-1" />
                Kontrakt bifogas som PDF.
              </p>
            )}
            {withoutEmail.length > 0 && (
              <p className="text-xs text-yellow-400 mb-3">
                {withoutEmail.length} meddelanden utan e-post skickas inte.
              </p>
            )}
            <p className="text-xs text-gray-500 mb-5">Är du säker på att du vill fortsätta?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 text-sm transition-colors"
              >
                Avbryt
              </button>
              <button
                onClick={confirmSend}
                className={`flex-1 px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors ${isSponsor ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'}`}
              >
                Ja, skicka!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
