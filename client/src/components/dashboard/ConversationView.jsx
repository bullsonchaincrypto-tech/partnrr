import { useState, useEffect, useRef, useCallback } from 'react'
import {
  MessageSquare, Send, ArrowLeft, Clock, Loader2, RefreshCw,
  ChevronRight, Circle, Youtube, Instagram, Sparkles, Zap,
  Brain, TrendingUp, FileText, AlertCircle, CheckCircle2,
  ArrowUpRight, Radio, Shield, Bot, PenSquare, X,
  DollarSign, Video, Users, Save, ChevronDown,
  Search, Filter, Bell, BellRing, Building2, User, CalendarClock
} from 'lucide-react'
import * as api from '../../services/api'

// ─── HELPERS ────────────────────────────────────────

function platformIcon(plattform) {
  if (!plattform) return <MessageSquare className="w-4 h-4 text-gray-500" />
  const p = plattform.toLowerCase()
  if (p.includes('youtube')) return <Youtube className="w-4 h-4 text-red-400" />
  if (p.includes('instagram')) return <Instagram className="w-4 h-4 text-pink-400" />
  if (p.includes('tiktok')) return <span className="text-xs font-bold text-cyan-400">TT</span>
  return <MessageSquare className="w-4 h-4 text-gray-500" />
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just nu'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(dateStr).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })
}

function sentimentColor(sentiment) {
  if (sentiment === 'positive') return { bg: 'bg-emerald-500/20', text: 'text-emerald-300', glow: 'shadow-emerald-500/20', dot: 'bg-emerald-400' }
  if (sentiment === 'negative') return { bg: 'bg-red-500/20', text: 'text-red-300', glow: 'shadow-red-500/20', dot: 'bg-red-400' }
  return { bg: 'bg-sky-500/20', text: 'text-sky-300', glow: 'shadow-sky-500/20', dot: 'bg-sky-400' }
}

// Strip quoted/cited text from email replies
function stripQuotedText(text) {
  if (!text) return ''
  const lines = text.split('\n')
  const cleaned = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Stop at "Den ... skrev ...:" or "On ... wrote:" or similar reply headers
    if (/^(den |on |le )\d.+?(skrev|wrote|a écrit)/i.test(line.trim())) break
    // Stop at "YYYY-MM-DD ... skrev ..." or "9 apr. 2026 kl. ... skrev ..."
    if (/^\d{1,2}\s\w+\.?\s\d{4}\skl\.\s/.test(line.trim())) break
    // Skip lines starting with > (quoted text)
    if (line.trim().startsWith('>')) continue
    // Stop at "---------- Forwarded message" or similar dividers
    if (/^-{3,}\s*(Forwarded|Vidarebefordrat|Original)/i.test(line.trim())) break
    cleaned.push(line)
  }
  // Trim trailing empty lines
  while (cleaned.length > 0 && cleaned[cleaned.length - 1].trim() === '') {
    cleaned.pop()
  }
  return cleaned.join('\n')
}

function dealStageLabel(stage) {
  const stages = {
    'outreach': { label: 'Utskick', color: 'text-gray-400', icon: Send },
    'replied': { label: 'Svarat', color: 'text-sky-400', icon: MessageSquare },
    'negotiating': { label: 'Förhandling', color: 'text-amber-400', icon: TrendingUp },
    'contract_sent': { label: 'Avtal skickat', color: 'text-purple-400', icon: FileText },
    'signed': { label: 'Signerat', color: 'text-emerald-400', icon: CheckCircle2 },
    'active': { label: 'Aktivt', color: 'text-emerald-300', icon: Zap },
    'declined': { label: 'Avböjt', color: 'text-red-400', icon: AlertCircle },
  }
  return stages[stage] || stages['outreach']
}

function actionLabel(action) {
  const actions = {
    'svara_intresse': 'Svara — visar intresse',
    'boka_mote': 'Boka möte',
    'skicka_kontrakt': 'Skicka kontrakt',
    'skicka_info': 'Skicka mer info',
    'avvakta': 'Avvakta',
    'ingen_atgard': 'Ingen åtgärd behövs',
  }
  return actions[action] || action || ''
}

// ─── MAIN COMPONENT ─────────────────────────────────

export default function ConversationView() {
  const [conversations, setConversations] = useState([])
  const [selectedEmail, setSelectedEmail] = useState(null)
  const [thread, setThread] = useState(null)
  const [contact, setContact] = useState(null)
  const [loading, setLoading] = useState(true)
  const [threadLoading, setThreadLoading] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [checking, setChecking] = useState(false)
  const [analyzing, setAnalyzing] = useState(null)
  const [lastCheck, setLastCheck] = useState(null)
  const [pulse, setPulse] = useState(false)
  // Compose new message
  const [showCompose, setShowCompose] = useState(false)
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [composeSending, setComposeSending] = useState(false)
  // Economics panel
  const [showEconomy, setShowEconomy] = useState(false)
  const [ecoData, setEcoData] = useState(null)
  const [ecoSaving, setEcoSaving] = useState(false)
  // Search & filter
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState('all') // all | influencer | sponsor
  const [filterStage, setFilterStage] = useState('all') // all | replied | signed | etc
  const [showFilters, setShowFilters] = useState(false)
  // Contract reminders
  const [contractReminders, setContractReminders] = useState(null)
  const [remindersLoading, setRemindersLoading] = useState(false)
  const [showReminders, setShowReminders] = useState(false)
  const threadEndRef = useRef(null)
  const pollRef = useRef(null)

  // Scroll to bottom on new messages
  useEffect(() => {
    if (threadEndRef.current) {
      threadEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [thread])

  // Load conversations
  const loadConversations = useCallback(async () => {
    try {
      const data = await api.getWatcherConversations()
      setConversations(data)
    } catch (err) { console.error('[ConvView] Load error:', err) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadConversations() }, [loadConversations])

  // Smart polling — check Gmail for new relevant mail
  const checkForNew = useCallback(async () => {
    setChecking(true)
    try {
      const result = await api.checkGmailWatcher()
      setLastCheck(new Date())
      if (result.hasNew && result.relevant > 0) {
        setPulse(true)
        setTimeout(() => setPulse(false), 2000)
        await loadConversations()
        // Refresh thread if open
        if (selectedEmail) {
          const t = await api.getWatcherThread(selectedEmail)
          setThread(t.messages)
          setContact(t.contact)
        }
      }
      return result
    } catch (err) {
      console.error('[ConvView] Check error:', err)
      return null
    } finally { setChecking(false) }
  }, [loadConversations, selectedEmail])

  // Auto-poll every 30s
  useEffect(() => {
    pollRef.current = setInterval(checkForNew, 30000)
    return () => clearInterval(pollRef.current)
  }, [checkForNew])

  // Open thread
  const openThread = async (email) => {
    setSelectedEmail(email)
    setThreadLoading(true)
    setReplyText('')
    try {
      const data = await api.getWatcherThread(email)
      setThread(data.messages)
      setContact(data.contact)
      // Update local unread
      setConversations(prev => prev.map(c =>
        c.contact_email === email ? { ...c, unread_count: 0 } : c
      ))
    } catch (err) { console.error('[ConvView] Thread error:', err) }
    finally { setThreadLoading(false) }
  }

  // Send reply
  const handleReply = async () => {
    if (!replyText.trim() || !selectedEmail) return
    setSending(true)
    try {
      const threadId = thread?.find(m => m.gmail_thread_id)?.gmail_thread_id
      await api.sendWatcherReply({
        to_email: selectedEmail,
        subject: thread?.[0]?.subject ? `Re: ${thread[0].subject}` : 'Re: Samarbete',
        body: replyText,
        thread_id: threadId || null,
      })
      setReplyText('')
      // Reload thread
      const data = await api.getWatcherThread(selectedEmail)
      setThread(data.messages)
      setContact(data.contact)
      await loadConversations()
    } catch (err) {
      console.error('[ConvView] Reply error:', err)
      alert('Kunde inte skicka svar.')
    } finally { setSending(false) }
  }

  // AI analyze
  const handleAnalyze = async (messageId) => {
    setAnalyzing(messageId)
    try {
      const result = await api.analyzeMessage(messageId)
      if (result.success) {
        // Refresh thread to show AI data
        if (selectedEmail) {
          const data = await api.getWatcherThread(selectedEmail)
          setThread(data.messages)
          setContact(data.contact)
        }
        await loadConversations()
      }
    } catch (err) { console.error('[ConvView] Analyze error:', err) }
    finally { setAnalyzing(null) }
  }

  // Compose new message to current contact
  const handleCompose = async () => {
    if (!composeBody.trim() || !selectedEmail) return
    setComposeSending(true)
    try {
      await api.sendWatcherReply({
        to_email: selectedEmail,
        subject: composeSubject || `Samarbete — RankLeague`,
        body: composeBody,
        thread_id: null, // New thread
      })
      setComposeBody('')
      setComposeSubject('')
      setShowCompose(false)
      // Reload thread
      const data = await api.getWatcherThread(selectedEmail)
      setThread(data.messages)
      setContact(data.contact)
      await loadConversations()
    } catch (err) {
      console.error('[ConvView] Compose error:', err)
      alert('Kunde inte skicka meddelande.')
    } finally { setComposeSending(false) }
  }

  // Load economics for current contact
  const loadEconomy = async () => {
    if (!contact) return
    try {
      // Find contract via the conversation thread's influencer
      const thread = conversations.find(c => c.contact_email === selectedEmail)
      if (!thread?.influencer_id) { setEcoData(null); return }

      const contracts = await api.getContracts({ influencer_id: thread.influencer_id })
      if (contracts?.length > 0) {
        const k = contracts[0]
        setEcoData({
          kontrakt_id: k.id,
          status: k.status,
          videos_required: k.videos_required || 5,
          videos_delivered: k.videos_delivered || 0,
          total_signups: k.total_signups || 0,
          total_payout_sek: k.total_payout_sek || 0,
          notes: k.notes || '',
        })
      } else {
        setEcoData(null)
      }
    } catch (err) { console.error(err); setEcoData(null) }
  }

  const handleSaveEconomy = async () => {
    if (!ecoData?.kontrakt_id) return
    setEcoSaving(true)
    try {
      await api.updateContractEconomics(ecoData.kontrakt_id, {
        videos_delivered: ecoData.videos_delivered,
        total_signups: ecoData.total_signups,
        total_payout_sek: ecoData.total_payout_sek,
        notes: ecoData.notes,
      })
      setShowEconomy(false)
    } catch (err) { console.error(err); alert('Kunde inte spara') }
    finally { setEcoSaving(false) }
  }

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0)

  // ─── Filtered conversations ───
  const filteredConversations = conversations.filter(conv => {
    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const name = (conv.influencer_namn || conv.contact_name || '').toLowerCase()
      const email = (conv.contact_email || '').toLowerCase()
      const channel = (conv.kanalnamn || '').toLowerCase()
      if (!name.includes(q) && !email.includes(q) && !channel.includes(q)) return false
    }
    // Type filter (influencer vs sponsor)
    if (filterType === 'influencer' && !conv.influencer_id) return false
    if (filterType === 'sponsor' && !conv.prospect_id) return false
    // Deal stage filter
    if (filterStage !== 'all' && conv.deal_stage !== filterStage) return false
    return true
  })

  // ─── Load contract reminders ───
  const loadContractReminders = async () => {
    setRemindersLoading(true)
    try {
      const res = await fetch('/api/contracts/reminders/due')
      if (res.ok) {
        const data = await res.json()
        setContractReminders(data)
      }
    } catch (err) { console.error('[ConvView] Reminders error:', err) }
    finally { setRemindersLoading(false) }
  }

  const sendContractReminder = async (contractId, type) => {
    try {
      const res = await fetch(`/api/contracts/${contractId}/send-reminder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      if (res.ok) {
        // Reload reminders
        loadContractReminders()
      }
    } catch (err) { console.error('[ConvView] Send reminder error:', err) }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="relative">
        <div className="w-12 h-12 rounded-full border-2 border-purple-500/30 animate-spin" style={{ borderTopColor: 'rgb(168 85 247)' }} />
        <Sparkles className="w-5 h-5 text-purple-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
      </div>
    </div>
  )

  return (
    <div className="rounded-2xl overflow-hidden relative" style={{ height: 'min(680px, calc(100vh - 200px))' }}>
      {/* Futuristic background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(139,92,246,0.08),transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(59,130,246,0.05),transparent_50%)]" />

      {/* Grid overlay */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: 'linear-gradient(rgba(168,85,247,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(168,85,247,0.3) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }} />

      <div className="relative flex h-full border border-gray-800/80 rounded-2xl overflow-hidden backdrop-blur-sm">

        {/* ─── LEFT PANEL: Conversation List ─── */}
        <div className={`${selectedEmail ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 lg:w-96 border-r border-gray-800/60 h-full`}>

          {/* Header */}
          <div className="border-b border-gray-800/60 shrink-0 bg-gray-900/50">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className={`relative ${pulse ? 'animate-pulse' : ''}`}>
                  <Radio className="w-4 h-4 text-purple-400" />
                  {checking && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-purple-400 rounded-full animate-ping" />}
                </div>
                <span className="text-sm font-semibold text-white tracking-wide">Konversationer</span>
                {totalUnread > 0 && (
                  <span className="text-[10px] bg-purple-500 text-white px-1.5 py-0.5 rounded-full font-bold shadow-lg shadow-purple-500/30">
                    {totalUnread}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {lastCheck && (
                  <span className="text-[9px] text-gray-600">{timeAgo(lastCheck.toISOString())}</span>
                )}
                {/* Contract reminders button */}
                <button onClick={() => { if (!contractReminders) loadContractReminders(); setShowReminders(!showReminders) }}
                  className={`p-1 rounded-lg transition-colors ${showReminders ? 'text-amber-400 bg-amber-500/10' : 'text-gray-500 hover:text-amber-400 hover:bg-amber-500/10'}`}
                  title="Avtalspåminnelser">
                  {showReminders ? <BellRing className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
                </button>
                {/* Filter toggle */}
                <button onClick={() => setShowFilters(!showFilters)}
                  className={`p-1 rounded-lg transition-colors ${showFilters || filterType !== 'all' || filterStage !== 'all' ? 'text-purple-400 bg-purple-500/10' : 'text-gray-500 hover:text-purple-400 hover:bg-purple-500/10'}`}
                  title="Filter">
                  <Filter className="w-3.5 h-3.5" />
                </button>
                <button onClick={checkForNew} disabled={checking}
                  className="text-gray-500 hover:text-purple-400 transition-colors p-1 rounded-lg hover:bg-purple-500/10">
                  <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Search bar */}
            <div className="px-3 pb-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Sök namn, e-post, kanal..."
                  className="w-full bg-gray-800/50 border border-gray-700/40 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-600 focus:border-purple-500/40 focus:outline-none transition-colors"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Filter chips */}
            {showFilters && (
              <div className="px-3 pb-2.5 space-y-2">
                {/* Type filter */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-gray-500 uppercase tracking-wider w-10 shrink-0">Typ</span>
                  {[
                    { key: 'all', label: 'Alla', icon: null },
                    { key: 'influencer', label: 'Influencers', icon: User },
                    { key: 'sponsor', label: 'Sponsorer', icon: Building2 },
                  ].map(f => (
                    <button key={f.key} onClick={() => setFilterType(f.key)}
                      className={`text-[10px] px-2 py-1 rounded-md border transition-all flex items-center gap-1 ${
                        filterType === f.key
                          ? f.key === 'influencer' ? 'bg-purple-500/20 border-purple-500/30 text-purple-300'
                            : f.key === 'sponsor' ? 'bg-sky-500/20 border-sky-500/30 text-sky-300'
                            : 'bg-gray-700/50 border-gray-600/50 text-white'
                          : 'bg-gray-800/30 border-gray-700/30 text-gray-500 hover:text-gray-300 hover:border-gray-600/50'
                      }`}>
                      {f.icon && <f.icon className="w-2.5 h-2.5" />}
                      {f.label}
                    </button>
                  ))}
                </div>
                {/* Stage filter */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[9px] text-gray-500 uppercase tracking-wider w-10 shrink-0">Steg</span>
                  {[
                    { key: 'all', label: 'Alla' },
                    { key: 'outreach', label: 'Utskick' },
                    { key: 'replied', label: 'Svarat' },
                    { key: 'negotiating', label: 'Förhandling' },
                    { key: 'signed', label: 'Signerat' },
                    { key: 'active', label: 'Aktivt' },
                    { key: 'declined', label: 'Avböjt' },
                  ].map(f => (
                    <button key={f.key} onClick={() => setFilterStage(f.key)}
                      className={`text-[10px] px-2 py-1 rounded-md border transition-all ${
                        filterStage === f.key
                          ? 'bg-gray-700/50 border-gray-600/50 text-white'
                          : 'bg-gray-800/30 border-gray-700/30 text-gray-500 hover:text-gray-300 hover:border-gray-600/50'
                      }`}>
                      {f.label}
                    </button>
                  ))}
                </div>
                {/* Active filter count */}
                {(filterType !== 'all' || filterStage !== 'all') && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500">
                      {filteredConversations.length} av {conversations.length} konversationer
                    </span>
                    <button onClick={() => { setFilterType('all'); setFilterStage('all') }}
                      className="text-[10px] text-purple-400 hover:text-purple-300">
                      Rensa filter
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Contract reminders panel */}
            {showReminders && (
              <div className="px-3 pb-3 border-t border-gray-800/40 pt-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-amber-300 font-medium flex items-center gap-1.5 uppercase tracking-wider">
                    <BellRing className="w-3 h-3" /> Avtalspåminnelser
                  </span>
                  <button onClick={loadContractReminders} disabled={remindersLoading}
                    className="text-[10px] text-gray-500 hover:text-amber-400 flex items-center gap-1">
                    <RefreshCw className={`w-2.5 h-2.5 ${remindersLoading ? 'animate-spin' : ''}`} /> Uppdatera
                  </button>
                </div>

                {remindersLoading ? (
                  <div className="flex items-center gap-2 py-3 justify-center">
                    <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                    <span className="text-[10px] text-gray-500">Laddar påminnelser...</span>
                  </div>
                ) : contractReminders ? (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {/* Expiring soon */}
                    {contractReminders.expiring_soon?.map(c => (
                      <div key={`exp-${c.id}`} className="flex items-center justify-between bg-amber-500/[0.06] border border-amber-500/15 rounded-lg px-2.5 py-2">
                        <div className="min-w-0">
                          <p className="text-[11px] text-amber-200 font-medium truncate">{c.influencer_namn || c.kontaktperson}</p>
                          <p className="text-[9px] text-amber-400/60 flex items-center gap-1">
                            <CalendarClock className="w-2.5 h-2.5" /> Löper ut snart
                          </p>
                        </div>
                        <button onClick={() => sendContractReminder(c.id, 'expiry')}
                          className="text-[9px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 px-2 py-1 rounded-md border border-amber-500/20 transition-colors shrink-0 ml-2">
                          Påminn
                        </button>
                      </div>
                    ))}
                    {/* Expired */}
                    {contractReminders.expired?.map(c => (
                      <div key={`gone-${c.id}`} className="flex items-center justify-between bg-red-500/[0.06] border border-red-500/15 rounded-lg px-2.5 py-2">
                        <div className="min-w-0">
                          <p className="text-[11px] text-red-200 font-medium truncate">{c.influencer_namn || c.kontaktperson}</p>
                          <p className="text-[9px] text-red-400/60 flex items-center gap-1">
                            <AlertCircle className="w-2.5 h-2.5" /> Utgånget avtal
                          </p>
                        </div>
                        <button onClick={() => sendContractReminder(c.id, 'expired')}
                          className="text-[9px] bg-red-500/20 hover:bg-red-500/30 text-red-300 px-2 py-1 rounded-md border border-red-500/20 transition-colors shrink-0 ml-2">
                          Notifiera
                        </button>
                      </div>
                    ))}
                    {/* Unsigned stale */}
                    {contractReminders.unsigned_stale?.map(c => (
                      <div key={`uns-${c.id}`} className="flex items-center justify-between bg-gray-500/[0.06] border border-gray-600/20 rounded-lg px-2.5 py-2">
                        <div className="min-w-0">
                          <p className="text-[11px] text-gray-200 font-medium truncate">{c.influencer_namn || c.kontaktperson}</p>
                          <p className="text-[9px] text-gray-400/60 flex items-center gap-1">
                            <FileText className="w-2.5 h-2.5" /> Osignerat (5+ dagar)
                          </p>
                        </div>
                        <button onClick={() => sendContractReminder(c.id, 'sign')}
                          className="text-[9px] bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 px-2 py-1 rounded-md border border-purple-500/20 transition-colors shrink-0 ml-2">
                          Påminn
                        </button>
                      </div>
                    ))}
                    {/* Empty state */}
                    {(!contractReminders.expiring_soon?.length && !contractReminders.expired?.length && !contractReminders.unsigned_stale?.length) && (
                      <div className="py-3 text-center">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400/50 mx-auto mb-1" />
                        <p className="text-[10px] text-gray-500">Inga avtalspåminnelser just nu</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-3 text-center">
                    <p className="text-[10px] text-gray-500">Klicka "Uppdatera" för att hämta påminnelser</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Conversation items */}
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 px-6">
                <div className="w-16 h-16 rounded-2xl bg-gray-800/50 border border-gray-700/50 flex items-center justify-center mb-4">
                  <Shield className="w-7 h-7 text-gray-600" />
                </div>
                <p className="text-sm font-medium text-gray-400">Inga konversationer</p>
                <p className="text-xs text-gray-600 mt-1.5 text-center leading-relaxed">
                  Svar från influencers dyker upp här automatiskt. Bara mail från kontaktade personer visas.
                </p>
                <button onClick={checkForNew}
                  className="mt-4 text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 transition-all">
                  <RefreshCw className="w-3 h-3" /> Kontrollera nu
                </button>
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500 px-6">
                <Search className="w-6 h-6 text-gray-600 mb-2" />
                <p className="text-xs text-gray-400">Inga träffar</p>
                <p className="text-[10px] text-gray-600 mt-1">Prova att ändra sökning eller filter</p>
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const stage = dealStageLabel(conv.deal_stage)
                const StageIcon = stage.icon
                const sentiment = conv.ai_sentiment ? sentimentColor(conv.ai_sentiment) : null
                const isInfluencer = !!conv.influencer_id
                const isSponsor = !!conv.prospect_id
                // Color coding: purple border for influencers, sky/blue for sponsors
                const typeBorderColor = selectedEmail === conv.contact_email
                  ? (isInfluencer ? 'border-l-purple-500' : isSponsor ? 'border-l-sky-500' : 'border-l-gray-500')
                  : 'border-l-transparent'
                const typeSelectedBg = selectedEmail === conv.contact_email
                  ? (isInfluencer ? 'bg-purple-500/[0.06]' : isSponsor ? 'bg-sky-500/[0.06]' : 'bg-gray-500/[0.06]')
                  : ''

                return (
                  <button key={conv.contact_email}
                    onClick={() => openThread(conv.contact_email)}
                    className={`w-full text-left px-4 py-3.5 border-b border-gray-800/30 hover:bg-white/[0.03] transition-all duration-200 group border-l-2 ${typeBorderColor} ${typeSelectedBg}`}>
                    <div className="flex items-start gap-3">
                      {/* Status indicator */}
                      <div className="shrink-0 mt-1.5 relative">
                        {conv.unread_count > 0 ? (
                          <div className="relative">
                            <Circle className={`w-2.5 h-2.5 fill-current ${isInfluencer ? 'text-purple-400' : isSponsor ? 'text-sky-400' : 'text-gray-400'}`} />
                            <div className={`absolute inset-0 w-2.5 h-2.5 rounded-full animate-ping opacity-40 ${isInfluencer ? 'bg-purple-400' : isSponsor ? 'bg-sky-400' : 'bg-gray-400'}`} />
                          </div>
                        ) : (
                          <Circle className="w-2.5 h-2.5 text-gray-700/50" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        {/* Name + type badge + time */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {platformIcon(conv.inf_plattform || conv.plattform)}
                            <span className={`text-sm truncate ${conv.unread_count > 0 ? 'font-semibold text-white' : 'text-gray-300'}`}>
                              {conv.influencer_namn || conv.contact_name || conv.contact_email}
                            </span>
                            {/* Type badge */}
                            {isInfluencer && (
                              <span className="text-[8px] bg-purple-500/20 text-purple-300 px-1 py-0.5 rounded font-medium shrink-0">INF</span>
                            )}
                            {isSponsor && (
                              <span className="text-[8px] bg-sky-500/20 text-sky-300 px-1 py-0.5 rounded font-medium shrink-0">SPO</span>
                            )}
                          </div>
                          <span className="text-[10px] text-gray-600 shrink-0 tabular-nums">
                            {timeAgo(conv.last_message_at)}
                          </span>
                        </div>

                        {/* Channel name */}
                        {conv.kanalnamn && (
                          <p className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-1">
                            @{conv.kanalnamn}
                            {conv.foljare && <span className="text-gray-600">• {Number(conv.foljare).toLocaleString('sv-SE')}</span>}
                          </p>
                        )}

                        {/* AI summary preview */}
                        {conv.ai_summary && (
                          <p className="text-xs text-gray-500 mt-1 truncate italic">
                            {conv.ai_summary}
                          </p>
                        )}

                        {/* Tags row */}
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {/* Deal stage */}
                          <span className={`text-[9px] flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-gray-800/50 border border-gray-700/30 ${stage.color}`}>
                            <StageIcon className="w-2.5 h-2.5" /> {stage.label}
                          </span>

                          {/* Sentiment */}
                          {sentiment && (
                            <span className={`text-[9px] flex items-center gap-0.5 px-1.5 py-0.5 rounded-md ${sentiment.bg} ${sentiment.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${sentiment.dot}`} />
                              {conv.ai_sentiment}
                            </span>
                          )}

                          {/* Contract status */}
                          {conv.kontrakt_status && (
                            <span className="text-[9px] text-amber-400/70 flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20">
                              <FileText className="w-2.5 h-2.5" /> {conv.kontrakt_status}
                            </span>
                          )}

                          {/* Message count */}
                          <span className="text-[9px] text-gray-600">
                            {conv.message_count} msg
                          </span>
                        </div>
                      </div>

                      <ChevronRight className="w-4 h-4 text-gray-700 shrink-0 mt-2 group-hover:text-purple-400 transition-colors" />
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {/* Bottom status bar */}
          <div className="px-4 py-2 border-t border-gray-800/60 bg-gray-900/30 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] text-gray-600">
                <Bot className="w-3 h-3" />
                <span>AI-bevakning aktiv</span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-gray-600">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </div>
            </div>
          </div>
        </div>

        {/* ─── RIGHT PANEL: Thread View ─── */}
        <div className={`${selectedEmail ? 'flex' : 'hidden md:flex'} flex-col flex-1 h-full`}>
          {!selectedEmail ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center h-full">
              <div className="relative mb-6">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500/10 to-sky-500/10 border border-purple-500/20 flex items-center justify-center">
                  <MessageSquare className="w-8 h-8 text-purple-400/60" />
                </div>
                <div className="absolute -top-1 -right-1 w-6 h-6 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-purple-400" />
                </div>
              </div>
              <p className="text-sm text-gray-400 font-medium">Välj en konversation</p>
              <p className="text-xs text-gray-600 mt-1">AI analyserar sentiment och föreslår åtgärder</p>
            </div>
          ) : threadLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full border-2 border-purple-500/30 animate-spin" style={{ borderTopColor: 'rgb(168 85 247)' }} />
                  <Brain className="w-4 h-4 text-purple-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                </div>
                <span className="text-xs text-gray-500">Laddar konversation...</span>
              </div>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-800/60 shrink-0 bg-gray-900/30">
                <button onClick={() => setSelectedEmail(null)} className="md:hidden text-gray-400 hover:text-white p-1">
                  <ArrowLeft className="w-5 h-5" />
                </button>

                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-sky-500/20 border border-gray-700/50 flex items-center justify-center shrink-0">
                    {platformIcon(contact?.plattform)}
                  </div>

                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate">
                      {contact?.namn || contact?.email}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      {contact?.kanalnamn && (
                        <span className="text-[10px] text-gray-400">@{contact.kanalnamn}</span>
                      )}
                      {contact?.foljare && (
                        <span className="text-[10px] text-gray-500 bg-gray-800/50 px-1.5 py-0.5 rounded">
                          {Number(contact.foljare).toLocaleString('sv-SE')} följare
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right side: actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {contact?.kontrakt_status && (
                    <button onClick={() => { loadEconomy(); setShowEconomy(!showEconomy) }}
                      className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20 hover:bg-amber-500/20 transition-colors flex items-center gap-1">
                      <DollarSign className="w-2.5 h-2.5" />
                      Avtal: {contact.kontrakt_status}
                    </button>
                  )}
                  {contact?.ai_sentiment && (() => {
                    const s = sentimentColor(contact.ai_sentiment)
                    return (
                      <span className={`text-[10px] px-2 py-1 rounded-lg border flex items-center gap-1 ${s.bg} ${s.text} border-current/20`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                        {contact.ai_sentiment}
                      </span>
                    )
                  })()}
                  <button onClick={() => setShowCompose(!showCompose)}
                    className="text-[10px] text-purple-400 bg-purple-500/10 px-2 py-1 rounded-lg border border-purple-500/20 hover:bg-purple-500/20 transition-colors flex items-center gap-1">
                    <PenSquare className="w-2.5 h-2.5" /> Nytt mail
                  </button>
                </div>
              </div>

              {/* AI suggestion bar */}
              {contact?.ai_next_action && contact.ai_next_action !== 'ingen_atgard' && (
                <div className="px-5 py-2 bg-purple-500/[0.06] border-b border-purple-500/10 flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  <span className="text-xs text-purple-300">
                    <span className="text-purple-400 font-medium">AI föreslår:</span> {actionLabel(contact.ai_next_action)}
                  </span>
                </div>
              )}

              {/* ─── COMPOSE NEW MESSAGE PANEL ─── */}
              {showCompose && (
                <div className="px-5 py-3 bg-purple-500/[0.04] border-b border-purple-500/10 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-purple-300 font-medium flex items-center gap-1.5">
                      <PenSquare className="w-3 h-3" /> Nytt meddelande till {contact?.namn || selectedEmail}
                    </span>
                    <button onClick={() => setShowCompose(false)} className="text-gray-500 hover:text-white p-0.5">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    placeholder="Ämne (valfritt)"
                    className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500/50 focus:outline-none placeholder-gray-600"
                  />
                  <textarea
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                    placeholder="Skriv ditt meddelande..."
                    rows={4}
                    className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-white resize-none focus:border-purple-500/50 focus:outline-none placeholder-gray-600"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCompose()
                    }}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-600">Skickas via Gmail API. Ctrl+Enter för att skicka.</span>
                    <button onClick={handleCompose} disabled={composeSending || !composeBody.trim()}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white text-xs font-medium rounded-lg disabled:opacity-30 transition-all">
                      {composeSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      Skicka
                    </button>
                  </div>
                </div>
              )}

              {/* ─── ECONOMICS PANEL ─── */}
              {showEconomy && ecoData && (
                <div className="px-5 py-3 bg-amber-500/[0.04] border-b border-amber-500/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-amber-300 font-medium flex items-center gap-1.5">
                      <DollarSign className="w-3 h-3" /> Ekonomi & ROI — {contact?.namn}
                    </span>
                    <button onClick={() => setShowEconomy(false)} className="text-gray-500 hover:text-white p-0.5">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] text-gray-400 mb-0.5 block flex items-center gap-1">
                        <Video className="w-2.5 h-2.5" /> Videos levererade
                      </label>
                      <input type="number" value={ecoData.videos_delivered}
                        onChange={(e) => setEcoData(d => ({ ...d, videos_delivered: Number(e.target.value) }))}
                        className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-2 py-1.5 text-sm text-white focus:border-amber-500/50 focus:outline-none" />
                      <span className="text-[9px] text-gray-600">av {ecoData.videos_required} st (à 300 kr)</span>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400 mb-0.5 block flex items-center gap-1">
                        <Users className="w-2.5 h-2.5" /> Signups
                      </label>
                      <input type="number" value={ecoData.total_signups}
                        onChange={(e) => setEcoData(d => ({ ...d, total_signups: Number(e.target.value) }))}
                        className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-2 py-1.5 text-sm text-white focus:border-amber-500/50 focus:outline-none" />
                      <span className="text-[9px] text-gray-600">à 10 kr/signup</span>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400 mb-0.5 block">Total utbetalt</label>
                      <input type="number" value={ecoData.total_payout_sek}
                        onChange={(e) => setEcoData(d => ({ ...d, total_payout_sek: Number(e.target.value) }))}
                        className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-2 py-1.5 text-sm text-white focus:border-amber-500/50 focus:outline-none" />
                      <span className="text-[9px] text-gray-600">SEK</span>
                    </div>
                  </div>
                  {/* Cost summary */}
                  <div className="bg-gray-800/40 rounded-lg px-3 py-2 flex items-center gap-4 text-[10px]">
                    <span className="text-gray-400">Beräknad kostnad:</span>
                    <span className="text-white font-medium">
                      {((ecoData.videos_delivered || 0) * 300 + (ecoData.total_signups || 0) * 10).toLocaleString('sv-SE')} kr
                    </span>
                    <span className="text-gray-500">
                      ({ecoData.videos_delivered || 0} videos × 300 + {ecoData.total_signups || 0} signups × 10)
                    </span>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 mb-0.5 block">Anteckningar</label>
                    <input value={ecoData.notes}
                      onChange={(e) => setEcoData(d => ({ ...d, notes: e.target.value }))}
                      placeholder="T.ex. Bra CTA, hög konvertering..."
                      className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-2 py-1.5 text-sm text-white focus:border-amber-500/50 focus:outline-none placeholder-gray-600" />
                  </div>
                  <div className="flex justify-end">
                    <button onClick={handleSaveEconomy} disabled={ecoSaving}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors">
                      {ecoSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      Spara ekonomi
                    </button>
                  </div>
                </div>
              )}
              {showEconomy && !ecoData && (
                <div className="px-5 py-3 bg-amber-500/[0.04] border-b border-amber-500/10">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">Inget avtal kopplat till denna kontakt.</span>
                    <button onClick={() => setShowEconomy(false)} className="text-gray-500 hover:text-white p-0.5">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
                {thread?.map((msg, idx) => {
                  const isOutbound = msg.direction === 'outbound' || msg.direction === 'outbound_reply'
                  const sentiment = msg.ai_sentiment ? sentimentColor(msg.ai_sentiment) : null

                  return (
                    <div key={idx} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] relative group ${isOutbound
                        ? 'rounded-2xl rounded-br-md'
                        : 'rounded-2xl rounded-bl-md'
                      }`}>
                        {/* Sender label */}
                        <div className={`mb-1 text-[11px] font-semibold ${isOutbound ? 'text-right text-purple-400' : 'text-left text-gray-400'}`}>
                          {isOutbound ? 'Du' : (contact?.namn || msg.from_email || 'Influencer')}
                        </div>

                        {/* Message bubble */}
                        <div className={`px-4 py-3 ${isOutbound
                          ? 'bg-gradient-to-br from-purple-600/20 to-purple-500/10 border border-purple-500/20'
                          : 'bg-gray-800/60 border border-gray-700/40'
                        } ${isOutbound ? 'rounded-2xl rounded-br-md' : 'rounded-2xl rounded-bl-md'}`}>

                          {/* Subject */}
                          {msg.subject && !msg.subject.startsWith('Re:') && (
                            <p className="text-[10px] text-gray-400 mb-1.5 font-medium tracking-wide uppercase">{msg.subject}</p>
                          )}

                          {/* Body — strip quoted email text */}
                          <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
                            {stripQuotedText(msg.body_preview || msg.meddelande || msg.snippet || '')}
                          </p>

                          {/* Meta row */}
                          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                            <span className="text-[10px] text-gray-500 flex items-center gap-1 tabular-nums">
                              <Clock className="w-2.5 h-2.5" />
                              {msg.received_at ? new Date(msg.received_at).toLocaleString('sv-SE', {
                                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                              }) : ''}
                            </span>

                            {isOutbound && (
                              <span className="text-[10px] text-purple-400/60 flex items-center gap-0.5">
                                <ArrowUpRight className="w-2.5 h-2.5" /> Skickat
                              </span>
                            )}

                            {msg.followup_step > 0 && (
                              <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                                Uppföljning #{msg.followup_step}
                              </span>
                            )}

                            {sentiment && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5 ${sentiment.bg} ${sentiment.text}`}>
                                <span className={`w-1 h-1 rounded-full ${sentiment.dot}`} />
                                {msg.ai_sentiment}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* AI summary card */}
                        {msg.ai_summary && (
                          <div className={`mt-1.5 px-3 py-2 rounded-xl text-[11px] leading-relaxed border ${
                            isOutbound
                              ? 'bg-purple-500/[0.04] border-purple-500/10 text-purple-300/70'
                              : 'bg-sky-500/[0.04] border-sky-500/10 text-sky-300/70'
                          }`}>
                            <div className="flex items-center gap-1 mb-0.5">
                              <Brain className="w-2.5 h-2.5" />
                              <span className="font-medium text-[10px] uppercase tracking-wider opacity-60">AI-sammanfattning</span>
                            </div>
                            {msg.ai_summary}
                          </div>
                        )}

                        {/* Analyze button (for inbound without AI) */}
                        {!isOutbound && !msg.ai_summary && msg.id && (
                          <button
                            onClick={() => handleAnalyze(msg.id)}
                            disabled={analyzing === msg.id}
                            className="mt-1.5 text-[10px] text-gray-500 hover:text-purple-400 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-purple-500/10 transition-all opacity-0 group-hover:opacity-100"
                          >
                            {analyzing === msg.id ? (
                              <><Loader2 className="w-2.5 h-2.5 animate-spin" /> Analyserar...</>
                            ) : (
                              <><Sparkles className="w-2.5 h-2.5" /> Analysera med AI</>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
                <div ref={threadEndRef} />
              </div>

              {/* Reply area */}
              <div className="border-t border-gray-800/60 px-5 py-3.5 shrink-0 bg-gray-900/20">
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Skriv ett svar..."
                      rows={2}
                      className="w-full bg-gray-800/40 border border-gray-700/50 rounded-xl px-4 py-3 text-sm text-white resize-none focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/20 placeholder-gray-600 transition-all"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleReply()
                      }}
                    />
                  </div>
                  <button
                    onClick={handleReply}
                    disabled={sending || !replyText.trim()}
                    className="self-end flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white text-sm font-medium rounded-xl disabled:opacity-30 disabled:from-gray-700 disabled:to-gray-600 transition-all shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <p className="text-[10px] text-gray-600">⌘+Enter för att skicka</p>
                  <p className="text-[10px] text-gray-600 flex items-center gap-1">
                    <Shield className="w-2.5 h-2.5" /> Via Gmail API
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
