'use client';
import { useEffect, useRef, useState } from 'react';
import { Headphones, Mic, MicOff, PhoneCall, PhoneOff, Volume2, VolumeX } from 'lucide-react';
import type { AccountSnapshot } from '../../lib/account-client';

type SignalKind = 'offer'|'answer'|'candidate';
interface Peer { id:string; name:string }
interface Signal { id:number; from:string; kind:SignalKind; payload:string }
interface VoiceResponse { playerId?:string; peers?:Peer[]; blockedPlayerIds?:string[]; signals?:Signal[]; latestSignalId?:number; iceServers?:RTCIceServer[]; error?:string }

export default function VoiceChatPanel({ account, roomCode }: { account: AccountSnapshot; roomCode?: string }) {
  const [status,setStatus]=useState<'off'|'joining'|'connected'>('off');
  const [peers,setPeers]=useState<Peer[]>([]),[blocked,setBlocked]=useState<string[]>([]),[muted,setMuted]=useState(false),[silenced,setSilenced]=useState(false),[error,setError]=useState('');
  const localStream=useRef<MediaStream|null>(null), selfId=useRef(''), since=useRef(0), ice=useRef<RTCIceServer[]>([]), timer=useRef<number|null>(null), joined=useRef(false);
  const connections=useRef(new Map<string,RTCPeerConnection>()), audios=useRef(new Map<string,HTMLAudioElement>()), pendingCandidates=useRef(new Map<string,RTCIceCandidateInit[]>());
  const blockedRef=useRef(blocked); blockedRef.current=blocked;
  const silencedRef=useRef(silenced); silencedRef.current=silenced;
  async function api(body:Record<string,unknown>):Promise<VoiceResponse>{
    const response=await fetch('/api/voice',{method:'POST',credentials:'same-origin',cache:'no-store',keepalive:body.action==='leave',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:roomCode,...body})});
    const data=await response.json().catch(()=>({})) as VoiceResponse; if(!response.ok)throw new Error(data.error||'Voice connection failed.'); return data;
  }
  const closePeer=(id:string)=>{connections.current.get(id)?.close();connections.current.delete(id);const a=audios.current.get(id);if(a){a.srcObject=null;a.remove();audios.current.delete(id);}pendingCandidates.current.delete(id);};
  async function sendSignal(id:string,kind:SignalKind,payload:unknown){if(!joined.current)return;await api({action:'signal',playerId:id,kind,payload:JSON.stringify(payload)}).catch(()=>{});}
  async function flushCandidates(id:string,pc:RTCPeerConnection){if(!pc.remoteDescription)return;const list=pendingCandidates.current.get(id)||[];pendingCandidates.current.delete(id);for(const candidate of list)await pc.addIceCandidate(candidate).catch(()=>{});}
  async function ensurePeer(peer:Peer, makeOffer=false){
    if(!joined.current||blockedRef.current.includes(peer.id)||peer.id===selfId.current)return null;
    let pc=connections.current.get(peer.id); if(pc)return pc;
    pc=new RTCPeerConnection({iceServers:ice.current}); connections.current.set(peer.id,pc);
    for(const track of localStream.current?.getTracks()||[])pc.addTrack(track,localStream.current!);
    pc.onicecandidate=e=>{if(e.candidate)void sendSignal(peer.id,'candidate',e.candidate.toJSON());};
    pc.onconnectionstatechange=()=>{if(['failed','closed','disconnected'].includes(pc!.connectionState)){if(pc!.connectionState!=='disconnected')closePeer(peer.id);}};
    pc.ontrack=e=>{let audio=audios.current.get(peer.id);if(!audio){audio=document.createElement('audio');audio.autoplay=true;audio.playsInline=true;audio.dataset.voicePeer=peer.id;document.body.append(audio);audios.current.set(peer.id,audio);}audio.srcObject=e.streams[0];audio.muted=silencedRef.current;void audio.play().catch(()=>{});};
    if(makeOffer){const offer=await pc.createOffer();await pc.setLocalDescription(offer);await sendSignal(peer.id,'offer',offer);}
    return pc;
  }
  async function handleSignal(signal:Signal, peer:Peer|undefined){
    if(!peer||blockedRef.current.includes(signal.from))return;
    if(signal.kind==='offer'){
      const pc=await ensurePeer(peer,false);if(!pc)return;const offer=JSON.parse(signal.payload) as RTCSessionDescriptionInit;await pc.setRemoteDescription(offer);await flushCandidates(peer.id,pc);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await sendSignal(peer.id,'answer',answer);return;
    }
    const pc=await ensurePeer(peer,false);if(!pc)return;
    if(signal.kind==='answer'){await pc.setRemoteDescription(JSON.parse(signal.payload) as RTCSessionDescriptionInit).catch(()=>{});await flushCandidates(peer.id,pc);}
    else {const candidate=JSON.parse(signal.payload) as RTCIceCandidateInit;if(pc.remoteDescription)await pc.addIceCandidate(candidate).catch(()=>{});else pendingCandidates.current.set(peer.id,[...(pendingCandidates.current.get(peer.id)||[]),candidate]);}
  }
  async function poll(){
    if(!joined.current)return;
    try{const data=await api({action:'poll',since:since.current});const nextPeers=data.peers||[],nextBlocked=data.blockedPlayerIds||[];setPeers(nextPeers);setBlocked(nextBlocked);blockedRef.current=nextBlocked;for(const id of nextBlocked)closePeer(id);const visible=new Set(nextPeers.map(p=>p.id));for(const id of connections.current.keys())if(!visible.has(id))closePeer(id);for(const peer of nextPeers)if(!nextBlocked.includes(peer.id)&&selfId.current<peer.id)await ensurePeer(peer,true);for(const signal of data.signals||[])await handleSignal(signal,nextPeers.find(p=>p.id===signal.from));since.current=Math.max(since.current,data.latestSignalId||0);}catch(e){setError(e instanceof Error?e.message:'Voice connection lost.');}
  }
  const leave=async()=>{
    if(timer.current!==null){window.clearInterval(timer.current);timer.current=null;}joined.current=false;for(const id of [...connections.current.keys()])closePeer(id);for(const track of localStream.current?.getTracks()||[])track.stop();localStream.current=null;selfId.current='';since.current=0;setStatus('off');setPeers([]);setBlocked([]);setMuted(false);setSilenced(false);if(roomCode)void api({action:'leave'}).catch(()=>{});
  };
  const join=async()=>{
    if(!roomCode||!account.user||!account.entitlements.voiceChat)return;setError('');setStatus('joining');
    try{const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});localStream.current=stream;const data=await api({action:'join',since:0});selfId.current=data.playerId||'';ice.current=data.iceServers||[{urls:'stun:stun.l.google.com:19302'}];setPeers(data.peers||[]);setBlocked(data.blockedPlayerIds||[]);blockedRef.current=data.blockedPlayerIds||[];since.current=data.latestSignalId||0;joined.current=true;setStatus('connected');for(const peer of data.peers||[])if(!blockedRef.current.includes(peer.id)&&selfId.current<peer.id)await ensurePeer(peer,true);timer.current=window.setInterval(()=>void poll(),1800);}catch(e){for(const track of localStream.current?.getTracks()||[])track.stop();localStream.current=null;setStatus('off');setError(e instanceof Error?e.message:'Voice did not start.');}
  };
  const setMic=(value:boolean)=>{setMuted(value);for(const track of localStream.current?.getAudioTracks()||[])track.enabled=!(value||silencedRef.current);};
  const setSilence=(value:boolean)=>{setSilenced(value);silencedRef.current=value;for(const audio of audios.current.values())audio.muted=value;for(const track of localStream.current?.getAudioTracks()||[])track.enabled=!(muted||value);};
  const togglePeer=async(id:string)=>{const shouldBlock=!blocked.includes(id);try{const data=await api({action:'block',playerId:id,blocked:shouldBlock});const next=data.blockedPlayerIds||[];setBlocked(next);blockedRef.current=next;if(next.includes(id))closePeer(id);else{const peer=peers.find(p=>p.id===id);if(peer&&selfId.current<id)await ensurePeer(peer,true);}}catch(e){setError(e instanceof Error?e.message:'Mute did not change.');}};
  useEffect(()=>{const away=()=>{if(joined.current)void leave();};const visibility=()=>{if(document.hidden)away();};document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',away);return()=>{document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',away);void leave();};},[roomCode]);
  if(!roomCode)return <section className="voice-panel voice-disabled"><Headphones size={20}/><div><strong>Voice Chat</strong><p>Join a table to use voice.</p></div></section>;
  if(!account.user)return <section className="voice-panel voice-disabled"><Headphones size={20}/><div><strong>Voice Chat</strong><p>Sign in to use purchased voice access across devices.</p></div></section>;
  if(!account.entitlements.voiceChat)return <section className="voice-panel voice-disabled"><Headphones size={20}/><div><strong>Voice Chat</strong><p>Available from the Store for a one-off A$2.99.</p><a className="text-link" href="/store">Open Store</a></div></section>;
  return <section className="voice-panel"><header><div><Headphones size={20}/><span><strong>Table voice</strong><small>{status==='connected'?'Connected':'Off until you join'}</small></span></div>{status==='connected'?<button className="button outline small" onClick={()=>void leave()}><PhoneOff size={16}/>Leave</button>:<button className="button gold small" disabled={status==='joining'} onClick={()=>void join()}><PhoneCall size={16}/>{status==='joining'?'Joining…':'Join voice'}</button>}</header>
    {status==='connected'&&<><div className="voice-main-controls"><button className="button outline small" aria-pressed={muted} onClick={()=>setMic(!muted)}>{muted?<MicOff size={16}/>:<Mic size={16}/>} {muted?'Unmute mic':'Mute mic'}</button><button className="button outline small" aria-pressed={silenced} onClick={()=>setSilence(!silenced)}>{silenced?<Volume2 size={16}/>:<VolumeX size={16}/>} {silenced?'Restore everyone':'Silence everyone'}</button></div><div className="voice-peers">{peers.length===0?<p>Waiting for another voice-enabled player.</p>:peers.map(peer=><div key={peer.id}><span>{peer.name}</span><button className="button quiet small" aria-pressed={blocked.includes(peer.id)} onClick={()=>void togglePeer(peer.id)}>{blocked.includes(peer.id)?'Restore voice':'Mute both ways'}</button></div>)}</div><p className="voice-note">Individual mute works both ways. Backgrounding the game stops your microphone and leaves voice.</p></>}
    {error&&<p className="voice-error" role="alert">{error}</p>}
  </section>;
}
