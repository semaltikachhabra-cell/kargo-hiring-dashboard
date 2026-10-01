import { NextResponse } from 'next/server';
import { refreshDrafts } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Re-rank both roles and rewrite any draft whose invite/rejection status changed.
export async function POST() {
  try {
    await refreshDrafts('PM');
    await refreshDrafts('SPM');
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
