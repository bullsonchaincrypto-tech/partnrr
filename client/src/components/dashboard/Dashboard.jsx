import { useState, useEffect } from 'react'
import {
  BarChart3, Users, CheckCircle, XCircle, Clock, FileText, TrendingUp,
  RefreshCw, Loader2, Mail, Download, Eye, DollarSign, Brain, Send, Bot, Radio, Heart,
  ExternalLink, AlertTriangle, Wifi, WifiOff
} from 'lucide-react'
import * as api from '../../services/api'
import ContractsTab from './ContractsTab'
import EkonomiTab from './EkonomiTab'
import OutreachTab from './OutreachTab'
import ContentTab from './ContentTab'
import AiAnalysTab from './AiAnalysTab'
import InboxTab from './InboxTab'
import RoiDashboard from './RoiDashboard'
import TeamTab from './TeamTab'
import AutomationTab from './AutomationTab'
import DailySummaryCard from './DailySummaryCard'
import ConversationView from './ConversationView'
import InfluencerLibraryTab from './InfluencerLibraryTab'
import AdminDashboard from './AdminDashboard'

const ADMIN_KEY = 'rankleague2024'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [outreach, setOutreach] = useState([])
  const [followUps, setFollowUps] = useState([])
  const [ranking, setRanking] = useState([]) // kept for data loading
  const [trackingStats, setTrackingStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('avtal')
  const [gmailStatus, setGmailStatus] = useState(null)

  // Admin access: ?admin=rankleague2024 in URL or saved in sessionStorage
  const [isAdmin, setIsAdmin] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('admin') === ADMIN_KEY) {
        sessionStorage.setItem('sparkcollab_admin', '1')
        // Clean URL
        params.delete('admin')
        const clean = params.toString()
        window.history.replaceState({}, '', window.location.pathname + (clean ? '?' + clean : ''))
        return true
      }
      return sessionStorage.getItem('sparkcollab_admin') === '1'
    }
    return false
  })

  useEffect(() => { loadData(); checkGmail() }, [])

  // Poll Gmail status every 5s if not connected
  useEffect(() => {
    if (gmailStatus?.authenticated) return
    const interval = setInterval(checkGmail, 5000)
    return () => clearInterval(interval)
  }, [gmailStatus?.authenticated])

  const checkGmail = async () => {
    try {
      const status = await api.getAuthStatus()
      setGmailStatus(status)
    } catch { setGmailStatus({ authenticated: false }) }
  }

  const loadData = async () => {
    setLoading(true)
    try {
      const [s, o, f, r, t] = await Promise.all([
        api.getDashboardStats(),
        api.getAllOutreach(),
        api.getFollowUps(),
        api.getInfluencerRanking().catch(() => []),
        api.getTrackingStats().catch(() => null),
      ])
      setStats(s)
      setOutreach(o)
      setFollowUps(f)
      setRanking(r)
      setTrackingStats(t)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const handleFollowUp = async (id) => {
    try { await api.generateFollowUp(id); loadData() } catch (err) { console.error(err) }
  }

  const handleDismissFollowUp = async (id) => {
    try { await api.dismissFollowUp(id); loadData() } catch (err) { console.error(err) }
  }

  const handleSaveSignups = async (influencerId, val) => {
    try { await api.updateSignups(influencerId, val); loadData() } catch (err) { console.error(err) }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
    </div>
  )

  const TABS = [
    { key: 'avtal', label: 'Avtal', icon: FileText },
    { key: 'konversationer', label: 'Konversationer', icon: Radio },
    { key: 'ekonomi', label: 'Ekonomi', icon: DollarSign },
    { key: 'roi', label: 'ROI', icon: TrendingUp },
    { key: 'utskick', label: 'Utskick', icon: Send },
    { key: 'bevakning', label: 'Bevakning', icon: Eye },
    { key: 'ai-analys', label: 'AI-analys', icon: Brain },
    { key: 'bibliotek', label: 'Bibliotek', icon: Heart },
    ...(isAdmin ? [{ key: 'admin', label: 'Admin', icon: BarChart3 }] : []),
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-3">
          <BarChart3 className="w-6 h-6 sm:w-7 sm:h-7 text-purple-500" />
          Kontrollpanel
        </h1>
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Export buttons — hidden on mobile, shown in a dropdown-style row on sm+ */}
          <div className="hidden sm:flex gap-1">
            <a href={api.exportCsvUrl('outreach')} download
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded border border-gray-700 hover:border-gray-600 transition-colors">
              <Download className="w-3 h-3" /> CSV Utskick
            </a>
            <a href={api.exportCsvUrl('sponsors')} download
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded border border-gray-700 hover:border-gray-600 transition-colors">
              <Download className="w-3 h-3" /> CSV Sponsorer
            </a>
            <a href={api.exportCsvUrl('ranking')} download
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded border border-gray-700 hover:border-gray-600 transition-colors">
              <Download className="w-3 h-3" /> CSV Ranking
            </a>
          </div>
          {/* Mobile: single export icon */}
          <div className="flex sm:hidden gap-1">
            <a href={api.exportCsvUrl('outreach')} download
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1.5 rounded border border-gray-700">
              <Download className="w-3 h-3" /> CSV
            </a>
          </div>
          <button onClick={loadData} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm">
            <RefreshCw className="w-4 h-4" /> <span className="hidden sm:inline">Uppdatera</span>
          </button>
        </div>
      </div>

      {/* Gmail-anslutningsstatus */}
      {gmailStatus && (
        <div className={`rounded-lg border px-3 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
          gmailStatus.authenticated
            ? 'border-green-700/50 bg-green-900/10'
            : 'border-amber-700/50 bg-amber-900/10'
        }`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              gmailStatus.authenticated ? 'bg-green-500/10' : 'bg-amber-500/10'
            }`}>
              <Mail className={`w-4 h-4 ${gmailStatus.authenticated ? 'text-green-400' : 'text-amber-400'}`} />
            </div>
            {gmailStatus.authenticated ? (
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-green-300">E-post anslutet</span>
                  {gmailStatus.provider && <span className="text-[10px] text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded-full capitalize">{gmailStatus.provider}</span>}
                  <span className="flex items-center gap-1 text-[10px] text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded-full">
                    <Wifi className="w-2.5 h-2.5" /> Aktiv
                  </span>
                </div>
                <span className="text-xs text-gray-400 truncate block">{gmailStatus.email}</span>
              </div>
            ) : (
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-amber-300">E-post ej anslutet</span>
                  <span className="flex items-center gap-1 text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                    <WifiOff className="w-2.5 h-2.5" /> Offline
                  </span>
                </div>
                <span className="text-xs text-gray-500">Anslut för att skicka utskick och spåra konversationer</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 sm:ml-auto">
            {gmailStatus.authenticated ? (
              <button onClick={async () => { await api.disconnectAuth(); checkGmail() }}
                className="text-xs text-gray-500 hover:text-red-400 px-2 py-1 rounded transition-colors">
                Koppla från
              </button>
            ) : (
              <span className="text-xs text-amber-400">Gå till Utskick för att ansluta</span>
            )}
          </div>
        </div>
      )}

      {/* Daglig sammanfattning — "Idag"-vy */}
      <DailySummaryCard />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3">
        {[
          { label: 'Kontaktade', value: stats?.total || 0, icon: Users, color: 'text-purple-400' },
          { label: 'Skickade', value: stats?.skickat || 0, icon: Mail, color: 'text-blue-400' },
          { label: 'Öppnade', value: stats?.totalOpened || 0, icon: Eye, color: 'text-cyan-400' },
          { label: 'Svarat', value: stats?.svarat || 0, icon: CheckCircle, color: 'text-green-400' },
          { label: 'Avtal', value: stats?.avtal || 0, icon: FileText, color: 'text-emerald-400' },
          { label: 'Svarsfrekvens', value: `${stats?.svarsfrekvens || 0}%`, icon: TrendingUp, color: 'text-yellow-400' },
          { label: 'Öppningsfrekvens', value: `${stats?.oppningsfrekvens || 0}%`, icon: Eye, color: 'text-cyan-400' },
        ].map((kpi, i) => (
          <div key={i} className="bg-gray-900 rounded-lg border border-gray-800 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <kpi.icon className={`w-3.5 h-3.5 ${kpi.color}`} />
              <span className="text-xs text-gray-400">{kpi.label}</span>
            </div>
            <div className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Tab navigation — horizontally scrollable on mobile */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
        <div className="flex gap-1 bg-gray-900 rounded-lg p-1 border border-gray-800 min-w-max sm:min-w-0">
          {TABS.map(t => {
            const Icon = t.icon
            return (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`sm:flex-1 flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-3 py-2 rounded text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === t.key ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}>
                <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'avtal' && (
        <ContractsTab />
      )}

      {activeTab === 'konversationer' && (
        <ConversationView />
      )}

      {activeTab === 'inbox' && (
        <InboxTab />
      )}

      {activeTab === 'ekonomi' && (
        <EkonomiTab />
      )}

      {activeTab === 'roi' && (
        <RoiDashboard />
      )}

      {activeTab === 'utskick' && (
        <OutreachTab
          outreach={outreach}
          trackingStats={trackingStats}
          stats={stats}
          followUps={followUps}
          onFollowUp={handleFollowUp}
          onDismissFollowUp={handleDismissFollowUp}
        />
      )}

      {activeTab === 'bevakning' && (
        <ContentTab />
      )}

      {activeTab === 'ai-analys' && (
        <AiAnalysTab />
      )}

      {activeTab === 'bibliotek' && (
        <InfluencerLibraryTab />
      )}

      {activeTab === 'admin' && (
        <AdminDashboard />
      )}

      {activeTab === 'automation' && (
        <AutomationTab />
      )}

      {activeTab === 'team' && (
        <TeamTab />
      )}
    </div>
  )
}
