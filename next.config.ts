import { securityHeaders } from './lib/security-headers';
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.PARKES_SECURITY_BUILD==='1'?'.next-security':'.next',
  poweredByHeader: false,
  // Capture only this nonsecret build value; Netlify Functions omit CONTEXT.
  env: { PARKES_DEPLOY_CONTEXT: process.env.CONTEXT ?? '' },
  async headers(){return [{source:'/:path*',headers:securityHeaders}];},
  async redirects() {
    return [{
      source: '/:path*',
      has: [{ type: 'host', value: 'www.parkesrummy.com' }],
      destination: 'https://parkesrummy.com/:path*',
      permanent: true,
    }];
  },
};

export default nextConfig;
