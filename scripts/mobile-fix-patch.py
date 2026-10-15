"""Temporary, branch-only edit script. Removed after the reviewed source commit."""
from pathlib import Path
import subprocess
root = Path.cwd()
assert subprocess.check_output(['git','branch','--show-current'], text=True).strip() == 'fix/mobile-play-and-ai-turns'
def edit(path, pairs):
    p=root/path; s=p.read_text()
    for a,b in pairs:
        assert s.count(a)==1, (path,a[:90],s.count(a))
        s=s.replace(a,b)
    p.write_text(s)
edit('lib/rummy.ts', [
("Date.now() + (room.phase === 'draw' ? 800 : 650)", "Date.now() + (room.phase === 'draw' ? 240 : 120)"),
("/** Deliberately accepts only public state: hidden hands and the stock sequence are unavailable. */", '''/** Search the exact same opening contract used when a human goes down.
 * Original Rules has extra suit/rank restrictions not represented by the broad
 * planning hints in RuleDefinition.requirements. Never submit those hints as a
 * legal opening. At most eleven own cards are searched; no hidden cards enter.
 */
export function findBotOpening(hand: Card[], game: GameType, ruleNumber: number): Meld[] | null {
  const definition = RULES[game]?.[ruleNumber - 1];
  if (!definition || hand.length > 11) return null;
  if (game !== 4) return searchOpening(hand, definition);
  const count = definition.requirements.reduce((sum, group) => sum + group.count, 0);
  if (hand.length < count) return null;
  for (const mask of combinations(hand.length, count)) {
    const opening = findOpeningMelds(cardsForMask(hand, mask), game, ruleNumber);
    if (opening) return opening;
  }
  return null;
}

/** Deliberately accepts only public state: hidden hands and the stock sequence are unavailable. */'''),
("if (searchOpening(extended, definition)) return { type: 'draw', source: 'discard' };", "if (findBotOpening(extended, view.game, ruleNumberFor(own, view.round))) return { type: 'draw', source: 'discard' };"),
("const opening = searchOpening(view.hand, definition);", "const opening = findBotOpening(view.hand, view.game, ruleNumberFor(own, view.round));")])
edit('lib/room-server.ts', [
("import { chooseQuickPlaySetup } from './quick-play';", "import { chooseQuickPlaySetup } from './quick-play';\nimport { advanceBotTurn } from './bot-turn';"),
("const next = applyAction(room, player.id, action);", "const next = action.type === 'botStep' ? advanceBotTurn(room, player.id) : applyAction(room, player.id, action);")])
edit('app/components/ParkesApp.tsx', [
("const schedule = (delay = 550)", "const schedule = (delay = 180)"),
("now >= current.botDueAt + 80", "now >= current.botDueAt + 30"),
("botPending.current = ''; schedule(700);", "botPending.current = ''; schedule(120);"),
("{onRule.some(p => p.id === youId) && <em>YOU</em>}", ""),
("{player.id === room.youId ? ' (You)' : ''}", ""),
("{p.id===room.youId&&<span> · You</span>}", ""),
("<span> · You</span>", ""),
("{p.id === room.youId ? ' · You' : ''}", ""),
("{row.playerId===room.youId?' · You':''}", ""),
('className="button outline exit-game-button" onClick=', 'className="button outline exit-game-button" aria-label="Exit game" onClick=')])
p=root/'app/components/HandCards.tsx'; s=p.read_text()
s=s.replace('const HOLD_TO_DRAG = 200;', 'const HOLD_TO_DRAG = 350;')
s=s.replace("    gesture.mode = 'drag';\n    latest.current.onDragCardChange", "    gesture.mode = 'drag';\n    try { gesture.button.setPointerCapture(gesture.pointerId); } catch { /* The browser may already own a cancelled touch. */ }\n    latest.current.onDragCardChange")
s=s.replace("    event.preventDefault();\n    event.currentTarget.focus({ preventScroll: true });", "    if (event.pointerType === 'mouse') {\n      event.preventDefault();\n      event.currentTarget.focus({ preventScroll: true });\n    }")
s=s.replace("    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Capture may be unavailable for an already released pointer. */ }", "    if (gesture.pointerType === 'mouse') {\n      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Already released. */ }\n    }")
a=s.index('  const onPointerMove = '); b=s.index('  const onPointerUp = ',a)
s=s[:a]+'''  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    const distance = Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY);
    if (gesture.mode === 'pending' && gesture.pointerType !== 'mouse') {
      if (distance >= TOUCH_MOVE_THRESHOLD) {
        // A swipe belongs to the browser, including momentum and nested scroll
        // containers. Do not turn a slow swipe into a card drag or a tap.
        ignoreClickRef.current = true;
        finishGesture();
      }
      return;
    }
    if (gesture.pointerType === 'mouse' || gesture.mode === 'drag') event.preventDefault();
    if (gesture.mode === 'pending' && distance >= MOUSE_MOVE_THRESHOLD) beginDrag(gesture);
    if (gesture.mode === 'drag') updateDrag();
  };

'''+s[b:]
s=s.replace("    const mode = gesture.mode;\n    ignoreClickRef.current = true;", "    const mode = gesture.pointerType !== 'mouse' && gesture.mode === 'pending'\n      && Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) >= TOUCH_MOVE_THRESHOLD ? 'scroll' : gesture.mode;\n    ignoreClickRef.current = true;")
s=s.replace("    const cancel = () => finishGesture();", "    const cancel = () => { ignoreClickRef.current = true; finishGesture(); };\n    const touchMove = (event: TouchEvent) => {\n      // Only an already lifted card suppresses scrolling. Changing touch-action\n      // mid-gesture is too late; this non-passive listener preserves hold/drag.\n      if (event.touches.length > 1) { cancel(); return; }\n      if (gestureRef.current?.mode === 'drag' && event.cancelable) event.preventDefault();\n    };")
s=s.replace("    document.addEventListener('keydown', escape);", "    window.addEventListener('touchmove', touchMove, { passive: false });\n    document.addEventListener('keydown', escape);")
s=s.replace("      document.removeEventListener('keydown', escape);", "      window.removeEventListener('touchmove', touchMove);\n      document.removeEventListener('keydown', escape);")
p.write_text(s)
p=root/'app/components/DrawCardButton.tsx'; s=p.read_text()
s=s.replace("    activationRef.current!.pointerFinished();\n    setVisual", "    try { gesture.button.setPointerCapture(gesture.state.pointerId); } catch { /* Touch was cancelled by the browser. */ }\n    activationRef.current!.pointerFinished();\n    setVisual")
s=s.replace("    event.preventDefault();\n    event.currentTarget.focus({ preventScroll: true });", "    if (state.pointerType === 'mouse') {\n      event.preventDefault();\n      event.currentTarget.focus({ preventScroll: true });\n    }")
s=s.replace("    try { event.currentTarget.setPointerCapture(state.pointerId); } catch { /* Window listeners cover unavailable capture. */ }", "    if (state.pointerType === 'mouse') {\n      try { event.currentTarget.setPointerCapture(state.pointerId); } catch { /* Window listeners cover unavailable capture. */ }\n    }")
s=s.replace("      event.preventDefault();\n      const mode = gesture.state.mode;\n      gesture.state = moveDrawGesture(gesture.state, event.clientX, event.clientY);", "      const mode = gesture.state.mode;\n      gesture.state = moveDrawGesture(gesture.state, event.clientX, event.clientY);\n      if (gesture.state.pointerType !== 'mouse' && mode !== 'drag') {\n        if (gesture.state.mode === 'scroll') cancelGesture();\n        return; // Native scroll, not a draw and not an imitation window scroll.\n      }\n      event.preventDefault();")
s=s.replace("    const blur = () => cancelGesture();", "    const blur = () => cancelGesture();\n    const touchMove = (event: TouchEvent) => {\n      if (event.touches.length > 1) { cancelGesture(); return; }\n      if (gestureRef.current?.state.mode === 'drag' && event.cancelable) event.preventDefault();\n    };")
s=s.replace("    window.addEventListener('pointermove', move,", "    window.addEventListener('touchmove', touchMove, { passive: false });\n    window.addEventListener('pointermove', move,")
s=s.replace("      window.removeEventListener('pointermove', move, true);", "      window.removeEventListener('touchmove', touchMove);\n      window.removeEventListener('pointermove', move, true);")
p.write_text(s)
edit('lib/draw-card-drag.ts', [("export const DRAW_HOLD_MS = 200;", "export const DRAW_HOLD_MS = 350;")])
p=root/'tests/draw-card-drag.test.ts'; s=p.read_text().replace('1200','1350').replace('1199','1349').replace('200ms','350ms'); p.write_text(s)
edit('app/components/AccountControls.tsx', [
("import '../account.css';", "import '../account.css';\nimport GameLogo from './GameLogo';"),
('<span className="account-check-suit" aria-hidden="true">♠</span><h1>Parkes Rummy</h1>', '<h1 className="account-loading-logo"><GameLogo large/></h1>')])
edit('app/layout.tsx', [("import './home-information.css';", "import './home-information.css';\nimport './mobile-usability.css';")])
