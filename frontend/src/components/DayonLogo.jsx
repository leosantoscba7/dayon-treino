// The DAYON wordmark (design-ref/ref-inicio.png): "DAY" in a dark italic serif and "ON" in a green
// pill whose "O" is a power symbol. Text and pill are drawn here, never taken from a generated
// image (the same drawing as resources/dayon/compor-marca.swift, which makes the splash screens).
export default function DayonLogo({ size = 30, className = '' }) {
  return <div className={'dayon-logo ' + className} style={{ fontSize: size }} role="img" aria-label="DAY ON">
    <span className="dl-day" aria-hidden="true">DAY</span>
    <span className="dl-on" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="dl-o"><path d="M7.4 6.2a8 8 0 1 0 9.2 0" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" /><path d="M12 2.6v8.2" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" /></svg>
      <span>N</span>
    </span>
  </div>
}
