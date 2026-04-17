import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Search, Loader2, ArrowRight, ArrowLeft, Users, Youtube, ExternalLink, CheckCircle, Check, ArrowUpDown, Filter, Instagram, X, Heart, Ban, ShieldCheck, ShieldAlert, Database, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'
import * as api from '../../services/api'

const getChannelUrl = (kanalnamn, plattform) => {
  const name = (kanalnamn || '').replace(/^@/, '')
  const p = (plattform || '').toLowerCase()
  if (p.includes('tiktok')) return `https://tiktok.com/@${name}`
  if (p.includes('instagram')) return `https://instagram.com/${name}`
  if (p.includes('twitch')) return `https://twitch.tv/${name}`
  return `https://youtube.com/@${name}`
}

const PLATTFORMAR = [
  { id: 'youtube', label: 'YouTube', icon: '▶️', color: 'bg-red-500/20 text-red-300 border-red-500/30' },
  { id: 'tiktok', label: 'TikTok', icon: '🎵', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  { id: 'instagram', label: 'Instagram', icon: '📸', color: 'bg-pink-500/20 text-pink-300 border-pink-500/30' },
]

const formatNumber = (n) => {
  if (!n || n === 0) return null
  if (n >= 1000000000) return `${(n / 1000000000).toFixed(1)}B`
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return n.toString()
}

// Prisriktlinjer baserat på svensk marknad (SEK per sponsrad video)
function getPriceEstimate(followers, nisch) {
  const n = nisch?.toLowerCase() || ''
  // Nisch-multiplikator (gaming/tech betalar lägre per video, finans/hälsa högre)
  let nischMultiplier = 1.0
  if (n.includes('finans') || n.includes('affär') || n.includes('investering')) nischMultiplier = 1.4
  else if (n.includes('hälsa') || n.includes('fitness') || n.includes('mat')) nischMultiplier = 1.2
  else if (n.includes('gaming') || n.includes('spel')) nischMultiplier = 0.8
  else if (n.includes('tech') || n.includes('teknik')) nischMultiplier = 1.1
  else if (n.includes('underhåll') || n.includes('vlogg') || n.includes('livsstil')) nischMultiplier = 1.0

  // Grundpris baserat på följarantal (svensk marknad)
  let baseLow, baseHigh
  if (followers < 5000) { baseLow = 500; baseHigh = 1500 }
  else if (followers < 10000) { baseLow = 1000; baseHigh = 3000 }
  else if (followers < 25000) { baseLow = 2000; baseHigh = 5000 }
  else if (followers < 50000) { baseLow = 3000; baseHigh = 8000 }
  else if (followers < 100000) { baseLow = 5000; baseHigh = 15000 }
  else if (followers < 250000) { baseLow = 10000; baseHigh = 30000 }
  else if (followers < 500000) { baseLow = 20000; baseHigh = 50000 }
  else if (followers < 1000000) { baseLow = 40000; baseHigh = 100000 }
  else { baseLow = 80000; baseHigh = 250000 }

  const low = Math.round(baseLow * nischMultiplier / 100) * 100
  const high = Math.round(baseHigh * nischMultiplier / 100) * 100

  return { low, high }
}

export default function Step2HittaInfluencers({ foretag, outreachType, influencers, setInfluencers, setMessages, setOutreachBrief, next, prev }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sortBy, setSortBy] = useState('score_desc')
  const [filterNisch, setFilterNisch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [editingEmailId, setEditingEmailId] = useState(null)
  const [editingEmailValue, setEditingEmailValue] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState(['youtube', 'instagram', 'tiktok'])
  const [searchMeta, setSearchMeta] = useState(null)
  const [directSearch, setDirectSearch] = useState('')
  const abortRef = useRef(null)
  const prevOutreachType = useRef(outreachType)

  const isSponsor = outreachType === 'sponsor'

  // Rensa influencers när användaren byter flöde (influencer ↔ sponsor)
  useEffect(() => {
    if (prevOutreachType.current !== outreachType) {
      prevOutreachType.current = outreachType
      setInfluencers([])
      setSearchMeta(null)
      setError('')
      setDirectSearch('')
    }
  }, [outreachType, setInfluencers])

  const cancelSearch = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setLoading(false)
    setError('Sökningen avbröts')
  }, [])

  const togglePlatform = (id) => {
    setSelectedPlatforms(prev => {
      if (prev.includes(id)) {
        return prev.length > 1 ? prev.filter(p => p !== id) : prev // Minst en vald
      }
      return [...prev, id]
    })
  }

  const handleDirectSearch = async () => {
    if (!directSearch.trim() || !foretag?.id) return
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError('')
    try {
      if (isSponsor) {
        // Sponsor-sökning: sök företag direkt
        const results = await api.searchSponsorDirect(directSearch.trim(), foretag.id)
        if (results?.length > 0) {
          setInfluencers(prev => {
            const existingNames = new Set(prev.map(i => i.namn?.toLowerCase()))
            const newResults = results
              .filter(r => !existingNames.has(r.namn?.toLowerCase()))
              .map(p => ({
                ...p,
                kanalnamn: p.hemsida ? p.hemsida.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : p.namn,
                plattform: 'Företag',
                foljare: '-',
                foljare_exakt: 0,
                nisch: p.bransch || 'B2B',
                kontakt_epost: p.epost,
                kontakt_info: p.hemsida,
                telefon: p.telefon || null,
                betyg: p.betyg || null,
                kalla: p.kalla || 'google_maps',
                hemsida: p.hemsida || null,
                thumbnail: null,
                beskrivning: p.bransch || '',
                datakalla: p.kalla === 'google_maps' ? 'google_maps' : 'ai_sponsor',
                verifierad: p.kalla === 'google_maps',
                videoCount: 0,
                viewCount: 0,
                _isSponsor: true,
                vald: 0,
              }))
            return [...newResults, ...prev]
          })
        } else {
          setError(`Inga företag hittades för "${directSearch}"`)
        }
      } else {
        // Influencer-sökning: sök på alla plattformar via Apify + YouTube
        const results = await api.searchInfluencerDirect(directSearch.trim(), foretag.id)
        if (results?.length > 0) {
          // Append nya resultat till befintliga (dedup på kanalnamn + plattform)
          setInfluencers(prev => {
            const mapped = results.map(r => ({ ...r, vald: 0 }))
            if (prev.length === 0) return mapped
            const existingKeys = new Set(prev.map(i => `${(i.kanalnamn || i.namn || '').toLowerCase()}_${(i.plattform || '').toLowerCase()}`))
            const newResults = mapped.filter(r => !existingKeys.has(`${(r.kanalnamn || r.namn || '').toLowerCase()}_${(r.plattform || '').toLowerCase()}`))
            if (newResults.length === 0) return prev
            return [...newResults, ...prev]
          })
        } else {
          setError(`Inga resultat för "${directSearch}"`)
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err.message)
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  // Re-scora alla influencers i en enda Claude-batch för konsistenta scores
  const rescoreAll = async (allInfluencers, foretagId) => {
    try {
      console.log(`[Steg2] Re-scorear ${allInfluencers.length} influencers för konsistenta scores...`)
      const result = await api.rescoreInfluencers(foretagId, allInfluencers)
      if (result.scores?.length > 0) {
        const scoreMap = new Map(result.scores.map(s => [s.id, s]))
        setInfluencers(prev => prev.map(inf => {
          const updated = scoreMap.get(inf.id)
          if (!updated) return inf
          return {
            ...inf,
            match_score: updated.match_score,
            ai_motivation: updated.ai_motivation || inf.ai_motivation,
          }
        }))
        console.log(`[Steg2] ✅ Re-scoring klar — ${result.scores.length} uppdaterade`)
      }
    } catch (err) {
      console.warn(`[Steg2] Re-scoring misslyckades (ej kritiskt):`, err.message)
    }
  }

  const handleFind = async ({ append = false } = {}) => {
    if (!foretag?.id) {
      setError('Företagsprofil saknas. Gå tillbaka till Steg 1.')
      return
    }
    // Avbryt ev. pågående sökning
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError('')
    try {
      if (isSponsor) {
        // Vid "Hitta fler" — skicka med redan hittade företagsnamn
        const excludeNames = append
          ? influencers.map(i => (i.namn || '').toLowerCase()).filter(Boolean)
          : []
        const prospects = await api.findSponsorProspects(foretag.id, excludeNames.length > 0 ? excludeNames : undefined)
        const saved = await api.getSponsorProspects(foretag.id)
        const mapped = saved.map(p => ({
          ...p,
          namn: p.namn,
          kanalnamn: p.hemsida ? p.hemsida.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : p.namn,
          plattform: 'Företag',
          foljare: '-',
          foljare_exakt: 0,
          nisch: p.bransch || 'B2B',
          kontakt_epost: p.epost,
          kontakt_info: p.hemsida,
          telefon: p.telefon || null,
          betyg: p.betyg || null,
          kalla: p.kalla || 'ai',
          hemsida: p.hemsida || null,
          thumbnail: null,
          beskrivning: p.bransch || '',
          datakalla: p.kalla === 'google_maps' ? 'google_maps' : 'ai_sponsor',
          verifierad: p.kalla === 'google_maps',
          videoCount: 0,
          viewCount: 0,
          _isSponsor: true,
        }))
        if (append) {
          // "Hitta fler" — append utan att ta bort befintliga
          setInfluencers(prev => {
            const existingNames = new Set(prev.map(i => i.namn?.toLowerCase()))
            const newResults = mapped.filter(r => !existingNames.has(r.namn?.toLowerCase()))
            if (newResults.length === 0) return prev
            return [...prev, ...newResults]
          })
        } else {
          // Ny sökning — ersätt alla
          setInfluencers(mapped)
        }
      } else {
        // ─── PRIMÄR: Phyllo + YouTube pipeline (verifierad data) ───
        let pipelineWorked = false
        let briefAnswers = {}
        try {
          const profile = foretag.company_profile ? JSON.parse(foretag.company_profile) : {}
          briefAnswers = profile.brief_answers || {}
        } catch { /* OK */ }

        try {
          // Vid "Hitta fler" — skicka med befintliga handles så AI:n inte genererar dubbletter
          const excludeHandles = append
            ? influencers.map(i => (i.kanalnamn || i.namn || '').toLowerCase()).filter(Boolean)
            : []
          console.log(`[Steg2] ${append ? 'Hitta fler' : 'Primär'} sökning: Phyllo + YouTube pipeline...${excludeHandles.length ? ` (exkluderar ${excludeHandles.length} befintliga)` : ''}`)
          const searchResult = await api.searchInfluencers(foretag.id, selectedPlatforms, {
            min_followers: 1000,
            min_engagement: briefAnswers.min_engagement || null,
            max_price: briefAnswers.budget ? parseInt(briefAnswers.budget) : null,
          }, excludeHandles.length > 0 ? excludeHandles : undefined, append)

          if (searchResult.results?.length > 0) {
            const results = searchResult.results.map(inf => ({
              ...inf,
              kanalnamn: (inf.kanalnamn || '').replace(/^@+/, ''),
              selected: false,
              vald: inf.vald || 0,
            }))
            results.sort((a, b) => (b.match_score || 0) - (a.match_score || 0))
            if (append) {
              // "Hitta fler" — append utan att ta bort befintliga (dedup), sen re-scora ALLA
              setInfluencers(prev => {
                if (prev.length === 0) return results
                const existingKeys = new Set(prev.map(i => `${(i.kanalnamn || i.namn || '').toLowerCase()}_${(i.plattform || '').toLowerCase()}`))
                const newResults = results.filter(r => !existingKeys.has(`${(r.kanalnamn || r.namn || '').toLowerCase()}_${(r.plattform || '').toLowerCase()}`))
                if (newResults.length === 0) return prev
                const combined = [...prev, ...newResults]
                // Re-scora ALLA i bakgrunden så scores blir jämförbara
                rescoreAll(combined, foretag.id)
                return combined
              })
            } else {
              // Ny sökning — ersätt alla pipeline-resultat (behåll manuellt sökta)
              setInfluencers(results)
            }
            const isAIPowered = !!(searchResult.sources?.ai_web_search)
            setSearchMeta({
              sources: searchResult.sources || {},
              ai_powered: isAIPowered,
              phyllo_active: searchResult.phyllo_active,
              total: results.length,
            })
            pipelineWorked = true
            console.log(`[Steg2] Pipeline lyckades! ${results.length} influencers (Phyllo: ${searchResult.phyllo_active ? 'JA' : 'NEJ'}).`)
          }
        } catch (pipeErr) {
          console.warn('[Steg2] Pipeline-sökning misslyckades:', pipeErr.message)
          // Visa det faktiska felet från backend
          const errMsg = pipeErr.message || ''
          if (errMsg.includes('API-nyckel') || errMsg.includes('API-krediter') || errMsg.includes('401') || errMsg.includes('403')) {
            setError(`Sökningen misslyckades: ${errMsg}`)
          } else if (errMsg.includes('misslyckades')) {
            setError(errMsg)
          } else {
            setError('Sökningen misslyckades. Kontrollera att du har API-credits (Anthropic) eller YouTube API-nyckel.')
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return // Avbruten av användaren
      setError(err.message)
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  const allCategories = useMemo(() => {
    const cats = new Set()
    influencers.forEach(inf => {
      (inf.nisch || '').split(',').forEach(c => {
        const trimmed = c.trim()
        if (trimmed && trimmed !== 'Övrigt') cats.add(trimmed)
      })
    })
    return [...cats].sort()
  }, [influencers])

  const displayList = useMemo(() => {
    let list = [...influencers]
    if (filterNisch === '__has_email') {
      list = list.filter(inf => inf.kontakt_epost)
    } else if (filterNisch === '__no_email') {
      list = list.filter(inf => !inf.kontakt_epost)
    } else if (filterNisch.startsWith('__platform_')) {
      const plat = filterNisch.replace('__platform_', '')
      list = list.filter(inf => (inf.plattform || '').toLowerCase().includes(plat))
    } else if (filterNisch) {
      list = list.filter(inf => (inf.nisch || '').includes(filterNisch))
    }
    if (sortBy === 'score_desc') {
      list.sort((a, b) => (b.match_score || 0) - (a.match_score || 0))
    } else if (sortBy === 'foljare_desc') {
      list.sort((a, b) => (b.foljare_exakt || 0) - (a.foljare_exakt || 0))
    } else if (sortBy === 'foljare_asc') {
      list.sort((a, b) => (a.foljare_exakt || 0) - (b.foljare_exakt || 0))
    }
    return list
  }, [influencers, sortBy, filterNisch])

  const selectedCount = influencers.filter(i => i.vald).length
  const withEmail = influencers.filter(i => i.kontakt_epost).length

  // Kolla om influencers kommer från AI (inte sparade i DB)
  const isAiResults = influencers.length > 0 && String(influencers[0]?.id).startsWith('ai-')

  const toggleOne = async (id) => {
    // Blockera markering om profilen saknar e-post
    const inf = influencers.find(i => i.id === id)
    if (inf && !inf.kontakt_epost && !inf._isSponsor) return

    // Alltid toggla lokalt FÖRST — snabb respons i UI
    setInfluencers(prev => prev.map(i => i.id === id ? { ...i, vald: i.vald ? 0 : 1 } : i))

    // Synca till DB i bakgrunden (om det är DB-id:n)
    if (!isAiResults && typeof id === 'number') {
      try {
        if (isSponsor) {
          await api.toggleSponsorProspect(id)
        } else {
          await api.toggleInfluencer(id)
        }
      } catch (err) {
        console.error('[Toggle] API sync misslyckades:', err)
      }
    }
  }

  const selectAll = async (val) => {
    // Alltid uppdatera lokalt FÖRST — snabb respons. Skippa profiler utan e-post.
    const visibleIds = new Set(displayList.map(i => i.id))
    setInfluencers(prev => prev.map(i => {
      if (!visibleIds.has(i.id)) return i
      if (!i.kontakt_epost && !i._isSponsor && val) return i // kan inte markeras utan e-post
      return { ...i, vald: val ? 1 : 0 }
    }))

    // Synca till DB i bakgrunden
    if (!isAiResults && foretag?.id) {
      try {
        if (isSponsor) {
          await api.selectAllProspects(foretag.id, val)
        } else {
          await api.selectAllInfluencers(foretag.id, val)
        }
      } catch (err) {
        console.error('[SelectAll] API sync misslyckades:', err)
      }
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 mb-6">
        <Search className={`w-6 h-6 ${isSponsor ? 'text-blue-500' : 'text-purple-500'}`} />
        <h2 className="text-xl font-bold">Steg 2: Hitta & Välj {isSponsor ? 'Sponsorer' : 'Influencers'}</h2>
      </div>

      <p className="text-gray-400 mb-4">
        {isSponsor
          ? <>Sök företag eller sponsor direkt, eller låt AI hitta relevanta för <span className="text-blue-400 font-medium">{foretag?.namn}</span>.</>
          : <>Sök influencer direkt, eller låt AI hitta relevanta för <span className="text-purple-400 font-medium">{foretag?.namn}</span>.</>
        }
      </p>

      {/* Plattformsväljare — bara för influencer-flödet */}
      {!isSponsor && (
        <div className="mb-4">
          <p className="text-xs text-gray-500 mb-2">Välj plattformar att söka på:</p>
          <div className="flex gap-2">
            {PLATTFORMAR.map(p => {
              const isSelected = selectedPlatforms.includes(p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => togglePlatform(p.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                    isSelected
                      ? p.color + ' border-opacity-100'
                      : 'bg-gray-800/30 text-gray-500 border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <span>{p.icon}</span>
                  <span>{p.label}</span>
                  {isSelected && <Check className="w-3.5 h-3.5" />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* AI auto-find — HERO CTA */}
      <div className="mb-6 space-y-4">
        <button
          onClick={handleFind}
          disabled={loading}
          className={`w-full flex items-center justify-center gap-3 ${
            isSponsor
              ? 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 shadow-blue-500/20'
              : 'bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 shadow-purple-500/20'
          } disabled:opacity-50 text-white px-6 py-4 rounded-xl font-semibold text-base transition-all shadow-lg`}
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
          Hitta {isSponsor ? 'sponsorer' : 'influencers'} automatiskt med AI
        </button>
        <p className="text-center text-xs text-gray-500">
          AI analyserar {foretag?.namn || 'ditt företag'} och hittar de mest relevanta {isSponsor ? 'sponsorerna' : 'influencers'} automatiskt.
          Sökningen kan ta 1–2 minuter.
        </p>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-700"></div>
          <span className="text-xs text-gray-500">eller sök manuellt</span>
          <div className="flex-1 h-px bg-gray-700"></div>
        </div>

        {/* Manuell sökning — sekundär */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={directSearch}
              onChange={(e) => setDirectSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDirectSearch()}
              placeholder={isSponsor ? 'Sök företag, varumärke eller bransch...' : 'Sök influencer, kanal eller @handle...'}
              className={`w-full bg-gray-800/50 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none ${isSponsor ? 'focus:border-blue-500' : 'focus:border-purple-500'}`}
            />
          </div>
          <button
            onClick={handleDirectSearch}
            disabled={loading || !directSearch.trim()}
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Sök
          </button>
          {loading && (
            <button
              onClick={cancelSearch}
              className="flex items-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-red-500/30"
            >
              <X className="w-4 h-4" /> Avbryt
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="bg-gray-800/50 rounded-lg p-4 mb-4 border border-gray-700">
          <div className="flex items-center gap-3 mb-2">
            <Loader2 className={`w-4 h-4 animate-spin ${isSponsor ? 'text-blue-400' : 'text-purple-400'}`} />
            <span className="text-sm text-gray-300">{isSponsor ? 'Söker företag/sponsorer...' : 'Söker influencers...'}</span>
          </div>
          <div className="space-y-1 text-xs text-gray-500 ml-7">
            {isSponsor ? (
              <>
                <p>1. AI analyserar din beskrivning: <span className="text-blue-400">{foretag?.beskrivning?.slice(0, 60) || foretag?.bransch || 'din profil'}{foretag?.beskrivning?.length > 60 ? '...' : ''}</span></p>
                <p>2. Söker riktiga svenska företag via Google Maps</p>
                <p>3. AI rankar och samlar kontaktinformation</p>
              </>
            ) : (
              <>
                <p>1. AI analyserar din beskrivning: <span className="text-purple-400">{foretag?.beskrivning?.slice(0, 60) || foretag?.bransch || 'din profil'}{foretag?.beskrivning?.length > 60 ? '...' : ''}</span></p>
                <p>2. Söker på: <span className="text-purple-400">{selectedPlatforms.map(p => PLATTFORMAR.find(x => x.id === p)?.label).join(', ')}</span></p>
                {selectedPlatforms.includes('youtube') && <p>3. YouTube Data API v3 hämtar verifierad kanaldata</p>}
                {selectedPlatforms.some(p => p !== 'youtube') && <p>4. SerpAPI + Apify verifierar Instagram/TikTok-profiler</p>}
                <p>5. AI rankar resultat och söker e-postadresser via SerpAPI</p>
              </>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {influencers.length > 0 && (
        <div className="space-y-2">
          {/* Status-rad */}
          <div className="flex items-center gap-4 bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 mb-2">
            <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
            <div className="text-sm">
              <p className="text-green-300 font-medium">
                {influencers.length} profiler hittade · {withEmail} med e-post
                {(() => {
                  const verified = influencers.filter(i => i.verifierad || i.datakalla === 'youtube_api').length
                  const aiGen = influencers.filter(i => i.datakalla === 'ai_genererad').length
                  if (verified > 0 && aiGen > 0) return ` · ${verified} API-verifierade · ${aiGen} AI-genererade`
                  if (aiGen > 0) return ` · ${aiGen} AI-genererade`
                  return ''
                })()}
              </p>
            </div>
          </div>

          {/* Hitta fler-knapp */}
          {!loading && (
            <button
              onClick={() => handleFind({ append: true })}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                isSponsor
                  ? 'border-blue-500/40 text-blue-400 hover:bg-blue-500/10'
                  : 'border-purple-500/40 text-purple-400 hover:bg-purple-500/10'
              }`}
            >
              <Search className="w-4 h-4" />
              Hitta fler {isSponsor ? 'företag' : 'influencers'}
            </button>
          )}

          {/* Sortering + filter + välj alla */}
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <ArrowUpDown className="w-4 h-4 text-gray-500" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 focus:border-purple-500 focus:outline-none"
                >
                  <option value="score_desc">AI matchning: bäst först</option>
                  {!isSponsor && <option value="foljare_desc">Följare: högst först</option>}
                  {!isSponsor && <option value="foljare_asc">Följare: lägst först</option>}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <Filter className="w-4 h-4 text-gray-500" />
                <select
                  value={filterNisch}
                  onChange={(e) => setFilterNisch(e.target.value)}
                  className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 focus:border-purple-500 focus:outline-none"
                >
                  <option value="">Alla ({influencers.length})</option>
                  <option value="__has_email">Med e-post ({withEmail})</option>
                  <option value="__no_email">Utan e-post ({influencers.length - withEmail})</option>
                  {!isSponsor && <option disabled>── Plattform ──</option>}
                  {!isSponsor && ['youtube', 'tiktok', 'instagram'].map(p => {
                    const count = influencers.filter(i => (i.plattform || '').toLowerCase().includes(p)).length
                    if (count === 0) return null
                    const label = p === 'youtube' ? 'YouTube' : p === 'tiktok' ? 'TikTok' : 'Instagram'
                    return <option key={p} value={`__platform_${p}`}>{label} ({count})</option>
                  })}
                  {allCategories.length > 0 && <option disabled>── Nisch ──</option>}
                  {allCategories.map(cat => (
                    <option key={cat} value={cat}>{cat} ({influencers.filter(i => (i.nisch || '').includes(cat)).length})</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-400">
                <span className="text-purple-400 font-bold">{selectedCount}</span> valda
              </span>
              <button onClick={() => selectAll(true)} className="text-xs text-purple-400 hover:text-purple-300">Välj alla</button>
              <span className="text-gray-700">|</span>
              <button onClick={() => selectAll(false)} className="text-xs text-gray-400 hover:text-gray-300">Avmarkera</button>
            </div>
          </div>

          <p className="text-xs text-gray-500 mb-2">Visar {displayList.length} av {influencers.length} {isSponsor ? 'sponsorer' : 'influencers'}</p>

          {/* Influencer-lista */}
          <div className="space-y-1 max-h-[36rem] overflow-y-auto pr-1">
            {displayList.map((inf) => (
              <div key={inf.id}>
                <div
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-colors ${
                    !inf.kontakt_epost && !inf._isSponsor
                      ? 'border-gray-800/30 bg-gray-900/30 opacity-60 cursor-default'
                      : inf.vald
                        ? 'border-purple-500/50 bg-purple-500/10 cursor-pointer'
                        : 'border-gray-800/50 bg-gray-800/20 hover:border-gray-700 cursor-pointer'
                  }`}
                  onClick={() => toggleOne(inf.id)}
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                    !inf.kontakt_epost && !inf._isSponsor
                      ? 'border-gray-700/50 bg-gray-800/30'
                      : inf.vald ? 'bg-purple-600 border-purple-600' : 'border-gray-600'
                  }`}>
                    {inf.vald ? <Check className="w-2.5 h-2.5 text-white" /> : null}
                  </div>

                  {inf.thumbnail ? (
                    <img src={inf.thumbnail} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-gray-700 flex-shrink-0" />
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-white text-sm leading-tight">{inf.namn}</span>
                      {/* Plattformsbadge */}
                      {(() => {
                        const plat = PLATTFORMAR.find(p => (inf.plattform || '').toLowerCase().includes(p.id))
                        return plat ? (
                          <span className={`text-[10px] px-1 py-0 rounded ${plat.color}`}>{plat.icon} {plat.label}</span>
                        ) : null
                      })()}
                      {/* Datakälla-badge — dölj för sponsors */}
                      {!inf._isSponsor && (
                        (inf.verifierad || inf.datakalla === 'youtube_api' || inf.datakalla === 'phyllo_api') ? (
                          <span className="text-[10px] px-1 py-0 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 flex items-center gap-0.5"
                            title={`Verifierad via ${inf.datakalla === 'phyllo_api' ? 'Phyllo' : 'YouTube API'} — riktig data`}>
                            <ShieldCheck className="w-2.5 h-2.5" /> Verifierad
                          </span>
                        ) : (inf.datakalla === 'ai_genererad' || inf.datakalla === 'ai_search') ? (
                          <span className="text-[10px] px-1 py-0 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 flex items-center gap-0.5"
                            title="AI-uppskattad data — följarantal och beskrivning kan avvika">
                            <ShieldAlert className="w-2.5 h-2.5" /> Uppskattad
                          </span>
                        ) : null
                      )}
                      {/* Sponsor: källa-badge + Google-betyg */}
                      {inf._isSponsor && (
                        <>
                          {inf.kalla === 'google_maps' && (
                            <span className="text-[10px] px-1 py-0 rounded bg-green-500/15 text-green-400 border border-green-500/20"
                              title="Hittad via Google — verifierat företag">Verifierat</span>
                          )}
                          {inf.betyg && (
                            <span className="text-[10px] px-1 py-0 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/20"
                              title={`Google-omdöme: ${inf.betyg} av 5 stjärnor`}>⭐ {inf.betyg}</span>
                          )}
                        </>
                      )}
                      {/* Länk: sponsors → hemsida, influencers → kanal */}
                      {inf._isSponsor ? (
                        inf.hemsida ? (
                          <a
                            href={inf.hemsida.startsWith('http') ? inf.hemsida : `https://${inf.hemsida}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-0.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {inf.kanalnamn} <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        ) : null
                      ) : (
                        <a
                          href={getChannelUrl(inf.kanalnamn, inf.plattform)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-purple-400 hover:text-purple-300 hover:underline flex items-center gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          @{inf.kanalnamn} <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                    {/* AI-motivering — visas i sin helhet (begränsad vid generering) */}
                    {inf.ai_motivation && (
                      <p className="text-[11px] text-purple-400/70 leading-tight mt-0.5">
                        <span className="text-purple-400/50 mr-0.5">✨</span>
                        {inf.ai_motivation}
                      </p>
                    )}
                  </div>

                  {/* Right side: score + followers + detaljer — tight group */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* AI Match Score */}
                    {inf.match_score != null && (
                      <div className="text-center w-12" title={`AI-bedömning av hur väl denna profil matchar din verksamhet (${inf.match_score}/100)`}>
                        <div className={`text-xs font-bold px-1 py-0 rounded-full ${
                          inf.match_score >= 70 ? 'bg-green-500/20 text-green-400' :
                          inf.match_score >= 40 ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-gray-700/50 text-gray-400'
                        }`}>
                          {inf.match_score}%
                        </div>
                      </div>
                    )}

                    {/* Följare — bara för influencers */}
                    {!inf._isSponsor && (
                      <div className="text-right w-16">
                        <div className="text-xs font-medium text-white leading-tight">{inf.foljare}</div>
                        <div className="text-[9px] text-gray-500 leading-tight">{(inf.plattform || '').toLowerCase().includes('youtube') ? 'pren.' : 'följare'}</div>
                      </div>
                    )}

                    {/* Ingen e-post — klickbar för manuell inmatning */}
                    {!inf.kontakt_epost && !inf._isSponsor && (
                      editingEmailId === inf.id ? (
                        <form
                          className="flex items-center gap-1"
                          onSubmit={async (e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            const email = editingEmailValue.trim()
                            if (!email || !email.includes('@')) return
                            try {
                              await api.saveEmail(inf.id, email)
                              setInfluencers(prev => prev.map(i => i.id === inf.id ? { ...i, kontakt_epost: email } : i))
                              setEditingEmailId(null)
                              setEditingEmailValue('')
                            } catch (err) {
                              console.error('Kunde inte spara e-post:', err)
                            }
                          }}
                        >
                          <input
                            type="email"
                            value={editingEmailValue}
                            onChange={(e) => setEditingEmailValue(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="namn@example.com"
                            autoFocus
                            className="text-[10px] w-40 px-1.5 py-0.5 rounded bg-gray-800 text-white border border-purple-500/50 focus:outline-none focus:border-purple-400"
                          />
                          <button type="submit" onClick={(e) => e.stopPropagation()} className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30">
                            Spara
                          </button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); setEditingEmailId(null); setEditingEmailValue('') }} className="text-[9px] px-1 py-0.5 text-gray-500 hover:text-gray-300">
                            ✕
                          </button>
                        </form>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingEmailId(inf.id); setEditingEmailValue('') }}
                          title={inf.plattform?.toLowerCase().includes('youtube') ? 'Kolla kanalens About-sida (Mer info) för e-post' : 'Klicka för att lägga till e-post manuellt'}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/30 whitespace-nowrap hover:bg-purple-500/20 hover:text-purple-300 cursor-pointer transition-colors"
                        >
                          + Lägg till e-post
                        </button>
                      )
                    )}

                    <button
                      onClick={(e) => { e.stopPropagation(); setExpandedId(expandedId === inf.id ? null : inf.id) }}
                      className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md border transition-all ${
                        expandedId === inf.id
                          ? 'text-purple-300 border-purple-500/50 bg-purple-500/15 shadow-sm shadow-purple-500/10'
                          : 'text-gray-300 border-gray-600 hover:text-white hover:border-purple-500/40 hover:bg-purple-500/10 bg-gray-800/70'
                      }`}
                    >
                      {expandedId === inf.id ? (
                        <><ChevronUp className="w-3.5 h-3.5" /> Stäng</>
                      ) : (
                        <><ChevronDown className="w-3.5 h-3.5" /> Detaljer</>
                      )}
                    </button>
                  </div>
                </div>

                {expandedId === inf.id && (() => {
                  const priceEst = inf.estimated_price_sek
                    ? { exact: inf.estimated_price_sek }
                    : getPriceEstimate(inf.foljare_exakt || 0, inf.nisch)
                  return (
                    <div className="ml-10 bg-gray-800/20 rounded-b-lg px-4 py-3 border border-t-0 border-gray-800/50 mb-1">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="space-y-2">
                          {inf.beskrivning && (
                            <div>
                              <span className="text-gray-500 block mb-1">Kontobiografi:</span>
                              <p className="text-gray-400 text-xs line-clamp-3">{inf.beskrivning}</p>
                            </div>
                          )}
                        </div>

                        <div className="space-y-1">
                          {inf._isSponsor ? (
                            <>
                              {inf.kontakt_epost && (
                                <p className="text-green-400"><span className="text-gray-500">E-post:</span> {inf.kontakt_epost}</p>
                              )}
                              {inf.telefon && (
                                <p className="text-gray-400"><span className="text-gray-500">Telefon:</span> {inf.telefon}</p>
                              )}
                              {inf.hemsida && (
                                <p className="text-gray-400"><span className="text-gray-500">Hemsida:</span> <a href={inf.hemsida.startsWith('http') ? inf.hemsida : `https://${inf.hemsida}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{inf.hemsida.replace(/^https?:\/\/(www\.)?/, '')}</a></p>
                              )}
                              {inf.betyg && (
                                <p className="text-gray-400"><span className="text-gray-500">Google-betyg:</span> <span className="text-yellow-400">⭐ {inf.betyg}</span></p>
                              )}
                              <p className="text-gray-400"><span className="text-gray-500">Källa:</span> {
                                inf.kalla === 'google_maps' ? '📍 Google Maps' : '🤖 AI-förslag'
                              }</p>
                            </>
                          ) : (
                            <>
                              {inf.foljare_exakt > 0 && (
                                <p className="text-gray-400"><span className="text-gray-500">Följare:</span> {inf.foljare_exakt?.toLocaleString('sv-SE')}</p>
                              )}
                              {inf.videoCount > 0 && (
                                <p className="text-gray-400"><span className="text-gray-500">Videos:</span> {formatNumber(inf.videoCount)}</p>
                              )}
                              {inf.kontakt_epost ? (
                                <p className="text-green-400"><span className="text-gray-500">E-post:</span> {inf.kontakt_epost}</p>
                              ) : inf.plattform?.toLowerCase().includes('youtube') ? (
                                <p className="text-yellow-400/70 text-[10px]"><span className="text-gray-500">E-post:</span> Saknas — kolla kanalens <a href={`${getChannelUrl(inf.kanalnamn, inf.plattform)}/about`} target="_blank" rel="noopener noreferrer" className="underline text-blue-400 hover:text-blue-300">About / Mer info</a>-sida</p>
                              ) : (
                                <p className="text-yellow-400/70 text-[10px]"><span className="text-gray-500">E-post:</span> Saknas</p>
                              )}
                              <p className="text-gray-400"><span className="text-gray-500">Källa:</span> {
                                inf.datakalla === 'youtube_api' ? '✅ YouTube API' :
                                inf.datakalla === 'ai_serp_search' ? '🔍 SerpAPI + AI' :
                                inf.datakalla === 'ai_web_search' ? '🌐 AI Web Search' :
                                inf.datakalla?.startsWith('apify_ig_discovery') ? '📸 Apify IG Discovery' :
                                inf.datakalla?.startsWith('apify_tt_discovery') ? '🎵 Apify TT Discovery' :
                                inf.datakalla?.startsWith('apify_') ? '✅ Apify' :
                                inf.datakalla === 'serpapi_direct' ? '🔍 SerpAPI' :
                                inf.datakalla === 'apify_instagram' ? '📸 Apify Instagram' :
                                inf.datakalla === 'apify_tiktok' ? '🎵 Apify TikTok' :
                                inf.datakalla || 'YouTube API'
                              }</p>
                              {inf.enrichment_kalla && (
                                <p className="text-gray-400"><span className="text-gray-500">Verifierad via:</span> {
                                  inf.enrichment_kalla.startsWith('apify_') ? '✅ Apify Profile Scraper' :
                                  inf.enrichment_kalla
                                }</p>
                              )}
                              {/* YouTube API ToS — attribution */}
                              {(inf.datakalla === 'youtube_api' || inf.plattform?.toLowerCase().includes('youtube')) && (
                                <p className="text-gray-500 text-[10px] mt-1 flex items-center gap-1">
                                  <svg viewBox="0 0 28 20" className="w-4 h-3 flex-shrink-0">
                                    <rect width="28" height="20" rx="4" fill="#FF0000"/>
                                    <polygon points="11,5 11,15 20,10" fill="white"/>
                                  </svg>
                                  Channel data provided by <a href="https://www.youtube.com/" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-400">YouTube</a>
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>
            ))}
          </div>

          {/* YouTube API ToS — global attribution footer */}
          {influencers.some(inf => inf.datakalla === 'youtube_api' || inf.plattform?.toLowerCase().includes('youtube')) && (
            <div className="mt-2 px-1 flex items-center gap-1.5 text-gray-500 text-[10px]">
              <svg viewBox="0 0 28 20" className="w-4 h-3 flex-shrink-0">
                <rect width="28" height="20" rx="4" fill="#FF0000"/>
                <polygon points="11,5 11,15 20,10" fill="white"/>
              </svg>
              <span>
                YouTube channel data provided by{' '}
                <a href="https://www.youtube.com/" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-400">YouTube</a>
                {' · '}
                <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-400">Terms of Service</a>
                {' · '}
                <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-400">Google Privacy Policy</a>
              </span>
            </div>
          )}

          {/* Sök fler-knapp för sponsors */}
          {isSponsor && influencers.length > 0 && (
            <div className="mt-3 flex justify-center">
              <button
                onClick={() => handleFind({ append: true })}
                disabled={loading}
                className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 px-4 py-2 rounded-lg border border-blue-500/30 hover:border-blue-500/50 bg-blue-500/5 hover:bg-blue-500/10 transition-colors disabled:opacity-50"
              >
                <Search className="w-4 h-4" />
                {loading ? 'Söker...' : 'Sök fler sponsorer'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Sticky bottom CTA */}
      <div className="sticky bottom-0 bg-gray-900 pt-4 pb-1 -mx-6 px-6 mt-4 border-t border-gray-800/50">
        <div className="flex gap-3">
          <button onClick={prev} className="flex items-center gap-2 text-gray-400 hover:text-white px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Tillbaka
          </button>
          {selectedCount > 0 && (
            <button
              onClick={async () => {
                // Om AI-resultat: spara till DB först så att Steg 4 (outreach-generering) kan hitta dem
                if (isAiResults && foretag?.id) {
                  try {
                    if (isSponsor) {
                      // Spara sponsor-prospects till DB
                      const dbRows = await api.bulkSaveSponsorProspects(foretag.id, influencers)
                      setInfluencers(dbRows.map(row => ({
                        ...row,
                        kontakt_epost: row.epost || row.kontakt_epost,
                        nisch: row.bransch || row.nisch,
                        kanalnamn: row.instagram_handle || row.kanalnamn,
                        foljare_exakt: parseInt(row.foljare) || influencers.find(i => (i.namn || '') === (row.namn || ''))?.foljare_exakt || 0,
                        match_score: influencers.find(i => (i.namn || '') === (row.namn || ''))?.match_score || 0,
                        profil_beskrivning: influencers.find(i => (i.namn || '') === (row.namn || ''))?.profil_beskrivning || '',
                      })))
                    } else {
                      // Spara influencers till DB
                      const dbRows = await api.bulkSaveInfluencers(foretag.id, influencers)
                      setInfluencers(dbRows.map(row => ({
                        ...row,
                        foljare_exakt: parseInt(row.foljare) || 0,
                        match_score: influencers.find(i => i.kanalnamn === row.kanalnamn)?.match_score || 0,
                        profil_beskrivning: influencers.find(i => i.kanalnamn === row.kanalnamn)?.profil_beskrivning || row.kontakt_info || '',
                      })))
                    }
                  } catch (e) {
                    console.error('Kunde inte spara till DB:', e.message)
                  }
                } else if (!isAiResults && foretag?.id) {
                  // DB-backade resultat: synka vald-status till DB som säkerhetsnät
                  // (toggle/selectAll-anrop kan ha misslyckats tyst)
                  try {
                    const selectedIds = influencers.filter(i => i.vald).map(i => i.id)
                    if (isSponsor) {
                      await api.syncSponsorSelection(foretag.id, selectedIds)
                    } else {
                      await api.syncInfluencerSelection(foretag.id, selectedIds)
                    }
                    console.log(`[Steg2] Synkade ${selectedIds.length} valda till DB`)
                  } catch (e) {
                    console.error('Kunde inte synka val till DB:', e.message)
                  }
                }
                // Rensa gamla meddelanden och brief så att "Generera utskick" börjar om
                if (setMessages) setMessages([])
                if (setOutreachBrief) setOutreachBrief(null)
                next()
              }}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
            >
              Fortsätt med {selectedCount} influencers <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
