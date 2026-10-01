import { getVercelOidcToken } from '@vercel/oidc';

// Gemini Flash client that asks for JSON output.
// Uses a Google AI Studio key (GEMINI_API_KEY) if set, otherwise Vercel AI Gateway (AI_GATEWAY_API_KEY,
// or the OIDC token Vercel injects at runtime) routed to the same Gemini Flash model.
export async function geminiJSON<T>(prompt: string, schema: object): Promise<T> {
  if (process.env.GEMINI_API_KEY) return viaGoogle<T>(prompt, schema);
  const gatewayKey = process.env.AI_GATEWAY_API_KEY || (await getVercelOidcToken().catch(() => ''));
  if (gatewayKey) return viaGateway<T>(prompt, schema, gatewayKey);
  throw new Error('No AI key set: add GEMINI_API_KEY or AI_GATEWAY_API_KEY');
}

async function withRetry(call: () => Promise<Response>): Promise<Response> {
  let last: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    last = await call();
    if (last.ok) return last;
    // Retry on rate limits and transient server errors only.
    if (last.status !== 429 && last.status < 500) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  // Keep the status code in the message so callers can decide whether to fall back.
  throw new Error(`AI request failed ${last!.status}: ${(await last!.text()).slice(0, 300)}`);
}

// Flash models tried in order. An overloaded (503), rate-limited (429) or retired (404) model hands over
// to the next one immediately, so one busy model never stalls the pipeline.
const FLASH_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];

async function viaGoogle<T>(prompt: string, schema: object): Promise<T> {
  const models = [...new Set([process.env.GEMINI_MODEL, ...FLASH_MODELS].filter(Boolean) as string[])];
  let lastErr = '';
  for (let round = 0; round < 2; round++) {
    for (const model of models) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
        return JSON.parse(text) as T;
      }
      lastErr = `${model} ${res.status}: ${(await res.text()).slice(0, 200)}`;
      if (![404, 429, 500, 503].includes(res.status)) throw new Error(`AI request failed ${lastErr}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`All Gemini Flash models are busy right now. Last error: ${lastErr}`);
}

async function viaGateway<T>(prompt: string, schema: object, key: string): Promise<T> {
  const model = process.env.GATEWAY_MODEL || 'google/gemini-2.5-flash';
  const res = await withRetry(() =>
    fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_schema', json_schema: { name: 'result', schema } },
      }),
    }),
  );
  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? '';
  // Some providers wrap JSON in a code fence; strip it before parsing.
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as T;
}
