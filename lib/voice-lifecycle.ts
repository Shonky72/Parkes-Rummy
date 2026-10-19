/** Owns capture across uncancellable permission prompts and late HTTP replies. */
export class VoiceLifecycle {
  private generation=0;
  private streams=new Set<{getTracks():Array<{stop():void}>}>();
  constructor(private readonly eligible:()=>boolean){}
  begin(){this.cancel();return this.generation;}
  current(generation:number){return generation===this.generation&&this.eligible();}
  attach(stream:{getTracks():Array<{stop():void}>},generation:number){
    if(!this.current(generation)){for(const track of stream.getTracks())track.stop();return false;}
    this.streams.add(stream);return true;
  }
  cancel(){this.generation++;for(const stream of this.streams)for(const track of stream.getTracks())track.stop();this.streams.clear();}
}
