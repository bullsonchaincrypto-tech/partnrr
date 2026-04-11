import { useState, useEffect } from 'react'
import {
  FileText, CheckCircle, Clock, AlertTriangle, XCircle, Send,
  Loader2, RefreshCw, DollarSign, Users, Play, PenLine, Eye, EyeOff, Download, ChevronDown, ChevronUp, Trash2
} from 'lucide-react'
import * as api from '../../services/api'

const STATUS_CONFIG = {
  genererat: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Genererat', icon: FileText },
  skickat: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Skickat för signering', icon: Send },
  signerat: { bg: 'bg-purple-500/20', text: 'text-purple-400', label: 'Signerat', icon: PenLine },
  aktivt: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Aktivt', icon: CheckCircle },
  utgånget: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Utgånget', icon: Clock },
  avslutat: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Avslutat', icon: XCircle },
  avböjt: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Avböjt', icon: XCircle },
}

export default function ContractsTab() {
  const [overview, setOverview] = useState(null)
  const [contracts, setContracts] = useState([])
  const [reminders, setReminders] = useState(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('alla')
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [dismissedReminders, setDismissedReminders] = useState([])

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [o, c, r] = await Promise.all([
        api.getContractsOverview().catch(() => null),
        api.getContracts().catch(() => []),
        api.getContractReminders().catch(() => null),
      ])
      setOverview(o)
      setContracts(c)
      setReminders(r)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const handleStatusChange = async (id, newStatus) => {
    try {
      await api.updateContractStatus(id, newStatus)
      await loadData()
    } catch (err) { console.error(err) }
  }

  const handleSendForSigning = async (id) => {
    try {
      await api.sendForSigning(id)
      await loadData()
    } catch (err) { alert(err.message) }
  }

  const handleDelete = async (id) => {
    if (!confirm('Vill du ta bort detta kontrakt?')) return
    try {
      await api.deleteContract(id)
      await loadData()
    } catch (err) { alert(err.message) }
  }

  const handleSendReminder = async (id, type) => {
    try {
      await api.sendContractReminder(id, type)
      await loadData()
    } catch (err) { console.error(err) }
  }

  const handleDismissReminder = (id, type) => {
    setDismissedReminders(prev => [...prev, `${type}-${id}`])
  }

  const handleDismissAllReminders = () => {
    const allKeys = []
    if (reminders?.expiring_soon) allKeys.push(...reminders.expiring_soon.map(k => `exp-${k.id}`))
    if (reminders?.unsigned_stale) allKeys.push(...reminders.unsigned_stale.map(k => `unsig-${k.id}`))
    if (reminders?.expired) allKeys.push(...reminders.expired.map(k => `dead-${k.id}`))
    setDismissedReminders(allKeys)
  }

  const handleSaveEconomics = async (id) => {
    try {
      await api.updateContractEconomics(id, editForm)
      setEditingId(null)
      await loadData()
    } catch (err) { console.error(err) }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
    </div>
  )

  const filteredContracts = statusFilter === 'alla'
    ? contracts
    : contracts.filter(c => c.status === statusFilter)

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <FileText className="w-6 h-6 text-purple-500" />
          Avtal & Signering
        </h2>
        <button onClick={loadData} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm">
          <RefreshCw className="w-4 h-4" /> Uppdatera
        </button>
      </div>

      {/* Översiktskort */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={<FileText className="w-5 h-5 text-purple-400" />}
            label="Totalt avtal"
            value={overview.total}
          />
          <StatCard
            icon={<CheckCircle className="w-5 h-5 text-green-400" />}
            label="Aktiva"
            value={overview.by_status?.aktivt || 0}
          />
          <StatCard
            icon={<Clock className="w-5 h-5 text-blue-400" />}
            label="Väntar signering"
            value={overview.by_status?.skickat || 0}
          />
          <StatCard
            icon={<AlertTriangle className="w-5 h-5 text-orange-400" />}
            label="Utgår snart"
            value={overview.expiring_soon?.length || 0}
            alert={(overview.expiring_soon?.length || 0) > 0}
          />
        </div>
      )}

      {/* Ekonomi */}
      {overview?.ekonomi && (overview.ekonomi.total_videos > 0 || overview.ekonomi.total_signups > 0) && (
        <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-green-400" /> Ekonomisk översikt
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-gray-500">Videos levererade</div>
              <div className="text-lg font-bold text-white">{overview.ekonomi.total_videos}</div>
              <div className="text-xs text-gray-500">{overview.ekonomi.video_kostnad.toLocaleString()} SEK</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Signups (referral)</div>
              <div className="text-lg font-bold text-white">{overview.ekonomi.total_signups}</div>
              <div className="text-xs text-gray-500">{overview.ekonomi.signup_kostnad.toLocaleString()} SEK</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Total kostnad</div>
              <div className="text-lg font-bold text-green-400">{overview.ekonomi.total_kostnad.toLocaleString()} SEK</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Utbetalt</div>
              <div className="text-lg font-bold text-yellow-400">{overview.ekonomi.total_utbetalt.toLocaleString()} SEK</div>
            </div>
          </div>
        </div>
      )}

      {/* Påminnelser / varningar */}
      {reminders && reminders.total_actions > 0 && (() => {
        const visibleExpiring = (reminders.expiring_soon || []).filter(k => !dismissedReminders.includes(`exp-${k.id}`))
        const visibleUnsigned = (reminders.unsigned_stale || []).filter(k => !dismissedReminders.includes(`unsig-${k.id}`))
        const visibleExpired = (reminders.expired || []).filter(k => !dismissedReminders.includes(`dead-${k.id}`))
        const totalVisible = visibleExpiring.length + visibleUnsigned.length + visibleExpired.length

        if (totalVisible === 0) return null

        return (
          <div className="bg-yellow-900/20 rounded-xl p-5 border border-yellow-700/50">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-yellow-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Kräver uppmärksamhet ({totalVisible})
              </h3>
              <button
                onClick={handleDismissAllReminders}
                className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded transition-colors"
                title="Avfärda alla"
              >
                Avfärda alla ✕
              </button>
            </div>
            <div className="space-y-2">
              {visibleExpiring.map(k => (
                <div key={`exp-${k.id}`} className="flex items-center justify-between text-sm">
                  <span className="text-white">
                    <Clock className="w-3 h-3 inline text-orange-400 mr-1" />
                    {k.influencer_namn} — avtal löper ut snart
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSendReminder(k.id, 'expiry')}
                      className="text-xs text-orange-400 hover:text-orange-300 px-2 py-1 border border-orange-500/30 rounded"
                    >
                      Skicka påminnelse
                    </button>
                    <button
                      onClick={() => handleDismissReminder(k.id, 'exp')}
                      className="text-xs text-gray-500 hover:text-gray-300 px-1.5 py-1 rounded transition-colors"
                      title="Avfärda"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              {visibleUnsigned.map(k => (
                <div key={`unsig-${k.id}`} className="flex items-center justify-between text-sm">
                  <span className="text-white">
                    <Send className="w-3 h-3 inline text-blue-400 mr-1" />
                    {k.influencer_namn} — ej signerat (5+ dagar)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSendReminder(k.id, 'sign')}
                      className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 border border-blue-500/30 rounded"
                    >
                      Påminn om signering
                    </button>
                    <button
                      onClick={() => handleDismissReminder(k.id, 'unsig')}
                      className="text-xs text-gray-500 hover:text-gray-300 px-1.5 py-1 rounded transition-colors"
                      title="Avfärda"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              {visibleExpired.map(k => (
                <div key={`dead-${k.id}`} className="flex items-center justify-between text-sm">
                  <span className="text-white">
                    <XCircle className="w-3 h-3 inline text-red-400 mr-1" />
                    {k.influencer_namn} — avtal har gått ut
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSendReminder(k.id, 'expired')}
                      className="text-xs text-red-400 hover:text-red-300 px-2 py-1 border border-red-500/30 rounded"
                    >
                      Notifiera
                    </button>
                    <button
                      onClick={() => handleDismissReminder(k.id, 'dead')}
                      className="text-xs text-gray-500 hover:text-gray-300 px-1.5 py-1 rounded transition-colors"
                      title="Avfärda"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Status-filter */}
      <div className="flex gap-2 flex-wrap">
        {['alla', 'genererat', 'skickat', 'signerat', 'aktivt', 'utgånget', 'avböjt'].map(f => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === f
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {f === 'alla' ? `Alla (${contracts.length})` : `${STATUS_CONFIG[f]?.label || f} (${contracts.filter(c => c.status === f).length})`}
          </button>
        ))}
      </div>

      {/* Kontraktslista */}
      {filteredContracts.length > 0 ? (
        <div className="space-y-3">
          {filteredContracts.map(k => (
            <ContractCard
              key={k.id}
              contract={k}
              onStatusChange={handleStatusChange}
              onSendForSigning={handleSendForSigning}
              onDelete={handleDelete}
              isEditing={editingId === k.id}
              editForm={editForm}
              onEditStart={() => {
                setEditingId(k.id)
                setEditForm({
                  videos_delivered: k.videos_delivered || 0,
                  total_signups: k.total_signups || 0,
                  total_payout_sek: k.total_payout_sek || 0,
                })
              }}
              onEditChange={setEditForm}
              onEditSave={() => handleSaveEconomics(k.id)}
              onEditCancel={() => setEditingId(null)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg font-medium">Inga avtal att visa</p>
          <p className="text-sm mt-1">Avtal skapas automatiskt när du bockar i "Bifoga kontrakt" i outreach-wizarden</p>
        </div>
      )}
    </div>
  )
}

// === Subkomponenter ===

function StatCard({ icon, label, value, alert }) {
  return (
    <div className={`rounded-xl p-4 border ${alert ? 'bg-orange-900/20 border-orange-700/50' : 'bg-gray-800/50 border-gray-700/50'}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <span className={`text-2xl font-bold ${alert ? 'text-orange-400' : 'text-white'}`}>{value}</span>
    </div>
  )
}

function ContractCard({ contract: k, onStatusChange, onSendForSigning, onDelete, isEditing, editForm, onEditStart, onEditChange, onEditSave, onEditCancel }) {
  const [showContract, setShowContract] = useState(false)
  const style = STATUS_CONFIG[k.status] || STATUS_CONFIG.genererat
  const Icon = style.icon
  const daysLeft = k.expires_at ? Math.ceil((new Date(k.expires_at) - Date.now()) / (1000 * 60 * 60 * 24)) : null
  const createdDate = new Date(k.created_at).toLocaleDateString('sv-SE')

  // Formatera avtalstexten snyggt
  const formatContractText = (text) => {
    if (!text) return null
    return text.split('\n').map((line, i) => {
      if (line.startsWith('SAMARBETSAVTAL') || line.startsWith('AVTAL')) {
        return <div key={i} className="text-lg font-bold text-white mb-2">{line}</div>
      }
      if (line.startsWith('Mellan ') || line.startsWith('MELLAN ')) {
        return <div key={i} className="text-sm text-purple-400 mb-3 font-medium">{line}</div>
      }
      if (line.endsWith(':')) {
        return <div key={i} className="text-sm font-semibold text-gray-300 mt-3 mb-1">{line}</div>
      }
      if (line.startsWith('- ')) {
        return <div key={i} className="text-sm text-gray-400 ml-4 mb-0.5">{line}</div>
      }
      if (line.trim() === '') {
        return <div key={i} className="h-2" />
      }
      return <div key={i} className="text-sm text-gray-400">{line}</div>
    })
  }

  return (
    <div className="bg-gray-800/50 rounded-xl p-3 sm:p-4 border border-gray-700/50">
      {/* Top row */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-white font-medium">{k.influencer_namn}</span>
            <span className="text-gray-600 hidden sm:inline">•</span>
            <span className="text-sm text-gray-500">@{k.kanalnamn}</span>
          </div>
          <div className="text-xs sm:text-sm text-gray-400">
            {k.foretag_namn} • Skapad {createdDate}
            {k.signed_at && ` • Signerad ${new Date(k.signed_at).toLocaleDateString('sv-SE')}`}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {daysLeft !== null && k.status === 'aktivt' && (
            <span className={`text-xs px-2 py-1 rounded ${
              daysLeft <= 0 ? 'bg-red-500/20 text-red-400' :
              daysLeft <= 7 ? 'bg-orange-500/20 text-orange-400' :
              'bg-gray-700 text-gray-400'
            }`}>
              {daysLeft <= 0 ? 'Utgånget' : `${daysLeft}d kvar`}
            </span>
          )}
          <span className={`${style.bg} ${style.text} text-xs font-medium px-2.5 py-1 rounded-lg flex items-center gap-1`}>
            <Icon className="w-3 h-3" /> {style.label}
          </span>
        </div>
      </div>

      {/* Progress: videos delivered */}
      {(k.status === 'aktivt' || k.status === 'signerat' || k.status === 'utgånget') && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Videos: {k.videos_delivered || 0} / {k.videos_required || 5}</span>
            <span>Signups: {k.total_signups || 0}</span>
            <span>Kostnad: {((k.videos_delivered || 0) * 300 + (k.total_signups || 0) * 10).toLocaleString()} SEK</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-purple-500 h-2 rounded-full transition-all"
              style={{ width: `${Math.min(100, ((k.videos_delivered || 0) / (k.videos_required || 5)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Visa kontrakt (expanderbar) */}
      {k.villkor_text && (
        <div className="mt-3">
          <button
            onClick={() => setShowContract(!showContract)}
            className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg transition-colors ${
              showContract
                ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30'
                : 'bg-gray-700/50 text-gray-400 hover:text-white border border-gray-700'
            }`}
          >
            {showContract ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {showContract ? 'Dölj kontrakt' : 'Visa kontrakt'}
            {showContract ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {showContract && (
            <div className="mt-2 p-4 bg-gray-900 rounded-lg border border-gray-700 relative">
              {/* Kontrakts-header med status-badge */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pb-3 border-b border-gray-700">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-purple-400" />
                  <span className="text-sm font-medium text-gray-300">Kontraktsvillkor</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {k.signed_at && (
                    <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">
                      Signerad {new Date(k.signed_at).toLocaleDateString('sv-SE')}
                    </span>
                  )}
                  {k.expires_at && (
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      daysLeft <= 0 ? 'bg-red-500/20 text-red-400' :
                      daysLeft <= 7 ? 'bg-orange-500/20 text-orange-400' :
                      'bg-gray-700 text-gray-400'
                    }`}>
                      Utgår: {new Date(k.expires_at).toLocaleDateString('sv-SE')}
                    </span>
                  )}
                  <a href={api.getContractPdfUrl(k.id)} download
                    className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 px-2 py-0.5 border border-purple-500/30 rounded">
                    <Download className="w-3 h-3" /> Ladda ner PDF
                  </a>
                </div>
              </div>

              {/* Kontraktsinnehåll */}
              <div className="space-y-0.5">
                {formatContractText(k.villkor_text)}
              </div>

              {/* Nyckeldata-summering */}
              <div className="mt-4 pt-3 border-t border-gray-700 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="text-center">
                  <div className="text-xs text-gray-500">Referral-kod</div>
                  <div className="text-sm font-mono text-purple-400">{k.referral_kod || '–'}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500">Per video</div>
                  <div className="text-sm font-bold text-white">300 SEK</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500">Per signup</div>
                  <div className="text-sm font-bold text-white">10 SEK</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500">Max videos</div>
                  <div className="text-sm font-bold text-white">{k.videos_required || 5} st</div>
                </div>
              </div>

              {/* Noteringar */}
              {k.notes && (
                <div className="mt-3 pt-3 border-t border-gray-700">
                  <div className="text-xs text-gray-500 mb-1">Noteringar</div>
                  <div className="text-sm text-gray-400 italic">{k.notes}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Edit economics */}
      {isEditing && (
        <div className="mt-3 p-3 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-500">Videos levererade</label>
              <input type="number" value={editForm.videos_delivered}
                onChange={e => onEditChange({ ...editForm, videos_delivered: parseInt(e.target.value) || 0 })}
                className="w-full mt-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">Signups</label>
              <input type="number" value={editForm.total_signups}
                onChange={e => onEditChange({ ...editForm, total_signups: parseInt(e.target.value) || 0 })}
                className="w-full mt-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">Utbetalt (SEK)</label>
              <input type="number" value={editForm.total_payout_sek}
                onChange={e => onEditChange({ ...editForm, total_payout_sek: parseInt(e.target.value) || 0 })}
                className="w-full mt-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={onEditSave} className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded">Spara</button>
            <button onClick={onEditCancel} className="text-xs text-gray-400 hover:text-white px-3 py-1">Avbryt</button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex gap-2 flex-wrap">
        <a href={api.getContractPdfUrl(k.id)} download
          className="text-xs text-purple-400 hover:text-purple-300 px-3 py-1.5 border border-purple-500/30 rounded flex items-center gap-1">
          <Download className="w-3 h-3" /> PDF
        </a>
        {k.status === 'genererat' && (
          <button onClick={() => onSendForSigning(k.id)}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded flex items-center gap-1">
            <Send className="w-3 h-3" /> Skicka för signering
          </button>
        )}
        {k.status === 'skickat' && (
          <button onClick={() => onStatusChange(k.id, 'signerat')}
            className="text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded flex items-center gap-1">
            <PenLine className="w-3 h-3" /> Markera signerad
          </button>
        )}
        {k.status === 'signerat' && (
          <button onClick={() => onStatusChange(k.id, 'aktivt')}
            className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> Aktivera
          </button>
        )}
        {(k.status === 'aktivt' || k.status === 'signerat' || k.status === 'utgånget') && !isEditing && (
          <button onClick={onEditStart}
            className="text-xs text-gray-400 hover:text-white px-3 py-1.5 border border-gray-700 rounded flex items-center gap-1">
            <DollarSign className="w-3 h-3" /> Uppdatera ekonomi
          </button>
        )}
        {k.status === 'aktivt' && (
          <button onClick={() => onStatusChange(k.id, 'avslutat')}
            className="text-xs text-gray-500 hover:text-red-400 px-3 py-1.5 border border-gray-700 rounded">
            Avsluta
          </button>
        )}
        {k.status === 'genererat' && (
          <button onClick={() => onDelete(k.id)}
            className="text-xs text-red-500/60 hover:text-red-400 px-3 py-1.5 border border-red-500/20 hover:border-red-500/40 rounded flex items-center gap-1 transition-colors">
            <Trash2 className="w-3 h-3" /> Ta bort
          </button>
        )}
        {k.status !== 'avböjt' && k.status !== 'avslutat' && k.status !== 'genererat' && (
          <button onClick={() => onStatusChange(k.id, 'avböjt')}
            className="text-xs text-gray-600 hover:text-red-400 px-2 py-1.5">
            Avböjt
          </button>
        )}
      </div>
    </div>
  )
}
