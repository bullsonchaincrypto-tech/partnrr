import { useState, useEffect } from 'react'
import {
  RefreshCw, Loader2, Settings, Play, Pause, Zap, Clock, Check,
  AlertTriangle, Mail, ChevronDown, ChevronUp, Send
} from 'lucide-react'
import * as api from '../../services/api'

const STEP_LABELS = {
  1: { label: 'Mjuk påminnelse', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30' },
  2: { label: 'Direkt uppföljning', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30' },
  3: { label: 'Sista försöket', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30' },
}

export default function FollowupSequenceTab() {
  const [settings, setSettings] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [processing, setProcessing] = useState(null)
  const [showSettings, setShowSettings] = useState(false)

  // Lokala inställningsvärden
  const [localSettings, setLocalSettings] = useState({})

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [s, st] = await Promise.all([
        api.getFollowupSettings().catch(() => null),
        api.getFollowupStatus().catch(() => null),
      ])
      setSettings(s)
      setStatus(st)
      if (s) setLocalSettings({
        enabled: !!s.enabled,
        step1_days: s.step1_days || 3,
        step2_days: s.step2_days || 7,
        step3_days: s.step3_days || 14,
        max_steps: s.max_steps || 3,
        auto_send: !!s.auto_send,
      })
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await api.updateFollowupSettings(localSettings)
      setSettings(updated)
      setShowSettings(false)
      await loadData()
    } catch (err) { console.error(err) }
    finally { setSaving(false) }
  }

  const handleRun = async () => {
    setRunning(true)
    try {
      await api.runAutoFollowups()
      await loadData()
    } catch (err) { console.error(err) }
    finally { setRunning(false) }
  }

  const handleProcess = async (id) => {
    setProcessing(id)
    try {
      await api.processFollowup(id, true)
      await loadData()
    } catch (err) { console.error(err) }
    finally { setProcessing(null) }
  }

  const handlePause = async (id, paused) => {
    try {
      await api.pauseFollowupSequence(id, paused)
      await loadData()
    } catch (err) { console.error(err) }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
    </div>
  )

  const stats = status?.stats || {}
  const sequences = status?.sequences || []
  const recentFollowups = status?.recentFollowups || []
  const isEnabled = localSettings.enabled

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Zap className="w-5 h-5 text-purple-500" />
          Auto-uppföljning
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-1 text-gray-400 hover:text-white text-sm px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors">
            <Settings className="w-3.5 h-3.5" /> Inställningar
          </button>
          <button onClick={loadData}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Status-bar */}
      <div className={`rounded-lg px-4 py-3 border flex items-center justify-between ${
        isEnabled ? 'bg-green-500/10 border-green-500/30' : 'bg-gray-800/50 border-gray-700'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${isEnabled ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
          <span className={`text-sm font-medium ${isEnabled ? 'text-green-400' : 'text-gray-400'}`}>
            {isEnabled ? 'Auto-uppföljning aktiv' : 'Auto-uppföljning avstängd'}
          </span>
          {isEnabled && (
            <span className="text-xs text-gray-500">
              Steg 1: {localSettings.step1_days}d · Steg 2: {localSettings.step2_days}d · Steg 3: {localSettings.step3_days}d
            </span>
          )}
        </div>
        {isEnabled && (
          <button onClick={handleRun} disabled={running}
            className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 px-3 py-1.5 bg-purple-500/10 rounded-lg border border-purple-500/30 transition-colors disabled:opacity-50">
            {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            {running ? 'Kör...' : 'Kör nu'}
          </button>
        )}
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700 space-y-4">
          <h4 className="text-sm font-semibold text-white">Inställningar</h4>

          {/* Toggle enabled */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white">Aktivera auto-uppföljning</p>
              <p className="text-xs text-gray-500">Systemet genererar uppföljningar automatiskt baserat på schemat nedan</p>
            </div>
            <button
              onClick={() => setLocalSettings(s => ({ ...s, enabled: !s.enabled }))}
              className={`w-11 h-6 rounded-full transition-colors relative ${localSettings.enabled ? 'bg-purple-600' : 'bg-gray-700'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${localSettings.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Step timing */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { key: 'step1_days', label: 'Steg 1: Mjuk påminnelse', desc: 'dagar efter utskick' },
              { key: 'step2_days', label: 'Steg 2: Direkt uppföljning', desc: 'dagar efter utskick' },
              { key: 'step3_days', label: 'Steg 3: Sista försöket', desc: 'dagar efter utskick' },
            ].map(({ key, label, desc }) => (
              <div key={key} className="space-y-1">
                <label className="text-xs text-gray-400">{label}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={localSettings[key]}
                    onChange={(e) => setLocalSettings(s => ({ ...s, [key]: Number(e.target.value) }))}
                    className="w-16 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white text-center focus:border-purple-500 focus:outline-none"
                  />
                  <span className="text-xs text-gray-500">{desc}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Auto-send toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-700">
            <div>
              <p className="text-sm text-white">Auto-skicka via Gmail</p>
              <p className="text-xs text-gray-500">Skickar uppföljningen automatiskt. Annars skapas bara ett utkast.</p>
            </div>
            <button
              onClick={() => setLocalSettings(s => ({ ...s, auto_send: !s.auto_send }))}
              className={`w-11 h-6 rounded-full transition-colors relative ${localSettings.auto_send ? 'bg-green-600' : 'bg-gray-700'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${localSettings.auto_send ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {localSettings.auto_send && (
            <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-300">Auto-skicka kräver att Gmail är kopplat. Meddelanden skickas utan manuell granskning.</p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Spara
            </button>
            <button onClick={() => setShowSettings(false)}
              className="text-gray-400 hover:text-white px-4 py-2 text-sm transition-colors">
              Avbryt
            </button>
          </div>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 text-center">
          <div className="text-xl font-bold text-blue-400">{stats.totalActive || 0}</div>
          <div className="text-xs text-gray-500">Aktiva sekvenser</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 text-center">
          <div className="text-xl font-bold text-yellow-400">{stats.totalPaused || 0}</div>
          <div className="text-xs text-gray-500">Pausade</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 text-center">
          <div className="text-xl font-bold text-green-400">{stats.totalCompleted || 0}</div>
          <div className="text-xs text-gray-500">Slutförda</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 text-center">
          <div className="text-xl font-bold text-purple-400">{stats.totalFollowupsSent || 0}</div>
          <div className="text-xs text-gray-500">Uppföljningar skickade</div>
        </div>
      </div>

      {/* Sequence list */}
      {sequences.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-300">Aktiva utskick med uppföljningssekvens</h4>
          {sequences.map(seq => {
            const step = seq.followup_step || 0
            const isPaused = !!seq.followup_paused
            const maxSteps = localSettings.max_steps || 3
            const isComplete = step >= maxSteps

            return (
              <div key={seq.id} className={`rounded-lg border p-3 ${isPaused ? 'border-yellow-500/30 bg-yellow-500/5' : isComplete ? 'border-green-500/20 bg-green-500/5' : 'border-gray-700 bg-gray-800/30'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      {/* Step progress dots */}
                      <div className="flex gap-1">
                        {Array.from({ length: maxSteps }, (_, i) => (
                          <div key={i} className={`w-2.5 h-2.5 rounded-full ${i < step ? 'bg-purple-500' : i === step && !isComplete ? 'bg-purple-500/40 animate-pulse' : 'bg-gray-700'}`} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{seq.influencer_namn}</span>
                        <span className="text-xs text-gray-500">{seq.plattform} · {seq.kanalnamn}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Skickat: {new Date(seq.skickat_datum).toLocaleDateString('sv-SE')}
                        {step > 0 && <> · Steg {step}/{maxSteps} klar</>}
                        {seq.last_followup_at && <> · Senaste: {new Date(seq.last_followup_at).toLocaleDateString('sv-SE')}</>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isComplete ? (
                      <span className="text-xs text-green-400 px-2 py-1 bg-green-500/10 rounded">Slutförd</span>
                    ) : isPaused ? (
                      <button onClick={() => handlePause(seq.id, false)}
                        className="text-xs text-yellow-400 hover:text-yellow-300 px-2 py-1 border border-yellow-500/30 rounded flex items-center gap-1">
                        <Play className="w-3 h-3" /> Återuppta
                      </button>
                    ) : (
                      <>
                        <button onClick={() => handleProcess(seq.id)} disabled={processing === seq.id}
                          className="text-xs text-purple-400 hover:text-purple-300 px-2 py-1 border border-purple-500/30 rounded flex items-center gap-1 disabled:opacity-50">
                          {processing === seq.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                          Skicka steg {step + 1}
                        </button>
                        <button onClick={() => handlePause(seq.id, true)}
                          className="text-xs text-gray-500 hover:text-gray-300 px-1.5 py-1 rounded transition-colors"
                          title="Pausa sekvens">
                          <Pause className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-10">
          <Clock className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 font-medium mb-1">Inga aktiva sekvenser</p>
          <p className="text-gray-600 text-sm">Skicka outreach-meddelanden via wizarden — uppföljningar skapas automatiskt.</p>
        </div>
      )}

      {/* Recent followups log */}
      {recentFollowups.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-300">Senaste uppföljningar</h4>
          <div className="bg-gray-800/30 rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left text-gray-500 px-3 py-2 text-xs">Influencer</th>
                  <th className="text-left text-gray-500 px-3 py-2 text-xs">Steg</th>
                  <th className="text-left text-gray-500 px-3 py-2 text-xs">Anledning</th>
                  <th className="text-left text-gray-500 px-3 py-2 text-xs">Status</th>
                  <th className="text-left text-gray-500 px-3 py-2 text-xs">Datum</th>
                </tr>
              </thead>
              <tbody>
                {recentFollowups.map(f => (
                  <tr key={f.id} className="border-b border-gray-800/50">
                    <td className="px-3 py-2 text-white">{f.influencer_namn || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STEP_LABELS[f.followup_nr]?.bg || 'bg-gray-700'} ${STEP_LABELS[f.followup_nr]?.color || 'text-gray-400'}`}>
                        {STEP_LABELS[f.followup_nr]?.label || `Steg ${f.followup_nr}`}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-400 text-xs">{f.trigger_reason}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs ${f.status === 'sent' ? 'text-green-400' : 'text-yellow-400'}`}>
                        {f.status === 'sent' ? 'Skickad' : 'Utkast'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {f.sent_at ? new Date(f.sent_at).toLocaleDateString('sv-SE') : new Date(f.created_at).toLocaleDateString('sv-SE')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
