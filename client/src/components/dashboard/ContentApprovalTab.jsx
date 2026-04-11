import { useState, useEffect } from 'react'
import {
  FileVideo, CheckCircle, XCircle, Clock, RotateCcw, Plus,
  Loader2, Eye, MessageSquare, ChevronDown, ChevronUp, Send,
  AlertTriangle, ExternalLink, Filter
} from 'lucide-react'
import * as api from '../../services/api'

const STATUS_CONFIG = {
  submitted: { label: 'Inskickad', color: 'bg-blue-500/20 text-blue-300', icon: Clock },
  in_review: { label: 'Granskas', color: 'bg-yellow-500/20 text-yellow-300', icon: Eye },
  approved: { label: 'Godkänd', color: 'bg-green-500/20 text-green-300', icon: CheckCircle },
  needs_revision: { label: 'Behöver ändras', color: 'bg-orange-500/20 text-orange-300', icon: RotateCcw },
  rejected: { label: 'Avvisad', color: 'bg-red-500/20 text-red-300', icon: XCircle },
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.submitted
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  )
}

export default function ContentApprovalTab() {
  const [submissions, setSubmissions] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [reviewNote, setReviewNote] = useState('')
  const [showNewForm, setShowNewForm] = useState(false)
  const [newForm, setNewForm] = useState({ influencer_id: '', title: '', content_url: '', content_type: 'video', notes_from_influencer: '', deadline: '' })
  const [influencers, setInfluencers] = useState([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { loadData() }, [filter])

  const loadData = async () => {
    setLoading(true)
    try {
      const params = filter !== 'all' ? { status: filter } : {}
      const [subs, st] = await Promise.all([
        api.getContentSubmissions(params),
        api.getContentSubmissionStats(),
      ])
      setSubmissions(subs)
      setStats(st)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const loadInfluencers = async () => {
    try {
      const data = await api.getInfluencers()
      setInfluencers(data.filter(i => i.kontakt_epost))
    } catch (err) { console.error(err) }
  }

  const handleReview = async (id, status) => {
    try {
      await api.reviewContentSubmission(id, { status, review_notes: reviewNote, reviewed_by: 'Admin' })
      setReviewNote('')
      setExpandedId(null)
      loadData()
    } catch (err) { console.error(err); alert('Fel vid granskning') }
  }

  const handleNewSubmission = async (e) => {
    e.preventDefault()
    if (!newForm.influencer_id || !newForm.title) return
    setSubmitting(true)
    try {
      await api.createContentSubmission({
        ...newForm,
        influencer_id: Number(newForm.influencer_id),
      })
      setNewForm({ influencer_id: '', title: '', content_url: '', content_type: 'video', notes_from_influencer: '', deadline: '' })
      setShowNewForm(false)
      loadData()
    } catch (err) { console.error(err); alert('Fel vid skapande') }
    finally { setSubmitting(false) }
  }

  const openNewForm = () => {
    if (influencers.length === 0) loadInfluencers()
    setShowNewForm(true)
  }

  if (loading && submissions.length === 0) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          {[
            { label: 'Totalt', value: stats.total, color: 'text-white' },
            { label: 'Väntar', value: stats.pending, color: 'text-blue-400' },
            { label: 'Granskas', value: stats.in_review, color: 'text-yellow-400' },
            { label: 'Godkända', value: stats.approved, color: 'text-green-400' },
            { label: 'Ändras', value: stats.needs_revision, color: 'text-orange-400' },
            { label: 'Snitt dagar', value: stats.avg_review_days ?? '—', color: 'text-purple-400' },
          ].map((s, i) => (
            <div key={i} className="bg-gray-900 rounded-lg border border-gray-800 px-3 py-2 text-center">
              <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter + New */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {[
            { key: 'all', label: 'Alla' },
            { key: 'submitted', label: 'Nya' },
            { key: 'in_review', label: 'Granskas' },
            { key: 'needs_revision', label: 'Revision' },
            { key: 'approved', label: 'Godkända' },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                filter === f.key
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
        <button onClick={openNewForm}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors">
          <Plus className="w-3 h-3" />
          Ny inskickning
        </button>
      </div>

      {/* New submission form */}
      {showNewForm && (
        <form onSubmit={handleNewSubmission} className="bg-gray-900 rounded-xl border border-purple-500/30 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white">Ny content-inskickning</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select value={newForm.influencer_id} onChange={e => setNewForm(p => ({ ...p, influencer_id: e.target.value }))}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" required>
              <option value="">Välj influencer...</option>
              {influencers.map(inf => (
                <option key={inf.id} value={inf.id}>{inf.namn} (@{inf.kanalnamn})</option>
              ))}
            </select>
            <input type="text" placeholder="Titel / videotitel" value={newForm.title}
              onChange={e => setNewForm(p => ({ ...p, title: e.target.value }))}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" required />
            <input type="url" placeholder="Länk till content (YouTube, Google Drive...)" value={newForm.content_url}
              onChange={e => setNewForm(p => ({ ...p, content_url: e.target.value }))}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            <input type="date" placeholder="Deadline" value={newForm.deadline}
              onChange={e => setNewForm(p => ({ ...p, deadline: e.target.value }))}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <textarea placeholder="Kommentar från influencer" value={newForm.notes_from_influencer}
            onChange={e => setNewForm(p => ({ ...p, notes_from_influencer: e.target.value }))}
            rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white resize-none" />
          <div className="flex gap-2">
            <button type="submit" disabled={submitting}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50">
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Skicka in
            </button>
            <button type="button" onClick={() => setShowNewForm(false)}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white">Avbryt</button>
          </div>
        </form>
      )}

      {/* Submissions list */}
      {submissions.length === 0 ? (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center">
          <FileVideo className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Inga inskickningar{filter !== 'all' ? ` med status "${STATUS_CONFIG[filter]?.label}"` : ''}</p>
          <p className="text-xs text-gray-600 mt-1">Influencers kan skicka in content för godkännande innan publicering.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {submissions.map(sub => {
            const isExpanded = expandedId === sub.id
            const isActionable = sub.status === 'submitted' || sub.status === 'in_review'

            return (
              <div key={sub.id} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                {/* Header row */}
                <button onClick={() => setExpandedId(isExpanded ? null : sub.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-800/50 transition-colors">
                  <FileVideo className="w-4 h-4 text-gray-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate">{sub.title}</span>
                      <StatusBadge status={sub.status} />
                      {sub.revision_count > 0 && (
                        <span className="text-[10px] text-gray-500">Rev. {sub.revision_count}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-400">{sub.influencer_namn}</span>
                      <span className="text-[10px] text-gray-600">@{sub.kanalnamn}</span>
                      {sub.deadline && (
                        <span className={`text-[10px] ${new Date(sub.deadline) < new Date() ? 'text-red-400' : 'text-gray-500'}`}>
                          Deadline: {new Date(sub.deadline).toLocaleDateString('sv-SE')}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] text-gray-600 shrink-0">
                    {sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString('sv-SE') : ''}
                  </span>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-600" /> : <ChevronDown className="w-4 h-4 text-gray-600" />}
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-800 pt-3 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Left: Content info */}
                      <div className="space-y-2">
                        {sub.content_url && (
                          <a href={sub.content_url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-sm text-purple-400 hover:text-purple-300">
                            <ExternalLink className="w-3.5 h-3.5" />
                            Visa content
                          </a>
                        )}
                        {sub.description && (
                          <div>
                            <p className="text-[10px] text-gray-500 mb-0.5">Beskrivning</p>
                            <p className="text-xs text-gray-300">{sub.description}</p>
                          </div>
                        )}
                        {sub.notes_from_influencer && (
                          <div>
                            <p className="text-[10px] text-gray-500 mb-0.5">Kommentar från influencer</p>
                            <p className="text-xs text-gray-300 bg-gray-800 rounded px-2 py-1">{sub.notes_from_influencer}</p>
                          </div>
                        )}
                        {sub.foretag_namn && (
                          <p className="text-[10px] text-gray-500">Företag: <span className="text-gray-400">{sub.foretag_namn}</span></p>
                        )}
                        {sub.videos_required && (
                          <p className="text-[10px] text-gray-500">
                            Kontrakt: {sub.videos_delivered || 0}/{sub.videos_required} videos levererade
                          </p>
                        )}
                      </div>

                      {/* Right: Review history */}
                      <div className="space-y-2">
                        {sub.review_notes && (
                          <div>
                            <p className="text-[10px] text-gray-500 mb-0.5">Granskningskommentar</p>
                            <p className="text-xs text-gray-300 bg-gray-800 rounded px-2 py-1">{sub.review_notes}</p>
                          </div>
                        )}
                        {sub.reviewed_at && (
                          <p className="text-[10px] text-gray-500">
                            Granskad: {new Date(sub.reviewed_at).toLocaleString('sv-SE')}
                            {sub.reviewed_by && ` av ${sub.reviewed_by}`}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    {isActionable && (
                      <div className="border-t border-gray-800 pt-3">
                        <textarea
                          value={reviewNote}
                          onChange={(e) => setReviewNote(e.target.value)}
                          placeholder="Granskningskommentar (valfritt)..."
                          rows={2}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white resize-none mb-2 focus:border-purple-500 focus:outline-none"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => handleReview(sub.id, 'approved')}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors">
                            <CheckCircle className="w-3.5 h-3.5" />
                            Godkänn
                          </button>
                          <button onClick={() => handleReview(sub.id, 'needs_revision')}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors">
                            <RotateCcw className="w-3.5 h-3.5" />
                            Begär revision
                          </button>
                          <button onClick={() => handleReview(sub.id, 'rejected')}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors">
                            <XCircle className="w-3.5 h-3.5" />
                            Avvisa
                          </button>
                          {sub.status === 'submitted' && (
                            <button onClick={() => handleReview(sub.id, 'in_review')}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">
                              <Eye className="w-3.5 h-3.5" />
                              Markera granskas
                            </button>
                          )}
                        </div>
                      </div>
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
