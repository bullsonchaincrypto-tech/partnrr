import { useState, useCallback, useMemo, useEffect, Component } from 'react'
import { LayoutDashboard, Send, HelpCircle, AlertTriangle } from 'lucide-react'
import OutreachWizard from './components/wizard/OutreachWizard'
import Dashboard from './components/dashboard/Dashboard'
import Onboarding from './components/common/Onboarding'
import SigneraPage from './components/signing/SigneraPage'
import AiChat from './components/common/AiChat'
import { ThemeToggle } from './components/common/ThemeProvider'
import { useKeyboardShortcuts, ShortcutHint } from './hooks/useKeyboardShortcuts'

// Error Boundary — fångar React-krasch utan att hela sidan blir blank
class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(err, info) { console.error('[ErrorBoundary]', err, info) }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-400 mb-4" />
          <h2 className="text-lg font-bold text-white mb-2">Något gick fel</h2>
          <p className="text-sm text-gray-400 mb-4 max-w-md">{this.state.error?.message}</p>
          <button onClick={() => this.setState({ error: null })}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-500">
            Försök igen
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

const NAV_ITEMS = [
  { key: 'wizard', label: 'Utskick', icon: Send, shortcut: '1' },
  { key: 'dashboard', label: 'Kontrollpanel', icon: LayoutDashboard, shortcut: '2' },
]

export default function App() {
  const [page, setPage] = useState('wizard')
  const [dashboardMounted, setDashboardMounted] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try { return !sessionStorage.getItem('partnrr_onboarding_done') } catch { return true }
  })
  const [showShortcuts, setShowShortcuts] = useState(false)

  // Rensa ?auth=success/error från URL efter OAuth-redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('auth')) {
      params.delete('auth')
      params.delete('msg')
      const clean = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (clean ? '?' + clean : ''))
    }
  }, [])

  // Lazy-mount Dashboard — bara montera första gången man navigerar dit
  const handleSetPage = useCallback((p) => {
    if (p === 'dashboard' && !dashboardMounted) setDashboardMounted(true)
    setPage(p)
  }, [dashboardMounted])

  // Kolla om vi är på signeringssidan (publikt, ingen nav)
  const signingToken = useMemo(() => {
    const match = window.location.pathname.match(/^\/signera\/([a-f0-9]+)$/i)
    return match ? match[1] : null
  }, [])

  // Rendera signeringssidan direkt utan nav
  if (signingToken) {
    return <SigneraPage token={signingToken} />
  }

  // Global keyboard shortcuts
  useKeyboardShortcuts([
    { key: '1', ctrl: true, handler: () => handleSetPage('wizard') },
    { key: '2', ctrl: true, handler: () => handleSetPage('dashboard') },
    { key: '/', ctrl: false, shift: false, handler: () => setShowShortcuts(s => !s) },
  ])

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Onboarding */}
      {showOnboarding && <Onboarding onComplete={() => {
        setShowOnboarding(false)
        try { sessionStorage.setItem('partnrr_onboarding_done', '1') } catch {}
      }} />}

      {/* Keyboard shortcuts modal */}
      {showShortcuts && (
        <div className="fixed inset-0 z-[9997] flex items-center justify-center" onClick={() => setShowShortcuts(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-4">Tangentbordsgenvägar</h3>
            <div className="space-y-3 text-sm">
              {[
                { keys: ['Ctrl', '1'], desc: 'Outreach' },
                { keys: ['Ctrl', '2'], desc: 'Dashboard' },
                { keys: ['Ctrl', 'Enter'], desc: 'Skicka / Bekräfta' },
                { keys: ['Esc'], desc: 'Stäng dialoger' },
                { keys: ['/'], desc: 'Visa/dölj genvägar' },
              ].map((s, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-gray-300">{s.desc}</span>
                  <ShortcutHint keys={s.keys} />
                </div>
              ))}
            </div>
            <button onClick={() => setShowShortcuts(false)}
              className="mt-5 w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 rounded-lg text-sm transition-colors">
              Stäng
            </button>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2.5">
              {/* Partnrr Logo */}
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/25">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M7 4h5a5 5 0 0 1 0 10H9v6H7V4z" fill="white" />
                  <circle cx="12" cy="9" r="2.5" fill="url(#pg)" />
                  <defs>
                    <linearGradient id="pg" x1="10" y1="7" x2="14" y2="11">
                      <stop stopColor="#a855f7" />
                      <stop offset="1" stopColor="#ec4899" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <span className="text-xl font-extrabold text-white tracking-tight">Partnrr</span>
            </div>
            <div className="flex items-center gap-1">
              {NAV_ITEMS.map(({ key, label, icon: Icon, shortcut }) => (
                <button
                  key={key}
                  onClick={() => handleSetPage(key)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    page === key
                      ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/20'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
              <div className="w-px h-6 bg-gray-800 mx-1" />
              <ThemeToggle />
              <button
                onClick={() => setShowOnboarding(true)}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
                title="Visa guide"
              >
                <HelpCircle className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Content — båda renderas men bara aktiv sida visas (behåller wizard-state) */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 w-full flex-1">
        <ErrorBoundary>
          <div className={page === 'wizard' ? 'step-fade-in' : 'hidden'}>
            <OutreachWizard onNavigate={handleSetPage} />
          </div>
          {dashboardMounted && (
            <div className={page === 'dashboard' ? 'step-fade-in' : 'hidden'}>
              <Dashboard />
            </div>
          )}
        </ErrorBoundary>
      </main>

      {/* AI Chat-assistent (flytande) */}
      <AiChat />
    </div>
  )
}
