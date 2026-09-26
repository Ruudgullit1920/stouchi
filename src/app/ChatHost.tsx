/* Opens Aam Salah's chat, a lazy chunk. The chunk is fetched once the app is up
 * (prefetchChat), so the chat still opens after the phone goes offline — that
 * is when the offline parser matters most. If it still can't load, Réessayer. */
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ErrorState } from '../design/components/ErrorState';
import { Skeleton } from '../design/components/Skeleton';

type ChatModule = { ChatPanel: ComponentType };

let chunk: Promise<ChatModule> | null = null;
/** The chat chunk, loaded once; a failed load is forgotten so it can be tried again. */
export function loadChatChunk(): Promise<ChatModule> {
  chunk ??= import('../features/chat').catch((e: unknown) => {
    chunk = null;
    throw e;
  });
  return chunk;
}
export const prefetchChat = () => void loadChatChunk().catch(() => undefined);

export function ChatHost({ load = loadChatChunk }: { load?: () => Promise<ChatModule> }) {
  const [mod, setMod] = useState<ChatModule | null>(null);
  const [failed, setFailed] = useState(false);
  const attempt = () => {
    setFailed(false);
    load().then(setMod, () => setFailed(true));
  };
  useEffect(attempt, []);
  if (mod) return <mod.ChatPanel />;
  if (failed) return <ErrorState onRetry={attempt} />;
  return <Skeleton lines={4} />;
}
