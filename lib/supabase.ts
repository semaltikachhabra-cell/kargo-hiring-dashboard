import { createClient } from '@supabase/supabase-js';

// Server-only client. Tables have RLS on with no policies, so only the secret key can read them.
export function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY are not set');
  return createClient(url, key, { auth: { persistSession: false } });
}

export type Role = 'PM' | 'SPM';

export type Criterion = {
  id: number;
  role: Role;
  name: string;
  description: string;
  weight: number;
};

export type CriterionScore = { criterion: string; score: number; reason: string };

export type Candidate = {
  id: string;
  file_name: string;
  applied_role: Role;
  personal: { name?: string; email?: string; phone?: string };
  cv_text: string | null;
  status: 'processing' | 'scored' | 'ready' | 'error';
  error: string | null;
  pm_score: number | null;
  spm_score: number | null;
  score_json: { PM: CriterionScore[]; SPM: CriterionScore[] } | null;
  brief: string | null;
  email_type: 'invite' | 'rejection' | null;
  email_subject: string | null;
  email_body: string | null;
  sent_at: string | null;
  created_at: string;
};
