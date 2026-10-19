import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceLifecycle} from '../lib/voice-lifecycle';

test('a late microphone permission result is stopped after every cancellation path',async()=>{
 for(const reason of ['unmount','background','room change','account change','leave','authorization loss']){
  let stops=0;const life=new VoiceLifecycle(()=>true),generation=life.begin();
  let resolve!:(stream:{getTracks():{stop():void}[]})=>void;
  const permission=new Promise<{getTracks():{stop():void}[]}>(r=>{resolve=r;});
  const joining=permission.then(stream=>life.attach(stream,generation));
  life.cancel();resolve({getTracks:()=>[{stop(){stops++;}}]});
  assert.equal(await joining,false,reason);assert.equal(stops,1,reason);
 }
});
test('background state denies a stream even before the event handler runs; late HTTP generations cannot revive capture',()=>{
 let visible=true,stops=0;const life=new VoiceLifecycle(()=>visible),old=life.begin();
 assert.equal(life.attach({getTracks:()=>[{stop(){stops++;}}]},old),true);
 visible=false;assert.equal(life.current(old),false);life.cancel();assert.equal(stops,1);
 visible=true;const fresh=life.begin();assert.equal(life.current(old),false);assert.equal(life.current(fresh),true);
});
