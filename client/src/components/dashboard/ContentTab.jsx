import { useState, useEffect } from 'react'
import {
  Monitor, Play, CheckCircle, XCircle, AlertTriangle, Clock,
  Loader2, RefreshCw, ExternalLink, Search, Eye, ThumbsUp, MessageSquare, FileCheck
} from 'lucide-react'
import * as api from '../../services/api'
import ContentApprovalTab from './ContentApprovalTab'

const CTA_COLORS = {
  stark: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Stark CTA' },
  medium: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Medium CTA' },
  svag: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Svag CTA' },
  ingen: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Ingen CTA' },
  ej_analyserad: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Ej analyserad' },
}

export default function ContentTab() {
  const [subTab, setSubTab] = useState('bevakning')
  const [overview, setOverview] = useState(null)
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [selectedVideo, setSelectedVideo] = useState(null)
  const [ctaFilter, setCtaFilter] = useState('alla')

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [o, v] = await Promise.all([
        api.getContentOverview().catch(() => null),
        api.getContentVideos().catch(() => []),
      ])
      setOverview(o)
      setVideos(v)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const handleScan = async () => {
    setScanning(true)
    try {
      await api.triggerContentScan()
      await loadData()
    } catch (err) { console.error(err) }
    finally { setScanning(false) }
  }

  const handleAnalyzeVideo = async (id) => {
    try {
      await api.analyzeVideo(id)
      await loadData()
    } catch (err) { console.error(err) }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
    </div>
  )

  const filteredVideos = ctaFilter === 'alla'
    ? videos
    : videos.filter(v => v.cta_quality === ctaFilter)

  return (
    <div className="space-y-6">

      {/* Sub-tab navigation */}
      <div className="flex gap-2">
        <button onClick={() => setSubTab('bevakning')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg transition-colors ${
            subTab === 'bevakning' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}>
          <Monitor className="w-4 h-4" /> Bevakning
        </button>
        <button onClick={() => setSubTab('godkannande')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg transition-colors ${
            subTab === 'godkannande' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}>
          <FileCheck className="w-4 h-4" /> Godkännande
        </button>
      </div>

      {subTab === 'godkannande' ? (
        <ContentApprovalTab />
      ) : (
      <>

      {/* Header med scan-knapp */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Monitor className="w-6 h-6 text-purple-500" />
          Content-bevakning
        </h2>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
        >
          {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {scanning ? 'Skannar YouTube...' : 'Skanna kanaler nu'}
        </button>
      </div>

      {/* Översiktskort */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={<Play className="w-5 h-5 text-purple-400" />}
            label="Videos spårade"
            value={overview.total_videos_tracked}
          />
          <StatCard
            icon={<CheckCircle className="w-5 h-5 text-green-400" />}
            label="Med CTA"
            value={overview.videos_with_cta}
            sub={overview.total_videos_tracked > 0
              ? `${Math.round(overview.videos_with_cta / overview.total_videos_tracked * 100)}%`
              : '—'}
          />
          <StatCard
            icon={<ExternalLink className="w-5 h-5 text-blue-400" />}
            label="Med referral-länk"
            value={overview.videos_with_referral}
          />
          <StatCard
            icon={<AlertTriangle className="w-5 h-5 text-orange-400" />}
            label="Försenade (>14d)"
            value={overview.influencers_delayed}
            alert={overview.influencers_delayed > 0}
          />
        </div>
      )}

      {/* Avtalsstatus */}
      {overview && overview.influencers_with_deal > 0 && (
        <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Avtalsstatus</h3>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-400">Publicerat content</span>
                <span className="text-white font-medium">
                  {overview.influencers_published} / {overview.influencers_with_deal}
                </span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-3">
                <div
                  className="bg-gradient-to-r from-purple-500 to-green-500 h-3 rounded-full transition-all"
                  style={{ width: `${overview.influencers_with_deal > 0 ? (overview.influencers_published / overview.influencers_with_deal * 100) : 0}%` }}
                />
              </div>
            </div>
            {overview.influencers_missing > 0 && (
              <span className="text-sm text-yellow-400">
                {overview.influencers_missing} väntar
              </span>
            )}
          </div>
        </div>
      )}

      {/* Försenade influencers */}
      {overview?.delayed_influencers?.length > 0 && (
        <div className="bg-red-900/20 rounded-xl p-5 border border-red-700/50">
          <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Försenade influencers — ingen publicering efter avtal
          </h3>
          <div className="space-y-2">
            {overview.delayed_influencers.map(inf => (
              <div key={inf.id} className="flex items-center justify-between text-sm">
                <span className="text-white">{inf.namn} <span className="text-gray-500">(@{inf.kanalnamn})</span></span>
                <span className="text-red-400 font-medium">{inf.days_since_deal} dagar sedan avtal</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA-kvalitetsfördelning */}
      {overview?.cta_quality_breakdown && Object.keys(overview.cta_quality_breakdown).length > 0 && (
        <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">CTA-kvalitet</h3>
          <div className="flex gap-3 flex-wrap">
            {Object.entries(overview.cta_quality_breakdown).map(([quality, count]) => {
              const style = CTA_COLORS[quality] || CTA_COLORS.ej_analyserad
              return (
                <div key={quality} className={`${style.bg} rounded-lg px-4 py-2 flex items-center gap-2`}>
                  <span className={`text-lg font-bold ${style.text}`}>{count}</span>
                  <span className="text-sm text-gray-300">{style.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Video-filter */}
      {videos.length > 0 && (
        <div className="flex gap-2">
          {['alla', 'stark', 'medium', 'svag', 'ingen'].map(f => (
            <button
              key={f}
              onClick={() => setCtaFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                ctaFilter === f
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {f === 'alla' ? 'Alla' : CTA_COLORS[f]?.label || f}
            </button>
          ))}
        </div>
      )}

      {/* Videolista */}
      {filteredVideos.length > 0 ? (
        <div className="space-y-3">
          {filteredVideos.map(video => (
            <VideoCard
              key={video.id}
              video={video}
              onAnalyze={() => handleAnalyzeVideo(video.id)}
              onSelect={() => setSelectedVideo(selectedVideo?.id === video.id ? null : video)}
              isSelected={selectedVideo?.id === video.id}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500">
          <Monitor className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg font-medium">Inga videos att visa</p>
          <p className="text-sm mt-1">
            {overview?.influencers_with_deal > 0
              ? 'Tryck "Skanna kanaler nu" för att leta efter publicerat content'
              : 'Influencers måste ha status "Avtal signerat" för content-bevakning'}
          </p>
        </div>
      )}

      {/* Expanderad video-detalj */}
      {selectedVideo?.ai_analysis && (
        <div className="bg-gray-800/80 rounded-xl p-5 border border-purple-500/30">
          <h3 className="text-sm font-semibold text-purple-400 mb-3">AI-analys</h3>
          <div className="space-y-2 text-sm">
            {selectedVideo.ai_analysis.overall_assessment && (
              <p className="text-gray-300">
                <strong>Bedömning:</strong> {selectedVideo.ai_analysis.overall_assessment}
              </p>
            )}
            {selectedVideo.ai_analysis.cta_details && (
              <p className="text-gray-300">
                <strong>CTA:</strong> {selectedVideo.ai_analysis.cta_details}
              </p>
            )}
            {selectedVideo.ai_analysis.referral_details && (
              <p className="text-gray-300">
                <strong>Referral:</strong> {selectedVideo.ai_analysis.referral_details}
              </p>
            )}
            {selectedVideo.ai_analysis.improvement_suggestions && (
              <p className="text-yellow-400">
                <strong>Förbättringsförslag:</strong> {selectedVideo.ai_analysis.improvement_suggestions}
              </p>
            )}
          </div>
        </div>
      )}

      </>
      )}
    </div>
  )
}

// === Subkomponenter ===

function StatCard({ icon, label, value, sub, alert }) {
  return (
    <div className={`rounded-xl p-4 border ${alert ? 'bg-red-900/20 border-red-700/50' : 'bg-gray-800/50 border-gray-700/50'}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold ${alert ? 'text-red-400' : 'text-white'}`}>{value}</span>
        {sub && <span className="text-sm text-gray-500">{sub}</span>}
      </div>
    </div>
  )
}

function VideoCard({ video, onAnalyze, onSelect, isSelected }) {
  const style = CTA_COLORS[video.cta_quality] || CTA_COLORS.ej_analyserad
  const publishDate = video.published_at ? new Date(video.published_at).toLocaleDateString('sv-SE') : '—'

  return (
    <div
      className={`bg-gray-800/50 rounded-xl p-4 border transition-colors cursor-pointer ${
        isSelected ? 'border-purple-500/50' : 'border-gray-700/50 hover:border-gray-600/50'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-gray-400">{video.influencer_namn}</span>
            <span className="text-gray-600">•</span>
            <span className="text-xs text-gray-500">{publishDate}</span>
          </div>
          <h4 className="text-white font-medium truncate">{video.video_title}</h4>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {formatNumber(video.view_count)}</span>
            <span className="flex items-center gap-1"><ThumbsUp className="w-3 h-3" /> {formatNumber(video.like_count)}</span>
            <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {formatNumber(video.comment_count)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* CTA-badges */}
          <div className="flex gap-1">
            {video.has_company_mention ? (
              <span className="bg-green-500/20 text-green-400 text-xs px-2 py-0.5 rounded">Omnämnd</span>
            ) : null}
            {video.has_referral_link ? (
              <span className="bg-blue-500/20 text-blue-400 text-xs px-2 py-0.5 rounded">Referral</span>
            ) : null}
          </div>

          <span className={`${style.bg} ${style.text} text-xs font-medium px-2.5 py-1 rounded-lg`}>
            {style.label}
          </span>

          {video.status !== 'analyzed' && (
            <button
              onClick={(e) => { e.stopPropagation(); onAnalyze() }}
              className="text-xs text-purple-400 hover:text-purple-300 px-2 py-1 border border-purple-500/30 rounded"
            >
              Analysera
            </button>
          )}

          <a
            href={video.video_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-gray-500 hover:text-white"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  )
}

function formatNumber(n) {
  if (!n) return '0'
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toString()
}
