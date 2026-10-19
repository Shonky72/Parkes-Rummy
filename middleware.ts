import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy } from './lib/security-headers';

export function middleware(request:NextRequest){
  const nonce=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const policy=contentSecurityPolicy(nonce);
  const headers=new Headers(request.headers);
  headers.set('x-nonce',nonce);
  headers.set('Content-Security-Policy',policy);
  const response=NextResponse.next({request:{headers}});
  response.headers.set('Content-Security-Policy',policy);
  return response;
}
export const config={matcher:['/((?!api|_next/static|_next/image|favicon.svg|app-icon|audio|.*\\.(?:png|svg|mp3)$).*)']};
