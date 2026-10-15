import { ArrowUp, Check, ChevronDown, EllipsisVertical, House, Menu, Plus, Share, Smartphone } from 'lucide-react';
import type { InstallBrowser, InstallStep } from '../../lib/phone-install';

/** Diagrams, not screenshots. The surrounding instructions remain the accessible source of truth. */
export default function InstallIllustration({ step, browser }: { step: InstallStep; browser: InstallBrowser }) {
  const safari = browser === 'safari';
  const MenuIcon = browser === 'samsung' ? Menu : EllipsisVertical;
  return <div className={`install-illustration illustration-${step.visual}`} role="img" aria-label={`Illustration: ${step.title}. ${step.label}${step.detail ? ', ' + step.detail : ''}`}>
    <div className="install-phone-frame" aria-hidden="true">
      <div className="install-phone-speaker"/>
      <div className="install-mini-address"><span>parkesrummy.com</span><span className={step.visual === 'menu' ? 'install-picture-target' : ''}><MenuIcon size={18}/></span></div>
      <div className="install-mini-game"><span className="install-mini-spade">♠</span><strong>Parkes Rummy</strong><div className="install-mini-cards"><i>5♥</i><i>6♣</i><i>7♦</i></div></div>
      {step.visual === 'menu' && <div className="install-picture-hint"><ArrowUp size={17}/>{browser === 'samsung' ? 'Menu: three lines' : 'Menu: three dots'}</div>}
      {step.visual === 'share' && <><div className="install-mini-toolbar"><ChevronDown size={18}/><span className="install-picture-target"><Share size={22}/></span><Plus size={18}/></div><div className="install-picture-hint">Square + up arrow</div></>}
      {step.visual === 'add' && <div className="install-mini-sheet"><span className="install-sheet-grip"/><span className="install-sheet-muted">Page options</span><div className="install-picture-target"><Smartphone size={18}/><strong>{step.label}</strong></div>{step.detail && <span className="install-sheet-detail">{step.detail}</span>}</div>}
      {step.visual === 'confirm' && <div className="install-mini-sheet install-confirm-sheet"><span className="install-confirm-mark">♠</span><strong>Parkes Rummy</strong>{safari && <span className="install-webapp-toggle">Open as Web App <span><Check size={10}/></span></span>}<div className="install-picture-target"><Plus size={17}/><strong>{step.label}</strong></div><span className="install-sheet-detail"><House size={13}/>New home-screen icon</span></div>}
    </div>
  </div>;
}
