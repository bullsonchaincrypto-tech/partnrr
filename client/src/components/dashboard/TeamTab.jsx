import { useState, useEffect } from 'react'
import { Users, UserPlus, Shield, Eye, Settings, Trash2, Loader2, Clock, Activity, ChevronDown, ChevronUp, Mail } from 'lucide-react'
import * as api from '../../services/api'

const ROLE_CONFIG = {
  admin: { label: 'Admin', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30', icon: Shield, desc: 'Full access till allt' },
  manager: { label: 'Manager', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30', icon: Settings, desc: 'Outreach, kontrakt & analys' },
  viewer: { label: 'Viewer', color: 'bg-gray-500/20 text-gray-300 border-gray-500/30', icon: Eye, desc: 'Läsrättighet' },
}

export default function TeamTab() {
  const [members, setMembers] = useState([])
  const [stats, setStats] = useState(null)
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [showActivity, setShowActivity] = useState(false)
  const [inviteForm, setInviteForm] = useState({ namn: '', epost: '', roll: 'viewer' })
  const [inviting, setInviting] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editRoll, setEditRoll] = useState('')

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [m, s, a] = await Promise.all([
        api.getTeamMembers(),
        api.getTeamStats(),
        api.getTeamActivity(20),
      ])
      setMembers(m)
      setStats(s)
      setActivity(a)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleInvite = async () => {
    if (!inviteForm.namn.trim() || !inviteForm.epost.trim()) return
    try {
      setInviting(true)
      await api.inviteTeamMember(inviteForm)
      setInviteForm({ namn: '', epost: '', roll: 'viewer' })
      setShowInvite(false)
      loadData()
    } catch (err) {
      alert(err.message)
    } finally {
      setInviting(false)
    }
  }

  const handleUpdateRole = async (id) => {
    if (!editRoll) return
    try {
      await api.updateTeamMember(id, { roll: editRoll })
      setEditingId(null)
      loadData()
    } catch (err) {
      alert(err.message)
    }
  }

  const handleDelete = async (id, namn) => {
    if (!confirm(`Ta bort ${namn} från teamet?`)) return
    try {
      await api.deleteTeamMember(id)
      loadData()
    } catch (err) {
      alert(err.message)
    }
  }

  const formatRelative = (dateStr) => {
    if (!dateStr) return 'Aldrig'
    const d = new Date(dateStr)
    const now = new Date()
    const diff = now - d
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just nu'
    if (mins < 60) return `${mins} min sedan`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h sedan`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d sedan`
    return d.toLocaleDateString('sv-SE')
  }

  const getActionLabel = (action) => {
    const labels = {
      team_invite: 'Bjöd in',
      team_remove: 'Tog bort',
      role_change: 'Ändrade roll',
      outreach_sent: 'Skickade outreach',
      contract_signed: 'Kontrakt signerat',
      contract_sent: 'Skickade kontrakt',
      influencer_added: 'Lade till influencer',
    }
    return labels[action] || action
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-400" />
            Team
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">{members.length} medlemmar</p>
        </div>
        <button
          onClick={() => setShowInvite(!showInvite)}
          className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <UserPlus className="w-4 h-4" /> Bjud in
        </button>
      </div>

      {/* Statistik-kort */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
            <p className="text-2xl font-bold text-white">{stats.total_members}</p>
            <p className="text-xs text-gray-500">Teammedlemmar</p>
          </div>
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
            <p className="text-2xl font-bold text-purple-400">{stats.by_role?.admin || 0}</p>
            <p className="text-xs text-gray-500">Admins</p>
          </div>
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
            <p className="text-2xl font-bold text-blue-400">{stats.by_role?.manager || 0}</p>
            <p className="text-xs text-gray-500">Managers</p>
          </div>
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
            <p className="text-2xl font-bold text-green-400">{stats.active_today}</p>
            <p className="text-xs text-gray-500">Aktiva idag</p>
          </div>
        </div>
      )}

      {/* Bjud in-formulär */}
      {showInvite && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h3 className="text-sm font-medium text-white mb-3">Bjud in ny teammedlem</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              placeholder="Namn"
              value={inviteForm.namn}
              onChange={(e) => setInviteForm(f => ({ ...f, namn: e.target.value }))}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
            <input
              type="email"
              placeholder="E-post"
              value={inviteForm.epost}
              onChange={(e) => setInviteForm(f => ({ ...f, epost: e.target.value }))}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
            <select
              value={inviteForm.roll}
              onChange={(e) => setInviteForm(f => ({ ...f, roll: e.target.value }))}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
            >
              <option value="viewer">Viewer (läsrättighet)</option>
              <option value="manager">Manager (outreach & kontrakt)</option>
              <option value="admin">Admin (full access)</option>
            </select>
          </div>

          {/* Roller förklaring */}
          <div className="grid grid-cols-3 gap-2 mt-3">
            {Object.entries(ROLE_CONFIG).map(([key, cfg]) => {
              const Icon = cfg.icon
              return (
                <div key={key} className={`rounded-lg p-2 border text-center ${
                  inviteForm.roll === key ? cfg.color : 'bg-gray-900/50 border-gray-800 text-gray-600'
                }`}>
                  <Icon className="w-4 h-4 mx-auto mb-1" />
                  <p className="text-xs font-medium">{cfg.label}</p>
                  <p className="text-[10px] opacity-70">{cfg.desc}</p>
                </div>
              )
            })}
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={handleInvite}
              disabled={inviting || !inviteForm.namn.trim() || !inviteForm.epost.trim()}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Skicka inbjudan
            </button>
            <button
              onClick={() => setShowInvite(false)}
              className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 transition-colors"
            >
              Avbryt
            </button>
          </div>
        </div>
      )}

      {/* Medlemslista */}
      <div className="space-y-2">
        {members.map(m => {
          const roleCfg = ROLE_CONFIG[m.roll] || ROLE_CONFIG.viewer
          const RoleIcon = roleCfg.icon
          const isEditing = editingId === m.id

          return (
            <div key={m.id} className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-4 flex items-center gap-4">
              {/* Avatar */}
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500/30 to-pink-500/30 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                {(m.namn || '?').charAt(0).toUpperCase()}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white text-sm">{m.namn}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${roleCfg.color} flex items-center gap-1`}>
                    <RoleIcon className="w-3 h-3" /> {roleCfg.label}
                  </span>
                  {m.invite_status === 'invited' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/20">Inbjuden</span>
                  )}
                </div>
                <p className="text-xs text-gray-500">{m.epost}</p>
              </div>

              {/* Aktivitet */}
              <div className="text-right flex-shrink-0 hidden sm:block">
                <p className="text-xs text-gray-400">{m.activity_count_30d} aktiviteter</p>
                <p className="text-[10px] text-gray-600">
                  Senast: {formatRelative(m.last_active_at)}
                </p>
              </div>

              {/* Byt roll */}
              {isEditing ? (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <select
                    value={editRoll}
                    onChange={(e) => setEditRoll(e.target.value)}
                    className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    onClick={() => handleUpdateRole(m.id)}
                    className="text-xs text-green-400 hover:text-green-300 px-2 py-1"
                  >Spara</button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-xs text-gray-400 hover:text-gray-300 px-1"
                  >✕</button>
                </div>
              ) : (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => { setEditingId(m.id); setEditRoll(m.roll) }}
                    className="text-xs text-gray-500 hover:text-gray-300 p-1.5 rounded hover:bg-gray-700/50"
                    title="Ändra roll"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(m.id, m.namn)}
                    className="text-xs text-gray-500 hover:text-red-400 p-1.5 rounded hover:bg-gray-700/50"
                    title="Ta bort"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {members.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Inga teammedlemmar ännu</p>
            <p className="text-xs mt-1">Klicka "Bjud in" för att lägga till ditt team</p>
          </div>
        )}
      </div>

      {/* Aktivitetslogg */}
      <div>
        <button
          onClick={() => setShowActivity(!showActivity)}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <Activity className="w-4 h-4" />
          Aktivitetslogg
          {showActivity ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showActivity && (
          <div className="mt-3 space-y-1 max-h-64 overflow-y-auto">
            {activity.map(a => (
              <div key={a.id} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-gray-800/20 text-xs">
                <Clock className="w-3 h-3 text-gray-600 flex-shrink-0" />
                <span className="text-gray-500 w-16 flex-shrink-0">{formatRelative(a.created_at)}</span>
                <span className="text-purple-400 font-medium flex-shrink-0">{a.user_name}</span>
                <span className="text-gray-400">{getActionLabel(a.action)}</span>
                {a.details && <span className="text-gray-500 truncate">{a.details}</span>}
              </div>
            ))}

            {activity.length === 0 && (
              <p className="text-xs text-gray-600 py-4 text-center">Ingen aktivitet ännu</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
