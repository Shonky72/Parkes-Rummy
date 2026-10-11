export const dynamic = 'force-dynamic';
export function GET() {
  const publisher = process.env.ADSENSE_PUBLISHER_ID?.trim() || process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.trim()?.replace(/^ca-/, '') || 'pub-5430752526720484';
  const valid = publisher && /^pub-\d+$/.test(publisher);
  const body = valid ? `google.com, ${publisher}, DIRECT, f08c47fec0942fa0\n` : '# Ad seller details will appear here after AdSense approval.\n';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}
