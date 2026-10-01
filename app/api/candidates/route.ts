import { NextResponse } from 'next/server';
import { db, type Candidate } from '@/lib/supabase';
import { getRubric, personalise } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { data, error } = await db().from('candidates').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const candidates = ((data ?? []) as Candidate[]).map((c) => ({
      id: c.id,
      file_name: c.file_name,
      applied_role: c.applied_role,
      name: c.personal?.name || c.file_name,
      email: c.personal?.email || '',
      send_to: process.env.TEST_RECIPIENT || c.personal?.email || '',
      status: c.status,
      error: c.error,
      pm_score: c.pm_score,
      spm_score: c.spm_score,
      score_json: c.score_json,
      brief: personalise(c.brief, c.personal?.name),
      email_type: c.email_type,
      email_subject: c.email_subject,
      email_body: personalise(c.email_body, c.personal?.name),
      sent_at: c.sent_at,
      created_at: c.created_at,
    }));
    return NextResponse.json({ candidates, rubric: await getRubric() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
