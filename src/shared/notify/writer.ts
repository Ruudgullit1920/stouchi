/* How a notification is worded (assistant spec §6): a small model call for the
 * advice triggers, a fixed French template for everything else and whenever
 * the model's answer can't be trusted — so a notification is never lost to a
 * timeout, and never carries a figure the maths didn't produce.
 *
 * Button labels are not the model's: they come from fr.json per action kind. */
import { t, type StringKey } from '../i18n/t';
import type { Candidate } from './rules';
import { TRIGGERS, type Trigger } from './triggers';

export interface AiCallContext {
  distinctId: string;
  sessionId: string | null;
  traceId: string;
}

export type CallModel = (
  prompt: string,
  signal: AbortSignal,
  context?: AiCallContext,
) => Promise<string>;

const TIMEOUT_MS = 6_000;
const TITLE_MAX = 40;
const TEXT_MAX = 140;
/** notifications.title / body limits in the database */
const DB_TITLE_MAX = 80;
const DB_BODY_MAX = 300;

/** What each trigger means, in the model's words. */
const MEANING: Record<Trigger, string> = {
  payday: 'le salaire est arrivé et vient d’être réparti',
  bill_due: 'une facture arrive bientôt',
  user_reminder: 'un rappel demandé par l’utilisateur',
  pot_over: 'un pot a dépassé son budget pour la période',
  pot_near: 'un pot a atteint 80 % de son budget',
  owed_to_me: 'quelqu’un doit de l’argent à l’utilisateur depuis plus de 10 jours',
  category_spike: 'une catégorie dépasse nettement son niveau habituel',
  savings_opportunity: 'fin de période : il reste de quoi verser à l’épargne',
  weekly_recap: 'le bilan de la semaine',
  quiet_week: 'aucune dépense notée depuis quelques jours',
};

const clean = (s: string, max: number) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, max);

export function writerPrompt(trigger: Trigger, facts: Record<string, string>, firstName: string): string {
  return [
    `Tu es Aam Salah, l'épicier qui tient le carnet de ${clean(firstName, 40)}. Écris UNE notification.`,
    'Tu reçois un déclencheur et ses faits. Recopie les chiffres tels quels, n’en calcule aucun.',
    'Ton : chaleureux, tutoiement, jamais culpabilisant, une touche tunisienne au plus (en français).',
    'Réponds uniquement en JSON :',
    '{"titre": "≤ 40 caractères, sans emoji", "texte": "≤ 140 caractères, 1 ou 2 phrases"}',
    '',
    `Déclencheur : ${trigger} (${MEANING[trigger]})`,
    `Faits : ${JSON.stringify(facts)}`,
  ].join('\n');
}

/** "1 200", "1 200", "12,5", "415" — a group of three after a space, or a plain number. */
const NUMBER = /\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;
const numbersIn = (s: string): number[] =>
  (s.match(NUMBER) ?? []).map((m) => Number(m.replace(/[   ]/g, '').replace(',', '.')));

/** Latin letters, ASCII digits, punctuation, spaces, + and −. No emoji, no Arabic script or digits. */
const ALLOWED = /^[\p{Script=Latin}0-9\p{P}\p{Zs}+−=]*$/u;
/* Arabic script, emoji, and the Number Forms block (Ⅲ, ½ …) which counts as Latin. */
const FORBIDDEN = /[\p{Script=Arabic}\p{Extended_Pictographic}\u2150-\u218f]/u;
/* A figure written in words escapes the digit check ("le double", "deux cents"):
 * refuse them. "Sept" and "neuf" also mean September and new — a template is
 * the safe price of the rare false alarm. */
const NUMBER_WORDS =
  /(?<!\p{L})(deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingts?|trente|quarante|cinquante|soixante|cents?|mille|millions?|milliards?|double|triple|quadruple|moitiés?|quarts?|tiers|dizaines?|centaines?|milliers?)(?!\p{L})/iu;
const plain = (s: string) => ALLOWED.test(s) && !FORBIDDEN.test(s) && !NUMBER_WORDS.test(s);

/** The model's answer, if it is safe to show as is; null means "use the template". */
export function acceptWriter(
  raw: string,
  facts: Record<string, string>,
): { title: string; body: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      raw
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, ''),
    );
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const { titre, texte } = parsed as Record<string, unknown>;
  if (typeof titre !== 'string' || typeof texte !== 'string') return null;
  const title = titre.trim();
  const body = texte.trim();
  if (!title || !body || title.length > TITLE_MAX || body.length > TEXT_MAX) return null;
  if (!plain(title) || !plain(body)) return null;
  const known = new Set(Object.values(facts).flatMap(numbersIn));
  if (![...numbersIn(title), ...numbersIn(body)].every((x) => known.has(x))) return null;
  return { title, body };
}

/** The fixed line for a trigger, filled only from `facts`. */
export function templateFor(
  trigger: Trigger,
  facts: Record<string, string>,
): { title: string; body: string } {
  const variant =
    trigger === 'payday' && !facts.objectif
      ? 'payday_nogoal'
      : trigger === 'bill_due' && facts.jours === '0'
        ? 'bill_due_today'
        : trigger;
  return {
    title: t(`notify.tpl.${variant}.title` as StringKey, facts).slice(0, DB_TITLE_MAX),
    body: t(`notify.tpl.${variant}.body` as StringKey, facts).slice(0, DB_BODY_MAX),
  };
}

export async function compose(
  candidate: Candidate,
  firstName: string,
  callModel?: CallModel,
  aiContext?: AiCallContext,
): Promise<{ title: string; body: string; source: 'model' | 'template' }> {
  const { trigger, facts } = candidate;
  if (callModel && TRIGGERS[trigger].writer) {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        abort.abort();
        resolve(null);
      }, TIMEOUT_MS);
    });
    try {
      const raw = await Promise.race([
        callModel(writerPrompt(trigger, facts, firstName), abort.signal, aiContext),
        timeout,
      ]);
      const ok = raw === null ? null : acceptWriter(raw, facts);
      if (ok) return { ...ok, source: 'model' };
    } catch {
      /* the template below */
    } finally {
      clearTimeout(timer);
    }
  }
  return { ...templateFor(trigger, facts), source: 'template' };
}
