import { useState, useEffect } from 'react'
import {
  TrendingUp, Users, DollarSign, Target, Award, AlertTriangle,
  Loader2, RefreshCw, BarChart3, Zap, ArrowUp, ArrowDown, Minus,
  Crown, ChevronDown, ChevronUp, Edit3
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area
} from 'recharts'
import * as api from '../../services/api'

const COLORS = ['#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899']

export default function UtbetalningarTab() {
  const [overview, setOverview] = useState(null)
  const [ranking, setRanking] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [byPlatform, setByPlatform] = useState([])
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
          <DollarSign className="w-6 h-6 text-purple-500" />
          Utbetalningar till influencers
        </h2>
        <button onClick={loadData} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm">
          <RefreshCw className="w-4 h-4" /> Uppdatera
        </button>
      </div>

      {!hasData ? (
        <div className="text-center py-12 text-gray-500">
          <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">Ingen utbetalningsdata ännu</p>
          <p className="text-sm mt-1">Aktivera kontrakt och börja spåra videos/signups för att se utbetalningar här.</p>
        </div>
      ) : (
        <>
          {/* KPI-kort */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Totalt utbetalt" value={`${(overview.total_kostnad || 0).toLocaleString()} SEK`} color="text-purple-400" />
            <KpiCard icon={<Target className="w-4 h-4" />} label="Kostnad/signup" value={`${overview.cpa || 0} SEK`} color="text-blue-400" subtitle="per signup" />
            <KpiCard icon={<Users className="w-4 h-4" />} label="Totala signups" value={overview.total_signups || 0} color="text-green-400" />
            <KpiCard icon={<BarChart3 className="w-4 h-4" />} label="Videos" value={overview.total_videos || 0} color="text-yellow-400" />
            <KpiCard icon={<Zap className="w-4 h-4" />} label="Signups/video" value={overview.signups_per_video || 0} color="text-cyan-400" />
            <KpiCard icon={<Users className="w-4 h-4" />} label="Influencers" value={overview.total_influencers || 0} color="text-pink-400" />
          </div>

          {/* Kostnadsfördelning + per plattform */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-purple-400" /> Utbetalningsfördelning
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

            {byPlatform.length > 0 && (
              <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-400" /> Kostnad/signup per plattform
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={byPlatform}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="plattform" stroke="#9ca3af" fontSize={12} />
                    <YAxis stroke="#9ca3af" fontSize={12} unit=" SEK" />
                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                      formatter={(v, name) => name === 'cpa' ? [`${v} SEK`, 'Kostnad/signup'] : [v, name]} />
                    <Bar dataKey="cpa" name="cpa" radius={[4, 4, 0, 0]}>
                      {byPlatform.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-3 flex gap-4 justify-center">
                  {byPlatform.map(p => (
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
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-400" /> Utbetalningar över tid
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

          {/* Influencer-ranking */}
          {ranking?.ranking?.length > 0 && (
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                <Award className="w-4 h-4 text-yellow-400" /> Influencer-ranking (kostnad & signups)
              </h3>
              <div className="text-xs text-gray-500 mb-3">
                Snitt: {ranking.avg_signups} signups/influencer • Snitt kostnad/signup: {ranking.avg_cpa} SEK
              </div>
              <div className="space-y-2">
                {ranking.ranking.map(r => (
                  <InfluencerCard key={r.kontrakt_id} data={r} onUpdate={loadData} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function KpiCard({ icon, label, value, color, subtitle }) {
  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-3.5">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={color}>{icon}</span>
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {subtitle && <div className="text-xs text-gray-500">{subtitle}</div>}
    </div>
  )
}

function InfluencerCard({ data: r, onUpdate }) {
  const [expanded, setExpanded] = useState(false)
  const [editingSignups, setEditingSignups] = useState(false)
  const [signupVal, setSignupVal] = useState(r.total_signups || 0)

  const saveSignups = async () => {
    try {
      await api.updateContractEconomics(r.kontrakt_id, {
        total_signups: signupVal,
        videos_delivered: r.videos_delivered,
        total_payout_sek: r.total_kostnad || 0,
      })
      setEditingSignups(false)
      if (onUpdate) onUpdate()
    } catch (err) { console.error(err) }
  }
  const performanceColor = r.is_top_performer ? 'border-green-600/40' : r.is_underperformer ? 'border-red-600/40' : 'border-gray-700/50'
  const performanceBg = r.is_top_performer ? 'bg-green-900/10' : r.is_underperformer ? 'bg-red-900/10' : 'bg-gray-800/30'

  return (
    <div className={`${performanceBg} rounded-lg border ${performanceColor} p-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
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
                  <AlertTriangle className="w-3 h-3" /> Låg
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
            <div className="font-bold text-white">{r.cpa !== null ? `${r.cpa} SEK` : '–'}</div>
            <div className="text-xs text-gray-500">kostnad/signup</div>
          </div>
          <div>
            <div className="flex items-center gap-1">
              {r.vs_average > 150 ? <ArrowUp className="w-3 h-3 text-green-400" /> :
               r.vs_average < 50 ? <ArrowDown className="w-3 h-3 text-red-400" /> :
               <Minus className="w-3 h-3 text-gray-500" />}
              <span className={`text-sm font-medium ${
                r.vs_average > 150 ? 'text-green-400' : r.vs_average < 50 ? 'text-red-400' : 'text-gray-400'
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
        <div className="mt-3 pt-3 border-t border-gray-700/50">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <div><div className="text-xs text-gray-500">Videos</div><div className="text-white">{r.videos_delivered}/{r.videos_required}</div></div>
            <div><div className="text-xs text-gray-500">Video-kostnad</div><div className="text-white">{(r.video_kostnad || 0).toLocaleString()} SEK</div></div>
            <div><div className="text-xs text-gray-500">Signup-kostnad</div><div className="text-white">{(r.signup_kostnad || 0).toLocaleString()} SEK</div></div>
            <div><div className="text-xs text-gray-500">Total kostnad</div><div className="text-purple-400 font-medium">{(r.total_kostnad || 0).toLocaleString()} SEK</div></div>
            <div><div className="text-xs text-gray-500">Status</div><div className="text-white capitalize">{r.status}</div></div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {editingSignups ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Signups:</span>
                <input type="number" value={signupVal} onChange={e => setSignupVal(Number(e.target.value))}
                  className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white" />
                <button onClick={saveSignups} className="text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded">Spara</button>
                <button onClick={() => setEditingSignups(false)} className="text-xs text-gray-500 hover:text-white">Avbryt</button>
              </div>
            ) : (
              <button onClick={() => { setSignupVal(r.total_signups || 0); setEditingSignups(true) }}
                className="text-xs text-gray-400 hover:text-white px-2 py-1 border border-gray-700 rounded flex items-center gap-1">
                <Edit3 className="w-3 h-3" /> Uppdatera signups
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
