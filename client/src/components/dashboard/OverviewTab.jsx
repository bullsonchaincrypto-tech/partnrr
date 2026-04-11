import { useState } from 'react'
import {
  Clock, X, Loader2, Brain, BarChart3, ChevronDown
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area
} from 'recharts'
import * as api from '../../services/api'

const COLORS = ['#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899']
const FUNNEL_COLORS = ['#a855f7', '#8b5cf6', '#6366f1', '#4f46e5']

export default function OverviewTab({ stats, followUps, onFollowUp, onDismissFollowUp }) {
  const [aiRecs, setAiRecs] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisType, setAnalysisType] = useState('basic')
  const [activeSection, setActiveSection] = useState('kpi')

  const handleAnalyze = async () => {
    setAnalyzing(true)
    try {
      if (analysisType === 'roi') {
        const result = await api.getRoiAiRecommendations()
        setAiRecs(result.recommendations)
      } else {
        const result = analysisType === 'deep'
          ? await api.deepAnalyze()
          : await api.analyzeConversion()
        setAnalysis(result.analysis)
      }
    } catch (err) { console.error(err) }
    finally { setAnalyzing(false) }
  }

  const pieData = stats?.perPlatform?.map(p => ({ name: p.plattform, value: p.count })) || []
  const barData = stats?.perMonth?.map(m => ({ name: m.manad, count: m.count })).reverse() || []
  const weekData = stats?.perWeek?.map(w => ({ name: w.vecka, count: w.count })).reverse() || []
  const funnelData = stats?.funnel || []
  const platformRates = stats?.platformResponseRates || []

  const SECTIONS = [
    { key: 'kpi', label: 'KPI & Tratt' },
    { key: 'charts', label: 'Grafer & Statistik' },
    { key: 'ai', label: 'AI-analys' },
  ]

  return (
    <div className="space-y-6">

      {/* Sub-navigation */}
      <div className="flex gap-1 bg-gray-800/50 rounded-lg p-1">
        {SECTIONS.map(s => (
          <button key={s.key} onClick={() => setActiveSection(s.key)}
            className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeSection === s.key ? 'bg-purple-600/80 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}>{s.label}</button>
        ))}
      </div>

      {/* ============ KPI & TRATT ============ */}
      {activeSection === 'kpi' && (
        <div className="space-y-6">
          {/* Follow-ups */}
          {followUps?.length > 0 && (
            <div className="bg-gray-900 rounded-lg border border-yellow-700/50 p-4">
              <h3 className="text-sm font-medium text-yellow-300 flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4" /> Uppföljning krävs ({followUps.length})
              </h3>
              <div className="space-y-2">
                {followUps.map(f => (
                  <div key={f.id} className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                    <div>
                      <span className="text-white font-medium">{f.influencer_namn}</span>
                      <span className="text-xs text-gray-400 ml-2">{f.plattform} · Skickat {f.skickat_datum?.split('T')[0]}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => onFollowUp(f.id)} className="text-sm text-purple-400 hover:text-purple-300">
                        Generera uppföljning
                      </button>
                      <button onClick={() => onDismissFollowUp(f.id)}
                        className="text-gray-500 hover:text-red-400 transition-colors p-1 rounded hover:bg-red-500/10"
                        title="Avfärda uppföljning">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Konverteringstratt */}
          {funnelData.length > 0 && (
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-5">
              <h3 className="text-sm font-medium text-gray-300 mb-6">Konverteringstratt</h3>
              <div className="space-y-3">
                {funnelData.map((step, i) => {
                  const maxVal = funnelData[0]?.antal || 1
                  const width = Math.max((step.antal / maxVal) * 100, 6)
                  const prevAntal = i > 0 ? funnelData[i - 1].antal : null
                  const pct = prevAntal && prevAntal > 0 ? ((step.antal / prevAntal) * 100).toFixed(0) : null
                  return (
                    <div key={i}>
                      {i > 0 && pct !== null && (
                        <div className="flex items-center gap-2 ml-4 my-1">
                          <ChevronDown className="w-3 h-3 text-gray-600" />
                          <span className="text-xs text-gray-500">{pct}% konvertering</span>
                        </div>
                      )}
                      <div className="flex items-center gap-4">
                        <div className="w-24 text-right">
                          <span className="text-sm text-gray-400">{step.steg}</span>
                        </div>
                        <div className="flex-1 relative">
                          <div
                            className="h-10 rounded-lg flex items-center justify-end pr-3 transition-all"
                            style={{
                              width: `${width}%`,
                              backgroundColor: FUNNEL_COLORS[i],
                              minWidth: '48px',
                            }}
                          >
                            <span className="text-sm font-bold text-white">{step.antal}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ============ GRAFER & STATISTIK ============ */}
      {activeSection === 'charts' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Weekly volume */}
            {weekData.length > 0 && (
              <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-4">Outreach-volym per vecka</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={weekData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="name" stroke="#9ca3af" fontSize={10} />
                    <YAxis stroke="#9ca3af" fontSize={12} />
                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} />
                    <Area type="monotone" dataKey="count" stroke="#a855f7" fill="#a855f7" fillOpacity={0.2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Platform response rates */}
            {platformRates.length > 0 && (
              <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-4">Svarsfrekvens per plattform</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={platformRates}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="plattform" stroke="#9ca3af" fontSize={12} />
                    <YAxis stroke="#9ca3af" fontSize={12} unit="%" />
                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                      formatter={(v) => [`${v}%`, 'Svarsfrekvens']} />
                    <Bar dataKey="svarsfrekvens" radius={[4, 4, 0, 0]}>
                      {platformRates.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Monthly volume */}
            {barData.length > 0 && (
              <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-4">Utskick per månad</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="name" stroke="#9ca3af" fontSize={12} />
                    <YAxis stroke="#9ca3af" fontSize={12} />
                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} />
                    <Bar dataKey="count" fill="#a855f7" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Platform distribution pie */}
            {pieData.length > 0 && (
              <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-4">Fördelning per plattform</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {(weekData.length === 0 && barData.length === 0 && pieData.length === 0) && (
            <div className="text-center py-12 text-gray-500">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Ingen outreach-data ännu. Skicka outreach för att se statistik här.</p>
            </div>
          )}
        </div>
      )}

      {/* ============ AI-ANALYS ============ */}
      {activeSection === 'ai' && (
        <div className="space-y-6">
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-400" /> AI-analys & Rekommendationer
              </h3>
              <div className="flex items-center gap-2">
                <select value={analysisType} onChange={e => setAnalysisType(e.target.value)}
                  className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300">
                  <option value="basic">Snabbanalys (Outreach)</option>
                  <option value="deep">Djupanalys (CTA, plattform)</option>
                  <option value="roi">ROI-rekommendationer</option>
                </select>
                <button onClick={handleAnalyze} disabled={analyzing}
                  className="flex items-center gap-2 text-sm bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg">
                  {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                  Analysera
                </button>
              </div>
            </div>

            {(analysis || aiRecs) ? (
              <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                {analysis || aiRecs}
              </pre>
            ) : (
              <p className="text-gray-500 text-sm">
                Välj analystyp och klicka "Analysera" för att få AI-drivna insikter om din kampanjprestanda,
                CTA-kvalitet, plattformsfördelning och rekommendationer för att förbättra ROI.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


// === Subkomponenter ===

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

