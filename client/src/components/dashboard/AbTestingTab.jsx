import { useState, useEffect } from 'react'
import {
  FlaskConical, Trophy, Plus, Loader2, CheckCircle, Trash2,
  ArrowUpRight, ArrowDownRight, BarChart3, Users, Mail
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import * as api from '../../services/api'

function RateBadge({ rate, label }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold text-white">{rate}%</p>
      <p className="text-[10px] text-gray-500">{label}</p>
    </div>
  )
}

export default function AbTestingTab() {
  const [tests, setTests] = useState([])
  const [insights, setInsights] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [foretag, setForetag] = useState([])
  const [selectedForetag, setSelectedForetag] = useState('')

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [t, ins] = await Promise.all([
        api.getAbTests(),
        api.getAbTestInsights().catch(() => null),
      ])
      setTests(t)
      setInsights(ins)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const loadForetag = async () => {
    try {
      const data = await api.getForetag()
      setForetag(data)
    } catch (err) { console.error(err) }
  }

  const handleCreate = async () => {
    if (!selectedForetag || !newName) return
    try {
      await api.createAbTest({ foretag_id: Number(selectedForetag), name: newName })
      setNewName('')
      setShowCreate(false)
      loadData()
    } catch (err) { alert('Kunde inte skapa test') }
  }

  const handleComplete = async (id) => {
    try {
      await api.completeAbTest(id)
      loadData()
    } catch (err) { alert('Kunde inte avsluta test') }
  }

  const handleDelete = async (id) => {
    if (!confirm('Ta bort detta A/B-test?')) return
    try {
      await api.deleteAbTest(id)
      loadData()
    } catch (err) { alert('Kunde inte ta bort') }
  }

  const openCreate = () => {
    if (foretag.length === 0) loadForetag()
    setShowCreate(true)
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Insights summary */}
      {insights && insights.total_tests > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            { label: 'Genomförda tester', value: insights.total_tests, color: 'text-white' },
            { label: 'Variant A vinner', value: insights.a_wins, color: 'text-blue-400' },
            { label: 'Variant B vinner', value: insights.b_wins, color: 'text-green-400' },
            { label: 'Snitt svar A', value: `${insights.avg_response_rate_a}%`, color: 'text-blue-400' },
            { label: 'Snitt svar B', value: `${insights.avg_response_rate_b}%`, color: 'text-green-400' },
          ].map((s, i) => (
            <div key={i} className="bg-gray-900 rounded-lg border border-gray-800 px-3 py-2 text-center">
              <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-purple-400" />
          A/B-tester
          {insights?.active_tests > 0 && (
            <span className="text-[10px] bg-yellow-500/20 text-yellow-300 px-1.5 py-0.5 rounded">
              {insights.active_tests} aktiva
            </span>
          )}
        </h3>
        <button onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors">
          <Plus className="w-3 h-3" />
          Nytt A/B-test
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-gray-900 rounded-xl border border-purple-500/30 p-4 space-y-3">
          <h4 className="text-sm font-medium text-white">Skapa nytt A/B-test</h4>
          <p className="text-xs text-gray-400">
            Skapa ett test, generera outreach i wizarden och välj variant A eller B.
            Systemet trackar svarsfrekvens per variant.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select value={selectedForetag} onChange={e => setSelectedForetag(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">Välj företag...</option>
              {foretag.map(f => <option key={f.id} value={f.id}>{f.namn}</option>)}
            </select>
            <input type="text" placeholder="Testnamn (t.ex. 'Kort vs långt ämnesrad')" value={newName}
              onChange={e => setNewName(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={!selectedForetag || !newName}
              className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50">
              Skapa
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Avbryt</button>
          </div>
        </div>
      )}

      {/* Tests list */}
      {tests.length === 0 ? (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center">
          <FlaskConical className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Inga A/B-tester ännu</p>
          <p className="text-xs text-gray-600 mt-1">
            Skapa ett test och generera outreach med olika varianter för att jämföra svarsfrekvens.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tests.map(test => {
            const isExpanded = expandedId === test.id
            const chartData = [
              { name: 'Variant A', skickade: test.sent_a, svar: test.replied_a, rate: test.rate_a, kontrakt: test.contract_a },
              { name: 'Variant B', skickade: test.sent_b, svar: test.replied_b, rate: test.rate_b, kontrakt: test.contract_b },
            ]

            return (
              <div key={test.id} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <button onClick={() => setExpandedId(isExpanded ? null : test.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-800/50 transition-colors">
                  <FlaskConical className={`w-4 h-4 shrink-0 ${test.status === 'active' ? 'text-yellow-400' : 'text-gray-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate">{test.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        test.status === 'active' ? 'bg-yellow-500/20 text-yellow-300' : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {test.status === 'active' ? 'Pågår' : 'Avslutad'}
                      </span>
                      {test.winner && test.winner !== 'draw' && (
                        <span className="text-[10px] bg-green-500/20 text-green-300 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                          <Trophy className="w-3 h-3" /> Variant {test.winner}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-500">{test.foretag_namn}</span>
                  </div>

                  {/* Quick stats */}
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-center">
                      <p className="text-xs font-bold text-blue-400">{test.rate_a}%</p>
                      <p className="text-[10px] text-gray-600">A</p>
                    </div>
                    <span className="text-gray-600 text-xs">vs</span>
                    <div className="text-center">
                      <p className="text-xs font-bold text-green-400">{test.rate_b}%</p>
                      <p className="text-[10px] text-gray-600">B</p>
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-800 pt-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Chart */}
                      <div>
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="name" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                            <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                            <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 8 }} />
                            <Bar dataKey="skickade" name="Skickade" radius={[4, 4, 0, 0]}>
                              <Cell fill="#3B82F6" />
                              <Cell fill="#10B981" />
                            </Bar>
                            <Bar dataKey="svar" name="Svar" radius={[4, 4, 0, 0]}>
                              <Cell fill="#93C5FD" />
                              <Cell fill="#6EE7B7" />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Detailed comparison */}
                      <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                          <div />
                          <div className="text-center text-[10px] font-bold text-blue-400">Variant A</div>
                          <div className="text-center text-[10px] font-bold text-green-400">Variant B</div>
                        </div>
                        {[
                          { label: 'Skickade', a: test.sent_a, b: test.sent_b },
                          { label: 'Svar', a: test.replied_a, b: test.replied_b },
                          { label: 'Svarsfrekvens', a: `${test.rate_a}%`, b: `${test.rate_b}%` },
                          { label: 'Kontrakt', a: test.contract_a, b: test.contract_b },
                        ].map((row, i) => (
                          <div key={i} className="grid grid-cols-3 gap-2 py-1 border-b border-gray-800/50">
                            <span className="text-[10px] text-gray-500">{row.label}</span>
                            <span className={`text-xs text-center ${
                              test.leading === 'A' && i === 2 ? 'text-blue-300 font-bold' : 'text-gray-300'
                            }`}>{row.a}</span>
                            <span className={`text-xs text-center ${
                              test.leading === 'B' && i === 2 ? 'text-green-300 font-bold' : 'text-gray-300'
                            }`}>{row.b}</span>
                          </div>
                        ))}

                        {/* Actions */}
                        <div className="flex gap-2 pt-2">
                          {test.status === 'active' && (
                            <button onClick={() => handleComplete(test.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg">
                              <CheckCircle className="w-3 h-3" />
                              Avsluta test
                            </button>
                          )}
                          <button onClick={() => handleDelete(test.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg">
                            <Trash2 className="w-3 h-3" />
                            Ta bort
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* How to use guide */}
      <div className="bg-gray-800/30 rounded-xl border border-gray-800 p-4">
        <h4 className="text-xs font-semibold text-gray-400 mb-2">Så fungerar A/B-testning</h4>
        <ol className="text-xs text-gray-500 space-y-1 list-decimal list-inside">
          <li>Skapa ett test ovan och ge det ett namn (t.ex. "Kort vs formellt ämnesrad")</li>
          <li>I outreach-wizarden, generera meddelanden — välj A/B-test och variant (A eller B)</li>
          <li>Skicka variant A till hälften av influencers och variant B till resten</li>
          <li>Följ svarsfrekvensen här — avsluta testet när du har tillräckligt med data</li>
        </ol>
      </div>
    </div>
  )
}
