import { useState, useEffect } from 'react'
import {
  DollarSign, CheckCircle, Clock, AlertTriangle, XCircle, Plus,
  Loader2, RefreshCw, ChevronDown, ChevronUp, Edit3, Trash2, Tag
} from 'lucide-react'
import * as api from '../../services/api'

const STATUS_CONFIG = {
  avtalat: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Avtalat' },
  fakturerad: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Fakturerad' },
  betald: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Betald' },
  forfallen: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Förfallen' },
  makulerad: { bg: 'bg-gray-500/20', text: 'text-gray-500', label: 'Makulerad' },
}

export default function IntakterTab() {
  const [overview, setOverview] = useState(null)
  const [intakter, setIntakter] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('alla')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({
    sponsor_namn: '', belopp_sek: '', kampanj_namn: '',
    beskrivning: '', kontaktperson: '', typ: 'sponsoravtal',
    avtalsdatum: new Date().toISOString().split('T')[0], forfallodag: '', notes: ''
  })

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [o, i] = await Promise.all([
        api.getIntakterOverview().catch(() => null),
        api.getIntakter().catch(() => []),
      ])
      setOverview(o)
      setIntakter(i)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const handleSubmit = async () => {
    if (!form.sponsor_namn || !form.belopp_sek) return
    try {
      if (editingId) {
        await api.updateIntakt(editingId, { ...form, belopp_sek: parseInt(form.belopp_sek) })
      } else {
        await api.createIntakt({ ...form, belopp_sek: parseInt(form.belopp_sek) })
      }
      resetForm()
      await loadData()
    } catch (err) { alert(err.message) }
  }

  const resetForm = () => {
    setShowForm(false)
    setEditingId(null)
    setForm({
      sponsor_namn: '', belopp_sek: '', kampanj_namn: '',
      beskrivning: '', kontaktperson: '', typ: 'sponsoravtal',
      avtalsdatum: new Date().toISOString().split('T')[0], forfallodag: '', notes: ''
    })
  }

  const startEdit = (item) => {
    setEditingId(item.id)
    setForm({
      sponsor_namn: item.sponsor_namn || '',
      belopp_sek: item.belopp_sek || '',
      kampanj_namn: item.kampanj_namn || '',
      beskrivning: item.beskrivning || '',
      kontaktperson: item.kontaktperson || '',
      typ: item.typ || 'sponsoravtal',
      avtalsdatum: item.avtalsdatum || '',
      forfallodag: item.forfallodag || '',
      notes: item.notes || '',
    })
    setShowForm(true)
  }

  const handleStatusChange = async (id, updates) => {
    try {
      await api.updateIntaktStatus(id, updates)
      await loadData()
    } catch (err) { console.error(err) }
  }

  const handleDelete = async (id) => {
    try {
      await api.deleteIntakt(id)
      await loadData()
    } catch (err) { console.error(err) }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
    </div>
  )

  const filtered = statusFilter === 'alla'
    ? intakter.filter(i => i.status !== 'makulerad')
    : intakter.filter(i => i.status === statusFilter)

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <DollarSign className="w-6 h-6 text-green-500" />
          Intäkter
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={() => { resetForm(); setShowForm(!showForm) }}
            className="flex items-center gap-2 text-sm bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg">
            <Plus className="w-4 h-4" /> Ny intäkt
          </button>
          <button onClick={loadData} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm">
            <RefreshCw className="w-4 h-4" /> Uppdatera
          </button>
        </div>
      </div>

      {/* Översiktskort */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={<DollarSign className="w-5 h-5 text-green-400" />} label="Totalt avtalat" value={`${(overview.total_avtalat || 0).toLocaleString()} SEK`} />
          <StatCard icon={<CheckCircle className="w-5 h-5 text-emerald-400" />} label="Inbetalt" value={`${(overview.total_betalt || 0).toLocaleString()} SEK`} />
          <StatCard icon={<Clock className="w-5 h-5 text-yellow-400" />} label="Väntar betalning" value={`${(overview.total_obetalt || 0).toLocaleString()} SEK`} alert={(overview.total_obetalt || 0) > 0} />
          <StatCard icon={<Tag className="w-5 h-5 text-purple-400" />} label="Sponsorer" value={overview.antal_sponsorer || 0} />
        </div>
      )}

      {/* Per kampanj */}
      {overview?.per_kampanj?.length > 0 && (
        <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Tag className="w-4 h-4 text-purple-400" /> Intäkter per kampanj
          </h3>
          <div className="space-y-2">
            {overview.per_kampanj.map(k => (
              <div key={k.kampanj_namn} className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg border border-gray-700/50">
                <div>
                  <span className="text-white font-medium">{k.kampanj_namn}</span>
                  <span className="text-xs text-gray-500 ml-2">{k.antal_sponsorer} sponsor(er)</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-white font-bold">{(k.total_belopp || 0).toLocaleString()} SEK</div>
                    <div className="text-xs text-gray-500">
                      {(k.betalt_belopp || 0).toLocaleString()} SEK inbetalt
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="w-20 bg-gray-700 rounded-full h-2">
                    <div className="bg-green-500 h-2 rounded-full"
                      style={{ width: `${k.total_belopp > 0 ? (k.betalt_belopp / k.total_belopp * 100) : 0}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ny intäkt-formulär */}
      {showForm && (
        <div className="bg-gray-800/50 rounded-xl p-5 border border-green-700/30">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">
            {editingId ? 'Redigera intäkt' : 'Registrera ny intäkt'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">Sponsor/Företag *</label>
              <input value={form.sponsor_namn} onChange={e => setForm({ ...form, sponsor_namn: e.target.value })}
                placeholder="T.ex. Elgiganten"
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Belopp (SEK) *</label>
              <input type="number" value={form.belopp_sek} onChange={e => setForm({ ...form, belopp_sek: e.target.value })}
                placeholder="15000"
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Kampanj</label>
              <input value={form.kampanj_namn} onChange={e => setForm({ ...form, kampanj_namn: e.target.value })}
                placeholder="T.ex. Sommarkampanjen 2026"
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Kontaktperson</label>
              <input value={form.kontaktperson} onChange={e => setForm({ ...form, kontaktperson: e.target.value })}
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Typ</label>
              <select value={form.typ} onChange={e => setForm({ ...form, typ: e.target.value })}
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                <option value="sponsoravtal">Sponsoravtal</option>
                <option value="kampanjpaket">Kampanjpaket</option>
                <option value="engangsbidrag">Engångsbidrag</option>
                <option value="ovrigt">Övrigt</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Avtalsdatum</label>
              <input type="date" value={form.avtalsdatum} onChange={e => setForm({ ...form, avtalsdatum: e.target.value })}
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Förfallodag</label>
              <input type="date" value={form.forfallodag} onChange={e => setForm({ ...form, forfallodag: e.target.value })}
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Beskrivning</label>
              <input value={form.beskrivning} onChange={e => setForm({ ...form, beskrivning: e.target.value })}
                placeholder="Vad ingår?"
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs text-gray-500">Notering</label>
            <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={handleSubmit}
              className="text-sm bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg">
              {editingId ? 'Spara ändringar' : 'Registrera intäkt'}
            </button>
            <button onClick={resetForm}
              className="text-sm text-gray-400 hover:text-white px-4 py-2">
              Avbryt
            </button>
          </div>
        </div>
      )}

      {/* Status-filter */}
      <div className="flex gap-2 flex-wrap">
        {['alla', 'avtalat', 'fakturerad', 'betald', 'forfallen', 'makulerad'].map(f => (
          <button key={f} onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === f ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}>
            {f === 'alla' ? `Alla (${intakter.filter(i => i.status !== 'makulerad').length})`
              : `${STATUS_CONFIG[f]?.label || f} (${intakter.filter(i => i.status === f).length})`}
          </button>
        ))}
      </div>

      {/* Intäktslista */}
      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map(item => (
            <IntaktCard
              key={item.id}
              item={item}
              onStatusChange={handleStatusChange}
              onEdit={startEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500">
          <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg font-medium">Inga intäkter registrerade</p>
          <p className="text-sm mt-1">Klicka "Ny intäkt" för att registrera ett sponsoravtal eller en kampanjintäkt</p>
        </div>
      )}
    </div>
  )
}


// === Subkomponenter ===

function StatCard({ icon, label, value, alert }) {
  return (
    <div className={`rounded-xl p-4 border ${alert ? 'bg-yellow-900/20 border-yellow-700/50' : 'bg-gray-800/50 border-gray-700/50'}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <span className={`text-2xl font-bold ${alert ? 'text-yellow-400' : 'text-white'}`}>{value}</span>
    </div>
  )
}

function IntaktCard({ item, onStatusChange, onEdit, onDelete }) {
  const [showDetails, setShowDetails] = useState(false)
  const style = STATUS_CONFIG[item.status] || STATUS_CONFIG.avtalat

  return (
    <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
      {/* Top row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white font-medium">{item.sponsor_namn}</span>
            {item.kampanj_namn && (
              <>
                <span className="text-gray-600">•</span>
                <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">{item.kampanj_namn}</span>
              </>
            )}
          </div>
          <div className="text-sm text-gray-400">
            {item.typ && <span className="capitalize">{item.typ.replace(/_/g, ' ')}</span>}
            {item.avtalsdatum && ` • Avtalat ${item.avtalsdatum}`}
            {item.kontaktperson && ` • ${item.kontaktperson}`}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xl font-bold text-green-400">{(item.belopp_sek || 0).toLocaleString()} SEK</span>
          <span className={`${style.bg} ${style.text} text-xs font-medium px-2.5 py-1 rounded-lg`}>
            {style.label}
          </span>
        </div>
      </div>

      {/* Expanderbar detalj */}
      {(item.beskrivning || item.notes || item.forfallodag) && (
        <>
          <button onClick={() => setShowDetails(!showDetails)}
            className="mt-2 text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
            {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showDetails ? 'Dölj detaljer' : 'Visa detaljer'}
          </button>
          {showDetails && (
            <div className="mt-2 p-3 bg-gray-900/50 rounded-lg border border-gray-700/50 text-sm space-y-1">
              {item.beskrivning && <div><span className="text-gray-500">Beskrivning:</span> <span className="text-white">{item.beskrivning}</span></div>}
              {item.forfallodag && <div><span className="text-gray-500">Förfallodag:</span> <span className="text-white">{item.forfallodag}</span></div>}
              {item.betald_datum && <div><span className="text-gray-500">Betald:</span> <span className="text-green-400">{item.betald_datum.split('T')[0]}</span></div>}
              {item.notes && <div><span className="text-gray-500">Notering:</span> <span className="text-gray-400 italic">{item.notes}</span></div>}
            </div>
          )}
        </>
      )}

      {/* Actions */}
      <div className="mt-3 flex gap-2 flex-wrap">
        {item.status === 'avtalat' && (
          <button onClick={() => onStatusChange(item.id, { fakturerad: true, status: 'fakturerad' })}
            className="text-xs bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1.5 rounded flex items-center gap-1">
            <Clock className="w-3 h-3" /> Markera fakturerad
          </button>
        )}
        {(item.status === 'fakturerad' || item.status === 'forfallen') && (
          <button onClick={() => onStatusChange(item.id, { betald: true, status: 'betald' })}
            className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> Markera betald
          </button>
        )}
        <button onClick={() => onEdit(item)}
          className="text-xs text-gray-400 hover:text-white px-3 py-1.5 border border-gray-700 rounded flex items-center gap-1">
          <Edit3 className="w-3 h-3" /> Redigera
        </button>
        {item.status !== 'makulerad' && (
          <button onClick={() => onDelete(item.id)}
            className="text-xs text-gray-600 hover:text-red-400 px-2 py-1.5 flex items-center gap-1">
            <Trash2 className="w-3 h-3" /> Makulera
          </button>
        )}
      </div>
    </div>
  )
}
