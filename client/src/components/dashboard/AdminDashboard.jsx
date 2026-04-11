import { useState, useEffect } from 'react'
import {
  Shield, DollarSign, Activity, AlertTriangle, Clock,
  Server, Database, CheckCircle2, XCircle, RefreshCw,
  TrendingUp, Zap, Eye, ChevronDown, BarChart3, Wifi, WifiOff
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts'
import * as api from '../../services/api'

const PERIODS = [
  { key: 'today', label: 'Idag' },
  { key: 'week', label: 'Senaste 7d' },
  { key: 'month', label: 'Senaste 30d' },
  { key: 'all', label: 'Allt' },
]

const SERVICE_COLORS = {
  anthropic: '#a855f7',
  phyllo: '#06b6d4',
  youtube: '#ef4444',
  serpapi: '#f59e0b',
  gmail: '#22c55e',
  apify: '#ff6b35',
}
const SERVICE_LABELS = {
  anthropic: 'Claude AI',
  phyllo: 'Phyllo',
  youtube: 'YouTube API',
  serpapi: 'SerpAPI',
  gmail: 'Gmail API',
  apify: 'Apify',
}

export default function AdminDashboard() {
  const [costs, setCosts] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [status, setStatus] = useState(null)
  const [envCheck, setEnvCheck] = useState(null)
  const [serpStatus, setSerpStatus] = useState(null)
  const [realtime, setRealtime] = useState(null)
  const [period, setPeriod] = useState('week')
  const [loading, setLoading] = useState(true)
  const [dailyCosts, setDailyCosts] = useState([])

  const loadAll = async () => {
    setLoading(true)
    try {
      const [c, a, s, e, d, serp, rt] = await Promise.all([
        api.getAdminCosts(period),
        api.getAdminAlerts(),
        api.getAdminSystemStatus(),
        api.getAdminEnvCheck(),
        api.getAdminCostsDaily(30),
        api.getAdminSerpApiStatus().catch(() => null),
        api.getAdminCostsRealtime().catch(() => null),
      ])
      setCosts(c)
      setAlerts(a.alerts || [])
      setStatus(s)
      setEnvCheck(e)
      setDailyCosts(d)
      setSerpStatus(serp)
      setRealtime(rt)
    } catch (err) { console.error('[Admin] Load error:', err) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadAll() }, [period])

  // Gruppera daily costs per dag
  const dailyChart = (() => {
    const byDate = {}
    for (const row of dailyCosts) {
      if (!byDate[row.date]) byDate[row.date] = { date: row.date }
      byDate[row.date][row.service] = (byDate[row.date][row.service] || 0) + (row.sek || 0)
      byDate[row.date].total = (byDate[row.date].total || 0) + (row.sek || 0)
    }
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)).slice(-14)
  })()

  // Pie chart data
  const pieData = (costs?.by_service || []).map(s => ({
    name: SERVICE_LABELS[s.service] || s.service,
    value: s.total_sek || 0,
    color: SERVICE_COLORS[s.service] || '#6b7280',
  }))

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Activity className="w-8 h-8 text-purple-500 animate-pulse" />
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <Shield className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Admin Dashboard</h2>
            <p className="text-xs text-gray-500">Kostnadsövervakning & systemstatus</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                period === p.key
                  ? 'bg-purple-500/20 border-purple-500/30 text-purple-300'
                  : 'bg-gray-800/30 border-gray-700/30 text-gray-500 hover:text-gray-300'
              }`}>
              {p.label}
            </button>
          ))}
          <button onClick={loadAll} className="text-gray-500 hover:text-purple-400 p-1.5 rounded-lg hover:bg-purple-500/10">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
              a.level === 'critical'
                ? 'bg-red-500/10 border-red-500/30 text-red-300'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            }`}>
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span className="text-sm">{a.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* System Status */}
      <SystemStatus />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          icon={DollarSign} label="Total kostnad" color="text-purple-400" bg="bg-purple-500/10"
          value={`${(costs?.totals?.total_sek || 0).toFixed(2)} kr`}
          sub={`$${(costs?.totals?.total_usd || 0).toFixed(4)}`}
        />
        <KpiCard
          icon={Zap} label="API-anrop" color="text-sky-400" bg="bg-sky-500/10"
          value={costs?.totals?.total_calls || 0}
          sub={`${PERIODS.find(p => p.key === period)?.label}`}
        />
        <KpiCard
          icon={BarChart3} label="Tokens" color="text-amber-400" bg="bg-amber-500/10"
          value={formatTokens(costs?.totals?.total_tokens_input + costs?.totals?.total_tokens_output)}
          sub={`In: ${formatTokens(costs?.totals?.total_tokens_input)} / Ut: ${formatTokens(costs?.totals?.total_tokens_output)}`}
        />
        <KpiCard
          icon={Server} label="Aktiva avtal" color="text-emerald-400" bg="bg-emerald-500/10"
          value={status?.active_contracts || 0}
          sub={`${status?.conversations?.total || 0} konversationer`}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Daily costs bar chart */}
        <div className="lg:col-span-2 bg-gray-900/50 border border-gray-800/60 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-purple-400" /> Daglig kostnad (SEK)
          </h3>
          {dailyChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dailyChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }}
                  tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '8px', color: '#fff', fontSize: '12px' }}
                  labelFormatter={l => `Datum: ${l}`}
                  formatter={(v, name) => [`${v.toFixed(2)} kr`, SERVICE_LABELS[name] || name]}
                />
                {Object.keys(SERVICE_COLORS).map(svc => (
                  <Bar key={svc} dataKey={svc} stackId="a" fill={SERVICE_COLORS[svc]} radius={[0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-gray-600 text-sm">
              Ingen kostnadsdata ännu
            </div>
          )}
        </div>

        {/* Pie chart */}
        <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-purple-400" /> Fördelning per tjänst
          </h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  outerRadius={70} innerRadius={35} paddingAngle={2}>
                  {pieData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '8px', color: '#fff', fontSize: '12px' }}
                  formatter={v => `${v.toFixed(2)} kr`}
                />
                <Legend wrapperStyle={{ fontSize: '10px', color: '#9ca3af' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-gray-600 text-sm">
              Inga kostnader
            </div>
          )}
        </div>
      </div>

      {/* Cost per service table */}
      <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800/60">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Database className="w-4 h-4 text-purple-400" /> Kostnad per tjänst
          </h3>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800/40">
              <th className="text-left px-4 py-2 font-medium">Tjänst</th>
              <th className="text-right px-4 py-2 font-medium">Anrop</th>
              <th className="text-right px-4 py-2 font-medium">Tokens (in/ut)</th>
              <th className="text-right px-4 py-2 font-medium">USD</th>
              <th className="text-right px-4 py-2 font-medium">SEK</th>
            </tr>
          </thead>
          <tbody>
            {(costs?.by_service || []).map((s, i) => (
              <tr key={i} className="border-b border-gray-800/20 hover:bg-white/[0.02]">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: SERVICE_COLORS[s.service] || '#6b7280' }} />
                    <span className="text-gray-200 font-medium">{SERVICE_LABELS[s.service] || s.service}</span>
                  </div>
                </td>
                <td className="text-right px-4 py-2.5 text-gray-400">{s.calls}</td>
                <td className="text-right px-4 py-2.5 text-gray-400">
                  {formatTokens(s.total_tokens_input)} / {formatTokens(s.total_tokens_output)}
                </td>
                <td className="text-right px-4 py-2.5 text-gray-300">${s.total_usd}</td>
                <td className="text-right px-4 py-2.5 text-white font-medium">{s.total_sek} kr</td>
              </tr>
            ))}
            {(costs?.by_service || []).length === 0 && (
              <tr>
                <td colSpan="5" className="text-center py-6 text-gray-600">Inga API-anrop loggade ännu</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* SerpAPI Quota + Realtime Cost */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* SerpAPI Kvota */}
        <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-amber-400" /> SerpAPI Kvota
          </h3>
          {serpStatus?.account ? (() => {
            const acct = serpStatus.account
            const used = acct.searches_this_month || (acct.searches_per_month - (acct.searches_left || 0))
            const total = acct.searches_per_month || 0
            const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0
            const isLow = pct > 80
            return (
              <div className="space-y-3">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Plan</span>
                  <span className="text-amber-300 font-medium">{acct.plan}</span>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-400">Sökningar denna månad</span>
                    <span className={isLow ? 'text-red-400 font-medium' : 'text-gray-200'}>{used} / {total}</span>
                  </div>
                  <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${isLow ? 'bg-red-500' : 'bg-amber-500'}`}
                      style={{ width: `${pct}%` }} />
                  </div>
                  {acct.searches_left != null && (
                    <p className="text-[10px] text-gray-500 mt-1">{acct.searches_left} kvar</p>
                  )}
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Idag (intern tracking)</span>
                  <span className="text-gray-200">
                    {serpStatus.usage?.today?.calls_today || 0} anrop ({(serpStatus.usage?.today?.cost_sek_today || 0).toFixed(2)} kr)
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Denna månad (intern)</span>
                  <span className="text-gray-200">
                    {serpStatus.usage?.month?.calls_month || 0} anrop ({(serpStatus.usage?.month?.cost_sek_month || 0).toFixed(2)} kr)
                  </span>
                </div>
              </div>
            )
          })() : (
            <div className="text-xs text-gray-500">
              {serpStatus?.error || 'Laddar...'}
              {!serpStatus?.configured && <p className="text-red-400 mt-1">SERPAPI_KEY saknas</p>}
            </div>
          )}
        </div>

        {/* Realtidskostnad */}
        <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-sky-400" /> Senaste sökning (realtid)
          </h3>
          {realtime?.last_search?.items?.length > 0 ? (
            <div className="space-y-2">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-gray-400">Total kostnad</span>
                <span className="text-white font-bold text-sm">
                  {realtime.last_search.total.sek.toFixed(2)} kr
                  <span className="text-gray-500 text-[10px] ml-1">(${realtime.last_search.total.usd.toFixed(4)})</span>
                </span>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {realtime.last_search.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px] py-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: SERVICE_COLORS[item.service] || '#6b7280' }} />
                      <span className="text-gray-300">{item.endpoint || item.service}</span>
                    </div>
                    <span className="text-gray-500">{(item.cost_sek || 0).toFixed(2)} kr</span>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-gray-600 pt-1 border-t border-gray-800/30">
                {realtime.last_search.total.calls} API-anrop senaste 5 min
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-500 py-4 text-center">Ingen sökning de senaste 5 min</div>
          )}
          {realtime?.today?.total && (
            <div className="mt-3 pt-3 border-t border-gray-800/30 flex justify-between text-xs">
              <span className="text-gray-400">Totalt idag</span>
              <span className="text-white font-medium">{(realtime.today.total.sek || 0).toFixed(2)} kr ({realtime.today.total.calls || 0} anrop)</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: API Keys + Recent calls + System */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* API Keys status */}
        <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Eye className="w-4 h-4 text-purple-400" /> API-nycklar
          </h3>
          <div className="space-y-2">
            {envCheck && Object.entries(envCheck).map(([key, configured]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-xs text-gray-400 capitalize">{key.replace(/_/g, ' ')}</span>
                {configured ? (
                  <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded flex items-center gap-1">
                    <CheckCircle2 className="w-2.5 h-2.5" /> Aktiv
                  </span>
                ) : (
                  <span className="text-[10px] text-red-400 bg-red-500/10 px-2 py-0.5 rounded flex items-center gap-1">
                    <XCircle className="w-2.5 h-2.5" /> Saknas
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Recent API calls */}
        <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-purple-400" /> Senaste anrop
          </h3>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {(costs?.recent || []).map((r, i) => (
              <div key={i} className="flex items-center justify-between text-[10px] py-1 border-b border-gray-800/20 last:border-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SERVICE_COLORS[r.service] || '#6b7280' }} />
                  <span className="text-gray-300 truncate">{r.endpoint || r.service}</span>
                </div>
                <span className="text-gray-500 shrink-0 ml-2">
                  {r.cost_sek > 0 ? `${r.cost_sek.toFixed(2)} kr` : 'gratis'}
                </span>
              </div>
            ))}
            {(costs?.recent || []).length === 0 && (
              <p className="text-gray-600 text-[10px] py-3 text-center">Inga anrop loggade</p>
            )}
          </div>
        </div>

        {/* System health */}
        <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Server className="w-4 h-4 text-purple-400" /> System
          </h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-400">Uptime</span>
              <span className="text-gray-200">{formatUptime(status?.uptime || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Minne (heap)</span>
              <span className="text-gray-200">{formatBytes(status?.memory?.heapUsed || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Gmail</span>
              <span className={status?.gmail?.history_id ? 'text-emerald-400' : 'text-red-400'}>
                {status?.gmail?.history_id ? 'Ansluten' : 'Ej ansluten'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Konversationer</span>
              <span className="text-gray-200">{status?.conversations?.total || 0} ({status?.conversations?.unread || 0} olästa)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Kostnad idag</span>
              <span className="text-gray-200">{(status?.costs_today?.sek || 0).toFixed(2)} kr</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── HELPERS ───

function KpiCard({ icon: Icon, label, value, sub, color, bg }) {
  return (
    <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center`}>
          <Icon className={`w-3.5 h-3.5 ${color}`} />
        </div>
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl font-bold text-white">{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function formatTokens(n) {
  if (!n || n === 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`
  return n.toString()
}

function formatUptime(seconds) {
  if (!seconds) return '-'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

// ─── SYSTEM STATUS (anslutningstest) ───

const STATUS_ICONS = {
  database: '💾', email: '📧', microsoft: '🔷', gmail: '🔴',
  anthropic: '🤖', youtube: '▶️', serpapi: '🔍', apify: '🐝',
}
const STATUS_LABELS = {
  database: 'Databas (SQLite)', email: 'E-post (aktiv)', microsoft: 'Microsoft OAuth',
  gmail: 'Gmail OAuth', anthropic: 'Anthropic API', youtube: 'YouTube API',
  serpapi: 'SerpAPI', apify: 'Apify',
}

function SystemStatus() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const runTest = async () => {
    setLoading(true)
    try {
      const resp = await fetch('/api/test/status')
      setData(await resp.json())
    } catch (err) {
      setData({ allOk: false, summary: 'Kunde inte ansluta', services: {} })
    }
    setLoading(false)
  }

  useEffect(() => { runTest() }, [])

  return (
    <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            data?.allOk ? 'bg-emerald-500/10' : data ? 'bg-amber-500/10' : 'bg-gray-800/50'
          }`}>
            {data?.allOk
              ? <Wifi className="w-4 h-4 text-emerald-400" />
              : data
                ? <WifiOff className="w-4 h-4 text-amber-400" />
                : <Activity className="w-4 h-4 text-gray-500 animate-pulse" />
            }
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-white">Systemstatus</h3>
            <p className="text-[10px] text-gray-500">
              {loading ? 'Testar...' : data ? data.summary : 'Klicka för att testa'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data && !loading && (
            <div className="flex gap-1">
              {Object.values(data.services || {}).map((svc, i) => (
                <span key={i} className={`w-2 h-2 rounded-full ${svc.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
              ))}
            </div>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); runTest() }}
            className="text-gray-500 hover:text-purple-400 p-1 rounded-lg hover:bg-purple-500/10"
            disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded && data && (
        <div className="px-4 pb-4 space-y-1.5 border-t border-gray-800/40 pt-3">
          {Object.entries(data.services || {}).map(([key, svc]) => (
            <div key={key} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/[0.02]">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span>{STATUS_ICONS[key] || '🔧'}</span>
                  <span className="text-gray-200 font-medium text-xs">{STATUS_LABELS[key] || key}</span>
                </div>
                {(svc.message || svc.email) && (
                  <p className="text-[10px] text-gray-500 ml-6 truncate">
                    {svc.message || ''}
                    {svc.email ? `${svc.message ? ' — ' : ''}${svc.email}` : ''}
                    {svc.displayName ? ` (${svc.displayName})` : ''}
                    {svc.expired ? ' ⚠️ Token utgången' : ''}
                  </p>
                )}
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                svc.ok
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-red-500/10 text-red-400'
              }`}>
                {svc.ok ? 'OK' : 'FEL'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
