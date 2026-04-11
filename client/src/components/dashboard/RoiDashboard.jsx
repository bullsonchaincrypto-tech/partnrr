import { useState, useEffect } from 'react'
import {
  TrendingUp, TrendingDown, DollarSign, Users, BarChart3, Target,
  Loader2, RefreshCw, Award, AlertTriangle, ArrowUpRight, ArrowDownRight,
  Zap, PieChart, FileText
} from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Area
} from 'recharts'
import * as api from '../../services/api'

function formatSEK(val) {
  if (val == null) return '—'
  return Number(val).toLocaleString('sv-SE') + ' kr'
}

function StatCard({ icon: Icon, label, value, sub, color = 'purple', trend }) {
  const colors = {
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    green: 'bg-green-500/10 text-green-400 border-green-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    yellow: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center justify-between mb-2">
        <Icon className="w-4 h-4 opacity-70" />
        {trend !== undefined && (
          <span className={`flex items-center gap-0.5 text-xs font-medium ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trend >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <p className="text-xl font-bold text-white">{value}</p>
      <p className="text-xs opacity-60 mt-0.5">{label}</p>
      {sub && <p className="text-[10px] opacity-40 mt-1">{sub}</p>}
    </div>
  )
}

function BenchmarkBar({ label, myValue, benchValue, unit = 'SEK' }) {
  const maxVal = Math.max(myValue || 0, benchValue || 0, 1)
  const myPct = ((myValue || 0) / maxVal) * 100
  const benchPct = ((benchValue || 0) / maxVal) * 100
  const isBetter = unit === 'SEK' ? (myValue || 0) <= (benchValue || 0) : (myValue || 0) >= (benchValue || 0)

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400">{label}</span>
        <span className={`text-xs font-medium ${isBetter ? 'text-green-400' : 'text-yellow-400'}`}>
          {isBetter ? 'Bättre' : 'Under snitt'}
        </span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-purple-400 w-8">Du</span>
          <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${myPct}%` }} />
          </div>
          <span className="text-xs text-white w-16 text-right">{myValue != null ? `${myValue} ${unit}` : '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 w-8">Snitt</span>
          <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-gray-600 rounded-full" style={{ width: `${benchPct}%` }} />
          </div>
          <span className="text-xs text-gray-400 w-16 text-right">{benchValue} {unit}</span>
        </div>
      </div>
    </div>
  )
}

export default function RoiDashboard() {
  const [profitData, setProfitData] = useState(null)
  const [trendData, setTrendData] = useState([])
  const [comparison, setComparison] = useState(null)
  const [aiRecs, setAiRecs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    try {
      const [profit, trend, comp] = await Promise.all([
        api.getRoiProfitability(),
        api.getRoiProfitTrend(),
        api.getRoiComparison(),
      ])
      setProfitData(profit)
      setTrendData(trend)
      setComparison(comp)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const loadAiRecs = async () => {
    setAiLoading(true)
    try {
      const data = await api.getRoiAiRecommendations()
      setAiRecs(data.recommendations)
    } catch (err) { console.error(err) }
    finally { setAiLoading(false) }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
    </div>
  )

  const p = profitData?.profitability || {}
  const c = profitData?.costs || {}
  const r = profitData?.revenue || {}
  const bench = profitData?.benchmarks || {}

  const hasData = c.antal_kontrakt > 0 || r.antal_intakter > 0

  if (!hasData) return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center">
      <BarChart3 className="w-12 h-12 text-gray-700 mx-auto mb-3" />
      <h3 className="text-white font-semibold mb-1">Ingen ROI-data ännu</h3>
      <p className="text-sm text-gray-500">
        Skapa och aktivera kontrakt, och registrera intäkter från sponsorer för att se ROI-analysen.
      </p>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Rapport-knapp */}
      <div className="flex justify-end">
        <button
          onClick={() => api.downloadReport()}
          className="flex items-center gap-2 text-sm text-purple-400 hover:text-purple-300 px-4 py-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 transition-colors"
        >
          <FileText className="w-4 h-4" /> Ladda ner ROI-rapport (PDF)
        </button>
      </div>

      {/* KPI-kort */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard icon={DollarSign} label="Total intäkt" value={formatSEK(r.total_inbetalt)} sub={`Avtalat: ${formatSEK(r.total_avtalat)}`} color="green" />
        <StatCard icon={TrendingDown} label="Total kostnad" value={formatSEK(c.total_kostnad)} sub={`${c.antal_kontrakt} kontrakt`} color="red" />
        <StatCard icon={TrendingUp} label="Profit" value={formatSEK(p.profit_confirmed)}
          color={p.profit_confirmed >= 0 ? 'green' : 'red'}
          sub={`Marginal: ${p.margin_pct}%`} />
        <StatCard icon={Target} label="CPA" value={p.cpa ? `${p.cpa} kr` : '—'} sub="Kostnad per signup" color="blue" />
        <StatCard icon={Users} label="Totala signups" value={c.total_signups?.toLocaleString('sv-SE') || '0'} color="purple" />
        <StatCard icon={Zap} label="LTV/CPA" value={p.ltv_to_cpa ? `${p.ltv_to_cpa}x` : '—'}
          color={p.ltv_to_cpa >= 2 ? 'green' : p.ltv_to_cpa >= 1 ? 'yellow' : 'red'}
          sub="Värde per signup / kostnad" />
      </div>

      {/* Trend-graf + Benchmarks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trend-graf */}
        <div className="lg:col-span-2 bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-purple-400" />
            Lönsamhetstrend per månad
          </h3>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="manad" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={(v) => `${v/1000}k`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 8 }}
                  labelStyle={{ color: '#fff' }}
                  formatter={(val, name) => [formatSEK(val), name]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="intakt" name="Intäkt" fill="#10B981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="kostnad" name="Kostnad" fill="#EF4444" radius={[4, 4, 0, 0]} opacity={0.7} />
                <Line dataKey="profit" name="Profit" stroke="#A855F7" strokeWidth={2} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-500 text-sm py-10 text-center">Ingen trenddata ännu</p>
          )}
        </div>

        {/* Benchmarks */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-purple-400" />
            Branschjämförelse
          </h3>
          <BenchmarkBar label="CPA (Gaming)" myValue={p.cpa} benchValue={bench.avg_cpa_gaming} unit="SEK" />
          <BenchmarkBar label="CPA (Lifestyle)" myValue={p.cpa} benchValue={bench.avg_cpa_lifestyle} unit="SEK" />
          <BenchmarkBar label="CPA (Tech)" myValue={p.cpa} benchValue={bench.avg_cpa_tech} unit="SEK" />
          <BenchmarkBar label="Vinstmarginal" myValue={Number(p.margin_pct)} benchValue={bench.avg_margin} unit="%" />
          <div className="mt-4 text-[10px] text-gray-600">
            Benchmarks baserade på svenska influencer-kampanjer 2025–2026
          </div>
        </div>
      </div>

      {/* Influencer-jämförelse */}
      {comparison && (comparison.top?.length > 0) && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Award className="w-4 h-4 text-yellow-400" />
            Influencer-ranking (ROI)
            <span className="text-[10px] text-gray-500 ml-2">{comparison.total_influencers} totalt</span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-[10px] uppercase border-b border-gray-800">
                  <th className="py-2 text-left">#</th>
                  <th className="py-2 text-left">Influencer</th>
                  <th className="py-2 text-left">Plattform</th>
                  <th className="py-2 text-right">Videos</th>
                  <th className="py-2 text-right">Signups</th>
                  <th className="py-2 text-right">CPA</th>
                  <th className="py-2 text-right">Signups/video</th>
                  <th className="py-2 text-right">vs Snitt</th>
                </tr>
              </thead>
              <tbody>
                {comparison.top.map((inf, idx) => (
                  <tr key={inf.influencer_id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="py-2">
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                    </td>
                    <td className="py-2">
                      <span className="text-white font-medium">{inf.namn}</span>
                      <span className="text-gray-500 text-xs ml-1">@{inf.kanalnamn}</span>
                    </td>
                    <td className="py-2 text-gray-400 text-xs">{inf.plattform}</td>
                    <td className="py-2 text-right text-gray-300">{inf.videos || 0}</td>
                    <td className="py-2 text-right text-white font-medium">{inf.signups || 0}</td>
                    <td className="py-2 text-right">
                      <span className={inf.cpa && inf.cpa < (comparison.avg?.cpa || 999) ? 'text-green-400' : 'text-gray-300'}>
                        {inf.cpa ? `${inf.cpa} kr` : '—'}
                      </span>
                    </td>
                    <td className="py-2 text-right text-gray-300">{inf.signups_per_video}</td>
                    <td className="py-2 text-right">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        inf.vs_avg_signups > 120 ? 'bg-green-500/20 text-green-300' :
                        inf.vs_avg_signups < 80 ? 'bg-red-500/20 text-red-300' :
                        'bg-gray-500/20 text-gray-300'
                      }`}>
                        {inf.vs_avg_signups}%
                      </span>
                    </td>
                  </tr>
                ))}
                {comparison.bottom?.length > 0 && (
                  <>
                    <tr><td colSpan={8} className="py-1">
                      <div className="border-t border-dashed border-gray-700 my-1" />
                    </td></tr>
                    {comparison.bottom.map((inf) => (
                      <tr key={inf.influencer_id} className="border-b border-gray-800/50 opacity-60">
                        <td className="py-2 text-gray-500">
                          <AlertTriangle className="w-3 h-3 text-yellow-500" />
                        </td>
                        <td className="py-2">
                          <span className="text-gray-300">{inf.namn}</span>
                          <span className="text-gray-600 text-xs ml-1">@{inf.kanalnamn}</span>
                        </td>
                        <td className="py-2 text-gray-500 text-xs">{inf.plattform}</td>
                        <td className="py-2 text-right text-gray-500">{inf.videos || 0}</td>
                        <td className="py-2 text-right text-gray-400">{inf.signups || 0}</td>
                        <td className="py-2 text-right text-gray-500">{inf.cpa ? `${inf.cpa} kr` : '—'}</td>
                        <td className="py-2 text-right text-gray-500">{inf.signups_per_video}</td>
                        <td className="py-2 text-right">
                          <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-300">
                            {inf.vs_avg_signups}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
          {comparison.avg && (
            <div className="mt-3 flex gap-4 text-[10px] text-gray-500">
              <span>Snitt signups: {comparison.avg.signups}</span>
              <span>Snitt CPA: {comparison.avg.cpa} kr</span>
              <span>Snitt videos: {comparison.avg.videos}</span>
            </div>
          )}
        </div>
      )}

      {/* AI-rekommendationer */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            AI ROI-rekommendationer
          </h3>
          <button onClick={loadAiRecs} disabled={aiLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50 transition-colors">
            {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {aiLoading ? 'Analyserar...' : 'Analysera ROI'}
          </button>
        </div>
        {aiRecs ? (
          <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            {aiRecs}
          </div>
        ) : (
          <p className="text-sm text-gray-500 text-center py-6">
            Klicka "Analysera ROI" för att få AI-drivna rekommendationer baserade på din data.
          </p>
        )}
      </div>
    </div>
  )
}
