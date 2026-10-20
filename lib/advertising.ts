import { isAdvertisingGuidePath } from './monetization';

export function advertisingAllowed(input:{enabled:boolean;consent:string|null;ready:boolean;adFree:boolean;pathname:string|null}){
  return input.enabled&&input.consent==='accepted'&&input.ready&&!input.adFree&&isAdvertisingGuidePath(input.pathname);
}
