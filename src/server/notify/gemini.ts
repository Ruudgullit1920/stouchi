/* The notification writer's model call: one user message, JSON out, through
 * Gemini's OpenAI-compatible endpoint (the same one lib/aam-salah uses). The
 * 6 s budget and every fallback live in writer.ts; this only asks. */
import type { AiCallContext, CallModel } from '../../shared/notify/writer';

const URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

export interface GenerationCapture {
  (generation: {
    context?: AiCallContext;
    model: string;
    input: { role: 'user'; content: string }[];
    output?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    latency: number;
    httpStatus?: number;
    isError: boolean;
  }): Promise<void>;
}

export function geminiCaller({
  key,
  model,
  fetchFn = fetch,
  captureGeneration,
}: {
  key: string;
  model: string;
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  captureGeneration?: GenerationCapture;
}): CallModel {
  /* `key` may hold several keys, comma-separated: each is tried in turn, so a key that is
     out of quota or revoked falls through to the next. The writer's 6 s budget still applies. */
  const keys = key
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const askWith =
    (apiKey: string): CallModel =>
    async (prompt, signal, context) => {
      const input = [{ role: 'user' as const, content: prompt }];
      const started = Date.now();
      let res: Response;
      try {
        res = await fetchFn(URL, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: input,
            temperature: 0.5,
            /* Gemini counts hidden reasoning against max_tokens; the answer itself is ~60 tokens */
            max_tokens: 1024,
            reasoning_effort: 'low',
            response_format: { type: 'json_object' },
          }),
        });
      } catch (error) {
        await captureGeneration?.({
          context,
          model,
          input,
          latency: (Date.now() - started) / 1000,
          isError: true,
        });
        throw error;
      }
      if (!res.ok) {
        await captureGeneration?.({
          context,
          model,
          input,
          latency: (Date.now() - started) / 1000,
          httpStatus: res.status,
          isError: true,
        });
        throw new Error(`gemini HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = json.choices?.[0]?.message?.content;
      await captureGeneration?.({
        context,
        model,
        input,
        output: content,
        usage: json.usage,
        latency: (Date.now() - started) / 1000,
        httpStatus: res.status,
        isError: typeof content !== 'string' || !content,
      });
      if (typeof content !== 'string' || !content) throw new Error('gemini: empty answer');
      return content;
    };
  return async (prompt, signal, context) => {
    let last: unknown = new Error('gemini: no key');
    for (const k of keys) {
      try {
        return await askWith(k)(prompt, signal, context);
      } catch (error) {
        last = error;
        if (signal.aborted) break;
      }
    }
    throw last;
  };
}
