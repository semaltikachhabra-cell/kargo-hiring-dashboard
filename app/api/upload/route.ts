import { NextResponse } from 'next/server';
import { db, type Role } from '@/lib/supabase';
import { fileToText } from '@/lib/parse';
import { extractPersonal, getRubric, redact, refreshDrafts, scoreCV } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file');
  const role = form.get('role') as Role;
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  if (role !== 'PM' && role !== 'SPM') return NextResponse.json({ error: 'Pick PM or SPM' }, { status: 400 });

  const client = db();
  const { data: row, error } = await client
    .from('candidates')
    .insert({ file_name: file.name, applied_role: role, status: 'processing' })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const id = row.id as string;

  try {
    const raw = await fileToText(file.name, Buffer.from(await file.arrayBuffer()));
    if (raw.trim().length < 100) throw new Error('Could not read enough text from this file');

    // Step 1: personal details are split off and stored separately; only cv_text flows on to AI steps.
    const personal = await extractPersonal(raw);
    const cvText = redact(raw, personal);
    await client.from('candidates').update({ personal, cv_text: cvText }).eq('id', id);

    // Step 2: score against both rubrics regardless of the role applied for.
    const scored = await scoreCV(cvText, await getRubric());
    await client.from('candidates').update({ ...scored, status: 'scored' }).eq('id', id);

    // Steps 3-4: re-rank the role, then write briefs and draft emails where needed.
    await refreshDrafts(role);
    return NextResponse.json({ id, ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await client.from('candidates').update({ status: 'error', error: message }).eq('id', id);
    return NextResponse.json({ id, error: message }, { status: 500 });
  }
}
