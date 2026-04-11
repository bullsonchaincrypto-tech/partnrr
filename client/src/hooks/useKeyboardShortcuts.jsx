import { useEffect, useCallback } from 'react'

/**
 * useKeyboardShortcut - register a global keyboard shortcut
 * @param {Object[]} shortcuts - array of { key, ctrl, shift, alt, handler, description }
 */
export function useKeyboardShortcuts(shortcuts) {
  const handleKeyDown = useCallback((e) => {
    for (const s of shortcuts) {
      const ctrlMatch = s.ctrl ? (e.ctrlKey || e.metaKey) : true
      const shiftMatch = s.shift ? e.shiftKey : !e.shiftKey
      const altMatch = s.alt ? e.altKey : !e.altKey
      const keyMatch = e.key.toLowerCase() === s.key.toLowerCase()

      if (ctrlMatch && shiftMatch && altMatch && keyMatch) {
        // Don't trigger if typing in an input/textarea (unless explicitly allowed)
        if (!s.allowInInput) {
          const tag = e.target.tagName.toLowerCase()
          if (tag === 'input' || tag === 'textarea' || tag === 'select') {
            // Allow Ctrl+Enter even in inputs
            if (!(s.ctrl && s.key.toLowerCase() === 'enter')) continue
          }
        }
        e.preventDefault()
        s.handler(e)
        return
      }
    }
  }, [shortcuts])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}

/**
 * ShortcutHint - renders a small keyboard shortcut indicator
 */
export function ShortcutHint({ keys, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] text-gray-500 ${className}`}>
      {keys.map((k, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-0.5">+</span>}
          <kbd className="px-1 py-0.5 rounded bg-gray-800 border border-gray-700 font-mono text-gray-400">
            {k}
          </kbd>
        </span>
      ))}
    </span>
  )
}
