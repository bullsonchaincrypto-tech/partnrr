import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
}

const STYLES = {
  success: 'border-green-600/50 bg-green-950/90 text-green-200',
  error: 'border-red-600/50 bg-red-950/90 text-red-200',
  warning: 'border-yellow-600/50 bg-yellow-950/90 text-yellow-200',
  info: 'border-blue-600/50 bg-blue-950/90 text-blue-200',
}

const ICON_STYLES = {
  success: 'text-green-400',
  error: 'text-red-400',
  warning: 'text-yellow-400',
  info: 'text-blue-400',
}

function ToastItem({ toast, onRemove }) {
  const [isExiting, setIsExiting] = useState(false)
  const [isEntering, setIsEntering] = useState(true)
  const Icon = ICONS[toast.type] || Info

  useEffect(() => {
    requestAnimationFrame(() => setIsEntering(false))
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true)
      setTimeout(() => onRemove(toast.id), 300)
    }, toast.duration || 4000)
    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, onRemove])

  const handleClose = () => {
    setIsExiting(true)
    setTimeout(() => onRemove(toast.id), 300)
  }

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-lg border backdrop-blur-sm shadow-lg transition-all duration-300 max-w-sm ${STYLES[toast.type]}
        ${isEntering ? 'translate-x-full opacity-0' : isExiting ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}
      `}
    >
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${ICON_STYLES[toast.type]}`} />
      <div className="flex-1 min-w-0">
        {toast.title && <p className="text-sm font-semibold">{toast.title}</p>}
        <p className="text-sm opacity-90">{toast.message}</p>
      </div>
      <button onClick={handleClose} className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback((type, message, options = {}) => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, type, message, ...options }])
    return id
  }, [])

  const toast = useCallback({
    success: (msg, opts) => addToast('success', msg, opts),
    error: (msg, opts) => addToast('error', msg, opts),
    warning: (msg, opts) => addToast('warning', msg, opts),
    info: (msg, opts) => addToast('info', msg, opts),
  }, [addToast])

  // Make toast callable with proper reference stability
  const toastRef = useCallback((type, msg, opts) => addToast(type, msg, opts), [addToast])
  toastRef.success = useCallback((msg, opts) => addToast('success', msg, opts), [addToast])
  toastRef.error = useCallback((msg, opts) => addToast('error', msg, opts), [addToast])
  toastRef.warning = useCallback((msg, opts) => addToast('warning', msg, opts), [addToast])
  toastRef.info = useCallback((msg, opts) => addToast('info', msg, opts), [addToast])

  return (
    <ToastContext.Provider value={toastRef}>
      {children}
      {/* Toast container */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onRemove={removeToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
