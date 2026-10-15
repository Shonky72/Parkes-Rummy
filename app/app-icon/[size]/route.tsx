import { ImageResponse } from 'next/og';

export const dynamic = 'force-static';
export function generateStaticParams() { return ['180.png', '192.png', '512.png'].map(size => ({ size })); }

export async function GET(_request: Request, context: { params: Promise<{ size: string }> }) {
  const { size: name } = await context.params;
  if (!/^(180|192|512)\.png$/.test(name)) return new Response('Not found', { status: 404 });
  const size = Number(name.split('.')[0]);
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', background: '#062e23', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={size * .65} height={size * .65} viewBox="0 0 70 76">
        <g fill="none" stroke="#f1c96c" strokeWidth="2.2">
          <rect x="9" y="12" width="40" height="55" rx="4" transform="rotate(-17 29 40)"/>
          <rect x="19" y="9" width="40" height="56" rx="4" transform="rotate(13 39 37)" fill="#092d23"/>
        </g>
        <path d="M39 24c-3 5-12 10-12 16 0 7 9 8 12 2-1 5-3 8-5 10h10c-2-2-4-5-5-10 4 6 12 5 12-2 0-6-9-11-12-16" fill="#f4ce7b"/>
      </svg>
    </div>, { width: size, height: size },
  );
}
