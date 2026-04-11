import { useState, useEffect } from 'react'
import { Send, Loader2, CheckCircle, XCircle, Mail, ExternalLink, AlertTriangle, ArrowLeft } from 'lucide-react'
import * as api from '../../services/api'

export default function Step7Send({ foretag, outreachType, messages, attachContracts, kontaktperson, kontraktBrief, sendResults, setSendResults, prev, onNavigate }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [authStatus, setAuthStatus] = useState(null)
  const [showConfirm, setShowConfirm] = useState(false)

  const isSponsor = outreachType === 'sponsor'

  useEffect(() => {
    api.getAuthStatus().then(setAuthStatus).catch(console.error)
  }, [])

  const emailMessages = messages.filter((m) => m.kontakt_epost || m.prospect_epost)
  const noEmailMessages = messages.filter((m) => !m.kontakt_epost && !m.prospect_epost)

  const handleSend = async () => {
    setLoading(true)
    setError('')
    try {
      if (emailMessages.length === 0) {
        setError('Inga meddelanden med e-postadresser att skicka')
        return
      }
      if (isSponsor) {
        const results = await api.sendSponsorOutreach(emailMessages.map(m => m.id))
        setSendResults(results)
      } else {
        // Skicka meddelande-IDs om de finns i DB, annars fullständiga objekt
        const hasDbIds = emailMessages.every(m => m.id && typeof m.id === 'number')
        const results = await api.sendOutreach({
          // Om alla meddelanden har DB-ids, skicka bara IDs (undvik duplikater)
          messageIds: hasDbIds ? emailMessages.map(m => m.id) : undefined,
          messages: !hasDbIds ? emailMessages.map((m) => ({
            id: m.id || undefined,
            influencer_id: m.influencer_id,
            influencer_namn: m.influencer_namn,
            kanalnamn: m.kanalnamn,
            plattform: m.plattform,
            kontakt_epost: m.kontakt_epost,
            referral_kod: m.referral_kod,
            foljare: m.foljare,
            nisch: m.nisch,
            foretag_id: foretag?.id,
            meddelande: m.meddelande,
            amne: m.amne,
          })) : undefined,
          attachContracts,
          kontaktperson: kontaktperson || foretag.kontaktperson,
          kontraktVillkor: kontraktBrief || null,
          foretag,
        })
        setSendResults(results)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const sentCount = sendResults?.filter((r) => r.status === 'skickat').length || 0
  const failedCount = sendResults?.filter((r) => r.status === 'misslyckat').length || 0

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Send className={`w-6 h-6 ${isSponsor ? 'text-blue-500' : 'text-purple-500'}`} />
        <h2 className="text-xl font-bold">Steg 6: Skicka</h2>
      </div>

      {/* E-post Auth Status */}
      <div className={`mb-6 p-4 rounded-lg border ${authStatus?.authenticated ? 'border-green-700 bg-green-900/20' : 'border-yellow-700 bg-yellow-900/20'}`}>
        <div className="flex items-center gap-3">
          <Mail className={`w-5 h-5 ${authStatus?.authenticated ? 'text-green-400' : 'text-yellow-400'}`} />
          {authStatus?.authenticated ? (
            <span className="text-green-300">
              {authStatus.provider === 'microsoft' || authStatus.provider === 'outlook' || authStatus.provider === 'hotmail'
                ? 'Microsoft' : authStatus.provider === 'gmail' ? 'Gmail' : 'E-post'} anslutet: {authStatus.email}
            </span>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-yellow-300">E-post ej anslutet</span>
            </div>
          )}
        </div>
      </div>

      {/* Varning: inga e-postadresser alls */}
      {emailMessages.length === 0 && !sendResults && (
        <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-4 mb-6">
          <AlertTriangle className="w-6 h-6 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-red-300 font-medium">Kan inte skicka — ingen har e-postadress</p>
            <p className="text-red-300/60 text-sm mt-1">
              Alla {noEmailMessages.length} meddelanden saknar e-post. Gå tillbaka till Steg 3 och lägg till e-postadresser.
            </p>
          </div>
        </div>
      )}

      {!sendResults && emailMessages.length > 0 && (
        <div>
          <p className="text-gray-400 mb-2">
            Redo att skicka <span className="text-green-400 font-bold">{emailMessages.length}</span> meddelanden via {
              authStatus?.provider === 'microsoft' || authStatus?.provider === 'outlook' || authStatus?.provider === 'hotmail'
                ? 'Microsoft' : authStatus?.provider === 'gmail' ? 'Gmail' : 'e-post'
            }.
          </p>

          {noEmailMessages.length > 0 && (
            <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 mb-4">
              <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
              <p className="text-yellow-300/80 text-sm">
                <span className="font-medium">{noEmailMessages.length} influencers hoppas över</span> — de saknar e-postadress:
                {' '}{noEmailMessages.map(m => m.influencer_namn || m.prospect_namn).join(', ')}
              </p>
            </div>
          )}

          {/* Lista som skickas */}
          <div className="space-y-1 mb-6 max-h-48 overflow-y-auto">
            {emailMessages.map(m => (
              <div key={m.id} className="flex items-center gap-2 text-sm text-gray-300 py-1">
                <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                <span className="font-medium">{m.influencer_namn || m.prospect_namn}</span>
                <span className="text-gray-600">→</span>
                <span className="text-gray-400">{m.kontakt_epost || m.prospect_epost}</span>
              </div>
            ))}
          </div>

          {!showConfirm ? (
            <button
              onClick={() => setShowConfirm(true)}
              disabled={loading || !authStatus?.authenticated}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-medium transition-colors text-lg"
            >
              <Send className="w-5 h-5" />
              Skicka {emailMessages.length} meddelanden
            </button>
          ) : (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <p className="text-yellow-300 font-medium mb-2">
                Är du säker? {emailMessages.length} {emailMessages.length === 1 ? 'mail' : 'mail'} skickas till:
              </p>
              <ul className="text-sm text-gray-300 mb-4 space-y-0.5">
                {emailMessages.map(m => (
                  <li key={m.id}>• {m.influencer_namn || m.prospect_namn} ({m.kontakt_epost || m.prospect_epost}){attachContracts ? ' + kontrakt' : ''}</li>
                ))}
              </ul>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setShowConfirm(false); handleSend(); }}
                  disabled={loading}
                  className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {loading ? 'Skickar...' : 'Ja, skicka nu'}
                </button>
                <button
                  onClick={() => setShowConfirm(false)}
                  className="text-gray-400 hover:text-white px-4 py-2.5 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors text-sm"
                >
                  Avbryt
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
        </div>
      )}

      {sendResults && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-green-900/20 border border-green-700 rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-green-400">{sentCount}</div>
              <div className="text-sm text-green-300">Skickade</div>
            </div>
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-red-400">{failedCount}</div>
              <div className="text-sm text-red-300">Misslyckade</div>
            </div>
          </div>

          <div className="space-y-2">
            {sendResults.map((r, idx) => {
              const msg = messages.find((m) => m.id === r.id) || messages[idx]
              const namn = r.influencer_namn || msg?.influencer_namn || msg?.prospect_namn || 'Okänd'
              const epost = r.kontakt_epost || msg?.kontakt_epost || msg?.prospect_epost
              return (
                <div key={r.id || idx} className="flex items-center gap-3 p-3 bg-gray-800/30 rounded-lg border border-gray-700">
                  {r.status === 'skickat' ? (
                    <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                  )}
                  <div className="flex-1">
                    <span className="text-white">{namn}</span>
                    <span className="text-xs text-gray-500 ml-2">{epost}</span>
                  </div>
                  {r.error && <span className="text-xs text-red-400">{r.error}</span>}
                </div>
              )
            })}
          </div>

          <p className="text-gray-400 text-sm mt-4">
            Alla utskick är loggade. Gå till{' '}
            <button
              onClick={() => onNavigate?.('dashboard')}
              className="text-purple-400 hover:text-purple-300 underline font-medium"
            >
              Kontrollpanelen
            </button>
            {' '}för att följa upp.
          </p>
        </div>
      )}

      {/* Tillbaka-knapp */}
      <div className="mt-6">
        <button onClick={prev} className="flex items-center gap-2 text-gray-400 hover:text-white px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Tillbaka
        </button>
      </div>
    </div>
  )
}
