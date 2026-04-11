import { useState, useEffect } from 'react'
import {
  FileText, CheckCircle, Clock, AlertTriangle, XCircle, Send,
  Loader2, RefreshCw, DollarSign, Download, Plus, CreditCard,
  Receipt, Eye, ChevronDown, ChevronUp
} from 'lucide-react'
import * as api from '../../services/api'

const STATUS_CONFIG = {
  utkast: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Utkast', icon: FileText },
  skickad: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Skickad', icon: Send },
  betald: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Betald', icon: CheckCircle },
  forfallen: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Förfallen', icon: AlertTriangle },
  makulerad: { bg: 'bg-gray-500/20', text: 'text-gray-500', label: 'Makulerad', icon: XCircle },
}

export default function InvoicesTab() {
  const [overview, setOverview] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [billable, setBillable] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('alla')
  const [showBillable, setShowBillable] = useState(false)
  const [generating, setGenerating] = useState(null)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [o, i, b] = await Promise.all([
        api.getInvoicesOverview().catch(() => null),
        api.getInvoices().catch(() => []),
        api.getBillableContracts().catch(() => []),
      ])
      setOverview(o)
      setInvoices(i)
      setBillable(b)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const handleGenerate = async (kontraktId) => {
    setGenerating(kontraktId)
    try {
      await api.generateInvoice(kontraktId)
      await loadData()
    } catch (err) { alert(err.message) }
    finally { setGenerating(null) }
  }

  const handleStatusChange = async (id, status) => {
    try {
      await api.updateInvoiceStatus(id, status)
      await loadData()
    } catch (err) { console.error(err) }
  }

  const handleSendInvoice = async (id) => {
    try {
      await api.sendInvoice(id)
      await loadData()
    } catch (err) { alert(err.message) }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
    </div>
  )

  const filtered = statusFilter === 'alla'
    ? invoices
    : invoices.filter(i => i.status === statusFilter)

  const unpaidBillable = billable.filter(b => b.beraknat_belopp > 0)

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Receipt className="w-6 h-6 text-purple-500" />
          Fakturering & Betalning
        </h2>
        <button onClick={loadData} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm">
          <RefreshCw className="w-4 h-4" /> Uppdatera
        </button>
      </div>

      {/* Översiktskort */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={<Receipt className="w-5 h-5 text-purple-400" />}
            label="Totalt fakturerat"
            value={`${(overview.total_fakturerat || 0).toLocaleString()} SEK`}
          />
          <StatCard
            icon={<CheckCircle className="w-5 h-5 text-green-400" />}
            label="Betalt"
            value={`${(overview.total_betalt || 0).toLocaleString()} SEK`}
          />
          <StatCard
            icon={<Clock className="w-5 h-5 text-blue-400" />}
            label="Obetalt"
            value={`${(overview.total_obetalt || 0).toLocaleString()} SEK`}
          />
          <StatCard
            icon={<AlertTriangle className="w-5 h-5 text-red-400" />}
            label="Förfallna"
            value={overview.overdue_count || 0}
            alert={(overview.overdue_count || 0) > 0}
          />
        </div>
      )}

      {/* Generera ny faktura */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700/50">
        <button
          onClick={() => setShowBillable(!showBillable)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <div className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-purple-400" />
            <span className="font-medium text-white">Generera ny faktura</span>
            {unpaidBillable.length > 0 && (
              <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">
                {unpaidBillable.length} fakturerbara kontrakt
              </span>
            )}
          </div>
          {showBillable ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {showBillable && (
          <div className="px-4 pb-4 space-y-2">
            {unpaidBillable.length > 0 ? unpaidBillable.map(k => (
              <div key={k.id} className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg border border-gray-700/50">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">{k.influencer_namn}</span>
                    <span className="text-gray-500 text-sm">@{k.kanalnamn}</span>
                  </div>
                  <div className="text-sm text-gray-400 mt-1">
                    {k.videos_delivered || 0} videos ({((k.videos_delivered || 0) * 300).toLocaleString()} SEK)
                    {' + '}
                    {k.total_signups || 0} signups ({((k.total_signups || 0) * 10).toLocaleString()} SEK)
                    {' = '}
                    <span className="text-purple-400 font-medium">{(k.beraknat_belopp || 0).toLocaleString()} SEK</span>
                  </div>
                  {k.antal_fakturor > 0 && (
                    <span className="text-xs text-yellow-400 mt-1 inline-block">
                      {k.antal_fakturor} befintlig(a) faktura/or
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleGenerate(k.id)}
                  disabled={generating === k.id}
                  className="text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg flex items-center gap-1"
                >
                  {generating === k.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Receipt className="w-3 h-3" />
                  )}
                  Skapa faktura
                </button>
              </div>
            )) : (
              <p className="text-gray-500 text-center py-4">Inga kontrakt med fakturerbara belopp hittades.</p>
            )}
          </div>
        )}
      </div>

      {/* Status-filter */}
      <div className="flex gap-2 flex-wrap">
        {['alla', 'utkast', 'skickad', 'betald', 'forfallen', 'makulerad'].map(f => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === f
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {f === 'alla' ? `Alla (${invoices.length})` : `${STATUS_CONFIG[f]?.label || f} (${invoices.filter(i => i.status === f).length})`}
          </button>
        ))}
      </div>

      {/* Fakturalista */}
      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map(inv => (
            <InvoiceCard
              key={inv.id}
              invoice={inv}
              onStatusChange={handleStatusChange}
              onSend={handleSendInvoice}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500">
          <Receipt className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg font-medium">Inga fakturor att visa</p>
          <p className="text-sm mt-1">Klicka "Generera ny faktura" ovan för att skapa en faktura från ett kontrakt</p>
        </div>
      )}
    </div>
  )
}


// === Subkomponenter ===

function StatCard({ icon, label, value, alert }) {
  return (
    <div className={`rounded-xl p-4 border ${alert ? 'bg-red-900/20 border-red-700/50' : 'bg-gray-800/50 border-gray-700/50'}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <span className={`text-2xl font-bold ${alert ? 'text-red-400' : 'text-white'}`}>{value}</span>
    </div>
  )
}

function InvoiceCard({ invoice: inv, onStatusChange, onSend }) {
  const [showDetails, setShowDetails] = useState(false)
  const style = STATUS_CONFIG[inv.status] || STATUS_CONFIG.utkast
  const Icon = style.icon

  const isOverdue = inv.status === 'skickad' && inv.due_date && new Date(inv.due_date) < new Date()
  const daysUntilDue = inv.due_date ? Math.ceil((new Date(inv.due_date) - Date.now()) / (1000 * 60 * 60 * 24)) : null

  return (
    <div className={`bg-gray-800/50 rounded-xl p-4 border ${isOverdue ? 'border-red-700/50' : 'border-gray-700/50'}`}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-purple-400">{inv.faktura_nr}</span>
            <span className="text-gray-600">•</span>
            <span className="text-white font-medium">{inv.influencer_namn}</span>
            <span className="text-gray-500 text-sm">@{inv.kanalnamn}</span>
          </div>
          <div className="text-sm text-gray-400">
            {inv.foretag_namn} • Skapad {new Date(inv.created_at).toLocaleDateString('sv-SE')}
            {inv.sent_at && ` • Skickad ${new Date(inv.sent_at).toLocaleDateString('sv-SE')}`}
            {inv.paid_at && ` • Betald ${new Date(inv.paid_at).toLocaleDateString('sv-SE')}`}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-lg font-bold text-white">{(inv.total_amount_sek || 0).toLocaleString()} SEK</span>
          {daysUntilDue !== null && inv.status === 'skickad' && (
            <span className={`text-xs px-2 py-1 rounded ${
              daysUntilDue <= 0 ? 'bg-red-500/20 text-red-400' :
              daysUntilDue <= 7 ? 'bg-orange-500/20 text-orange-400' :
              'bg-gray-700 text-gray-400'
            }`}>
              {daysUntilDue <= 0 ? 'Förfallen' : `${daysUntilDue}d kvar`}
            </span>
          )}
          <span className={`${style.bg} ${style.text} text-xs font-medium px-2.5 py-1 rounded-lg flex items-center gap-1`}>
            <Icon className="w-3 h-3" /> {style.label}
          </span>
        </div>
      </div>

      {/* Beloppsuppdelning */}
      <div className="mt-3 flex items-center gap-6 text-sm">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-purple-500" />
          <span className="text-gray-400">{inv.videos_count || 0} videos</span>
          <span className="text-gray-500">=</span>
          <span className="text-white font-medium">{(inv.video_amount_sek || 0).toLocaleString()} SEK</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="text-gray-400">{inv.signups_count || 0} signups</span>
          <span className="text-gray-500">=</span>
          <span className="text-white font-medium">{(inv.signup_amount_sek || 0).toLocaleString()} SEK</span>
        </div>
      </div>

      {/* Expanderbar detalj */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="mt-2 text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"
      >
        {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {showDetails ? 'Dölj detaljer' : 'Visa detaljer'}
      </button>

      {showDetails && (
        <div className="mt-2 p-3 bg-gray-900/50 rounded-lg border border-gray-700/50 text-sm space-y-1">
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-gray-500">Förfallodatum:</span> <span className="text-white">{inv.due_date || '–'}</span></div>
            <div><span className="text-gray-500">Period:</span> <span className="text-white">{(inv.period_from || '').split('T')[0]} — {(inv.period_to || '').split('T')[0]}</span></div>
          </div>
          {inv.notes && (
            <div className="mt-2">
              <span className="text-gray-500">Notering:</span>
              <span className="text-gray-400 ml-1 italic">{inv.notes}</span>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex gap-2 flex-wrap">
        <a href={api.getInvoicePdfUrl(inv.id)} download
          className="text-xs text-purple-400 hover:text-purple-300 px-3 py-1.5 border border-purple-500/30 rounded flex items-center gap-1">
          <Download className="w-3 h-3" /> PDF
        </a>

        {inv.status === 'utkast' && (
          <>
            <button onClick={() => onSend(inv.id)}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded flex items-center gap-1">
              <Send className="w-3 h-3" /> Skicka faktura
            </button>
            <button onClick={() => onStatusChange(inv.id, 'makulerad')}
              className="text-xs text-gray-500 hover:text-red-400 px-2 py-1.5">
              Makulera
            </button>
          </>
        )}

        {inv.status === 'skickad' && (
          <button onClick={() => onStatusChange(inv.id, 'betald')}
            className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded flex items-center gap-1">
            <CreditCard className="w-3 h-3" /> Markera betald
          </button>
        )}

        {inv.status === 'forfallen' && (
          <>
            <button onClick={() => onStatusChange(inv.id, 'betald')}
              className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded flex items-center gap-1">
              <CreditCard className="w-3 h-3" /> Markera betald
            </button>
            <button onClick={() => onSend(inv.id)}
              className="text-xs bg-orange-600 hover:bg-orange-700 text-white px-3 py-1.5 rounded flex items-center gap-1">
              <Send className="w-3 h-3" /> Skicka påminnelse
            </button>
          </>
        )}
      </div>
    </div>
  )
}
