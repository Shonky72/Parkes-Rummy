import { SecurityError } from '../db/security';
export async function boundedText(request:Request,max:number):Promise<string>{
  if(Number(request.headers.get('Content-Length')||0)>max)throw new SecurityError('This request is too large.',413);
  if(!request.body)return '';
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new SecurityError('This request is too large.',413);}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder().decode(bytes);
}
export async function boundedJson(request:Request,max:number):Promise<Record<string,unknown>>{
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw new SecurityError('JSON required.',415);
  try{const value=JSON.parse(await boundedText(request,max));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}
  catch(error){if(error instanceof SecurityError)throw error;throw new SecurityError('Invalid request.',400);}
}
