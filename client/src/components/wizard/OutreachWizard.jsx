import { useState, useEffect, useCallback, useRef } from 'react'
import { Building2, Search, MessageSquare, FileText, Eye, Send, Zap, RotateCcw, Mail, ExternalLink, CheckCircle, Loader2, Unplug, ArrowLeft, Eye as EyeIcon, EyeOff, AlertCircle, Globe } from 'lucide-react'
import * as api from '../../services/api'
import Step1Foretag from './Step1Foretag'
import Step2HittaInfluencers from './Step2HittaInfluencers'
import Step4GenerateOutreach from './Step4GenerateOutreach'
import StepKontraktBrief from './StepKontraktBrief'
import Step6Review from './Step6Review'
import Step7Send from './Step7Send'

const FULL_STEPS = [
  { key: 'foretag', label: 'Företagsprofil', icon: Building2 },
  { key: 'hitta', label: 'Hitta & Välj', icon: Search },
  { key: 'generera', label: 'Generera utskick', icon: MessageSquare },
  { key: 'kontrakt', label: 'Kontrakt', icon: FileText },
  { key: 'granska', label: 'Granska', icon: Eye },
  { key: 'skicka', label: 'Skicka', icon: Send },
]

const QUICK_STEPS = [
  { key: 'foretag', label: 'Företagsprofil', icon: Building2 },
  { key: 'hitta', label: 'Hitta & Välj', icon: Search },
  { key: 'generera', label: 'Generera utskick', icon: MessageSquare },
  { key: 'granska', label: 'Granska', icon: Eye },
  { key: 'skicka', label: 'Skicka', icon: Send },
]

const FULL_COMPONENTS = {
  foretag: Step1Foretag,
  hitta: Step2HittaInfluencers,
  generera: Step4GenerateOutreach,
  kontrakt: StepKontraktBrief,
  granska: Step6Review,
  skicka: Step7Send,
}

const QUICK_COMPONENTS = {
  foretag: Step1Foretag,
  hitta: Step2HittaInfluencers,
  generera: Step4GenerateOutreach,
  granska: Step6Review,
  skicka: Step7Send,
}

// Hjälpfunktioner för att spara/ladda wizard-state
const STORAGE_KEY = 'partnrr_wizard_state'
const BOOT_ID_KEY = 'partnrr_server_boot_id'

function loadSavedState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

function saveState(state) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

function clearSavedState() {
  try { sessionStorage.removeItem(STORAGE_KEY) } catch {}
}

// Kolla om servern har startats om — om ja, rensa gammal data
async function checkServerBoot() {
  try {
    const res = await fetch('http://localhost:3001/api/health')
    const data = await res.json()
    const savedBootId = sessionStorage.getItem(BOOT_ID_KEY)
    if (savedBootId && savedBootId !== data.bootId) {
      // Servern har startats om — rensa sessionStorage
      console.log('[Wizard] Server omstartad, rensar gammal wizard-data')
      clearSavedState()
    }
    sessionStorage.setItem(BOOT_ID_KEY, data.bootId)
    return savedBootId !== data.bootId && savedBootId !== null
  } catch {
    return false
  }
}

// Beräkna vilket steg som faktiskt är "klart" baserat på data
function computeMaxStep(state) {
  if (!state.foretag?.id && !state.foretag?.namn) return 0  // Steg 1 ej klart
  const hasSelected = (state.influencers || []).some(i => i.vald)
  if (!hasSelected) return 0  // Steg 2 ej klart
  if (!state.messages?.length) return 1  // Steg 3 ej klart
  return state.maxReachedStep || 2
}

// ═══════════════════════════════════════════════════════════
// EmailConnectScreen — välj och anslut e-postleverantör
// ═══════════════════════════════════════════════════════════
const EMAIL_PROVIDERS = [
  {
    id: 'gmail',
    name: 'Gmail',
    icon: '✉️',
    color: 'from-red-500/20 to-orange-500/20 border-red-500/30 hover:border-red-400/50',
    description: 'Google-konto via OAuth',
    type: 'oauth',
  },
  {
    id: 'outlook',
    name: 'Outlook / Hotmail',
    icon: '📧',
    color: 'from-blue-500/20 to-cyan-500/20 border-blue-500/30 hover:border-blue-400/50',
    description: 'Microsoft-konto via OAuth',
    type: 'oauth',
  },
]

function EmailConnectScreen({ onConnected }) {
  const [selectedProvider, setSelectedProvider] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpSecure, setSmtpSecure] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [testing, setTesting] = useState(false)
  const [testOk, setTestOk] = useState(null)

  const provider = EMAIL_PROVIDERS.find(p => p.id === selectedProvider)

  const handleSmtpConnect = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await api.connectSmtp({
        provider: selectedProvider,
        email,
        password,
        host: selectedProvider === 'custom' ? smtpHost : undefined,
        port: selectedProvider === 'custom' ? parseInt(smtpPort) : undefined,
        secure: selectedProvider === 'custom' ? smtpSecure : undefined,
        displayName: displayName || undefined,
      })
      onConnected()
    } catch (err) {
      setError(err.message || 'Kunde inte ansluta. Kontrollera uppgifterna och försök igen.')
    } finally {
      setLoading(false)
    }
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestOk(null)
    setError(null)
    try {
      const result = await api.testSmtp({
        provider: selectedProvider,
        email,
        password,
        host: selectedProvider === 'custom' ? smtpHost : undefined,
        port: selectedProvider === 'custom' ? parseInt(smtpPort) : undefined,
        secure: selectedProvider === 'custom' ? smtpSecure : undefined,
      })
      setTestOk(result.ok)
      if (!result.ok) setError(result.error)
    } catch (err) {
      setTestOk(false)
      setError(err.message)
    } finally {
      setTesting(false)
    }
  }

  // ── Provider selection screen ──
  if (!selectedProvider) {
    return (
      <div className="max-w-lg mx-auto py-12">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-purple-600/20 flex items-center justify-center mx-auto mb-4">
            <Mail className="w-8 h-8 text-purple-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Anslut din e-post</h2>
          <p className="text-gray-400 text-sm">
            Partnrr behöver tillgång till ett e-postkonto för att skicka outreach-meddelanden. Välj din leverantör nedan.
          </p>
        </div>

        <div className="grid gap-3">
          {EMAIL_PROVIDERS.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedProvider(p.id)}
              className={`flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-r ${p.color} transition-all text-left group`}
            >
              <span className="text-2xl">{p.icon}</span>
              <div className="flex-1">
                <div className="text-white font-medium group-hover:text-white/90">{p.name}</div>
                <div className="text-gray-400 text-xs">{p.description}</div>
              </div>
              <ExternalLink className="w-4 h-4 text-gray-500 group-hover:text-gray-300 transition-colors" />
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Gmail OAuth redirect ──
  if (selectedProvider === 'gmail') {
    return (
      <div className="max-w-md mx-auto py-12 text-center">
        <button onClick={() => setSelectedProvider(null)} className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm mb-6 mx-auto transition-colors">
          <ArrowLeft className="w-4 h-4" /> Tillbaka
        </button>
        <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">✉️</span>
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Anslut Gmail</h2>
        <p className="text-gray-400 text-sm mb-6">
          Du dirigeras till Google för att ge Partnrr tillgång att skicka e-post via ditt Gmail-konto.
        </p>
        <a
          href={`${import.meta.env.VITE_API_URL || ''}/api/auth/google`}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
        >
          <Mail className="w-5 h-5" />
          Anslut Gmail via Google
          <ExternalLink className="w-4 h-4" />
        </a>
        <p className="text-gray-600 text-xs mt-4">
          Sidan uppdateras automatiskt när anslutningen är klar.
        </p>
      </div>
    )
  }

  // ── Outlook/Hotmail OAuth redirect ──
  if (selectedProvider === 'outlook') {
    return (
      <div className="max-w-md mx-auto py-12 text-center">
        <button onClick={() => setSelectedProvider(null)} className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm mb-6 mx-auto transition-colors">
          <ArrowLeft className="w-4 h-4" /> Tillbaka
        </button>
        <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">📧</span>
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Anslut Outlook / Hotmail</h2>
        <p className="text-gray-400 text-sm mb-6">
          Du dirigeras till Microsoft för att ge Partnrr tillgång att skicka e-post via ditt Outlook/Hotmail-konto.
        </p>
        <a
          href={`${import.meta.env.VITE_API_URL || ''}/api/auth/microsoft`}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
        >
          <Mail className="w-5 h-5" />
          Anslut via Microsoft
          <ExternalLink className="w-4 h-4" />
        </a>
        <p className="text-gray-600 text-xs mt-4">
          Sidan uppdateras automatiskt när anslutningen är klar.
        </p>
      </div>
    )
  }

  // ── SMTP login form (Yahoo, Custom) ──
  return (
    <div className="max-w-md mx-auto py-12">
      <button onClick={() => { setSelectedProvider(null); setError(null); setTestOk(null) }} className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Tillbaka
      </button>

      <div className="text-center mb-6">
        <span className="text-3xl mb-2 block">{provider.icon}</span>
        <h2 className="text-xl font-bold text-white">Anslut {provider.name}</h2>
      </div>

      {provider.hint && (
        <div className="flex items-start gap-2 bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-3 mb-5 text-sm text-blue-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{provider.hint}</span>
        </div>
      )}

      <form onSubmit={handleSmtpConnect} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">E-postadress</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="din@email.com"
            required
            className="w-full px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Lösenord / App-lösenord</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none pr-10"
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              {showPassword ? <EyeOff className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Visningsnamn <span className="text-gray-600">(valfritt)</span></label>
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="Ditt Företag"
            className="w-full px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
          />
        </div>

        {selectedProvider === 'custom' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">SMTP-server</label>
                <input
                  type="text"
                  value={smtpHost}
                  onChange={e => setSmtpHost(e.target.value)}
                  placeholder="smtp.example.com"
                  required
                  className="w-full px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Port</label>
                <input
                  type="number"
                  value={smtpPort}
                  onChange={e => setSmtpPort(e.target.value)}
                  placeholder="587"
                  required
                  className="w-full px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input type="checkbox" checked={smtpSecure} onChange={e => setSmtpSecure(e.target.checked)} className="rounded bg-gray-800 border-gray-600" />
              Använd SSL/TLS (port 465)
            </label>
          </>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {testOk === true && (
          <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 text-sm text-green-300">
            <CheckCircle className="w-4 h-4" />
            Anslutningen fungerar!
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={!email || !password || testing || (selectedProvider === 'custom' && !smtpHost)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:border-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
            Testa anslutning
          </button>
          <button
            type="submit"
            disabled={!email || !password || loading || (selectedProvider === 'custom' && !smtpHost)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            Anslut
          </button>
        </div>
      </form>
    </div>
  )
}

export default function OutreachWizard({ onNavigate }) {
  const saved = loadSavedState()

  // Validera sparad data — om foretag saknas, starta om
  const validSaved = saved?.foretag ? saved : null

  const [quickMode, setQuickMode] = useState(validSaved?.quickMode ?? false)
  const [currentStep, setCurrentStep] = useState(0) // Alltid börja på steg 0 vid laddning
  const [maxReachedStep, setMaxReachedStep] = useState(() => validSaved ? computeMaxStep(validSaved) : 0)
  const [foretag, setForetag] = useState(validSaved?.foretag ?? null)
  const [outreachType, setOutreachType] = useState(validSaved?.outreachType ?? 'influencer')
  const [influencers, setInfluencers] = useState(validSaved?.influencers ?? [])
  const [messages, setMessages] = useState(validSaved?.messages ?? [])
  const [attachContracts, setAttachContracts] = useState(validSaved?.attachContracts ?? false)
  const [kontaktperson, setKontaktperson] = useState(validSaved?.kontaktperson ?? '')
  const [outreachBrief, setOutreachBrief] = useState(validSaved?.outreachBrief ?? null)
  const [kontraktBrief, setKontraktBrief] = useState(validSaved?.kontraktBrief ?? null)
  const [sponsorQuestions, setSponsorQuestions] = useState(validSaved?.sponsorQuestions ?? {
    samarbetstyper: [],
    vadNiErbjuder: '',
    sponsorPris: '',
  })
  const [sendResults, setSendResults] = useState(null)

  // Gmail-anslutning — måste ske innan wizarden kan användas
  const [gmailStatus, setGmailStatus] = useState(null) // null = laddar, obj = resultat
  const [gmailChecking, setGmailChecking] = useState(true)

  const checkGmail = useCallback(async () => {
    setGmailChecking(true)
    try {
      const status = await api.getAuthStatus()
      setGmailStatus(status)
    } catch {
      setGmailStatus({ authenticated: false })
    } finally {
      setGmailChecking(false)
    }
  }, [])

  // Vid mount: kolla Gmail + server boot
  const bootChecked = useRef(false)
  useEffect(() => {
    checkGmail()
    if (bootChecked.current) return
    bootChecked.current = true
    checkServerBoot().then(wasRestarted => {
      if (wasRestarted) resetWizard()
    })
  }, [])

  // Polla Gmail-status var 3:e sekund om ej ansluten (användaren kan vara i annat fönster)
  useEffect(() => {
    if (gmailStatus?.authenticated) return
    const interval = setInterval(checkGmail, 3000)
    return () => clearInterval(interval)
  }, [gmailStatus?.authenticated, checkGmail])

  // Uppdatera högsta nådda steg
  useEffect(() => {
    if (currentStep > maxReachedStep) setMaxReachedStep(currentStep)
  }, [currentStep])

  // Spara state vid varje ändring
  useEffect(() => {
    saveState({ quickMode, currentStep, maxReachedStep, foretag, outreachType, influencers, messages, attachContracts, kontaktperson, outreachBrief, kontraktBrief, sponsorQuestions })
  }, [quickMode, currentStep, maxReachedStep, foretag, outreachType, influencers, messages, attachContracts, kontaktperson, outreachBrief, kontraktBrief, sponsorQuestions])

  const steps = quickMode ? QUICK_STEPS : FULL_STEPS
  const components = quickMode ? QUICK_COMPONENTS : FULL_COMPONENTS
  const totalSteps = steps.length

  const next = () => setCurrentStep((s) => Math.min(s + 1, totalSteps - 1))
  const prev = () => setCurrentStep((s) => Math.max(s - 1, 0))

  const toggleQuickMode = () => {
    setQuickMode(q => !q)
    setCurrentStep(0)
  }

  const resetWizard = () => {
    clearSavedState()
    setCurrentStep(0)
    setMaxReachedStep(0)
    setForetag(null)
    setOutreachType('influencer')
    setInfluencers([])
    setMessages([])
    setAttachContracts(false)
    setKontaktperson('')
    setOutreachBrief(null)
    setKontraktBrief(null)
    setSponsorQuestions({ samarbetstyper: [], vadNiErbjuder: '', sponsorPris: '' })
    setSendResults(null)
  }

  const currentStepKey = steps[currentStep]?.key
  const StepComponent = components[currentStepKey]

  // I snabbläge, skippa kontraktssteget — sätt attachContracts till false
  const effectiveAttachContracts = quickMode ? false : attachContracts

  const stepProps = {
    foretag, setForetag,
    outreachType, setOutreachType,
    influencers, setInfluencers,
    messages, setMessages,
    attachContracts: effectiveAttachContracts, setAttachContracts,
    kontaktperson, setKontaktperson,
    outreachBrief, setOutreachBrief,
    kontraktBrief, setKontraktBrief,
    sponsorQuestions, setSponsorQuestions,
    sendResults, setSendResults,
    next, prev,
    quickMode,
    onNavigate,
  }

  // Gate: E-post måste vara anslutet innan wizarden kan starta
  if (gmailChecking && !gmailStatus) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
        <span className="ml-3 text-gray-400">Kontrollerar e-postanslutning...</span>
      </div>
    )
  }

  if (!gmailStatus?.authenticated) {
    return <EmailConnectScreen onConnected={checkGmail} />
  }

  return (
    <div>
      {/* Toolbar: reset + gmail status + snabbläge */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (window.confirm('Vill du börja om från början? All data i wizarden rensas.')) {
                resetWizard()
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800/50 border border-gray-700 text-gray-400 hover:text-red-400 hover:border-red-500/40 transition-all"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Börja om
          </button>
          {/* E-poststatus */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/10 border border-green-500/30 text-green-400">
            <CheckCircle className="w-3.5 h-3.5" />
            <Mail className="w-3.5 h-3.5" />
            {gmailStatus?.email || 'E-post anslutet'}
            {gmailStatus?.provider && <span className="text-green-500/60 capitalize">({gmailStatus.provider})</span>}
            <button
              onClick={async (e) => { e.stopPropagation(); await api.disconnectAuth(); checkGmail() }}
              className="ml-1.5 flex items-center gap-1 text-gray-500 hover:text-red-400 transition-colors" title="Koppla från e-post">
              <Unplug className="w-3 h-3" />
              <span className="text-[10px]">Koppla från</span>
            </button>
          </div>
        </div>
        <button
          onClick={toggleQuickMode}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
            quickMode
              ? 'bg-yellow-500/10 border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/20'
              : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
          }`}
        >
          <Zap className={`w-3.5 h-3.5 ${quickMode ? 'text-yellow-400' : ''}`} />
          {quickMode ? 'Snabbläge aktivt' : 'Aktivera snabbläge'}
          {!quickMode && <span className="text-gray-600 ml-1">— skippar kontrakt</span>}
        </button>
      </div>

      {/* Quick mode info */}
      {quickMode && currentStep === 0 && (
        <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 mb-4">
          <Zap className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-yellow-300 font-medium">Snabbläge — skicka outreach på under 3 minuter</p>
            <p className="text-yellow-300/60 text-xs mt-0.5">
              Kontraktssteget hoppas över. Du kan alltid skicka kontrakt senare via Avtal-fliken i kontrollpanelen.
            </p>
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {steps.map((step, i) => {
            const Icon = step.icon
            const active = i === currentStep
            const reachable = i <= maxReachedStep
            const done = i < currentStep
            // Kan bara gå tillbaka till klara steg, inte framåt
            const canClick = reachable && i <= currentStep
            return (
              <button
                key={step.key}
                onClick={() => canClick && setCurrentStep(i)}
                className={`flex flex-col items-center gap-1 group ${canClick ? 'cursor-pointer' : 'cursor-default opacity-50'}`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                  active ? (quickMode ? 'bg-yellow-500 text-black' : 'bg-purple-600 text-white') : done ? (quickMode ? 'bg-yellow-500/30 text-yellow-400' : 'bg-purple-600/30 text-purple-400') : 'bg-gray-800 text-gray-500'
                }`}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className={`text-xs font-medium ${active ? (quickMode ? 'text-yellow-400' : 'text-purple-400') : done ? 'text-gray-400' : 'text-gray-600'}`}>
                  {step.label}
                </span>
              </button>
            )
          })}
        </div>
        <div className="mt-3 h-1 bg-gray-800 rounded-full">
          <div
            className={`h-1 rounded-full transition-all duration-300 ${quickMode ? 'bg-yellow-500' : 'bg-purple-600'}`}
            style={{ width: `${(currentStep / (totalSteps - 1)) * 100}%` }}
          />
        </div>
      </div>

      {/* Step content */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        {StepComponent && <StepComponent {...stepProps} />}
      </div>
    </div>
  )
}
