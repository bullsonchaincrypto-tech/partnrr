import { useState, useEffect, useRef } from 'react'
import {
  Inbox, Mail, Send, ArrowLeft, User, Clock, MessageSquare,
  Loader2, RefreshCw, ChevronRight, Circle, Youtube, Instagram,
  ExternalLink, AlertTriangle
} from 'lucide-react'
import * as api from '../../services/api'

function platformIcon(plattform) {
  if (!plattform) return <Mail className="w-4 h-4 text-gray-400" />
  const p = plattform.toLowerCase()
  if (p.includes('youtube')) return <Youtube className="w-4 h-4 text-red-400" />
  if (p.includes('instagram')) return <Instagram className="w-4 h-4 text-pink-400" />
  if (p.includes('tiktok')) return <span className="text-xs font-bold text-cyan-400">TT</span>
  return <Mail className="w-4 h-4 text-gray-400" />
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m sedan`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h sedan`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d sedan`
  return new Date(dateStr).toLocaleDateString('sv-SE')
}

function renderMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>')
}

export default function InboxTab() {
  const [conversations, setConversations] = useState([])
  const [selectedEmail, setSelectedEmail] = useState(null)
  const [thread, setThread] = useState(null)
  const [contact, setContact] = useState(null)
  const [loading, setLoading] = useState(true)
  const [threadLoading, setThreadLoading] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const threadEndRef = useRef(null)

  useEffect(() => { loadConversations() }, [])

  useEffect(() => {
    if (threadEndRef.current) {
      threadEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [thread])

  const loadConversations = async () => {
    setLoading(true)
    try {
      const data = await api.getInboxConversations()
      setConversations(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const refreshConversations = async () => {
    setRefreshing(true)
    try {
      const data = await api.getInboxConversations()
      setConversations(data)
      // If viewing a thread, refresh it too
      if (selectedEmail) {
        const t = await api.getInboxThread(selectedEmail)
        setThread(t.thread)
        setContact(t.contact)
      }
    } catch (err) { console.error(err) }
    finally { setRefreshing(false) }
  }

  const openThread = async (email) => {
    setSelectedEmail(email)
    setThreadLoading(true)
    setReplyText('')
    try {
      const data = await api.getInboxThread(email)
      setThread(data.thread)
      setContact(data.contact)
      // Update unread count locally
      setConversations(prev => prev.map(c =>
        c.from_email === email ? { ...c, unread_count: 0 } : c
      ))
    } catch (err) { console.error(err) }
    finally { setThreadLoading(false) }
  }

  const handleReply = async () => {
    if (!replyText.trim() || !selectedEmail) return
    setSending(true)
    try {
      await api.sendInboxReply({
        to_email: selectedEmail,
        subject: thread?.[0]?.subject ? `Re: ${thread[0].subject}` : 'Re: Samarbete med RankLeague',
        body: replyText
      })
      setReplyText('')
      // Reload thread
      const data = await api.getInboxThread(selectedEmail)
      setThread(data.thread)
    } catch (err) {
      console.error(err)
      alert('Kunde inte skicka svar. Kontrollera Gmail-kopplingen.')
    }
    finally { setSending(false) }
  }

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0)

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
    </div>
  )

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden" style={{ height: '600px' }}>
      <div className="flex h-full">
        {/* Conversation list — left panel */}
        <div className={`${selectedEmail ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 lg:w-96 border-r border-gray-800 h-full`}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
            <div className="flex items-center gap-2">
              <Inbox className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-semibold text-white">Inbox</span>
              {totalUnread > 0 && (
                <span className="text-[10px] bg-purple-600 text-white px-1.5 py-0.5 rounded-full font-bold">
                  {totalUnread}
                </span>
              )}
            </div>
            <button onClick={refreshConversations} disabled={refreshing}
              className="text-gray-500 hover:text-white transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Conversation items */}
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 px-4">
                <Mail className="w-10 h-10 mb-3 text-gray-700" />
                <p className="text-sm font-medium">Ingen inkommande post</p>
                <p className="text-xs text-gray-600 mt-1 text-center">
                  Svar hamnar automatiskt här när influencers svarar på dina utskick.
                </p>
              </div>
            ) : (
              conversations.map((conv) => (
                <button key={conv.from_email}
                  onClick={() => openThread(conv.from_email)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-800/50 hover:bg-gray-800/50 transition-colors ${
                    selectedEmail === conv.from_email ? 'bg-gray-800' : ''
                  }`}>
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 mt-0.5">
                      {conv.unread_count > 0 ? (
                        <Circle className="w-2.5 h-2.5 text-purple-400 fill-purple-400" />
                      ) : (
                        <Circle className="w-2.5 h-2.5 text-gray-700" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {platformIcon(conv.plattform)}
                          <span className={`text-sm truncate ${conv.unread_count > 0 ? 'font-semibold text-white' : 'text-gray-300'}`}>
                            {conv.contact_name}
                          </span>
                        </div>
                        <span className="text-[10px] text-gray-500 shrink-0">{timeAgo(conv.last_message_at)}</span>
                      </div>
                      {conv.kanalnamn && (
                        <p className="text-[10px] text-gray-500 mt-0.5">@{conv.kanalnamn}</p>
                      )}
                      <p className={`text-xs mt-1 truncate ${conv.unread_count > 0 ? 'text-gray-300' : 'text-gray-500'}`}>
                        {conv.last_snippet || conv.last_subject || 'Inget innehåll'}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-gray-600">
                          {conv.message_count} {conv.message_count === 1 ? 'meddelande' : 'meddelanden'}
                        </span>
                        {conv.match_type === 'influencer' && (
                          <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 rounded">Influencer</span>
                        )}
                        {conv.match_type === 'sponsor' && (
                          <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 rounded">Sponsor</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-700 shrink-0 mt-1" />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Thread view — right panel */}
        <div className={`${selectedEmail ? 'flex' : 'hidden md:flex'} flex-col flex-1 h-full`}>
          {!selectedEmail ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <MessageSquare className="w-12 h-12 mb-3 text-gray-700" />
              <p className="text-sm">Välj en konversation</p>
            </div>
          ) : threadLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 shrink-0">
                <button onClick={() => setSelectedEmail(null)} className="md:hidden text-gray-400 hover:text-white">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {platformIcon(contact?.plattform)}
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate">
                      {contact?.namn || contact?.email}
                    </h3>
                    <div className="flex items-center gap-2">
                      {contact?.kanalnamn && (
                        <span className="text-[10px] text-gray-400">@{contact.kanalnamn}</span>
                      )}
                      <span className="text-[10px] text-gray-500">{contact?.email}</span>
                    </div>
                  </div>
                </div>
                {contact?.type === 'influencer' && contact?.foljare && (
                  <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-1 rounded">
                    {Number(contact.foljare).toLocaleString('sv-SE')} följare
                  </span>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {thread?.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.direction === 'outbound' || msg.direction === 'outbound_reply' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-xl px-4 py-3 ${
                      msg.direction === 'outbound' || msg.match_type === 'outbound_reply'
                        ? 'bg-purple-600/20 border border-purple-500/30'
                        : 'bg-gray-800 border border-gray-700'
                    }`}>
                      {/* Subject line */}
                      {msg.subject && (
                        <p className="text-[10px] text-gray-400 mb-1 font-medium">{msg.subject}</p>
                      )}
                      {/* Body */}
                      <div className="text-sm text-gray-200 leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.body_preview || msg.snippet || '') }} />
                      {/* Meta */}
                      <div className="flex items-center gap-2 mt-2">
                        <Clock className="w-3 h-3 text-gray-600" />
                        <span className="text-[10px] text-gray-500">
                          {msg.received_at ? new Date(msg.received_at).toLocaleString('sv-SE', {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                          }) : ''}
                        </span>
                        {msg.direction === 'outbound' && (
                          <span className="text-[10px] text-purple-400">Skickat</span>
                        )}
                        {msg.followup_step > 0 && (
                          <span className="text-[10px] text-yellow-400">Uppföljning #{msg.followup_step}</span>
                        )}
                        {msg.ai_sentiment && (
                          <span className={`text-[10px] px-1.5 rounded ${
                            msg.ai_sentiment === 'positive' ? 'bg-green-500/20 text-green-300' :
                            msg.ai_sentiment === 'negative' ? 'bg-red-500/20 text-red-300' :
                            'bg-gray-500/20 text-gray-300'
                          }`}>{msg.ai_sentiment}</span>
                        )}
                      </div>
                      {/* AI summary */}
                      {msg.ai_summary && (
                        <div className="mt-2 text-[10px] text-gray-400 bg-gray-900/50 rounded px-2 py-1">
                          AI: {msg.ai_summary}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={threadEndRef} />
              </div>

              {/* Reply area */}
              <div className="border-t border-gray-800 px-4 py-3 shrink-0">
                <div className="flex gap-2">
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Skriv ett svar..."
                    rows={2}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white resize-none focus:border-purple-500 focus:outline-none placeholder-gray-500"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleReply()
                    }}
                  />
                  <button
                    onClick={handleReply}
                    disabled={sending || !replyText.trim()}
                    className="self-end flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg disabled:opacity-50 transition-colors"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Skicka
                  </button>
                </div>
                <p className="text-[10px] text-gray-600 mt-1">Ctrl+Enter för att skicka</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
