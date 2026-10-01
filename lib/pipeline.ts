import { db, type Candidate, type Criterion, type CriterionScore, type Role } from './supabase';
import { geminiJSON } from './gemini';

export const TOP_N = 5;

// ---------- Step 1: separate personal details from CV content ----------

type Personal = { name: string; email: string; phone: string };

export async function extractPersonal(raw: string): Promise<Personal> {
  // Only the header (first ~600 chars) goes to the extraction step; that is where contact details live.
  const header = raw.slice(0, 600);
  const out = await geminiJSON<Personal>(
    `Extract the candidate's full name, email address and phone number from the top of this CV.
Return empty strings for anything not present. Do not invent values.

CV HEADER:
${header}`,
    {
      type: 'object',
      properties: { name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' } },
      required: ['name', 'email', 'phone'],
    },
  );
  // Deterministic fallbacks so a model miss never leaks details downstream.
  const email = out.email || raw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] || '';
  const phone = out.phone || raw.match(/\+?\d[\d\s-]{8,}\d/)?.[0] || '';
  return { name: out.name.trim(), email: email.trim(), phone: phone.trim() };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function redact(raw: string, p: Personal): string {
  let t = raw;
  if (p.email) t = t.replace(new RegExp(escapeRe(p.email), 'gi'), '[EMAIL]');
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]');
  t = t.replace(/\+?\d[\d\s-]{8,}\d/g, '[PHONE]');
  t = t.replace(/(https?:\/\/)?(www\.)?(linkedin\.com|github\.com|leetcode\.com)\/\S+/gi, '[PROFILE LINK]');
  if (p.name) {
    const parts = [p.name, ...p.name.split(/\s+/).filter((w) => w.length > 2)];
    for (const part of parts) t = t.replace(new RegExp(`\\b${escapeRe(part)}\\b`, 'gi'), '[NAME]');
  }
  return t.trim();
}

// ---------- Step 2: score against both rubrics ----------

export async function getRubric(): Promise<Record<Role, Criterion[]>> {
  const { data, error } = await db().from('rubric_criteria').select('*').order('id');
  if (error) throw error;
  const rows = (data ?? []) as Criterion[];
  return { PM: rows.filter((r) => r.role === 'PM'), SPM: rows.filter((r) => r.role === 'SPM') };
}

const rubricText = (cs: Criterion[]) =>
  cs.map((c) => `- ${c.name} (weight ${c.weight}%): ${c.description}`).join('\n');

const scoreList = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      criterion: { type: 'string' },
      score: { type: 'integer', description: '0-10' },
      reason: { type: 'string', description: 'One sentence citing specific evidence from the CV' },
    },
    required: ['criterion', 'score', 'reason'],
  },
};

export function weighted(scores: CriterionScore[], criteria: Criterion[]): number {
  let total = 0;
  for (const c of criteria) {
    const s = scores.find((x) => x.criterion.toLowerCase() === c.name.toLowerCase());
    total += ((s?.score ?? 0) / 10) * c.weight;
  }
  return Math.round(total * 10) / 10;
}

export async function scoreCV(cvText: string, rubric: Record<Role, Criterion[]>) {
  const out = await geminiJSON<{ PM: CriterionScore[]; SPM: CriterionScore[] }>(
    `You are scoring a candidate for Kargo, a Series A logistics SaaS company in Mumbai, against two hiring rubrics.
The rubrics were built from the patterns of Kargo's best past hires. Score strictly on evidence in the CV; do not reward
titles, years of experience or keywords by themselves. Score each criterion 0-10 (0 = no evidence, 5 = some evidence,
10 = strong, specific, repeated evidence). The SPM bar is higher than the PM bar for the same evidence.
Use the exact criterion names given. Each reason is one sentence quoting or citing concrete CV evidence.

PM RUBRIC:
${rubricText(rubric.PM)}

SPM RUBRIC:
${rubricText(rubric.SPM)}

CV (personal details removed):
${cvText.slice(0, 12000)}`,
    { type: 'object', properties: { PM: scoreList, SPM: scoreList }, required: ['PM', 'SPM'] },
  );
  return {
    score_json: out,
    pm_score: weighted(out.PM, rubric.PM),
    spm_score: weighted(out.SPM, rubric.SPM),
  };
}

// ---------- Steps 3 & 4: interview brief + draft email ----------

const roleTitle = (r: Role) => (r === 'PM' ? 'Product Manager' : 'Senior Product Manager');

async function draftInvite(c: Candidate) {
  const role = c.applied_role;
  const scores = c.score_json?.[role] ?? [];
  return geminiJSON<{ brief: string; subject: string; body: string }>(
    `You help Arjun Mehta, founder of Kargo (logistics SaaS, Mumbai), hire a ${roleTitle(role)}.
This candidate ranked in the top ${TOP_N} for the role.

1. "brief": exactly three sentences for Arjun: who this person is, why the system ranked them here (cite the
   strongest criteria), and the one thing to probe in the interview (their weakest criterion).
2. "subject" and "body": a warm, specific interview invitation email from Arjun. Refer to one or two concrete things
   from their CV. Ask them to reply with two 45-minute slots next week for an in-person conversation in Mumbai.
   Address them as [NAME] (literally, it is replaced later). Sign off as "Arjun Mehta, Founder, Kargo". Under 150 words.

Criterion scores (${role}): ${JSON.stringify(scores)}

CV (personal details removed):
${(c.cv_text ?? '').slice(0, 10000)}`,
    {
      type: 'object',
      properties: { brief: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } },
      required: ['brief', 'subject', 'body'],
    },
  );
}

async function draftRejection(c: Candidate) {
  return geminiJSON<{ subject: string; body: string }>(
    `Write a warm, respectful rejection email from Arjun Mehta, founder of Kargo (logistics SaaS, Mumbai), to a candidate
who applied for ${roleTitle(c.applied_role)}. Mention one genuine, specific strength from their CV so it does not read
as a template. Be clear that Kargo is not moving forward for this role. No false promises. Address them as [NAME]
(literally, it is replaced later). Sign off as "Arjun Mehta, Founder, Kargo". Under 120 words.

CV (personal details removed):
${(c.cv_text ?? '').slice(0, 8000)}`,
    {
      type: 'object',
      properties: { subject: { type: 'string' }, body: { type: 'string' } },
      required: ['subject', 'body'],
    },
  );
}

const scoreFor = (c: Candidate) => (c.applied_role === 'PM' ? c.pm_score : c.spm_score) ?? 0;

// Re-rank one role and make sure every candidate has the right draft for where they now sit.
export async function refreshDrafts(role: Role) {
  const client = db();
  const { data, error } = await client
    .from('candidates')
    .select('*')
    .eq('applied_role', role)
    .in('status', ['scored', 'ready']);
  if (error) throw error;
  const ranked = ((data ?? []) as Candidate[]).sort((a, b) => scoreFor(b) - scoreFor(a));

  for (let i = 0; i < ranked.length; i++) {
    const c = ranked[i];
    if (c.sent_at) continue; // never rewrite an email that already went out
    const want = i < TOP_N ? 'invite' : 'rejection';
    if (c.status === 'ready' && c.email_type === want) continue;

    if (want === 'invite') {
      const d = await draftInvite(c);
      await client
        .from('candidates')
        .update({ brief: d.brief, email_type: 'invite', email_subject: d.subject, email_body: d.body, status: 'ready' })
        .eq('id', c.id);
    } else {
      const d = await draftRejection(c);
      await client
        .from('candidates')
        .update({ brief: null, email_type: 'rejection', email_subject: d.subject, email_body: d.body, status: 'ready' })
        .eq('id', c.id);
    }
  }
}

export const personalise = (text: string | null, name?: string) =>
  (text ?? '').replaceAll('[NAME]', name?.split(/\s+/)[0] || 'there');
