import { useState, useEffect } from 'react'
import {
  Sun, Mail, Clock, FileText, AlertTriangle, Check, Loader2, Send, RefreshCw
} from 'lucide-react'
import * as api from '../../services/api'

export default function DailySummaryCard() {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [sendStatus, setSendStatus] = useState(null)

  useEffect(() => { loadSummary() }, [])

  const loadSummary = async () => {
    setLoading(true)
    try {
      const data = await api.getDailySummary()
      setSummary(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const handleSendEmail = async () => {
    if (!emailInput) return
    setSending(true)
    setSendStatus(null)
    try {
      await api.sendDailySummary(emailInput)
      setSendStatus('sent')
      setShowEmailForm(false)
    } catch (err) {
      setSendStatus('error')
    }
    finally { setSending(false) }
  }

  if (loading) return null
  if (!summary || !summary.stats) return null

  const hasActions = summary.actionItems?.length > 0

  return (
    <div className={`rounded-xl border p-3 sm:p-5 mb-4 sm:mb-6 ${
      hasActions ? 'bg-yellow-500/5 border-yellow-500/20' : 'bg-green-500/5 border-green-500/20'
    }`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Sun className={`w-5 h-5 ${hasActions ? 'text-yellow-400' : 'text-green-400'}`} />
          <h3 className="text-sm font-semibold text-white">Idag — {new Date().toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowEmailForm(!showEmailForm)}
            className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 px-2 py-1 rounded border border-gray-700/50 transition-colors">
            <Mail className="w-3 h-3" /> <span className="hidden sm:inline">Skicka sammanfattning</span><span className="sm:hidden">Mejla</span>
          </button>
          <button onClick={loadSummary} className="text-gray-600 hover:text-gray-400 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Email form */}
      {showEmailForm && (
        <div className="flex items-center gap-2 mb-4 bg-gray-800/50 rounded-lg p-3 border border-gray-700">
          <input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="din@email.se"
            className="flex-1 text-sm bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-white focus:border-purple-500 focus:outline-none"
            onKeyDown={(e) => e.key === 'Enter' && handleSendEmail()}
          />
          <button onClick={handleSendEmail} disabled={sending || !emailInput}
            className="flex items-center gap-1 text-sm px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded disabled:opacity-50 transition-colors">
            {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            Skicka
          </button>
          {sendStatus === 'sent' && <span className="text-xs text-green-400">Skickad!</span>}
          {sendStatus === 'error' && <span className="text-xs text-red-400">Fel — kolla Gmail-koppling</span>}
        </div>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3 mb-4">
        <div className="text-center">
          <div className="text-base sm:text-lg font-bold text-white">{summary.stats.awaitingReply}</div>
          <div className="text-[10px] text-gray-500">Väntar svar</div>
        </div>
        <div className="text-center">
          <div className="text-base sm:text-lg font-bold text-purple-400">{summary.stats.followupsDue}</div>
          <div className="text-[10px] text-gray-500">Uppföljningar</div>
        </div>
        <div className="text-center">
          <div className="text-base sm:text-lg font-bold text-green-400">{summary.stats.newReplies}</div>
          <div className="text-[10px] text-gray-500">Nya svar</div>
        </div>
        <div className="text-center">
          <div className="text-base sm:text-lg font-bold text-yellow-400">{summary.stats.expiringContracts}</div>
          <div className="text-[10px] text-gray-500">Avtal utgår</div>
        </div>
        <div className="text-center">
          <div className="text-base sm:text-lg font-bold text-blue-400">{summary.stats.responseRate}%</div>
          <div className="text-[10px] text-gray-500">Svarsfrekvens</div>
        </div>
      </div>

      {/* Action items */}
      {hasActions ? (
        <div className="space-y-2">
          {summary.actionItems.map((item, idx) => (
            <div key={idx} className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${
              item.priority === 'high' ? 'bg-red-500/10 border border-red-500/20' : 'bg-yellow-500/10 border border-yellow-500/20'
            }`}>
              {item.priority === 'high' ? (
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              ) : (
                <Clock className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
              )}
              <div>
                <p className={`font-medium ${item.priority === 'high' ? 'text-red-300' : 'text-yellow-300'}`}>
                  {item.title}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {item.items.slice(0, 3).join(' · ')}
                  {item.items.length > 3 && ` +${item.items.length - 3} till`}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-green-400">
          <Check className="w-4 h-4" />
          Allt under kontroll — inga akuta åtgärder idag.
        </div>
      )}
    </div>
  )
}
