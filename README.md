# Kargo Hiring Dashboard

MESA · AI and its Application · Case Study 2: *Arjun and the Hiring Backlog*

Arjun Mehta, founder of Kargo (Series A logistics SaaS, Mumbai), has had two product roles open for eleven weeks:
60 applications, 19 opened, zero offers. Every review started from scratch and every decision lived in his head.
This app gives him a shortlist he can trust, ranked against what his **best past hires actually had in common**,
and handles everything after his decision.

**The system recommends. Arjun decides.**

## How it works

| Step | What happens | Tool |
|---|---|---|
| Trigger | Arjun uploads a CV and picks the role applied for (PM / SPM) | Dashboard |
| 1. Extract | Name, email and phone are split out and stored privately. Everything after this step sees only the redacted CV. | Gemini Flash + regex |
| 2. Score | Every CV is scored against **both** the PM and SPM rubrics: 0–10 per criterion, one-line evidence-based reason, weighted to 0–100 | Gemini Flash |
| 3. Brief | Top 5 per role scoring 50+ get a 3-sentence interview brief: who they are, why they ranked, what to probe | Gemini Flash |
| 4. Draft | Those same candidates get a personalised interview invite; everyone else gets a warm, specific rejection. Real name substituted from private storage. | Gemini Flash |
| Output | Ranked dashboard with score breakdown, brief and editable draft. **Confirm & send** emails via Resend and marks the candidate as sent. | Next.js · Supabase · Resend |

Rankings update as new CVs come in. If someone drops out of the top 5, their invite is replaced with a rejection
(never after an email has been sent).

## The rubric

Built from the 8 past-hire profiles and their ratings, **not** from the job descriptions (see [`rubric.txt`](rubric.txt)).
What the five *Exceeds Expectations* hires shared, and the *Meets/Below* hires lacked:

| Criterion | PM | SPM |
|---|---|---|
| Hands-on operations exposure | 30% | 25% |
| Self-started fixes that others adopted | 30% | 25% |
| Ownership without a safety net | 20% | 30% |
| Learns in public from what failed | 20% | 20% |

SPM weights independent ownership highest and sets a higher bar on every criterion.

## Privacy

- Personal details are stored in a separate `personal` column and never sent to the scoring, brief or email steps;
  the AI writes `[NAME]` and the real name is substituted only when the email is shown or sent.
- Both tables have Row Level Security on with no public policies; only the server (secret key) can read them.
- `TEST_RECIPIENT` routes every outgoing email to a test inbox so no real external address is contacted.

## Run it

```bash
npm install
cp .env.example .env.local   # fill in the keys
npm run dev
```

| Variable | What |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Supabase project (server-side secret key) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Google AI Studio key; defaults to `gemini-2.5-flash` |
| `RESEND_API_KEY`, `RESEND_FROM` | Resend key; `onboarding@resend.dev` works without a domain |
| `TEST_RECIPIENT` | Inbox that receives every email in testing |

Database schema: `rubric_criteria` (role, name, description, weight) and `candidates` (personal details, redacted CV,
scores per criterion for both roles, brief, draft email, sent status).

Stack: Next.js 15 · Supabase (Postgres) · Gemini Flash · Resend · Vercel. Built with Claude Code.

*Kargo, Arjun Mehta and all case data are fictional, for learning purposes.*
