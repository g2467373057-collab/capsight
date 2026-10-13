/** Hero mascot: the Capsight (胶囊AI) capsule icon with two orbit rings and floating fact chips (CSS only, no WebGL). */
export default function Mascot({ chips = [] }: { chips?: string[] }) {
  return (
    <div className="hero__fallback mascot-static">
      <span className="mascot-static__ring mascot-static__ring--a" />
      <span className="mascot-static__ring mascot-static__ring--b" />
      <img src="/icon.png" alt="Capsight" />
      {chips.slice(0, 3).map((c, i) => (
        <div key={i} className={`fact-chip mascot-static__chip mascot-static__chip--${i}`}>
          <span className="fact-chip__dot" />
          {c}
          <span className="fact-chip__src">✓ src</span>
        </div>
      ))}
    </div>
  )
}
