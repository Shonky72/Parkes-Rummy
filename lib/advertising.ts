export function advertisingAllowed(input:{enabled:boolean;consent:string|null;ready:boolean;adFree:boolean}){
  return input.enabled&&input.consent==='accepted'&&input.ready&&!input.adFree;
}
