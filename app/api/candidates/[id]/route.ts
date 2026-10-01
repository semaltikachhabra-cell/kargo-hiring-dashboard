import { NextResponse } from 'next/server';
import { db, type Role } from '@/lib/supabase';
import { refreshDrafts } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Remove a candidate (e.g. a test upload) and re-rank their role.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const client = db();
  const { data } = await client.from('candidates').select('applied_role').eq('id', id).single();
  const { error } = await client.from('candidates').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (data?.applied_role) await refreshDrafts(data.applied_role as Role);
  return NextResponse.json({ ok: true });
}
