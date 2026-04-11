import { useState, useEffect } from 'react'
import {
  Star, Ban, Search, Loader2, Trash2, Plus, RefreshCw,
  Youtube, Instagram, MessageSquare, Clock, StickyNote,
  Filter, Heart, ShieldOff, ChevronDown, UserPlus, CheckCircle,
  FileText, AlertCircle
} from 'lucide-react'
import * as api from '../../services/api'

function platformIcon(p) {
  if (!p) return <MessageSquare className="w-3.5 h-3.5 text-gray-500" />
  const pl = p.toLowerCase()
  if (pl.includes('youtube')) return <Youtube className="w-3.5 h-3.5 text-red-400" />
  if (pl.includes('instagram')) return <Instagram className="w-3.5 h-3.5 text-pink-400" />
  if (pl.includes('tiktok')) return <span className="text-[10px] font-bold text-cyan-400">TT</span>
  return <MessageSquare className="w-3.5 h-3.5 text-gray-500" />
}

export default function InfluencerLibraryTab() {
  const [activeSection, setActiveSection] = useState('import')
  const [favorites, setFavorites] = useState([])
  const [blacklist, setBlacklist] = useState([])
  const [savedSearches, setSavedSearches] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingNote, setEditingNote] = useState(null)
  const [noteText, setNoteText] = useState('')

  // Add blacklist form
  const [showAddBlacklist, setShowAddBlacklist] = useState(false)
  const [blForm, setBlForm] = useState({ namn: '', kanalnamn: '', plattform: 'youtube', anledning: '' })

  // Manual import form
  const [foretagList, setForetagList] = useState([])
  const [importForm, setImportForm] = useState({
    foretag_id: '', namn: '', kanalnamn: '', plattform: 'youtube', foljare: '', nisch: '',
    kontakt_epost: '', skapa_avtal: true, kontaktperson: '', avtal_status: 'aktivt',
    videos_required: 5, videos_delivered: 0, total_signups: 0, notes: '',
  })
  const [importResult, setImportResult] = useState(null)
  const [importLoading, setImportLoading] = useState(false)

  useEffect(() => { loadAll(); loadForetag() }, [])

  const loadForetag = async () => {
    try {
      const f = await api.getForetag()
      setForetagList(f)
      if (f.length > 0 && !importForm.foretag_id) {
        setImportForm(prev => ({ ...prev, foretag_id: f[0].id }))
      }
    } catch (err) { console.error(err) }
  }

  const loadAll = async () => {
    setLoading(true)
    try {
      const [f, b, s] = await Promise.all([
        api.getFavorites(),
        api.getBlacklist(),
        api.getSavedSearches(),
      ])
      setFavorites(f)
      setBlacklist(b)
      setSavedSearches(s)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const handleRemoveFavorite = async (id) => {
    await api.removeFavorite(id)
    setFavorites(prev => prev.filter(f => f.id !== id))
  }

  const handleSaveNote = async (id) => {
    await api.updateFavorite(id, { notering: noteText })
    setFavorites(prev => prev.map(f => f.id === id ? { ...f, notering: noteText } : f))
    setEditingNote(null)
    setNoteText('')
  }

  const handleRemoveBlacklist = async (id) => {
    await api.removeFromBlacklist(id)
    setBlacklist(prev => prev.filter(b => b.id !== id))
  }

  const handleAddBlacklist = async () => {
    if (!blForm.kanalnamn.trim()) return
    await api.addToBlacklist(blForm)
    setBlForm({ namn: '', kanalnamn: '', plattform: 'youtube', anledning: '' })
    setShowAddBlacklist(false)
    await loadAll()
  }

  const handleDeleteSearch = async (id) => {
    await api.deleteSavedSearch(id)
    setSavedSearches(prev => prev.filter(s => s.id !== id))
  }

  const handleManualImport = async () => {
    if (!importForm.foretag_id || !importForm.namn || !importForm.kanalnamn) return
    setImportLoading(true)
    setImportResult(null)
    try {
      const result = await api.manualImportInfluencer(importForm)
      setImportResult({ ...result, importedName: importForm.namn })
      // Reset form but keep foretag_id
      setImportForm(prev => ({
        foretag_id: prev.foretag_id, namn: '', kanalnamn: '', plattform: 'youtube', foljare: '', nisch: '',
        kontakt_epost: '', skapa_avtal: true, kontaktperson: '', avtal_status: 'aktivt',
        videos_required: 5, videos_delivered: 0, total_signups: 0, notes: '',
      }))
    } catch (err) {
      setImportResult({ error: err.message })
    } finally { setImportLoading(false) }
  }

  const SECTIONS = [
    { key: 'import', label: 'Lägg till samarbete', icon: UserPlus, count: null },
    { key: 'favorites', label: 'Favoriter', icon: Heart, count: favorites.length },
    { key: 'blacklist', label: 'Blacklist', icon: Ban, count: blacklist.length },
    { key: 'searches', label: 'Sparade sökningar', icon: Search, count: savedSearches.length },
  ]

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Section toggles */}
      <div className="flex items-center gap-2">
        {SECTIONS.map(s => (
          <button key={s.key}
            onClick={() => setActiveSection(s.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              activeSection === s.key
                ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                : 'text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600'
            }`}>
            <s.icon className="w-3.5 h-3.5" />
            {s.label}
            {s.count > 0 && (
              <span className="text-[10px] bg-gray-800 px-1.5 py-0.5 rounded-full">{s.count}</span>
            )}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={loadAll} className="text-gray-500 hover:text-white p-1.5 rounded-lg transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ─── MANUELL IMPORT ─── */}
      {activeSection === 'import' && (
        <div className="space-y-4">
          <div className="bg-gradient-to-br from-purple-900/20 to-gray-900 rounded-xl border border-purple-500/20 p-5">
            <div className="flex items-center gap-2 mb-4">
              <UserPlus className="w-5 h-5 text-purple-400" />
              <h3 className="text-sm font-semibold text-white">Lägg till befintligt samarbete</h3>
            </div>
            <p className="text-xs text-gray-400 mb-5">
              Lägg till en influencer du redan jobbar med. Avtal, konversationstråd och uppföljning skapas automatiskt.
            </p>

            {importResult && (
              <div className={`rounded-lg p-3 mb-4 flex items-center gap-2 text-sm ${importResult.error ? 'bg-red-500/10 border border-red-500/30 text-red-300' : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'}`}>
                {importResult.error ? <AlertCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                {importResult.error
                  ? importResult.error
                  : `${importResult.importedName || 'Influencern'} importerad! Referral-kod: ${importResult.referral_kod}${importResult.kontrakt_id ? ' · Avtal skapat' : ''}`}
              </div>
            )}

            {/* Företag-val */}
            <div className="mb-4">
              <label className="text-xs text-gray-400 mb-1 block">Företag *</label>
              <select value={importForm.foretag_id} onChange={(e) => setImportForm(s => ({ ...s, foretag_id: Number(e.target.value) }))}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none">
                {foretagList.map(f => <option key={f.id} value={f.id}>{f.namn}</option>)}
              </select>
            </div>

            {/* Influencer-info */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Namn *</label>
                <input value={importForm.namn} onChange={(e) => setImportForm(s => ({ ...s, namn: e.target.value }))}
                  placeholder="T.ex. PewDiePie"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Kanalnamn *</label>
                <input value={importForm.kanalnamn} onChange={(e) => setImportForm(s => ({ ...s, kanalnamn: e.target.value }))}
                  placeholder="@kanalnamn"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Plattform</label>
                <select value={importForm.plattform} onChange={(e) => setImportForm(s => ({ ...s, plattform: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none">
                  <option value="youtube">YouTube</option>
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Följare</label>
                <input value={importForm.foljare} onChange={(e) => setImportForm(s => ({ ...s, foljare: e.target.value }))}
                  placeholder="T.ex. 50000"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Nisch</label>
                <input value={importForm.nisch} onChange={(e) => setImportForm(s => ({ ...s, nisch: e.target.value }))}
                  placeholder="Gaming, Esports..."
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none" />
              </div>
            </div>

            <div className="mb-4">
              <label className="text-xs text-gray-400 mb-1 block">E-post</label>
              <input type="email" value={importForm.kontakt_epost} onChange={(e) => setImportForm(s => ({ ...s, kontakt_epost: e.target.value }))}
                placeholder="influencer@email.com"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none" />
              <p className="text-[10px] text-gray-600 mt-1">E-post krävs för konversationsspårning och uppföljning via Gmail.</p>
            </div>

            {/* Avtal-sektion */}
            <div className="border-t border-gray-800 pt-4 mt-4">
              <div className="flex items-center gap-3 mb-4">
                <button
                  onClick={() => setImportForm(s => ({ ...s, skapa_avtal: !s.skapa_avtal }))}
                  className={`relative w-10 h-5 rounded-full transition-colors ${importForm.skapa_avtal ? 'bg-purple-600' : 'bg-gray-700'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${importForm.skapa_avtal ? 'translate-x-5' : ''}`} />
                </button>
                <div>
                  <span className="text-sm text-white font-medium">Skapa avtal</span>
                  <p className="text-[10px] text-gray-500">Skapar kontrakt med standardvillkor (300 SEK/video, 10 SEK/signup)</p>
                </div>
              </div>

              {importForm.skapa_avtal && (
                <div className="space-y-3 pl-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Kontaktperson</label>
                      <input value={importForm.kontaktperson} onChange={(e) => setImportForm(s => ({ ...s, kontaktperson: e.target.value }))}
                        placeholder="Ditt namn"
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Avtalsstatus</label>
                      <select value={importForm.avtal_status} onChange={(e) => setImportForm(s => ({ ...s, avtal_status: e.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none">
                        <option value="aktivt">Aktivt</option>
                        <option value="signerat">Signerat</option>
                        <option value="genererat">Genererat (ej skickat)</option>
                        <option value="skickat">Skickat (väntar signering)</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Max videos</label>
                      <input type="number" value={importForm.videos_required} onChange={(e) => setImportForm(s => ({ ...s, videos_required: Number(e.target.value) }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Videos levererade</label>
                      <input type="number" value={importForm.videos_delivered} onChange={(e) => setImportForm(s => ({ ...s, videos_delivered: Number(e.target.value) }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Signups hittills</label>
                      <input type="number" value={importForm.total_signups} onChange={(e) => setImportForm(s => ({ ...s, total_signups: Number(e.target.value) }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Anteckningar</label>
                    <textarea value={importForm.notes} onChange={(e) => setImportForm(s => ({ ...s, notes: e.target.value }))}
                      rows={2} placeholder="T.ex. Påbörjat samarbete via DM, redan levererat 2 videos..."
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none resize-none" />
                  </div>
                </div>
              )}
            </div>

            {/* Submit */}
            <div className="flex items-center gap-3 mt-5 pt-4 border-t border-gray-800">
              <button onClick={handleManualImport} disabled={importLoading || !importForm.namn || !importForm.kanalnamn}
                className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors">
                {importLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Importera samarbete
              </button>
              <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                <FileText className="w-3 h-3" />
                {importForm.skapa_avtal ? 'Influencer + Avtal + Konversation skapas' : 'Influencer + Konversation skapas'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── FAVORITER ─── */}
      {activeSection === 'favorites' && (
        <div className="space-y-3">
          {favorites.length === 0 ? (
            <div className="text-center py-12">
              <Heart className="w-10 h-10 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-400 font-medium">Inga favoriter sparade</p>
              <p className="text-xs text-gray-600 mt-1">Spara influencers som favoriter i sökresultaten för att komma tillbaka till dem senare.</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {favorites.map(fav => (
                <div key={fav.id} className="bg-gray-800/40 rounded-lg border border-gray-700/50 p-3 flex items-start gap-3 group">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    {platformIcon(fav.plattform)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{fav.namn}</span>
                      {fav.kanalnamn && <span className="text-xs text-gray-500">@{fav.kanalnamn}</span>}
                      {fav.foljare && <span className="text-[10px] text-gray-600">{Number(fav.foljare).toLocaleString('sv-SE')} följare</span>}
                    </div>
                    {fav.nisch && <p className="text-xs text-gray-500 mt-0.5">{fav.nisch}</p>}
                    {fav.kontakt_epost && <p className="text-xs text-gray-600 mt-0.5">{fav.kontakt_epost}</p>}

                    {/* Notering */}
                    {editingNote === fav.id ? (
                      <div className="flex gap-2 mt-2">
                        <input
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          placeholder="Skriv en notering..."
                          className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-purple-500 focus:outline-none"
                          autoFocus
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveNote(fav.id)}
                        />
                        <button onClick={() => handleSaveNote(fav.id)} className="text-xs text-purple-400 hover:text-purple-300">Spara</button>
                        <button onClick={() => setEditingNote(null)} className="text-xs text-gray-500">Avbryt</button>
                      </div>
                    ) : fav.notering ? (
                      <p className="text-xs text-amber-400/60 mt-1.5 flex items-center gap-1 cursor-pointer hover:text-amber-300"
                        onClick={() => { setEditingNote(fav.id); setNoteText(fav.notering || '') }}>
                        <StickyNote className="w-3 h-3" /> {fav.notering}
                      </p>
                    ) : null}

                    <p className="text-[10px] text-gray-600 mt-1">
                      <Clock className="w-2.5 h-2.5 inline mr-0.5" />
                      Sparad {new Date(fav.created_at).toLocaleDateString('sv-SE')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setEditingNote(fav.id); setNoteText(fav.notering || '') }}
                      className="text-gray-500 hover:text-white p-1 rounded" title="Notering">
                      <StickyNote className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleRemoveFavorite(fav.id)}
                      className="text-gray-500 hover:text-red-400 p-1 rounded" title="Ta bort">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── BLACKLIST ─── */}
      {activeSection === 'blacklist' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">Influencers på blacklist filtreras bort automatiskt från sökresultat.</p>
            <button onClick={() => setShowAddBlacklist(!showAddBlacklist)}
              className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 px-2 py-1 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 transition-colors">
              <Plus className="w-3 h-3" /> Lägg till
            </button>
          </div>

          {showAddBlacklist && (
            <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Namn</label>
                  <input value={blForm.namn} onChange={(e) => setBlForm(s => ({ ...s, namn: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:border-purple-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Kanalnamn *</label>
                  <input value={blForm.kanalnamn} onChange={(e) => setBlForm(s => ({ ...s, kanalnamn: e.target.value }))}
                    placeholder="@kanalnamn"
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:border-purple-500 focus:outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Plattform</label>
                  <select value={blForm.plattform} onChange={(e) => setBlForm(s => ({ ...s, plattform: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:border-purple-500 focus:outline-none">
                    <option value="youtube">YouTube</option>
                    <option value="instagram">Instagram</option>
                    <option value="tiktok">TikTok</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Anledning</label>
                  <input value={blForm.anledning} onChange={(e) => setBlForm(s => ({ ...s, anledning: e.target.value }))}
                    placeholder="T.ex. avböjde, dålig match..."
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:border-purple-500 focus:outline-none" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddBlacklist}
                  className="text-xs bg-red-600/80 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg transition-colors">
                  Blacklista
                </button>
                <button onClick={() => setShowAddBlacklist(false)} className="text-xs text-gray-400 hover:text-white px-3 py-1.5">Avbryt</button>
              </div>
            </div>
          )}

          {blacklist.length === 0 && !showAddBlacklist ? (
            <div className="text-center py-12">
              <ShieldOff className="w-10 h-10 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-400 font-medium">Ingen på blacklist</p>
              <p className="text-xs text-gray-600 mt-1">Influencers som avböjt eller du vill undvika hamnar här.</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {blacklist.map(bl => (
                <div key={bl.id} className="bg-red-500/5 rounded-lg border border-red-500/20 p-3 flex items-center gap-3 group">
                  <Ban className="w-4 h-4 text-red-400/50 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {platformIcon(bl.plattform)}
                      <span className="text-sm text-white">{bl.namn || bl.kanalnamn}</span>
                      {bl.kanalnamn && bl.namn && <span className="text-xs text-gray-500">@{bl.kanalnamn}</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {bl.anledning && <span className="text-xs text-red-400/60">{bl.anledning}</span>}
                      <span className="text-[10px] text-gray-600">{new Date(bl.created_at).toLocaleDateString('sv-SE')}</span>
                    </div>
                  </div>
                  <button onClick={() => handleRemoveBlacklist(bl.id)}
                    className="text-gray-600 hover:text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-all" title="Ta bort från blacklist">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── SPARADE SÖKNINGAR ─── */}
      {activeSection === 'searches' && (
        <div className="space-y-3">
          {savedSearches.length === 0 ? (
            <div className="text-center py-12">
              <Search className="w-10 h-10 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-400 font-medium">Inga sparade sökningar</p>
              <p className="text-xs text-gray-600 mt-1">Spara dina sökinställningar i wizarden för att enkelt köra dem igen.</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {savedSearches.map(s => {
                let params = {}
                try { params = JSON.parse(s.sok_parametrar) } catch {}
                return (
                  <div key={s.id} className="bg-gray-800/40 rounded-lg border border-gray-700/50 p-3 flex items-center gap-3 group">
                    <Search className="w-4 h-4 text-purple-400/50 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-white">{s.namn}</span>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {params.nischer && <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">{params.nischer}</span>}
                        {params.platforms?.map(p => (
                          <span key={p} className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">{p}</span>
                        ))}
                        {s.resultat_count > 0 && <span className="text-[10px] text-gray-600">{s.resultat_count} resultat</span>}
                        <span className="text-[10px] text-gray-600">
                          <Clock className="w-2.5 h-2.5 inline mr-0.5" />
                          {s.senast_kord ? new Date(s.senast_kord).toLocaleDateString('sv-SE') : 'Aldrig körd'}
                        </span>
                      </div>
                    </div>
                    <button onClick={() => handleDeleteSearch(s.id)}
                      className="text-gray-600 hover:text-red-400 p-1 rounded opacity-0 group-hover:opacity-100 transition-all">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
