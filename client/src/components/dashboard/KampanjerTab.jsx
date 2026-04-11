import { useState, useEffect } from 'react'
import {
  Megaphone, Plus, Loader2, Send, Users, CheckCircle, Clock,
  ChevronDown, ChevronUp, Trash2, Play, BarChart3, Mail,
  UserPlus, Zap, AlertTriangle
} from 'lucide-react'
import * as api from '../../services/api'

const STATUS_LABELS = {
  draft: { label: 'Utkast', color: 'bg-gray-500/20 text-gray-300' },
  active: { label: 'Aktiv', color: 'bg-green-500/20 text-green-300' },
  completed: { label: 'Avslutad', color: 'bg-blue-500/20 text-blue-300' },
  paused: { label: 'Pausad', color: 'bg-yellow-500/20 text-yellow-300' },
}

export default function KampanjerTab() {
  const [kampanjer, setKampanjer] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [foretag, setForetag] = useState([])
  const [newForm, setNewForm] = useState({ foretag_id: '', namn: '', beskrivning: '', nisch: '', budget_sek: '' })

  // Expanded kampanj state
  const [kampanjDetail, setKampanjDetail] = useState(null)
  const [availableInf, setAvailableInf] = useState([])
  const [selectedInf, setSelectedInf] = useState([])
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const data = await api.getKampanjer()
      setKampanjer(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const loadForetag = async () => {
    try { setForetag(await api.getForetag()) } catch (err) { console.error(err) }
  }

  const loadKampanjDetail = async (id) => {
    setLoadingDetail(true)
    try {
      const [detail, avail] = await Promise.all([
        api.getKampanj(id),
        api.getAvailableInfluencers(id),
      ])
      setKampanjDetail(detail)
      setAvailableInf(avail)
      setSelectedInf([])
    } catch (err) { console.error(err) }
    finally { setLoadingDetail(false) }
  }

  const handleCreate = async () => {
    if (!newForm.foretag_id || !newForm.namn) return
    try {
      await api.createKampanj({ ...newForm, foretag_id: Number(newForm.foretag_id), budget_sek: newForm.budget_sek ? Number(newForm.budget_sek) : null })
      setNewForm({ foretag_id: '', namn: '', beskrivning: '', nisch: '', budget_sek: '' })
      setShowCreate(false)
      loadData()
    } catch (err) { alert('Kunde inte skapa kampanj') }
  }

  const handleExpand = async (id) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    await loadKampanjDetail(id)
  }

  const handleBulkGenerate = async () => {
    if (selectedInf.length === 0 || !kampanjDetail) return
    setGenerating(true)
    try {
      const result = await api.bulkGenerateOutreach(kampanjDetail.id, selectedInf)
      alert(`${result.generated} meddelanden genererade${result.errors > 0 ? `, ${result.errors} fel` : ''}`)
      await loadKampanjDetail(kampanjDetail.id)
      loadData()
    } catch (err) { alert('Fel vid generering: ' + err.message) }
    finally { setGenerating(false) }
  }

  const handleBulkSend = async () => {
    if (!kampanjDetail) return
    if (!confirm(`Skicka alla ${kampanjDetail.live_drafts} utkast i denna kampanj?`)) return
    setSending(true)
    try {
      const result = await api.bulkSendOutreach(kampanjDetail.id)
      alert(`${result.sent} meddelanden skickade${result.errors > 0 ? `, ${result.errors} fel` : ''}`)
      await loadKampanjDetail(kampanjDetail.id)
      loadData()
    } catch (err) { alert('Fel vid skickning: ' + err.message) }
    finally { setSending(false) }
  }

  const handleDelete = async (id) => {
    if (!confirm('Ta bort denna kampanj?')) return
    try { await api.deleteKampanj(id); loadData(); setExpandedId(null) }
    catch (err) { alert('Kunde inte ta bort') }
  }

  const toggleSelectAll = () => {
    if (selectedInf.length === availableInf.length) setSelectedInf([])
    else setSelectedInf(availableInf.map(i => i.id))
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-purple-400" />
          Kampanjer
          <span className="text-[10px] text-gray-500">{kampanjer.length} totalt</span>
        </h3>
        <button onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors">
          <Plus className="w-3 h-3" /> Ny kampanj
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-gray-900 rounded-xl border border-purple-500/30 p-4 space-y-3">
          <h4 className="text-sm font-medium text-white">Ny kampanj</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select value={newForm.foretag_id} onChange={e => setNewForm(p => ({ ...p, foretag_id: e.target.value }))}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" required>
              <option value="">Välj företag...</option>
              {foretag.map(f => <option key={f.id} value={f.id}>{f.namn}</option>)}
            </select>
            <input type="text" placeholder="Kampanjnamn" value={newForm.namn}
              onChange={e => setNewForm(p => ({ ...p, namn: e.target.value }))}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" required />
            <input type="text" placeholder="Nisch (valfritt)" value={newForm.nisch}
              onChange={e => setNewForm(p => ({ ...p, nisch: e.target.value }))}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            <input type="number" placeholder="Budget (SEK)" value={newForm.budget_sek}
              onChange={e => setNewForm(p => ({ ...p, budget_sek: e.target.value }))}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <textarea placeholder="Beskrivning (valfritt)" value={newForm.beskrivning}
            onChange={e => setNewForm(p => ({ ...p, beskrivning: e.target.value }))}
            rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white resize-none" />
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={!newForm.foretag_id || !newForm.namn}
              className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50">Skapa</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Avbryt</button>
          </div>
        </div>
      )}

      {/* Kampanj lista */}
      {kampanjer.length === 0 ? (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center">
          <Megaphone className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Inga kampanjer ännu</p>
          <p className="text-xs text-gray-600 mt-1">Skapa en kampanj för att organisera bulk-outreach till många influencers.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {kampanjer.map(k => {
            const isExpanded = expandedId === k.id
            const stCfg = STATUS_LABELS[k.status] || STATUS_LABELS.draft

            return (
              <div key={k.id} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                {/* Header */}
                <button onClick={() => handleExpand(k.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-800/50 transition-colors">
                  <Megaphone className={`w-4 h-4 shrink-0 ${k.status === 'active' ? 'text-green-400' : 'text-gray-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate">{k.namn}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${stCfg.color}`}>{stCfg.label}</span>
                    </div>
                    <span className="text-[10px] text-gray-500">{k.foretag_namn}{k.nisch ? ` · ${k.nisch}` : ''}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-[10px] text-gray-500">
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {k.live_total}</span>
                    <span className="flex items-center gap-1"><Send className="w-3 h-3" /> {k.live_sent}</span>
                    <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {k.live_replied}</span>
                    {k.live_response_rate > 0 && (
                      <span className="text-green-400 font-medium">{k.live_response_rate}%</span>
                    )}
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-600" /> : <ChevronDown className="w-4 h-4 text-gray-600" />}
                </button>

                {/* Expanded */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-800 pt-3 space-y-4">
                    {loadingDetail ? (
                      <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 text-purple-500 animate-spin" /></div>
                    ) : kampanjDetail && (
                      <>
                        {/* Stats */}
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                          {[
                            { label: 'Totalt', value: kampanjDetail.live_total, icon: Users },
                            { label: 'Utkast', value: kampanjDetail.live_drafts, icon: Clock },
                            { label: 'Skickade', value: kampanjDetail.live_sent, icon: Send },
                            { label: 'Svar', value: kampanjDetail.live_replied, icon: Mail },
                            { label: 'Avtal', value: kampanjDetail.live_contracts, icon: CheckCircle },
                          ].map((s, i) => (
                            <div key={i} className="bg-gray-800/50 rounded-lg px-3 py-2 text-center">
                              <s.icon className="w-3 h-3 mx-auto mb-1 text-gray-500" />
                              <p className="text-sm font-bold text-white">{s.value}</p>
                              <p className="text-[10px] text-gray-500">{s.label}</p>
                            </div>
                          ))}
                        </div>

                        {/* Add influencers */}
                        {availableInf.length > 0 && (
                          <div className="bg-gray-800/30 rounded-lg border border-gray-700 p-3">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-xs font-medium text-white flex items-center gap-1.5">
                                <UserPlus className="w-3.5 h-3.5 text-purple-400" />
                                Lägg till influencers ({availableInf.length} tillgängliga)
                              </h4>
                              <button onClick={toggleSelectAll} className="text-[10px] text-purple-400 hover:text-purple-300">
                                {selectedInf.length === availableInf.length ? 'Avmarkera alla' : 'Välj alla'}
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto mb-2">
                              {availableInf.map(inf => (
                                <label key={inf.id}
                                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
                                    selectedInf.includes(inf.id)
                                      ? 'bg-purple-600/30 text-purple-300 border border-purple-500/30'
                                      : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600'
                                  }`}>
                                  <input type="checkbox" className="sr-only"
                                    checked={selectedInf.includes(inf.id)}
                                    onChange={() => {
                                      setSelectedInf(prev => prev.includes(inf.id)
                                        ? prev.filter(id => id !== inf.id)
                                        : [...prev, inf.id])
                                    }} />
                                  {inf.namn}
                                  <span className="text-[10px] opacity-60">@{inf.kanalnamn}</span>
                                </label>
                              ))}
                            </div>
                            <button onClick={handleBulkGenerate} disabled={generating || selectedInf.length === 0}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50 transition-colors">
                              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                              {generating ? 'Genererar...' : `Generera outreach för ${selectedInf.length} influencers`}
                            </button>
                          </div>
                        )}

                        {/* Outreach list */}
                        {kampanjDetail.outreach?.length > 0 && (
                          <div>
                            <h4 className="text-xs font-medium text-white mb-2">Outreach ({kampanjDetail.outreach.length})</h4>
                            <div className="space-y-1 max-h-64 overflow-y-auto">
                              {kampanjDetail.outreach.map(o => (
                                <div key={o.id} className="flex items-center gap-2 px-3 py-2 bg-gray-800/30 rounded-lg text-xs">
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                                    o.status === 'avtal_signerat' ? 'bg-green-400' :
                                    o.status === 'svarat' ? 'bg-blue-400' :
                                    o.status === 'skickat' ? 'bg-purple-400' :
                                    'bg-gray-600'
                                  }`} />
                                  <span className="text-gray-300 flex-1 truncate">{o.influencer_namn}</span>
                                  <span className="text-[10px] text-gray-500">@{o.kanalnamn}</span>
                                  <span className="text-[10px] text-gray-500">{o.plattform}</span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                    o.status === 'utkast' ? 'bg-gray-500/20 text-gray-400' :
                                    o.status === 'skickat' ? 'bg-purple-500/20 text-purple-300' :
                                    o.status === 'svarat' ? 'bg-blue-500/20 text-blue-300' :
                                    o.status === 'avtal_signerat' ? 'bg-green-500/20 text-green-300' :
                                    'bg-gray-500/20 text-gray-400'
                                  }`}>{o.status}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-2 pt-2 border-t border-gray-800">
                          {kampanjDetail.live_drafts > 0 && (
                            <button onClick={handleBulkSend} disabled={sending}
                              className="flex items-center gap-1.5 px-4 py-2 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 transition-colors">
                              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                              {sending ? 'Skickar...' : `Skicka alla utkast (${kampanjDetail.live_drafts})`}
                            </button>
                          )}
                          {k.status === 'active' && (
                            <button onClick={async () => { await api.updateKampanj(k.id, { status: 'completed' }); loadData(); loadKampanjDetail(k.id); }}
                              className="flex items-center gap-1.5 px-3 py-2 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                              <CheckCircle className="w-3.5 h-3.5" /> Avsluta kampanj
                            </button>
                          )}
                          <button onClick={() => handleDelete(k.id)}
                            className="flex items-center gap-1.5 px-3 py-2 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg ml-auto">
                            <Trash2 className="w-3.5 h-3.5" /> Ta bort
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
