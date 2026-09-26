import { describe, expect, it, vi } from 'vitest';
import { geminiCaller } from '../../../src/server/notify/gemini';
import { handleNotify, type HandlerEnv } from '../../../src/server/notify/handler';
import type { NotifyDb, RunDeps } from '../../../src/server/notify/run';

const SECRET = 's3cret-that-is-long-enough-for-a-cron-0123456789';
const emptyDb: NotifyDb = {
  listUsers: () => Promise.resolve([]),
  loadSnapshot: () => Promise.resolve(null),
  recentNotifications: () => Promise.resolve([]),
  insertDeposit: () => Promise.resolve(),
  insertNotification: () => Promise.resolve(null),
  subscriptions: () => Promise.resolve([]),
  deleteSubscription: () => Promise.resolve(),
};
const env = (over: Partial<HandlerEnv> = {}): HandlerEnv => ({
  secret: SECRET,
  makeDeps: (): RunDeps => ({ db: emptyDb, now: new Date(), sendPush: vi.fn(), log: vi.fn() }),
  ...over,
});
const post = (auth?: string) =>
  new Request('https://x/functions/v1/notify-run', {
    method: 'POST',
    headers: auth === undefined ? {} : { Authorization: auth },
  });

describe('handleNotify', () => {
  it('runs with the cron secret and returns the report', async () => {
    const res = await handleNotify(post(`Bearer ${SECRET}`), env());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ users: 0, inserted: 0, errors: 0 });
  });
  it('401 without the secret, with a wrong one, or one of another length — and never runs', async () => {
    const makeDeps = vi.fn();
    for (const auth of [
      undefined,
      'Bearer nope',
      `Bearer ${SECRET}x`,
      `Bearer ${SECRET.slice(0, -1)}!`,
      SECRET,
    ])
      expect((await handleNotify(post(auth), env({ makeDeps }))).status).toBe(401);
    expect(makeDeps).not.toHaveBeenCalled();
  });
  it('405 for anything but POST', async () => {
    const res = await handleNotify(new Request('https://x/', { method: 'GET' }), env());
    expect(res.status).toBe(405);
  });
  it('503 when no secret is configured, whatever the caller sends', async () => {
    expect((await handleNotify(post('Bearer '), env({ secret: undefined }))).status).toBe(503);
    expect((await handleNotify(post('Bearer '), env({ secret: '' }))).status).toBe(503);
  });
  it('500 with no detail when the run itself throws', async () => {
    const makeDeps = () => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY=abc');
    };
    const res = await handleNotify(post(`Bearer ${SECRET}`), env({ makeDeps }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('abc');
  });
  it('logs what kind of failure stopped the run, without its text', async () => {
    const log = vi.fn();
    const failing = {
      ...emptyDb,
      listUsers: () => Promise.reject(new Error('profiles: secret detail')),
    };
    const makeDeps = (): RunDeps => ({ db: failing, now: new Date(), sendPush: vi.fn(), log });
    expect((await handleNotify(post(`Bearer ${SECRET}`), env({ makeDeps }))).status).toBe(500);
    expect(log).toHaveBeenCalledWith('notify_run_failed', { Error_profiles: 1 });
  });
});

describe('geminiCaller', () => {
  it("posts the prompt to Gemini's OpenAI-compatible endpoint and returns the content", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"titre":"a","texte":"b"}' } }] })),
      );
    const call = geminiCaller({ key: 'k', model: 'gemini-3.5-flash-lite', fetchFn });
    const signal = new AbortController().signal;
    await expect(call('Écris', signal)).resolves.toBe('{"titre":"a","texte":"b"}');
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(init.signal).toBe(signal);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer k' });
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'gemini-3.5-flash-lite',
      messages: [{ role: 'user', content: 'Écris' }],
      response_format: { type: 'json_object' },
    });
  });
  it('throws on an HTTP error or an empty answer', async () => {
    const call = (r: Response) => geminiCaller({ key: 'k', model: 'm', fetchFn: () => Promise.resolve(r) });
    await expect(
      call(new Response('quota', { status: 429 }))('p', new AbortController().signal),
    ).rejects.toThrow('429');
    await expect(call(new Response('{"choices":[]}'))('p', new AbortController().signal)).rejects.toThrow();
  });
});
