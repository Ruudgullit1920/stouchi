/* Types for the CommonJS pipeline, so src/server/aam can use it typed.
 * The eval and the legacy tests keep using index.js directly. */

export interface AamMessage {
  role: string;
  content: string;
}

/** A validated action: the §3 fields plus its kind (spec §5). */
export interface AamAction {
  type: string;
  kind: 'direct' | 'confirm';
  id?: string;
  [field: string]: unknown;
}

export interface AamAnswer {
  reply: string;
  actions: AamAction[];
  chips: string[];
  lang: 'fr' | 'en';
  /** provider:model that answered */
  model: string;
  /** how many of the model's actions validateActions dropped */
  dropped: number;
}

export type AamResult = { status: 200; body: AamAnswer } | { status: number; body: { error: string } };

export function handleAam(p: {
  messages: unknown;
  carnet: object;
  env: Record<string, string | undefined>;
}): Promise<AamResult>;

/** The reply shown when an action was dropped: never a sentence claiming it happened. */
export const SAFE: { fr: string; en: string };
export const DEFAULT_CHAIN: string;
