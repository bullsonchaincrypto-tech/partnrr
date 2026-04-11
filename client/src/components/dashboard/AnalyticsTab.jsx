import { useState, useEffect } from 'react'
import {
  TrendingUp, Users, DollarSign, Target, Award, AlertTriangle,
  Loader2, RefreshCw, Brain, BarChart3, ArrowUp, ArrowDown, Minus,
  Zap, Crown, ChevronDown, ChevronUp
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis
} from 'recharts'
import * as api from '../../services/api'

const COLORS = ['#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899']

export default function AnalyticsTab() {
  const [overview, setOverview] = useState(null)
  const [ranking, setRanking] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [byPlatform, setByPlatform] = useState([])
  const [aiRecs, setAiRecs] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [o, r, t, p] = await Promise.all([
        api.getRoiOverview().catch(() => null),
        api.getRoiRanking().catch(() => null),
        api.getRoiTimeline().catch(() => []),
        api.getRoiByPlatform().catch(() => []),
      ])
      setOverview(o)
      setRanking(r)
      setTimeline(t)
      setByPlatform(p)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const handleAiAnalysis = async () => {
    setAnalyzing(true)
    try {
      const result = await api.getRoiAiRecommendations()
      setAiRecs(result.recommendations)
    } catch (err) { console.error(err) }
    finally { setAnalyzing(false) }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
    </div>
  )

  const hasData = overview && (overview.total_videos > 0 || overview.total_signups > 0)

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-purple-500" />
          ROI & Analys
        </h2>
        <button onClick={loadData} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm">
          <RefreshCw className="w-4 h-4" /> Uppdatera
        </button>
      </div>

      {!hasData ? (
        <div className="text-center py-16 text-gray-500">
          <BarChart3 className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">Ingen kampanjdata ännu</p>
          <p className="text-sm mt-1">Aktivera kontrakt och börja spåra videos/signups för att se ROI-analys här.</p>
        </div>
      ) : (
        <>
          {/* KPI-kort */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Total kostnad" value={`${(overview.total_kostnad || 0).toLocaleString()} SEK`} color="text-purple-400" />
            <KpiCard icon={<Target className="w-4 h-4" />} label="CPA" value={`${overview.cpa || 0} SEK`} color="text-blue-400" subtitle="per signup" />
            <KpiCard icon={<Users className="w-4 h-4" />} label="Totala signups" value={overview.total_signups || 0} color="text-green-400" />
            <KpiCard icon={<BarChart3 className="w-4 h-4" />} label="Videos" value={overview.total_videos || 0} color="text-yellow-400" />
            <KpiCard icon={<Zap className="w-4 h-4" />} label="Signups/video" value={overview.signups_per_video || 0} color="text-cyan-400" />
            <KpiCard icon={<Users className="w-4 h-4" />} label="Influencers" value={overview.total_influencers || 0} color="text-pink-400" />
          </div>

          {/* Kostnadsfördelning */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Kostnad per typ */}
            <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
              <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-purple-400" /> Kostnadsfördelning
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Video-ersättning', value: overview.total_video_kostnad || 0 },
                      { name: 'Signup-provision', value: overview.total_signup_kostnad || 0 },
                    ]}
                    dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}
                    label={({ name, value }) => `${name}: ${value.toLocaleString()} SEK`}
                  >
                    <Cell fill="#a855f7" />
                    <Cell fill="#3b82f6" />
                  </Pie>
                  <Tooltip formatter={(v) => `${v.toLocaleString()} SEK`}
                    contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* ROI per plattform */}
            {byPlatform.length > 0 && (
              <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
                <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-400" /> CPA per plattform
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={byPlatform}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="plattform" stroke="#9ca3af" fontSize={12} />
                    <YAxis stroke="#9ca3af" fontSize={12} unit=" SEK" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                      formatter={(v, name) => {
                        if (name === 'cpa') return [`${v} SEK`, 'CPA'];
                        if (name === 'signups') return [v, 'Signups'];
                        return [v, name];
                      }}
                    />
                    <Bar dataKey="cpa" name="cpa" radius={[4, 4, 0, 0]}>
                      {byPlatform.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-3 flex gap-4 justify-center">
                  {byPlatform.map((p, i) => (
                    <div key={p.plattform} className="text-center">
                      <div className="text-xs text-gray-500">{p.plattform}</div>
                      <div className="text-sm font-medium text-white">{p.signups} signups</div>
                      <div className="text-xs text-gray-400">{p.signups_per_video} per video</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Tidslinje */}
          {timeline.length > 0 && (
            <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
              <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-400" /> Kampanjutveckling över tid
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={timeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="manad" stroke="#9ca3af" fontSize={12} />
                  <YAxis yAxisId="left" stroke="#a855f7" fontSize={12} />
                  <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={12} />
                  <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} />
                  <Area yAxisId="left" type="monotone" dataKey="kostnad" name="Kostnad (SEK)" stroke="#a855f7" fill="#a855f7" fillOpacity={0.15} />
                  <Area yAxisId="right" type="monotone" dataKey="signups" name="Signups" stroke="#10b981" fill="#10b981" fillOpacity={0.15} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Influencer ROI-ranking */}
          {ranking && ranking.ranking?.length > 0 && (
            <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
              <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <Award className="w-4 h-4 text-yellow-400" /> Influencer ROI-ranking
              </h3>
              <div className="text-xs text-gray-500 mb-3">
                Snitt: {ranking.avg_signups} signups/influencer • Snitt-CPA: {ranking.avg_cpa} SEK
              </div>

              <div className="space-y-2">
                {ranking.ranking.map(r => (
                  <InfluencerRoiCard key={r.kontrakt_id} data={r} avgSignups={ranking.avg_signups} />
                ))}
              </div>
            </div>
          )}

          {/* AI-rekommendationer */}
          <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-400" /> AI-rekommendationer
              </h3>
              <button
                onClick={handleAiAnalysis}
                disabled={analyzing}
                className="flex items-center gap-2 text-sm bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg"
              >
                {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                {analyzing ? 'Analyserar...' : 'Generera AI-analys'}
              </button>
            </div>

            {aiRecs ? (
              <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">{aiRecs}</pre>
            ) : (
              <p className="text-gray-500 text-sm">
                Klicka "Generera AI-analys" för att få personliga rekommendationer baserat på din kampanjdata —
                vilka influencers som bör förlängas, var du kan sänka CPA, och budgetförslag.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}


// === Subkomponenter ===

function KpiCard({ icon, label, value, color, subtitle }) {
  return (
    <div className="bg-gray-800/50 rounded-xl p-3.5 border border-gray-700/50">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={color}>{icon}</span>
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {subtitle && <div className="text-xs text-gray-500">{subtitle}</div>}
    </div>
  )
}

function InfluencerRoiCard({ data: r, avgSignups }) {
  const [expanded, setExpanded] = useState(false)

  const performanceColor = r.is_top_performer ? 'border-green-600/40' : r.is_underperformer ? 'border-red-600/40' : 'border-gray-700/50';
  const performanceBg = r.is_top_performer ? 'bg-green-900/10' : r.is_underperformer ? 'bg-red-900/10' : 'bg-gray-800/30';

  return (
    <div className={`${performanceBg} rounded-lg border ${performanceColor} p-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Rank badge */}
          <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
            r.rank === 1 ? 'bg-yellow-500/20 text-yellow-400' :
            r.rank === 2 ? 'bg-gray-400/20 text-gray-300' :
            r.rank === 3 ? 'bg-orange-500/20 text-orange-400' :
            'bg-gray-800 text-gray-500'
          }`}>{r.rank}</span>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-medium">{r.influencer_namn}</span>
              <span className="text-gray-500 text-sm">@{r.kanalnamn}</span>
              {r.is_top_performer && (
                <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                  <Crown className="w-3 h-3" /> Top
                </span>
              )}
              {r.is_underperformer && (
                <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                  <AlertTriangle className="w-3 h-3" /> Låg ROI
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500">{r.plattform} • {r.foljare} följare</div>
          </div>
        </div>

        <div className="flex items-center gap-4 text-right">
          <div>
            <div className="text-white font-bold">{r.total_signups} signups</div>
            <div className="text-xs text-gray-500">{r.signups_per_video} per video</div>
          </div>
          <div>
            <div className={`font-bold ${r.cpa && r.cpa < (avgSignups > 0 ? Math.round(r.total_kostnad / avgSignups) : 999) ? 'text-green-400' : 'text-white'}`}>
              {r.cpa !== null ? `${r.cpa} SEK` : '–'}
            </div>
            <div className="text-xs text-gray-500">CPA</div>
          </div>
          <div>
            <div className="flex items-center gap-1">
              {r.vs_average > 150 ? <ArrowUp className="w-3 h-3 text-green-400" /> :
               r.vs_average < 50 ? <ArrowDown className="w-3 h-3 text-red-400" /> :
               <Minus className="w-3 h-3 text-gray-500" />}
              <span className={`text-sm font-medium ${
                r.vs_average > 150 ? 'text-green-400' :
                r.vs_average < 50 ? 'text-red-400' : 'text-gray-400'
              }`}>{r.vs_average}%</span>
            </div>
            <div className="text-xs text-gray-500">vs snitt</div>
          </div>

          <button onClick={() => setExpanded(!expanded)} className="text-gray-500 hover:text-gray-300">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-700/50 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <div>
            <div className="text-xs text-gray-500">Videos</div>
            <div className="text-white">{r.videos_delivered}/{r.videos_required}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Video-kostnad</div>
            <div className="text-white">{(r.video_kostnad || 0).toLocaleString()} SEK</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Signup-kostnad</div>
            <div className="text-white">{(r.signup_kostnad || 0).toLocaleString()} SEK</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Total kostnad</div>
            <div className="text-purple-400 font-medium">{(r.total_kostnad || 0).toLocaleString()} SEK</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Status</div>
            <div className="text-white capitalize">{r.status}</div>
          </div>
        </div>
      )}
    </div>
  )
}
