import type { PublicRoom, RoomEvent } from './types';
import { getTableCardMoves, getWinningCardMove, winningCardChoreography, WINNING_CARD_TIMING, type MotionBox } from './table-motion-plan';

type Anchor =
  | { kind: 'pile'; pile: 'stock' | 'discard' }
  | { kind: 'hand'; cardId: string }
  | { kind: 'player'; playerId: string }
  | { kind: 'table'; cardId: string; meldId: string; ownerId: string };

type Box = MotionBox;
type Snapshot = { box: Box; visual: HTMLElement | null };
type Flight = {
  from: Anchor;
  to: Anchor;
  appearance: 'source' | 'destination' | 'back';
  source: Snapshot | null;
  winningCandidate: boolean;
};
type Batch = {
  key: string;
  root: HTMLElement | null;
  frames: Set<number>;
  timers: Set<ReturnType<typeof setTimeout>>;
  animations: Set<Animation>;
  ghosts: Set<HTMLElement>;
  classes: Map<HTMLElement, Set<string>>;
  expiresAt: number;
  stopListening: () => void;
  resolveWinning: (() => void) | null;
  resolveStarted: (() => void) | null;
  resolveLanding: (() => void) | null;
  retargetWinning: (() => void) | null;
};

/** Only returned for a new, visible round-winning play. */
export interface WinningCardPlayback {
  /** Resolves as the winning-card sequence begins, before flight or landing completes. */
  started: Promise<void>;
  /** Resolves when the final public card reaches its actual destination. */
  landed: Promise<void>;
  finished: Promise<void>;
  cancel: () => void;
}

const MAX_FLIGHTS = 14;
let currentBatch: Batch | null = null;

const roomKey = (room: PublicRoom) => `${room.code}:${room.round}:${room.youId}`;

function motionAllowed(): boolean {
  return typeof window !== 'undefined'
    && typeof document !== 'undefined'
    && document.visibilityState !== 'hidden'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function byAttribute(root: HTMLElement, attribute: string, value: string): HTMLElement | null {
  // Attribute values are compared directly, so player/card IDs never become CSS selectors.
  return Array.from(root.querySelectorAll<HTMLElement>(`[${attribute}]`))
    .find(element => element.getAttribute(attribute) === value) ?? null;
}

function anchorElement(root: HTMLElement, anchor: Anchor): HTMLElement | null {
  switch (anchor.kind) {
    case 'pile':
      return byAttribute(root, 'data-pile', anchor.pile);
    case 'hand':
      return byAttribute(root, 'data-hand-card', anchor.cardId);
    case 'player': {
      const rail = byAttribute(root, 'data-player-hand', anchor.playerId);
      return rail?.querySelector<HTMLElement>('.card-back:last-child') ?? rail;
    }
    case 'table':
      // Never substitute another exposed card if the actual destination is absent.
      return byAttribute(root, 'data-table-card', anchor.cardId);
  }
}

function visibleBox(element: HTMLElement, allowReceiving = false, checkDock = false): Box | null {
  if (!element.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return null;
  const style = window.getComputedStyle(element);
  if (style.visibility === 'hidden' || style.display === 'none'
    || (style.opacity === '0' && !(allowReceiving && element.classList.contains('table-motion-receiving')))) return null;

  let left = Math.max(0, rect.left);
  let top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right);
  let bottom = Math.min(window.innerHeight, rect.bottom);
  // A card scrolled out of a hand or meld rail is not a useful animation endpoint.
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const parentStyle = window.getComputedStyle(parent);
    if (parentStyle.visibility === 'hidden' || parentStyle.display === 'none'
      || (parentStyle.opacity === '0' && !(allowReceiving && parent.classList.contains('table-motion-receiving')))) return null;
    const bounds = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(parentStyle.overflowX)) {
      left = Math.max(left, bounds.left);
      right = Math.min(right, bounds.right);
    }
    if (/(auto|scroll|hidden|clip)/.test(parentStyle.overflowY)) {
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
    }
  }
  if (checkDock) {
    const dock = document.querySelector<HTMLElement>('.your-hand');
    if (dock && !dock.contains(element) && window.getComputedStyle(dock).position === 'fixed') {
      const bounds = dock.getBoundingClientRect();
      if (bounds.left < right && bounds.right > left) bottom = Math.min(bottom, bounds.top);
    }
  }
  if (right - left < rect.width * 0.65 || bottom - top < rect.height * 0.65) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

const VISUAL_PROPERTIES = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height',
  'padding', 'margin', 'border', 'border-radius', 'box-sizing', 'background',
  'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'text-align', 'align-items', 'justify-content', 'flex-direction', 'gap',
  'transform', 'transform-origin', 'box-shadow', 'overflow', 'opacity',
] as const;

function copyVisual(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  const originals = [element, ...Array.from(element.querySelectorAll<HTMLElement>('*'))];
  const copies = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))];
  originals.forEach((original, index) => {
    const copy = copies[index];
    const style = window.getComputedStyle(original);
    // Keep the approved card typography when its clone leaves a responsive rail.
    for (const property of VISUAL_PROPERTIES) copy.style.setProperty(property, style.getPropertyValue(property));
    copy.removeAttribute('id');
    copy.removeAttribute('tabindex');
    copy.removeAttribute('aria-label');
    // A former flight's temporary state must never hide or animate its clone.
    copy.classList.remove('table-motion-receiving', 'table-motion-arrive', 'table-motion-winning-arrive');
    copy.style.animation = 'none';
    copy.style.transition = 'none';
  });
  Object.assign(clone.style, {
    position: 'relative', inset: 'auto', width: '100%', height: '100%',
    minWidth: '0', maxWidth: 'none', margin: '0', transform: 'none', opacity: '1',
  });
  clone.setAttribute('aria-hidden', 'true');
  return clone;
}

function snapshot(element: HTMLElement | null, clone = true, winning = false): Snapshot | null {
  if (!element) return null;
  const visual = element.matches('.card-face, .card-back')
    ? element
    : element.querySelector<HTMLElement>('.card-face, .card-back');
  const box = visibleBox(visual ?? element, winning, winning);
  if (!box) return null;
  return { box, visual: visual && clone ? copyVisual(visual) : null };
}

function newEvents(previous: PublicRoom, next: PublicRoom): RoomEvent[] {
  const lastId = previous.events.reduce((highest, event) => Math.max(highest, event.id), -1);
  return next.events.filter(event => event.id > lastId);
}

function drawPile(events: RoomEvent[], playerId: string): 'stock' | 'discard' {
  const draw = events.filter(event => event.type === 'draw' && event.playerId === playerId).at(-1);
  // The server's public draw event explicitly names the chosen pile.
  return draw?.text.includes('discard pile') ? 'discard' : 'stock';
}

function makeFlights(previous: PublicRoom | null, next: PublicRoom, deal: boolean): Omit<Flight, 'source' | 'winningCandidate'>[] {
  if (deal) {
    return [
      ...next.hand.map(card => ({
        from: { kind: 'pile', pile: 'stock' },
        to: { kind: 'hand', cardId: card.id },
        appearance: 'destination',
      } as const)),
      ...next.players.filter(player => player.id !== next.youId && player.handCount > 0).map(player => ({
        from: { kind: 'pile', pile: 'stock' },
        to: { kind: 'player', playerId: player.id },
        appearance: 'back',
      } as const)),
    ];
  }
  if (!previous) return [];

  const flights: Omit<Flight, 'source' | 'winningCandidate'>[] = [];
  const events = newEvents(previous, next);
  const oldHand = new Set(previous.hand.map(card => card.id));

  for (const card of next.hand) {
    if (!oldHand.has(card.id)) {
      flights.push({
        from: { kind: 'pile', pile: previous.discard?.id === card.id ? 'discard' : drawPile(events, next.youId) },
        to: { kind: 'hand', cardId: card.id },
        appearance: 'destination',
      });
    }
  }

  for (const move of getTableCardMoves(previous, next)) {
    flights.push({
      from: move.playerId === next.youId ? { kind: 'hand', cardId: move.cardId } : { kind: 'player', playerId: move.playerId },
      to: { kind: 'table', cardId: move.cardId, meldId: move.meldId, ownerId: move.ownerId },
      appearance: move.playerId === next.youId ? 'source' : 'destination',
    });
  }

  if (next.discard && next.discard.id !== previous.discard?.id) {
    const lastPileEvent = events.filter(event => event.type === 'discard'
      || (event.type === 'draw' && event.text.includes('discard pile'))).at(-1);
    const actor = lastPileEvent?.type === 'discard'
      && (!lastPileEvent.cardId || lastPileEvent.cardId === next.discard.id)
      ? lastPileEvent.playerId
      : oldHand.has(next.discard.id) ? next.youId : undefined;
    if (actor) {
      flights.push({
        from: actor === next.youId ? { kind: 'hand', cardId: next.discard.id } : { kind: 'player', playerId: actor },
        to: { kind: 'pile', pile: 'discard' },
        appearance: actor === next.youId ? 'source' : 'destination',
      });
    }
  }

  for (const player of next.players) {
    if (player.id === next.youId) continue;
    const before = previous.players.find(candidate => candidate.id === player.id);
    if (before && player.handCount > before.handCount
      && events.some(event => event.type === 'draw' && event.playerId === player.id)) {
      flights.push({
        from: { kind: 'pile', pile: drawPile(events, player.id) },
        to: { kind: 'player', playerId: player.id },
        appearance: 'back',
      });
    }
  }
  return flights;
}

function cleanBatch(batch: Batch): void {
  if (currentBatch === batch) currentBatch = null;
  batch.retargetWinning = null;
  batch.stopListening();
  batch.frames.forEach(id => window.cancelAnimationFrame(id));
  batch.timers.forEach(id => clearTimeout(id));
  batch.animations.forEach(animation => animation.cancel());
  batch.ghosts.forEach(ghost => ghost.remove());
  batch.classes.forEach((classes, element) => classes.forEach(name => element.classList.remove(name)));
  batch.frames.clear();
  batch.timers.clear();
  batch.animations.clear();
  batch.ghosts.clear();
  batch.classes.clear();
  const started = batch.resolveStarted;
  batch.resolveStarted = null;
  started?.();
  const landed = batch.resolveLanding;
  batch.resolveLanding = null;
  landed?.();
  const resolve = batch.resolveWinning;
  batch.resolveWinning = null;
  resolve?.();
}

/** Use when leaving the table; visual work never keeps a departed screen alive. */
export function cancelTableMotion(): void {
  if (currentBatch) cleanBatch(currentBatch);
}

function frame(batch: Batch, callback: () => void): void {
  const id = window.requestAnimationFrame(() => {
    batch.frames.delete(id);
    if (currentBatch === batch) {
      try { callback(); } catch { cleanBatch(batch); }
    }
  });
  batch.frames.add(id);
}

function flash(batch: Batch, element: HTMLElement | null, className: string, duration: number): void {
  if (!element || !visibleBox(element) || currentBatch !== batch) return;
  element.classList.add(className);
  const names = batch.classes.get(element) ?? new Set<string>();
  names.add(className);
  batch.classes.set(element, names);
  const timer = setTimeout(() => {
    batch.timers.delete(timer);
    element.classList.remove(className);
    names.delete(className);
    if (!names.size) batch.classes.delete(element);
  }, duration);
  batch.timers.add(timer);
}

function backVisual(): HTMLElement {
  const back = document.createElement('span');
  back.className = 'card-back';
  back.appendChild(document.createElement('span'));
  return back;
}

function receivingVisual(batch: Batch, element: HTMLElement, hidden: boolean): void {
  const visual = element.matches('.card-face, .card-back') ? element : element.querySelector<HTMLElement>('.card-face, .card-back');
  if (!visual) return;
  const className = 'table-motion-receiving';
  if (hidden) {
    visual.classList.add(className);
    const names = batch.classes.get(visual) ?? new Set<string>();
    names.add(className);
    batch.classes.set(visual, names);
  } else {
    const names = batch.classes.get(visual);
    // A cancelled older flight must not unhide a newer flight's artwork.
    if (!names?.has(className)) return;
    visual.classList.remove(className);
    names?.delete(className);
    if (!names?.size) batch.classes.delete(visual);
  }
}

function visibleStage(root: HTMLElement): Box {
  const dock = root.querySelector<HTMLElement>('.your-hand');
  const dockTop = dock && window.getComputedStyle(dock).position === 'fixed'
    ? dock.getBoundingClientRect().top : window.innerHeight;
  const bottom = Math.max(36, Math.min(window.innerHeight, dockTop) - 18);
  const top = Math.max(8, Math.min(root.getBoundingClientRect().top + 10, window.innerHeight * 0.35, bottom - 80));
  return { left: 16, top, width: Math.max(80, window.innerWidth - 32), height: bottom - top };
}

function addWinningAura(ghost: HTMLElement, width: number, height: number): void {
  const aura = document.createElement('span');
  aura.className = 'table-motion-winning-aura';
  for (let index = 0; index < 12; index++) {
    const particle = document.createElement('i');
    const angle = index * Math.PI / 6;
    particle.style.setProperty('--spark-x', `${Math.cos(angle) * (width * 0.65 + 12)}px`);
    particle.style.setProperty('--spark-y', `${Math.sin(angle) * (height * 0.6 + 12)}px`);
    particle.style.setProperty('--spark-delay', `${index * -170}ms`);
    aura.appendChild(particle);
  }
  ghost.appendChild(aura);
}

function winningScene(batch: Batch, winnerName: string): {
  position: (stage: Box, destination: Box | null) => void;
  land: () => void;
  remove: () => void;
} {
  const scene = document.createElement('div');
  scene.className = 'table-motion-finale';
  scene.setAttribute('aria-hidden', 'true');
  const beacon = document.createElement('div');
  beacon.className = 'table-motion-winning-target';
  beacon.setAttribute('aria-hidden', 'true');
  beacon.style.display = 'none';
  beacon.style.setProperty('--winning-arrival-duration', `${WINNING_CARD_TIMING.arrival}ms`);
  const title = document.createElement('div');
  title.className = 'table-motion-finale-title';
  title.setAttribute('role', 'status');
  title.setAttribute('aria-live', 'polite');
  title.setAttribute('aria-atomic', 'true');
  const eyebrow = document.createElement('span');
  eyebrow.textContent = 'FINAL CARD';
  const name = document.createElement('strong');
  name.textContent = `${winnerName} goes out`;
  title.appendChild(eyebrow);
  title.appendChild(name);
  for (const node of [scene, beacon, title]) {
    document.body.appendChild(node);
    batch.ghosts.add(node);
  }
  return {
    position: (stage, destination) => {
      scene.style.setProperty('--finale-x', `${stage.left + stage.width / 2}px`);
      scene.style.setProperty('--finale-y', `${stage.top + stage.height / 2}px`);
      title.style.top = `${Math.max(10, stage.top - 62)}px`;
      if (destination) Object.assign(beacon.style, {
          display: 'block',
          left: `${destination.left - 9}px`, top: `${destination.top - 9}px`,
          width: `${destination.width + 18}px`, height: `${destination.height + 18}px`,
        });
    },
    land: () => {
      eyebrow.textContent = 'ROUND WON';
      beacon.classList.add('table-motion-winning-landed');
      scene.classList.add('table-motion-finale-landed');
    },
    remove: () => {
      for (const node of [scene, beacon, title]) { batch.ghosts.delete(node); node.remove(); }
    },
  };
}

function showWinningAnnouncement(batch: Batch, winnerName: string): void {
  if (!batch.root) { cleanBatch(batch); return; }
  const scene = winningScene(batch, winnerName);
  const emblem = document.createElement('div');
  emblem.className = 'table-motion-finale-emblem';
  emblem.setAttribute('aria-hidden', 'true');
  emblem.textContent = '✦';
  document.body.appendChild(emblem);
  batch.ghosts.add(emblem);
  const position = () => {
    if (!batch.root) return;
    const bounds = visibleStage(batch.root);
    const stage = winningCardChoreography(bounds, bounds, bounds, 0.65).stage;
    scene.position(stage, null);
    Object.assign(emblem.style, {
      left: `${stage.left + stage.width / 2}px`,
      top: `${stage.top + stage.height / 2}px`,
    });
  };
  position();
  batch.retargetWinning = position;
  const notifyStarted = batch.resolveStarted;
  batch.resolveStarted = null;
  notifyStarted?.();
  const notifyLanding = batch.resolveLanding;
  batch.resolveLanding = null;
  notifyLanding?.();
  // The real pile is offscreen. Announce the public win without creating a
  // fictitious card journey or holding the result for an invisible flight.
  const timer = setTimeout(() => { batch.timers.delete(timer); cleanBatch(batch); }, 2_800);
  batch.timers.add(timer);
}

function startFlight(batch: Batch, flight: Flight, destination: Snapshot, element: HTMLElement, index: number, deal: boolean, hideDestination: boolean, winning: boolean, winnerName: string): boolean {
  const source = flight.source;
  if (!source) return false;
  const visualSnapshot = flight.appearance === 'source' ? source : destination;
  const visual = flight.appearance === 'back'
    ? backVisual()
    : visualSnapshot.visual?.cloneNode(true) as HTMLElement | undefined;
  if (!visual) return false;

  const width = flight.appearance === 'back' ? Math.min(58, destination.box.width) : visualSnapshot.box.width;
  const height = flight.appearance === 'back' ? width * 1.55 : visualSnapshot.box.height;
  const ghost = document.createElement('div');
  ghost.className = `table-motion-flight${winning ? ' table-motion-winning-flight' : ''}`;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('inert', '');
  ghost.style.width = `${width}px`;
  ghost.style.height = `${height}px`;
  ghost.appendChild(visual);
  if (winning) addWinningAura(ghost, width, height);
  document.body.appendChild(ghost);
  batch.ghosts.add(ghost);

  const fromX = source.box.left + source.box.width / 2 - width / 2;
  const fromY = source.box.top + source.box.height / 2 - height / 2;
  const toX = destination.box.left + destination.box.width / 2 - width / 2;
  const toY = destination.box.top + destination.box.height / 2 - height / 2;
  const distance = Math.hypot(toX - fromX, toY - fromY);
  const lift = Math.min(34, Math.max(12, distance * 0.06));
  const turn = toX >= fromX ? 3 : -3;
  const fromScaleX = source.box.width / width;
  const fromScaleY = source.box.height / height;
  const toScaleX = destination.box.width / width;
  const toScaleY = destination.box.height / height;
  const transform = (x: number, y: number, rotation: number, scaleX: number, scaleY: number) =>
    `translate3d(${x}px, ${y}px, 0) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`;
  const duration = winning ? WINNING_CARD_TIMING.flight : Math.min(440, 320 + distance * 0.1);
  const delay = index * (deal ? 24 : 18);
  const midScaleX = (fromScaleX + toScaleX) / 2;
  const midScaleY = (fromScaleY + toScaleY) / 2;
  let latestDestination = destination.box;
  const finale = winning ? winningScene(batch, winnerName) : null;
  const featuredFrames = (): Keyframe[] => {
    const choreography = winningCardChoreography(source.box, latestDestination, visibleStage(batch.root!), width / height);
    finale?.position(choreography.stage, latestDestination);
    return choreography.frames.map(({ box, rotation, offset }) => ({
      transform: transform(box.left + box.width / 2 - width / 2, box.top + box.height / 2 - height / 2,
        rotation, box.width / width, box.height / height),
      opacity: 1,
      offset,
    }));
  };
  const keyframes: Keyframe[] = winning ? featuredFrames() : [
    { transform: transform(fromX, fromY, -turn, fromScaleX, fromScaleY), opacity: 0.92, offset: 0 },
    { transform: transform((fromX + toX) / 2, (fromY + toY) / 2 - lift, turn, midScaleX, midScaleY), opacity: 1, offset: 0.5 },
    { transform: transform(toX, toY, 0, toScaleX, toScaleY), opacity: 1, offset: 1 },
  ];

  try {
    // Hide only the arriving artwork. Its button, dimensions and hit target stay live.
    if (hideDestination) receivingVisual(batch, element, true);
    const animation = ghost.animate(keyframes, {
      duration, delay, easing: winning ? 'linear' : 'cubic-bezier(.2,.72,.24,1)', fill: 'both',
    });
    batch.animations.add(animation);
    if (winning) {
      const notifyStarted = batch.resolveStarted;
      batch.resolveStarted = null;
      notifyStarted?.();
    }
    let landed = false;
    let lastGeometry = '';
    let missingSince: number | null = null;
    if (winning) {
      batch.retargetWinning = () => {
        if (currentBatch !== batch || !batch.root?.isConnected) return;
        // A last-card update can shrink the hand, move a meld or settle a mobile
        // viewport. Follow the real destination instead of cancelling the win.
        // Folding or rotating a phone may remount the piles in another parent.
        // Follow the live anchor rather than retaining the detached button.
        const liveElement = anchorElement(batch.root, flight.to);
        const fresh = snapshot(liveElement, false, true);
        if (!fresh || !liveElement) {
          missingSince ??= performance.now();
          // A transient layout frame gets time to settle. A truly offscreen
          // pile must never be replaced by an invented landing position.
          if (performance.now() - missingSince > 350) cleanBatch(batch);
          return;
        }
        missingSince = null;
        if (liveElement !== element) {
          if (hideDestination && !landed) {
            receivingVisual(batch, element, false);
            receivingVisual(batch, liveElement, true);
          }
          element = liveElement;
          if (landed) flash(batch, element, 'table-motion-winning-arrive', WINNING_CARD_TIMING.arrival);
        }
        const stage = visibleStage(batch.root);
        const geometry = [fresh.box.left, fresh.box.top, fresh.box.width, fresh.box.height,
          stage.left, stage.top, stage.width, stage.height].map(value => Math.round(value * 10)).join(':');
        if (geometry === lastGeometry) return;
        lastGeometry = geometry;
        latestDestination = fresh.box;
        if (landed) {
          finale?.position(winningCardChoreography(source.box, latestDestination, stage, width / height).stage, latestDestination);
        } else {
          const effect = animation.effect as KeyframeEffect | null;
          if (typeof effect?.setKeyframes === 'function') effect.setKeyframes(featuredFrames());
        }
      };
    }
    void animation.finished.then(() => {
      batch.animations.delete(animation);
      batch.ghosts.delete(ghost);
      ghost.remove();
      if (hideDestination) receivingVisual(batch, element, false);
      if (batch.root?.isConnected && currentBatch === batch && motionAllowed()) {
        flash(batch, element, winning ? 'table-motion-winning-arrive' : 'table-motion-arrive', winning ? WINNING_CARD_TIMING.arrival : 390);
        if (winning) {
          landed = true;
          const notifyLanding = batch.resolveLanding;
          batch.resolveLanding = null;
          notifyLanding?.();
          finale?.land();
          const timer = setTimeout(() => {
            batch.timers.delete(timer);
            cleanBatch(batch);
          }, WINNING_CARD_TIMING.arrival);
          batch.timers.add(timer);
        }
      } else if (winning) {
        cleanBatch(batch);
      }
    }, () => {
      batch.animations.delete(animation);
      batch.ghosts.delete(ghost);
      ghost.remove();
      if (hideDestination) receivingVisual(batch, element, false);
      if (winning) cleanBatch(batch);
    });
    return true;
  } catch {
    batch.ghosts.delete(ghost);
    ghost.remove();
    if (hideDestination) receivingVisual(batch, element, false);
    finale?.remove();
    return false;
  }
}

/**
 * Call immediately before accepting a newer room state. The old DOM supplies
 * departure positions; two frames allow React to commit the destination cards.
 * Animation is a removable visual layer and never delays or changes gameplay.
 * A winning playback lets the UI wait to reveal results and play the win sound;
 * it always settles on completion, interruption or its bounded fallback timeout.
 */
export function animateRoomTransition(previous: PublicRoom | null, next: PublicRoom): WinningCardPlayback | null {
  try {
    if (!motionAllowed()) {
      if (currentBatch) cleanBatch(currentBatch);
      return null;
    }
    if (previous?.code === next.code && previous.youId === next.youId && next.version <= previous.version) return null;
    if (next.status === 'lobby') {
      if (currentBatch) cleanBatch(currentBatch);
      return null;
    }
    const sameRoom = previous?.code === next.code && previous.youId === next.youId && previous.game === next.game;
    const deal = next.status === 'playing'
      && (!sameRoom || previous?.status === 'lobby' || previous?.round !== next.round);
    const turnChanged = next.status === 'playing'
      && (deal || previous?.turnPlayerId !== next.turnPlayerId || previous?.turnNumber !== next.turnNumber);
    const plans = makeFlights(sameRoom ? previous : null, next, deal);
    if (!plans.length && !turnChanged) return null;
    const winningMove = getWinningCardMove(previous, next);
    const winningCardIds = new Set(winningMove?.cardIds ?? []);

    const oldRoot = document.querySelector<HTMLElement>('.table-main');
    // A transition into a new hand may create the table. Other panes never animate.
    if (!oldRoot && !deal) return null;
    if (!deal && document.querySelector('.modal-backdrop')) return null;
    const oldRootMatches = !!oldRoot && !!previous && oldRoot.dataset.roomKey === roomKey(previous);
    // Restore any receiving artwork before capturing the next departure. A
    // rapid draw then final discard otherwise has an invisible source card.
    if (currentBatch) cleanBatch(currentBatch);
    const flights: Flight[] = plans.map(plan => {
      const winningCandidate = !!winningMove
        && (plan.from.kind === 'hand' ? next.youId : plan.from.kind === 'player' ? plan.from.playerId : null) === winningMove.winnerId
        && winningCardIds.has(plan.to.kind === 'table' ? plan.to.cardId
          : plan.to.kind === 'pile' && plan.to.pile === 'discard' ? next.discard?.id ?? '' : '');
      return {
        ...plan, winningCandidate,
        source: oldRootMatches ? snapshot(anchorElement(oldRoot!, plan.from), plan.appearance === 'source', winningCandidate) : null,
      };
    });
    const hasWinningPlay = flights.some(flight => flight.winningCandidate);
    const winnerName = next.players.find(player => player.id === winningMove?.winnerId)?.name ?? next.result?.winnerName ?? 'Player';
    const batch: Batch = {
      key: roomKey(next), root: null, frames: new Set(), timers: new Set(),
      animations: new Set(), ghosts: new Set(), classes: new Map(),
      expiresAt: performance.now() + (hasWinningPlay ? WINNING_CARD_TIMING.fallback : 1_700),
      stopListening: () => {},
      resolveWinning: null, resolveStarted: null, resolveLanding: null, retargetWinning: null,
    };
    currentBatch = batch;
    const playback: WinningCardPlayback | null = hasWinningPlay ? {
      started: new Promise<void>(resolve => { batch.resolveStarted = resolve; }),
      landed: new Promise<void>(resolve => { batch.resolveLanding = resolve; }),
      finished: new Promise<void>(resolve => { batch.resolveWinning = resolve; }),
      cancel: () => cleanBatch(batch),
    } : null;
    // This timer also covers throttled or unavailable animation frames.
    const fallback = setTimeout(() => cleanBatch(batch), hasWinningPlay ? WINNING_CARD_TIMING.fallback : 1_700);
    batch.timers.add(fallback);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stopIfHidden = () => { if (!motionAllowed()) cleanBatch(batch); };
    const stopOnLayoutChange = () => {
      if (hasWinningPlay) batch.retargetWinning?.();
      else cleanBatch(batch);
    };
    // The hand reveals a newly drawn card before destination measurement.
    // That initial scroll is part of the layout we measure, not an interruption.
    const stopOnScroll = () => {
      if (!batch.root) return;
      if (hasWinningPlay) batch.retargetWinning?.();
      else cleanBatch(batch);
    };
    document.addEventListener('visibilitychange', stopIfHidden);
    reducedMotion.addEventListener?.('change', stopIfHidden);
    window.addEventListener('resize', stopOnLayoutChange, { passive: true });
    window.addEventListener('scroll', stopOnScroll, { passive: true, capture: true });
    batch.stopListening = () => {
      document.removeEventListener('visibilitychange', stopIfHidden);
      reducedMotion.removeEventListener?.('change', stopIfHidden);
      window.removeEventListener('resize', stopOnLayoutChange);
      window.removeEventListener('scroll', stopOnScroll, true);
    };

    frame(batch, () => frame(batch, () => {
      const root = document.querySelector<HTMLElement>('.table-main');
      if (!motionAllowed() || !root || root.dataset.roomKey !== batch.key || document.querySelector('.modal-backdrop')) {
        cleanBatch(batch);
        return;
      }
      batch.root = root;
      if (typeof root.animate === 'function') {
        const ready: { flight: Flight; destination: Snapshot; element: HTMLElement }[] = [];
        // Reserve early flights for other seats so an eight-player deal includes every visible opponent.
        const ordered = deal ? [
          ...flights.filter(flight => flight.to.kind === 'player'),
          ...flights.filter(flight => flight.to.kind !== 'player'),
        ] : hasWinningPlay ? [
          ...flights.filter(flight => flight.winningCandidate),
          ...flights.filter(flight => !flight.winningCandidate),
        ] : flights;
        for (const flight of ordered) {
          if (ready.length >= MAX_FLIGHTS) break;
          if (deal) flight.source = snapshot(anchorElement(root, flight.from), false);
          if (!flight.source) continue;
          const element = anchorElement(root, flight.to);
          const destination = snapshot(element, flight.appearance === 'destination', flight.winningCandidate);
          if (!destination || !element) continue;
          ready.push({ flight, destination, element });
        }
        // Reserve room for the finale without moving its departure ahead of
        // earlier cards from the same public sequence.
        if (hasWinningPlay) ready.sort((a, b) => flights.indexOf(a.flight) - flights.indexOf(b.flight));
        const destinationCounts = new Map<HTMLElement, number>();
        ready.forEach(({ element }) => destinationCounts.set(element, (destinationCounts.get(element) ?? 0) + 1));
        const winningFlight = hasWinningPlay ? ready.filter(item => item.flight.winningCandidate).at(-1) : undefined;
        let winningStarted = false;
        ready.forEach((item, index) => {
          const started = startFlight(batch, item.flight, item.destination, item.element, index, deal,
            destinationCounts.get(item.element) === 1, item === winningFlight, winnerName);
          if (item === winningFlight && started) winningStarted = true;
        });
        // Every visible table gets the public winner cue. A truly absent
        // endpoint gets a short announcement instead of an invented flight.
        if (hasWinningPlay && !winningStarted) showWinningAnnouncement(batch, winnerName);
      } else if (hasWinningPlay) {
        cleanBatch(batch);
        return;
      }
      if (turnChanged) {
        const rail = next.turnPlayerId === next.youId
          ? root.querySelector<HTMLElement>('.hand-cards')
          : byAttribute(root, 'data-player-hand', next.turnPlayerId);
        flash(batch, rail, 'table-motion-turn', 650);
      }
      const monitor = () => {
        if (!root.isConnected || root.dataset.roomKey !== batch.key || !motionAllowed()
          || document.querySelector('.modal-backdrop') || performance.now() >= batch.expiresAt) {
          cleanBatch(batch);
          return;
        }
        batch.retargetWinning?.();
        frame(batch, monitor);
      };
      frame(batch, monitor);
    }));
    return playback;
  } catch {
    // Unsupported or interrupted animation must never interfere with accepting a game update.
    if (currentBatch) cleanBatch(currentBatch);
    return null;
  }
}
