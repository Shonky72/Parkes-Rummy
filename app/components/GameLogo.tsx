export default function GameLogo({ large = false }: { large?: boolean }) {
  return <a className={'brand' + (large ? ' brand-large' : '')} href="/" aria-label="Parkes Rummy home" title="Go to the Parkes Rummy home page">
    <svg className="brand-mark" viewBox="0 0 70 76" aria-hidden="true">
      <defs><linearGradient id={large ? 'gold-large' : 'gold-mark'} x2=".8" y2="1"><stop stopColor="#ffe398"/><stop offset="1" stopColor="#d7a548"/></linearGradient></defs>
      <g fill="none" stroke="#f1c96c" strokeWidth="2.2"><rect x="9" y="12" width="40" height="55" rx="4" transform="rotate(-17 29 40)"/><rect x="19" y="9" width="40" height="56" rx="4" transform="rotate(13 39 37)" fill="#092d23"/></g>
      <path d="M39 24c-3 5-12 10-12 16 0 7 9 8 12 2-1 5-3 8-5 10h10c-2-2-4-5-5-10 4 6 12 5 12-2 0-6-9-11-12-16" fill={'url(#' + (large ? 'gold-large' : 'gold-mark') + ')'}/>
    </svg>
    {large && <span>Parkes <span>Rummy</span></span>}
  </a>;
}
