import { readLadder, writeLadder } from '@/lib/ladder-server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const GET = readLadder;
export const POST = writeLadder;
