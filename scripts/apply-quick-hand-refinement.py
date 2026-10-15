"""One-off source edit helper. Exact matches protect unrelated game code."""
from pathlib import Path

changed = {}
def edit(path, before, after, count=1):
    text = changed.get(path, Path(path).read_text())
    if before not in text and after in text:
        return
    found = text.count(before)
    if found != count:
        raise RuntimeError(f'{path}: expected {count} source matches, found {found}')
    changed[path] = text.replace(before, after)

types = 'lib/types.ts'
for declaration in ['export interface RoomState {', 'export interface PublicRoom {', 'export interface RoomPreview {', 'export interface RoomSummary {']:
    edit(types, declaration, declaration + '\n  /** Present only on new single-hand Quick Play rooms; old saves retain normal progression. */\n  quickPlay?: { ruleNumber: number };')

engine = 'lib/rummy.ts'
edit(engine, "if (room.players.length >= 8) throw new GameError('All eight seats are filled.');", "if (room.players.length >= (room.quickPlay ? 4 : 8)) throw new GameError(room.quickPlay ? 'Quick Play has four seats maximum.' : 'All eight seats are filled.');")
edit(engine, "for (const player of room.players) { player.score = 0; player.ruleNumber = 1; }", "if (room.quickPlay && (!Number.isInteger(room.quickPlay.ruleNumber) || room.quickPlay.ruleNumber < 1 || room.quickPlay.ruleNumber > 10 || room.players.length > 4)) throw new GameError('Invalid Quick Play setup. Start a new quick hand.');\n      for (const player of room.players) { player.score = 0; player.ruleNumber = room.quickPlay?.ruleNumber ?? 1; }")
edit(engine, "case 'nextHand': {\n      requireHost(room, actor);", "case 'nextHand': {\n      requireHost(room, actor);\n      if (room.quickPlay) throw new GameError('Quick Play ends after one hand. Start a new Quick Play from home.');")
edit(engine, "case 'rematch': {\n      requireHost(room, actor);", "case 'rematch': {\n      requireHost(room, actor);\n      if (room.quickPlay) throw new GameError('This quick hand is finished. Start a new Quick Play from home.');")
edit(engine, "nextRuleNumber: Math.min(10, ruleNumber + Number(player.down)),\n      completed: player.down && ruleNumber === 10,", "nextRuleNumber: room.quickPlay ? ruleNumber : Math.min(10, ruleNumber + Number(player.down)),\n      completed: !room.quickPlay && player.down && ruleNumber === 10,")
edit(engine, "room.status = scores.some(row => row.completed) ? 'finished' : 'round-end';", "room.status = room.quickPlay || scores.some(row => row.completed) ? 'finished' : 'round-end';")
edit(engine, "code: room.code, hostId: room.hostId, game: room.game, round: room.round, status: room.status,", "code: room.code, hostId: room.hostId, game: room.game, round: room.round, status: room.status,\n    ...(room.quickPlay ? { quickPlay: { ...room.quickPlay } } : {}),")
edit(engine, "code: room.code, hostName: room.players.find(player => player.id === room.hostId)?.name ?? 'The host',", "code: room.code, hostName: room.players.find(player => player.id === room.hostId)?.name ?? 'The host',\n    ...(room.quickPlay ? { quickPlay: { ...room.quickPlay } } : {}),")

server = 'lib/room-server.ts'
edit(server, "if (quickPlay) {\n          room = applyAction(room, host.id, { type: 'setGame', game: quickPlay.game });", "if (quickPlay) {\n          room.quickPlay = { ruleNumber: quickPlay.ruleNumber };\n          room = applyAction(room, host.id, { type: 'setGame', game: quickPlay.game });")
edit(server, "code: room.code, game: room.game, status: room.status,", "code: room.code, game: room.game, status: room.status,\n    ...(room.quickPlay ? { quickPlay: { ...room.quickPlay } } : {}),")
edit(server, "} else if (await repository.save(next, version)) {", "} else if (await repository.save(next, version, undefined, { membershipUnchanged: next.players.length === room.players.length && next.players.every(p => room.players.some(old => old.id === p.id && old.isBot === p.isBot)) })) {")
edit(server, "const identity = await identityFor(request, resolveSession);\n      const record = await load(codeOf(rawCode));", "const [identity, record] = await Promise.all([identityFor(request, resolveSession), load(codeOf(rawCode))]);")
# On actions, authorize and load in parallel, while keeping the existing check before any read is returned or write is accepted.
edit(server, "const identity = await identityFor(request, resolveSession);\n      const code = codeOf(rawCode);\n      const action = validateAction(body.action);", "const code = codeOf(rawCode);\n      const action = validateAction(body.action);\n      const [identity, firstRecord] = await Promise.all([identityFor(request, resolveSession), load(code)]);")
edit(server, "const record = await load(code);\n        const { room, version } = record;\n        const player = await authorizedPlayer(record, identity);", "const record = attempt === 0 ? firstRecord : await load(code);\n        const { room, version } = record;\n        const player = await authorizedPlayer(record, identity);")

app = 'app/components/ParkesApp.tsx'
edit(app, "import GameLogo from './GameLogo';", "import GameLogo from './GameLogo';\nimport AdaptiveMeld, { type AdaptiveMeldProps } from './AdaptiveMeld';\nimport ActionStatus from './ActionStatus';")
edit(app, "`${currentPlayer?.name}’S TURN`", "`${currentPlayer?.name}’s turn`")
edit(app, '<p aria-live="polite">{turnHint}</p>', '<ActionStatus hint={turnHint} busy={busy}/>')
edit(app, "<section className={`your-hand panel ${isTurn?'hand-your-turn':''}`} aria-label=\"Your hand\">", "<section className={`your-hand panel ${isTurn?'hand-your-turn':''}`} aria-label=\"Your hand\" aria-busy={!!busy}>")
edit(app, "title={room.status==='finished'?'Final scores':`Hand ${room.round} complete`}", "title={room.quickPlay?'Quick Play complete':room.status==='finished'?'Final scores':`Hand ${room.round} complete`}")
edit(app, "<RoundResults room={room} isHost={isHost} busy={busy}", "<RoundResults room={room} isHost={isHost} busy={busy} onExit={home} onNewQuick={()=>{home();void enterRoom('quick');}}")
edit(app, "function RoundResults({room,isHost,busy,onAction,onRematch,onDelete,onScores}:{room:PublicRoom;isHost:boolean;busy:string;onAction:(action:GameAction,label?:string)=>Promise<void>;onRematch:()=>void;onDelete:()=>void;onScores:()=>void})", "function RoundResults({room,isHost,busy,onAction,onRematch,onDelete,onScores,onExit,onNewQuick}:{room:PublicRoom;isHost:boolean;busy:string;onAction:(action:GameAction,label?:string)=>Promise<void>;onRematch:()=>void;onDelete:()=>void;onScores:()=>void;onExit:()=>void;onNewQuick:()=>void})")
edit(app, "{ruleOutcome(row,result.round,finished)}</p>", "{room.quickPlay ? `Rule ${row.ruleNumber ?? room.quickPlay.ruleNumber} · ${row.melded ? 'Opening completed' : 'Cards left in hand'}` : ruleOutcome(row,result.round,finished)}</p>")
edit(app, "{isHost?<button className=\"button gold\" disabled={!!busy} onClick={()=>finished?onRematch():onAction({type:'nextHand'})}", "{room.quickPlay ? <div className=\"quick-result-actions\"><p>One rule. One hand. Quick Play finished.</p><button type=\"button\" className=\"button gold\" onClick={onNewQuick} disabled={!!busy}><Dices size={20}/>New Quick Play</button><button type=\"button\" className=\"button outline\" onClick={onExit}><ArrowLeft size={18}/>Back to home</button></div> : isHost?<button className=\"button gold\" disabled={!!busy} onClick={()=>finished?onRematch():onAction({type:'nextHand'})}")
edit(app, "{finished&&<><p className=\"games-device-note result-rematch-note\">", "{finished&&!room.quickPlay&&<><p className=\"games-device-note result-rematch-note\">")
edit(app, "{gameLabel(room.game)}<ChevronRight size={14}/>", "{room.quickPlay ? `Quick · Rule ${room.quickPlay.ruleNumber}` : gameLabel(room.game)}<ChevronRight size={14}/>")
text = changed.get(app, Path(app).read_text())
start, end = text.find('function MeldGroup('), text.find('\nfunction RoundResults(')
if start < 0 or end < start:
    raise RuntimeError('MeldGroup bounds not found')
changed[app] = text[:start] + "function MeldGroup(props: Omit<AdaptiveMeldProps, 'renderCard'>) {\n  return <AdaptiveMeld {...props} renderCard={card => <CardFace card={card}/>}/>;\n}\n" + text[end:]
edit('app/layout.tsx', "import './mobile-usability.css';", "import './mobile-usability.css';\nimport './table-readability.css';")
for path, text in changed.items():
    Path(path).write_text(text)
    print(path)
