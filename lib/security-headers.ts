/** A fresh response nonce authorizes Next's bootstrap without unsafe-inline. */
export const BASE_CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com https://checkout.stripe.com; script-src 'self' https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.doubleclick.net https://*.google.com https://*.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.googleusercontent.com https://*.googlesyndication.com https://*.doubleclick.net https://*.google.com https://*.gstatic.com https://*.netlify.com; connect-src 'self' https://*.googlesyndication.com https://*.doubleclick.net https://*.google.com https://*.gstatic.com; frame-src https://*.googlesyndication.com https://*.doubleclick.net https://*.google.com https://app.netlify.com; media-src 'self' blob:; worker-src 'self' blob:; upgrade-insecure-requests";
export const securityHeaders=[
  {key:'X-Frame-Options',value:'DENY'},
  {key:'X-Content-Type-Options',value:'nosniff'},
  {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
  {key:'Permissions-Policy',value:'camera=(), geolocation=(), microphone=(self)'},
  // Baseline restrictions apply even before static bootstrap hashes are added.
  {key:'Content-Security-Policy',value:"frame-ancestors 'none'; base-uri 'self'; object-src 'none'"},
];
export function contentSecurityPolicy(nonce:string){
  let policy=BASE_CSP.replace("script-src 'self'",`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
  // Google's documented AdSense CSP requires dynamic trust and evaluation.
  // These allowances are absent on deployments where advertising is disabled.
  if(process.env.NEXT_PUBLIC_ADS_ENABLED==='true')policy=policy
    .replace("'strict-dynamic'","'strict-dynamic' 'unsafe-eval'")
    .replace(/connect-src [^;]+/,"connect-src 'self' https:")
    .replace(/frame-src [^;]+/,"frame-src https:")
    .replace(/img-src [^;]+/,"img-src 'self' data: blob: https:");
  return policy;
}
