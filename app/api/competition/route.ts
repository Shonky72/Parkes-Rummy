import { readCompetition, writeCompetition } from '@/lib/competition-server';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const GET=readCompetition;
export const POST=writeCompetition;
