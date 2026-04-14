import { useState, useEffect, useRef } from 'react'

/**
 * SparkBurst — visas i 700-900ms när någon nyckelhändelse triggas.
 * Använd via ref.current.trigger() eller via `show`-prop.
 *
 * Exempel:
 *   const burstRef = useRef()
 *   <SparkBurst ref={burstRef} />
 *   <button onClick={() => burstRef.current?.trigger()}>Signera</button>
 *
 * Eller enklare — wrap ett element och passa `active`:
 *   <SparkBurst active={justSent}>
 *     <CheckIcon />
 *   </SparkBurst>
 */
export function SparkBurst({ active = false, children, onComplete }) {
  const [showBurst, setShowBurst] = useState(false)

  useEffect(() => {
    if (active) {
      setShowBurst(true)
      const t = setTimeout(() => {
        setShowBurst(false)
        onComplete?.()
      }, 900)
      return () => clearTimeout(t)
    }
  }, [active, onComplete])

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      {children}
      {showBurst && <span className="spark-burst" aria-hidden="true" />}
    </span>
  )
}

/**
 * SparkPulse — kontinuerlig puls runt ett element (t.ex. "ny match" badge)
 */
export function SparkPulse({ children, className = '' }) {
  return (
    <span className={`spark-pulse ${className}`} style={{ borderRadius: 9999, display: 'inline-block' }}>
      {children}
    </span>
  )
}

/**
 * SparkSent — gnistspår åt höger (t.ex. "mail skickat")
 */
export function SparkSent({ active = false, children }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (active) {
      setShow(true)
      const t = setTimeout(() => setShow(false), 800)
      return () => clearTimeout(t)
    }
  }, [active])
  return (
    <span className={show ? 'spark-sent' : ''} style={{ position: 'relative', display: 'inline-block' }}>
      {children}
    </span>
  )
}

/**
 * SparkToast — flytande toast uppe i högra hörnet som dyker upp
 * i ~2s med en spark-burst-animation. Använd för enstaka events.
 */
export function SparkToast({ message, active, onDone }) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    if (active) {
      setVisible(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        setVisible(false)
        onDone?.()
      }, 2400)
    }
    return () => clearTimeout(timerRef.current)
  }, [active, onDone])

  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 24,
        right: 24,
        zIndex: 9999,
        padding: '12px 18px 12px 42px',
        borderRadius: 'var(--sc-radius-lg)',
        background: 'var(--sc-bg-raised)',
        color: 'var(--sc-fg)',
        border: '1px solid var(--sc-border)',
        boxShadow: 'var(--sc-shadow-lg)',
        fontFamily: 'var(--sc-font-body)',
        fontSize: 14,
        fontWeight: 500,
        animation: 'fadeIn 0.25s ease-out',
        pointerEvents: 'none',
      }}
      aria-live="polite"
    >
      <span
        className="spark-burst"
        aria-hidden="true"
        style={{ position: 'absolute', left: 18, top: '50%' }}
      />
      {message}
    </div>
  )
}

export default SparkBurst
