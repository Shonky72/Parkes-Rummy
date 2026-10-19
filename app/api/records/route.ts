import { readRecords, writeRecords } from '@/lib/records-server';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const GET=readRecords;
export const POST=writeRecords;
