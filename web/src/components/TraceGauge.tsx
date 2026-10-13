import { useEffect, useState } from 'react'

const R = 42
const C = 2 * Math.PI * R

/** Small radial ring showing the share of facts that passed verification. */
export default function TraceGauge({ ratio, label }: { ratio: number; label: string }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(ratio))
    return () => cancelAnimationFrame(id)
  }, [ratio])

  return (
    <div className="ring">
      <svg viewBox="0 0 100 100" width="100%" role="img" aria-label={`${Math.round(ratio * 100)}% ${label}`}>
        <circle cx="50" cy="50" r={R} className="ring__track" />
        <circle
          cx="50"
          cy="50"
          r={R}
          className="ring__value"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - shown)}
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="50" textAnchor="middle" className="ring__pct">
          {Math.round(ratio * 100)}%
        </text>
        <text x="50" y="66" textAnchor="middle" className="ring__cap">
          {label}
        </text>
      </svg>
    </div>
  )
}
