import { useState, useEffect } from 'react'
import {
  Mail, Eye, FileText, Clock, X, BarChart3, ChevronDown, Zap, FlaskConical, Megaphone, Wifi, WifiOff
} from 'lucide-react'
import FollowupSequenceTab from './FollowupSequenceTab'
import AbTestingTab from './AbTestingTab'
import KampanjerTab from './KampanjerTab'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area
} from 'recharts'
import * as api from '../../services/api'

const COLORS = ['#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444']
const FUNNEL_COLORS = ['#a855f7', '#8b5cf6', '#6366f1', '#4f46e5']

export default function OutreachTab({ outreach, trackingStats, stats, followUps, onFollowUp, onDismissFollowUp }) {
  const [statusFilter, setStatusFilter] = useState('alla')
  const [platformFilter, setPlatformFilter] = useState('alla')
  const [subTab, setSubTab] = useState('outreach')
  const [emailStatus, setEmailStatus] = useState(null)

  useEffect(() => { checkEmailStatus() }, [])

  async function checkEmailStatus() {
    try {
      const res = await api.getAuthStatus()
      setEmailStatus(res)
    } catch { setEmailStatus({ authenticated: false }) }
  }

  const filteredOutreach = (outreach || []).filter(o => {
    if (statusFilter !== 'alla' && o.status !== statusFilter) return false
    if (platformFilter !== 'alla' && o.plattform !== platformFilter) return false
    return true
  })

  const pieData = stats?.perPlatform?.map(p => ({ name: p.plattform, value: p.count })) || []
  const barData = stats?.perMonth?.map(m => ({ name: m.manad, count: m.count })).reverse() || []
  const weekData = stats?.perWeek?.map(w => ({ name: w.vecka, count: w.count })).reverse() || []
  const funnelData = stats?.funnel || []
  const platformRates = stats?.platformResponseRates || []

  return (
    <div className="space-y-4">
      {/* E-poststatus */}
      {emailStatus && (
        <div className={`rounded-lg border px-4 py-3 flex items-center justify-between ${
          emailStatus.authenticated
            ? 'border-green-700/50 bg-green-900/10'
            : 'border-amber-700/50 bg-amber-900/10'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              emailStatus.authenticated ? 'bg-green-500/10' : 'bg-amber-500/10'
            }`}>
              <Mail className={`w-4 h-4 ${emailStatus.authenticated ? 'text-green-400' : 'text-amber-400'}`} />
            </div>
            {emailStatus.authenticated ? (
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-green-300">E-post anslutet</span>
                  {emailStatus.provider && <span className="text-[10px] text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded-full capitalize">{emailStatus.provider}</span>}
                  <span className="flex items-center gap-1 text-[10px] text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded-full">
                    <Wifi className="w-2.5 h-2.5" /> Aktiv
                  </span>
                </div>
                <span className="text-xs text-gray-400">{emailStatus.email}</span>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-amber-300">E-post ej anslutet</span>
                  <span className="flex items-center gap-1 text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                    <WifiOff className="w-2.5 h-2.5" /> Offline
                  </span>
                </div>
                <span className="text-xs text-gray-500">Anslut för att skicka utskick</span>
              </div>
            )}
          </div>
          {emailStatus.authenticated && (
            <button onClick={async () => { await api.disconnectAuth(); checkEmailStatus() }}
              className="text-xs text-gray-500 hover:text-red-400 px-2 py-1 rounded transition-colors">
              Koppla från
            </button>
          )}
        </div>
      )}

      {/* Sub-navigation */}
      <div className="flex gap-1 bg-gray-800/50 rounded-lg p-1">
        <button onClick={() => setSubTab('outreach')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            subTab === 'outreach' ? 'bg-purple-600/80 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}>
          <Mail className="w-3.5 h-3.5" /> Utskickstabell
        </button>
        <button onClick={() => setSubTab('tracking')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            subTab === 'tracking' ? 'bg-purple-600/80 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}>
          <Eye className="w-3.5 h-3.5" /> E-postspårning
        </button>
        <button onClick={() => setSubTab('followup')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            subTab === 'followup' ? 'bg-purple-600/80 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}>
          <Zap className="w-3.5 h-3.5" /> Auto-uppföljning
        </button>
        <button onClick={() => setSubTab('statistik')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            subTab === 'statistik' ? 'bg-purple-600/80 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}>
          <BarChart3 className="w-3.5 h-3.5" /> Statistik
        </button>
        <button onClick={() => setSubTab('kampanjer')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            subTab === 'kampanjer' ? 'bg-purple-600/80 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}>
          <Megaphone className="w-3.5 h-3.5" /> Kampanjer
        </button>
        <button onClick={() => setSubTab('ab-test')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            subTab === 'ab-test' ? 'bg-purple-600/80 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}>
          <FlaskConical className="w-3.5 h-3.5" /> A/B-test
        </button>
      </div>

      {/* ============ UTSKICKSTABELL ============ */}
      {subTab === 'outreach' && (
        <div className="space-y-6">
          {/* Uppföljningar */}
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
                        title="Avfärda">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabell */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-300">Alla utskick</h3>
              <div className="flex gap-2">
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                  className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300">
                  <option value="alla">Alla statusar</option>
                  <option value="skickat">Skickat</option>
                  <option value="svarat">Svarat</option>
                  <option value="avtal_signerat">Avtal signerat</option>
                  <option value="avbojt">Avböjt</option>
                  <option value="misslyckat">Misslyckat</option>
                </select>
                <select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)}
                  className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300">
                  <option value="alla">Alla plattformar</option>
                  <option value="YouTube">YouTube</option>
                  <option value="Instagram">Instagram</option>
                  <option value="TikTok">TikTok</option>
                  <option value="Företag">Sponsor</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-800">
                    <th className="pb-2 pr-4">Mottagare</th>
                    <th className="pb-2 pr-4">Typ</th>
                    <th className="pb-2 pr-4">Plattform</th>
                    <th className="pb-2 pr-4">Företag</th>
                    <th className="pb-2 pr-4">Datum</th>
                    <th className="pb-2 pr-4">Kontrakt</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOutreach.map(o => (
                    <tr key={o.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="py-2 pr-4 font-medium text-white">{o.influencer_namn || o.prospect_namn || 'Okänd'}</td>
                      <td className="py-2 pr-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          (o.outreach_typ || o.typ) === 'sponsor' ? 'bg-blue-900/50 text-blue-300' : 'bg-purple-900/50 text-purple-300'
                        }`}>{(o.outreach_typ || o.typ) === 'sponsor' ? 'Sponsor' : 'Influencer'}</span>
                      </td>
                      <td className="py-2 pr-4 text-gray-300">{o.plattform || '-'}</td>
                      <td className="py-2 pr-4 text-gray-300">{o.foretag_namn}</td>
                      <td className="py-2 pr-4 text-gray-400">{o.skickat_datum?.split('T')[0] || '-'}</td>
                      <td className="py-2 pr-4">
                        {o.kontrakt_bifogat ? (
                          <a href={api.exportPdfUrl(o.id)} download className="text-green-400 hover:text-green-300">
                            <FileText className="w-4 h-4" />
                          </a>
                        ) : '-'}
                      </td>
                      <td className="py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          o.status === 'skickat' ? 'bg-blue-900/50 text-blue-300' :
                          o.status === 'svarat' ? 'bg-green-900/50 text-green-300' :
                          o.status === 'avtal_signerat' ? 'bg-emerald-900/50 text-emerald-300' :
                          o.status === 'avbojt' ? 'bg-red-900/50 text-red-300' :
                          'bg-gray-800 text-gray-400'
                        }`}>{o.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredOutreach.length === 0 && (
                <div className="text-center py-12">
                  <Mail className="w-10 h-10 text-gray-700 mx-auto mb-3" />
                  <p className="text-gray-400 font-medium mb-1">Inga utskick ännu</p>
                  <p className="text-gray-600 text-sm">Gå till Outreach-wizarden och skicka dina första meddelanden — resultaten visas här.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============ E-POSTSPÅRNING ============ */}
      {subTab === 'tracking' && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 text-center">
              <div className="text-3xl font-bold text-cyan-400">{trackingStats?.totalTracked || 0}</div>
              <div className="text-sm text-gray-400">Spårade e-post</div>
            </div>
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 text-center">
              <div className="text-3xl font-bold text-green-400">{trackingStats?.totalOpened || 0}</div>
              <div className="text-sm text-gray-400">Öppnade</div>
            </div>
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 text-center">
              <div className="text-3xl font-bold text-yellow-400">{trackingStats?.openRate || 0}%</div>
              <div className="text-sm text-gray-400">Öppningsfrekvens</div>
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-4">Senaste öppnade e-post</h3>
            {trackingStats?.recentOpens?.length > 0 ? (
              <div className="space-y-2">
                {trackingStats.recentOpens.map((o, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-gray-800/30 rounded-lg border border-gray-700">
                    <Eye className="w-4 h-4 text-green-400" />
                    <div className="flex-1">
                      <span className="text-white">{o.mottagare_namn || 'Okänd'}</span>
                      <span className="text-xs text-gray-400 ml-2">{o.typ}</span>
                    </div>
                    <span className="text-xs text-gray-400">{o.oppnad_datum}</span>
                    <span className="text-xs text-cyan-400">{o.oppnad_count}x</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-4">Inga öppnade e-post ännu.</p>
            )}
          </div>
        </div>
      )}

      {/* ============ STATISTIK ============ */}
      {subTab === 'statistik' && (
        <div className="space-y-6">
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
                            style={{ width: `${width}%`, backgroundColor: FUNNEL_COLORS[i], minWidth: '48px' }}
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

          {/* Grafer */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {weekData.length > 0 && (
              <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-4">Utskicksvolym per vecka</h3>
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

          {(weekData.length === 0 && barData.length === 0 && pieData.length === 0 && funnelData.length === 0) && (
            <div className="text-center py-12 text-gray-500">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Ingen utskicksdata ännu.</p>
            </div>
          )}
        </div>
      )}

      {/* ============ AUTO-UPPFÖLJNING ============ */}
      {subTab === 'followup' && (
        <FollowupSequenceTab />
      )}

      {subTab === 'kampanjer' && (
        <KampanjerTab />
      )}

      {subTab === 'ab-test' && (
        <AbTestingTab />
      )}
    </div>
  )
}
