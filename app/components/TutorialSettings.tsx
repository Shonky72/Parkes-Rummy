'use client';

import { ArrowRight, ArrowUpDown, Check, Settings, Volume2, X } from 'lucide-react';
import type { HandSort } from '../../lib/client';

export default function TutorialSettings({
  direction, onDirection, muted, onSound, onDone,
}: {
  direction: HandSort;
  onDirection: (value: HandSort) => void;
  muted: boolean;
  onSound: (value: boolean) => void;
  onDone: () => void;
}) {
  return <div className="tutorial-lesson-backdrop">
    <section className="tutorial-settings panel" role="dialog" aria-modal="true" aria-labelledby="tutorial-settings-title" aria-describedby="tutorial-settings-lead" onKeyDown={event => { if (event.key === 'Escape') onDone(); }}>
      <header className="tutorial-settings-header"><h2 id="tutorial-settings-title"><Settings size={23}/>Settings</h2><button type="button" className="icon-button" onClick={onDone} aria-label="Close settings"><X size={19}/></button></header>
      <p id="tutorial-settings-lead" className="tutorial-settings-lead">This is where you tell your cards how to line up and change the sounds.</p>
      <div className="tutorial-settings-item">
        <strong><ArrowUpDown size={18}/>Hand order</strong>
        <p>When you tap <b>Sort</b>, should the biggest cards go first or last?</p>
        <div className="tutorial-direction-options" role="group" aria-label="Hand order">
          <button type="button" className={direction === 'descending' ? 'chosen' : ''} aria-pressed={direction === 'descending'} onClick={() => onDirection('descending')}>High → low{direction === 'descending' && <Check size={14}/>}</button>
          <button type="button" className={direction === 'ascending' ? 'chosen' : ''} aria-pressed={direction === 'ascending'} onClick={() => onDirection('ascending')}>Low → high{direction === 'ascending' && <Check size={14}/>}</button>
        </div>
        <div className="tutorial-setting-example"><span>Tap Sort</span><ArrowRight size={16}/><span>Order your cards</span></div>
        <div className="tutorial-setting-example"><span>Hold Sort</span><ArrowRight size={16}/><span>Pick number, colour or suit</span></div>
      </div>
      <div className="tutorial-settings-item tutorial-settings-sound">
        <div><strong><Volume2 size={18}/>Game sound</strong><p>You choose whether you hear card sounds and music.</p></div>
        <button type="button" role="switch" aria-checked={!muted} aria-label="Game sound" className={'toggle ' + (!muted ? 'on' : '')} onClick={() => onSound(!muted)}><span/></button>
      </div>
      <div className="tutorial-settings-host">
        <strong>When you make a real game</strong>
        <p>The host picks the time allowed for turns and whether to show hints for good moves. On this practice table, hints are always on and there is no timer.</p>
      </div>
      <button type="button" id="tutorial-settings-done" className="button gold" onClick={onDone}>Done, back to cards<ArrowRight size={17}/></button>
    </section>
  </div>;
}
