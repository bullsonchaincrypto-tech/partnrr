import { useState, useEffect } from 'react'
import { Bot, Play, CheckCircle, XCircle, Loader2, Settings, Zap, Mail, FileText, Eye, Search, Clock, AlertTriangle } from 'lucide-react'
import * as api from '../../services/api'

const TASKS = [
  {
    key: 'auto-followup',
    label: 'Auto-Uppföljning',
    description: 'Hittar outreach utan svar efter 5 dagar och genererar uppföljningar',
    icon: Mail,
    color: 'purple',
    schedule: 'Dagligen',
  },
  {
    key: 'content-monitor',
    label: 'Content-bevakning',
    description: 'Skannar YouTube för publicerat content och analyserar CTA-kvalitet',
    icon: Eye,
    color: 'cyan',
    schedule: 'Var 12:e timme',
  },
  {
    key: 'contract-monitor',
    label: 'Avtalsbevakning',
    description: 'Hittar utgående/utgångna/osignerade kontrakt och skickar påminnelser',
    icon: FileText,
    color: 'amber',
    schedule: 'Dagligen',
  },
  {
    key: 'gmail-inbox-monitor',
    label: 'Inbox-övervakning',
    description: 'Kollar Gmail för svar, matchar mot outreach, analyserar sentiment',
    icon: Mail,
    color: 'green',
    schedule: 'Var 30:e minut',
  },
  {
    key: 'smart-email-finder',
    label: 'E-postsökning',
    description: 'Söker kontaktinfo för influencers som saknar e-postadress med AI',
    icon: Search,
    color: 'pink',
    schedule: 'Dagligen',
  },
]

const COLOR_CLASSES = {
  purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-400', btn: 'bg-purple-600 hover:bg-purple-700' },
  cyan: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', text: 'text-cyan-400', btn: 'bg-cyan-600 hover:bg-cyan-700' },
  amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', btn: 'bg-amber-600 hover:bg-amber-700' },
  green: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', btn: 'bg-emerald-600 hover:bg-emerald-700' },
  pink: { bg: 'bg-pink-500/10', border: 'border-pink-500/30', text: 'text-pink-400', btn: 'bg-pink-600 hover:bg-pink-700' },
}

export default function AutomationTab() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [setting_up, setSettingUp] = useState(false)
  const [runningTask, setRunningTask] = useState(null)
  const [taskResults, setTaskResults] = useState({})
  const [error, setError] = useState('')

  useEffect(() => {
    loadStatus()
  }, [])

  const loadStatus = async () => {
    setLoading(true)
    try {
      const s = await api.getAgentStatus()
      setStatus(s)
    } catch (err) {
      setError('Kunde inte ladda agent-status: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSetup = async () => {
    setSettingUp(true)
    setError('')
    try {
      await api.setupAgents()
      await loadStatus()
    } catch (err) {
      setError('Setup misslyckades: ' + err.message)
    } finally {
      setSettingUp(false)
    }
  }

  const handleRunTask = async (taskKey) => {
    setRunningTask(taskKey)
    setError('')
    try {
      const result = await api.runAgentTask(taskKey)
      setTaskResults(prev => ({
        ...prev,
        [taskKey]: {
          success: result.success,
          result: result.result,
          toolsUsed: result.toolsUsed,
          timestamp: new Date().toISOString(),
        },
      }))
    } catch (err) {
      setTaskResults(prev => ({
        ...prev,
        [taskKey]: {
          success: false,
          error: err.message,
          timestamp: new Date().toISOString(),
        },
      }))
    } finally {
      setRunningTask(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
        <span className="ml-2 text-gray-400">Laddar agent-status...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bot className="w-6 h-6 text-purple-400" />
          <div>
            <h2 className="text-lg font-bold text-white">AI-Automation</h2>
            <p className="text-sm text-gray-400">Claude Managed Agents kör dina automatiseringar i molnet</p>
          </div>
        </div>

        {status?.configured && (
          <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-1.5">
            <CheckCircle className="w-3.5 h-3.5" />
            {status.agents.length} agenter aktiva
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Setup-knapp om inte konfigurerat */}
      {!status?.configured && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-8 text-center space-y-4">
          <Bot className="w-12 h-12 text-purple-400 mx-auto" />
          <h3 className="text-lg font-bold text-white">Konfigurera AI-Agenter</h3>
          <p className="text-sm text-gray-400 max-w-md mx-auto">
            Sätt upp 5 molnbaserade Claude-agenter som automatiserar uppföljningar,
            content-bevakning, avtalshantering, inbox-övervakning och e-postsökning.
          </p>
          <button
            onClick={handleSetup}
            disabled={setting_up}
            className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg text-sm font-medium transition-colors"
          >
            {setting_up ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Sätter upp agenter...</>
            ) : (
              <><Zap className="w-4 h-4" /> Aktivera AI-Automation</>
            )}
          </button>
          <p className="text-xs text-gray-500">
            Kräver Anthropic API-nyckel. Kostar standard token-priser + $0.08/session-timme.
          </p>
        </div>
      )}

      {/* Task-kort */}
      {status?.configured && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {TASKS.map(task => {
            const Icon = task.icon
            const colors = COLOR_CLASSES[task.color]
            const isRunning = runningTask === task.key
            const result = taskResults[task.key]

            return (
              <div key={task.key} className={`${colors.bg} border ${colors.border} rounded-xl p-5 space-y-3`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors.bg} border ${colors.border}`}>
                      <Icon className={`w-5 h-5 ${colors.text}`} />
                    </div>
                    <div>
                      <h3 className="font-medium text-white text-sm">{task.label}</h3>
                      <p className="text-xs text-gray-400">{task.description}</p>
                    </div>
                  </div>
                  <span className="text-[10px] text-gray-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {task.schedule}
                  </span>
                </div>

                {/* Resultat */}
                {result && (
                  <div className={`text-xs rounded-lg p-3 ${result.success ? 'bg-gray-900/50 text-gray-300' : 'bg-red-500/10 text-red-300'}`}>
                    {result.success ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-emerald-400 font-medium">
                          <CheckCircle className="w-3 h-3" />
                          Klar
                          <span className="text-gray-500 font-normal ml-auto">
                            {new Date(result.timestamp).toLocaleTimeString('sv-SE')}
                          </span>
                        </div>
                        {result.toolsUsed?.length > 0 && (
                          <p className="text-gray-500">Verktyg: {[...new Set(result.toolsUsed)].join(', ')}</p>
                        )}
                        <p className="text-gray-300 line-clamp-3 mt-1">{result.result?.slice(0, 300)}</p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <XCircle className="w-3 h-3" />
                        {result.error}
                      </div>
                    )}
                  </div>
                )}

                {/* Kör-knapp */}
                <button
                  onClick={() => handleRunTask(task.key)}
                  disabled={isRunning}
                  className={`w-full flex items-center justify-center gap-2 ${colors.btn} disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors`}
                >
                  {isRunning ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Kör...</>
                  ) : (
                    <><Play className="w-3.5 h-3.5" /> Kör nu</>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
