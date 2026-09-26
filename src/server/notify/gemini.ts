/* The notification writer's model call: one user message, JSON out, through
 * Gemini's OpenAI-compatible endpoint (the same one lib/aam-salah uses). The
 * 6 s budget and every fallback live in writer.ts; this only asks. */
import type { CallModel } from '../../shared/notify/writer';

const URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

export function geminiCaller({
  key,
  model,
  fetchFn = fetch,
}: {
  key: string;
  model: string;
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
}): CallModel {
  return async (prompt, signal) => {
    const res = await fetchFn(URL, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        /* Gemini counts hidden reasoning against max_tokens; the answer itself is ~60 tokens */
        max_tokens: 1024,
        reasoning_effort: 'low',
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error(`gemini HTTP ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content) throw new Error('gemini: empty answer');
    return content;
  };
}
