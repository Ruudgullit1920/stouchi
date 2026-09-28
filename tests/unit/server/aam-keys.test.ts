import { afterEach, describe, expect, it, vi } from 'vitest';
import { chainFromEnv, handleAam } from '../../../lib/aam-salah/index.js';

afterEach(() => vi.unstubAllGlobals());

describe('chainFromEnv with several keys', () => {
  const list = (env: Record<string, string>) => chainFromEnv(env).map((m) => `${m.model}:${m.key}`);

  it('one key gives the same chain as before', () => {
    expect(list({ GEMINI_API_KEY: 'a', AAM_MODELS: 'gemini:x,gemini:y' })).toEqual(['x:a', 'y:a']);
  });
  it('every model is tried with each key, side by side', () => {
    expect(list({ GEMINI_API_KEY: 'a, b,,', AAM_MODELS: 'gemini:x,gemini:y' })).toEqual([
      'x:a',
      'x:b',
      'y:a',
      'y:b',
    ]);
  });
  it('keeps each provider on its own keys, and skips a provider with none', () => {
    expect(
      list({ GEMINI_API_KEY: 'a,b', MISTRAL_API_KEY: 'm', AAM_MODELS: 'gemini:x,mistral:z,tokenrouter:t' }),
    ).toEqual(['x:a', 'x:b', 'z:m']);
    expect(chainFromEnv({ GEMINI_API_KEY: ' , ' })).toEqual([]);
  });
});

describe('handleAam when the first key is out of quota', () => {
  it('answers with the second key', async () => {
    const seen: string[] = [];
    const answer = { reply: 'Noté !', actions: [], chips: [], lang: 'fr' };
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        seen.push((init.headers as Record<string, string>).Authorization);
        return Promise.resolve(
          seen.length === 1
            ? new Response('quota', { status: 429 })
            : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] })),
        );
      }),
    );
    const out = await handleAam({
      messages: [{ role: 'user', content: 'salut' }],
      carnet: { utilisateur: { prenom: 'Sofien' } },
      env: { GEMINI_API_KEY: 'a,b', AAM_MODELS: 'gemini:m' },
    });
    expect(out.status).toBe(200);
    expect(seen).toEqual(['Bearer a', 'Bearer b']);
  });
});
