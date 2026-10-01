'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Role = 'PM' | 'SPM';
type CriterionScore = { criterion: string; score: number; reason: string };
type Criterion = { name: string; weight: number; description: string };
type Cand = {
  id: string;
  file_name: string;
  applied_role: Role;
  name: string;
  email: string;
  send_to: string;
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
};
type QueueItem = { name: string; state: 'waiting' | 'working' | 'done' | 'failed'; msg?: string };

const TOP_N = 5;
const roleScore = (c: Cand, r: Role) => (r === 'PM' ? c.pm_score : c.spm_score) ?? 0;

export default function Dashboard() {
  const [cands, setCands] = useState<Cand[]>([]);
  const [rubric, setRubric] = useState<Record<Role, Criterion[]>>({ PM: [], SPM: [] });
  const [tab, setTab] = useState<Role>('PM');
  const [uploadRole, setUploadRole] = useState<Role>('PM');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/candidates', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) return setLoadErr(data.error || 'Could not load candidates');
    setLoadErr(null);
    setCands(data.candidates);
    setRubric(data.rubric);
  }, []);

  useEffect(() => { load(); }, [load]);
  const busy = queue.some((q) => q.state === 'working' || q.state === 'waiting');
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [busy, load]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setTab(uploadRole);
    setQueue((q) => [...q.filter((x) => x.state !== 'done'), ...list.map((f) => ({ name: f.name, state: 'waiting' as const }))]);
    for (const f of list) {
      setQueue((q) => q.map((x) => (x.name === f.name && x.state === 'waiting' ? { ...x, state: 'working' } : x)));
      const fd = new FormData();
      fd.append('file', f);
      fd.append('role', uploadRole);
      try {
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
        setQueue((q) => q.map((x) => (x.name === f.name && x.state === 'working' ? { ...x, state: 'done' } : x)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setQueue((q) => q.map((x) => (x.name === f.name && x.state === 'working' ? { ...x, state: 'failed', msg } : x)));
      }
      load();
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  const ranked = useMemo(
    () => cands.filter((c) => c.applied_role === tab).sort((a, b) => roleScore(b, tab) - roleScore(a, tab)),
    [cands, tab],
  );

  const stats = {
    total: cands.length,
    invites: cands.filter((c) => c.email_type === 'invite').length,
    sent: cands.filter((c) => c.sent_at).length,
  };

  async function remove(id: string) {
    if (!confirm('Remove this candidate? This deletes their record.')) return;
    await fetch(`/api/candidates/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>Kargo · Hiring Dashboard</h1>
          <p>CVs scored against a rubric built from Kargo’s best past hires. The system recommends; Arjun decides.</p>
        </div>
        <div className="stats">
          <div className="stat"><b>{stats.total}</b><span>CVs scored</span></div>
          <div className="stat"><b>{stats.invites}</b><span>Invites drafted</span></div>
          <div className="stat"><b>{stats.sent}</b><span>Emails sent</span></div>
        </div>
      </header>

      <section className="panel">
        <div className="upload">
          <div className="seg" role="group" aria-label="Role applied for">
            {(['PM', 'SPM'] as Role[]).map((r) => (
              <button key={r} className={uploadRole === r ? 'on' : ''} onClick={() => setUploadRole(r)}>
                {r === 'PM' ? 'Product Manager' : 'Senior PM'}
              </button>
            ))}
          </div>
          <div
            className={`drop ${over ? 'over' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
          >
            Drop CVs here or click to choose (.docx, .pdf, .txt) — applying for <b>{uploadRole}</b>
          </div>
          <input ref={fileRef} type="file" multiple accept=".docx,.pdf,.txt" hidden onChange={(e) => e.target.files && upload(e.target.files)} />
          <button className="btn primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Processing…' : 'Upload CVs'}
          </button>
        </div>
        {queue.length > 0 && (
          <div className="queue">
            {queue.map((q, i) => (
              <div key={q.name + i}>
                <span>{q.name}</span>
                <span className={`pill ${q.state === 'failed' ? 'error' : q.state === 'done' ? 'invite' : 'processing'}`}>
                  {q.state === 'waiting' ? 'Queued' : q.state === 'working' ? 'Extracting → scoring → drafting…' : q.state === 'done' ? 'Done' : q.msg || 'Failed'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="tabs">
        {(['PM', 'SPM'] as Role[]).map((r) => (
          <button key={r} className={tab === r ? 'on' : ''} onClick={() => setTab(r)}>
            {r === 'PM' ? 'Product Manager' : 'Senior Product Manager'} ({cands.filter((c) => c.applied_role === r).length})
          </button>
        ))}
      </div>
      <p className="hint">Ranked by {tab} rubric score. Top {TOP_N} scoring 50+ get an interview brief and an invite draft; everyone else gets a personalised rejection. Nothing is sent until you click Send.</p>

      {loadErr && <div className="panel" style={{ color: 'var(--bad)' }}>{loadErr}</div>}
      {!loadErr && ranked.length === 0 && <div className="panel empty">No {tab} candidates yet. Upload a CV above to start.</div>}

      <div className="list">
        {ranked.map((c, i) => (
          <CandidateCard
            key={c.id}
            c={c}
            rank={i + 1}
            role={tab}
            criteria={rubric[tab]}
            open={open === c.id}
            onToggle={() => setOpen(open === c.id ? null : c.id)}
            onSent={(to) => { flash(`Email sent to ${to}`); load(); }}
            onError={flash}
            onRemove={() => remove(c.id)}
          />
        ))}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function CandidateCard(props: {
  c: Cand; rank: number; role: Role; criteria: Criterion[]; open: boolean;
  onToggle: () => void; onSent: (to: string) => void; onError: (m: string) => void; onRemove: () => void;
}) {
  const { c, rank, role, criteria, open } = props;
  const [subject, setSubject] = useState(c.email_subject ?? '');
  const [body, setBody] = useState(c.email_body ?? '');
  const [sending, setSending] = useState(false);
  useEffect(() => { setSubject(c.email_subject ?? ''); setBody(c.email_body ?? ''); }, [c.email_subject, c.email_body]);

  const isTop = c.email_type === 'invite';
  const other: Role = role === 'PM' ? 'SPM' : 'PM';
  const scores = c.score_json?.[role] ?? [];

  async function send() {
    setSending(true);
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, subject, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Send failed');
      props.onSent(data.to);
    } catch (e) {
      props.onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <article className={`cand ${isTop ? 'top' : ''}`}>
      <div className="row" onClick={props.onToggle}>
        <div className="rank">{rank}</div>
        <div>
          <div className="name">{c.name}</div>
          <div className="meta">
            {c.status === 'processing' && <span className="pill processing">Processing</span>}
            {c.status === 'error' && <span className="pill error">Error: {c.error?.slice(0, 80)}</span>}
            {c.sent_at ? <span className="pill sent">Sent</span> : c.email_type && <span className={`pill ${c.email_type}`}>{c.email_type === 'invite' ? 'Invite drafted' : 'Rejection drafted'}</span>}
            <span>{other} score: {roleScore(c, other)}</span>
            <span>{c.file_name}</span>
          </div>
        </div>
        <div className="score"><b>{roleScore(c, role)}</b><span>/ 100</span></div>
      </div>

      {open && (
        <div className="detail">
          <div>
            {c.brief && (
              <>
                <h4>Interview brief</h4>
                <div className="brief">{c.brief}</div>
              </>
            )}
            <h4>{role} rubric breakdown</h4>
            {criteria.map((cr) => {
              const s = scores.find((x) => x.criterion.toLowerCase() === cr.name.toLowerCase());
              return (
                <div className="crit" key={cr.name}>
                  <div className="top"><span>{cr.name} · {cr.weight}%</span><span>{s?.score ?? 0}/10</span></div>
                  <div className="bar"><i style={{ width: `${(s?.score ?? 0) * 10}%` }} /></div>
                  <p>{s?.reason ?? 'No evidence found.'}</p>
                </div>
              );
            })}
          </div>
          <div className="email">
            <h4>{c.email_type === 'invite' ? 'Draft interview invite' : 'Draft rejection'}</h4>
            {c.email_body ? (
              <>
                <div className="to">To: {c.send_to || 'no email on CV'}{c.send_to && c.send_to !== c.email ? ' (test inbox)' : ''}</div>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!!c.sent_at} aria-label="Subject" />
                <textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={!!c.sent_at} aria-label="Email body" />
                <div className="actions">
                  <button className="btn ghost" onClick={props.onRemove}>Remove</button>
                  {c.sent_at ? (
                    <span className="pill sent">Sent {new Date(c.sent_at).toLocaleString()}</span>
                  ) : (
                    <button className="btn good" disabled={sending || !c.send_to} onClick={send}>
                      {sending ? 'Sending…' : 'Confirm & send'}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="hint">Draft is being written…</p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
