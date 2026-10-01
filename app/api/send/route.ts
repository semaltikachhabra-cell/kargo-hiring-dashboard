import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { db, type Candidate } from '@/lib/supabase';
import { personalise } from '@/lib/pipeline';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { id, subject, body } = (await req.json()) as { id: string; subject?: string; body?: string };
  const key = process.env.RESEND_API_KEY;
  if (!key) return NextResponse.json({ error: 'RESEND_API_KEY is not set' }, { status: 500 });

  const client = db();
  const { data, error } = await client.from('candidates').select('*').eq('id', id).single();
  if (error || !data) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  const c = data as Candidate;
  if (c.sent_at) return NextResponse.json({ error: 'Already sent' }, { status: 409 });
  // TEST_RECIPIENT routes every email to a test inbox so no real external address is ever contacted.
  const to = process.env.TEST_RECIPIENT || c.personal?.email;
  if (!to) return NextResponse.json({ error: 'No email address on this CV' }, { status: 400 });

  // The founder may have edited the draft in the dashboard; otherwise send the stored one.
  const finalSubject = subject?.trim() || c.email_subject || 'Your application to Kargo';
  const finalBody = body?.trim() || personalise(c.email_body, c.personal?.name);

  const resend = new Resend(key);
  const { error: sendErr } = await resend.emails.send({
    from: process.env.RESEND_FROM || 'Kargo Hiring <onboarding@resend.dev>',
    to,
    subject: finalSubject,
    text: finalBody,
  });
  if (sendErr) return NextResponse.json({ error: sendErr.message }, { status: 502 });

  const sent_at = new Date().toISOString();
  await client.from('candidates').update({ sent_at, email_subject: finalSubject }).eq('id', id);
  return NextResponse.json({ ok: true, sent_at, to });
}
