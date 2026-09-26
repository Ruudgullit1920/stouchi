/* Aam Salah's server side: one chat turn in, one validated answer out.
 *
 *   messages + carnet ──► [instructions + carnet as ONE system message]
 *                     ──► provider chain (first that answers in time wins)
 *                     ──► parse → shape → latinOnly → validateActions
 *                     ──► {reply, actions, chips, lang, provider}
 *
 * One system message, not two: Gemini's OpenAI-compatible endpoint keeps only
 * the last system turn, so with two it never saw the instructions (measured:
 * 0/2 → 2/2 on the eval once merged). */
'use strict';

const { instructions } = require('./instructions');
const { validateActions } = require('./validate');
const { shape, latinOnly, replyHasArabic, cleanHistory } = require('../chat-context');

const ENDPOINTS = {
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', keyVar: 'GEMINI_API_KEY',
            /* 3.x Flash-Lite rejects "none"; "low" answers in about half a second */
            extra: { reasoning_effort: 'low' } },
  mistral: { url: 'https://api.mistral.ai/v1/chat/completions', keyVar: 'MISTRAL_API_KEY', extra: {} },
  tokenrouter: { url: 'https://api.tokenrouter.com/v1/chat/completions', keyVar: 'TOKENROUTER_API_KEY', extra: {} }
};
/* Chosen on the §8 eval (2026-09-23): Flash-Lite 53/56 over two runs, p50 1.2 s,
 * after the prompt fixes. Flash is the stronger backup; Mistral last, its free key is
 * rate-limited on every call. Override with AAM_MODELS in .env. */
/* Flash-Lite twice: an occasional call stalls, and a second try usually lands
 * in about a second. The free-tier backups are often out of quota. */
const DEFAULT_CHAIN = 'gemini:gemini-3.5-flash-lite,gemini:gemini-3.5-flash-lite,gemini:gemini-3.8-flash,mistral:mistral-small-latest';

function chainFromEnv(env) {
  return String(env.AAM_MODELS || DEFAULT_CHAIN).split(',').map((s) => {
    const [provider, model] = s.trim().split(':');
    const ep = ENDPOINTS[provider];
    return ep && model && env[ep.keyVar] ? { provider, model, url: ep.url, key: env[ep.keyVar], extra: ep.extra } : null;
  }).filter(Boolean);
}

async function callOnce(m, messages, ms) {
  /* Gemini counts its hidden reasoning against max_tokens: at 900 an answer was
   * cut off mid-JSON (finish_reason "length"). The visible reply is ~100 tokens. */
  const body = Object.assign({ model: m.model, messages, temperature: 0.3, max_tokens: 2048,
    response_format: { type: 'json_object' } }, m.extra);
  let r;
  try {
    r = await fetch(m.url, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(ms),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + m.key } });
  } catch (e) {
    throw Object.assign(new Error(m.provider + ' unreachable or timed out'), { soft: true });
  }
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300);
    /* 429 / 5xx: try the next model. 4xx: our request is wrong for this model, also try the next. */
    throw Object.assign(new Error(m.provider + ':' + m.model + ' HTTP ' + r.status), { detail, soft: true });
  }
  const j = await r.json();
  return j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
}

/* The model sometimes wraps its JSON in drafts or notes ("Wait, check the
 * constraints…"), or gets cut off. Take the LAST complete top-level object that
 * has a string "reply"; anything else is a failed answer, never shown. */
function extractAnswer(content) {
  const s = String(content == null ? '' : content);
  const found = [];
  let depth = 0, start = -1, inStr = false, escNext = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (escNext) escNext = false; else if (ch === '\\') escNext = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { if (depth > 0) inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}' && depth > 0) { depth--; if (depth === 0) found.push(s.slice(start, i + 1)); }
  }
  for (let k = found.length - 1; k >= 0; k--) {
    try { const o = JSON.parse(found[k]); if (o && typeof o.reply === 'string' && o.reply.trim()) return o; } catch (e) { /* next */ }
  }
  return null;
}

/* Each attempt is capped so one slow reply can't eat the time the backups need
 * (a Flash-Lite call once hung 12 s). And the chain is walked in hedged pairs:
 * if the first of a pair hasn't answered after HEDGE_MS, the second starts in
 * parallel and the first usable answer wins. On the free tier about half the
 * first calls stalled until the cap (~8 s replies); hedging brings that to ~3–5 s. */
const PER_ATTEMPT_MS = 6000;
const HEDGE_MS = 3000;
const why = (e) => e.message + (e.detail ? ' ' + e.detail.replace(/\s+/g, ' ').slice(0, 120) : '');

function hedged(startA, startB, delay) {
  return new Promise((resolve, reject) => {
    const errs = [];
    let running = 0, secondStarted = false, settled = false;
    const run = (start) => {
      running++;
      start().then((v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } },
        (e) => { errs.push(e); running--; if (!secondStarted) startSecond(); else if (!running && !settled) { settled = true; reject(errs); } });
    };
    const startSecond = () => { if (secondStarted || settled) return; secondStarted = true; clearTimeout(timer); run(startB); };
    const timer = setTimeout(startSecond, delay);
    run(startA);
  });
}

async function ask(chain, messages, deadline) {
  const errors = [];
  const attempt = (m, last) => async () => {
    const left = deadline - Date.now();
    const content = await callOnce(m, messages, Math.max(1000, last ? left : Math.min(left, PER_ATTEMPT_MS)));
    const answer = extractAnswer(content);
    if (!answer) throw Object.assign(new Error(m.provider + ':' + m.model + ' unusable answer'), { detail: String(content).slice(0, 200) });
    return { answer, model: m.provider + ':' + m.model };
  };
  for (let i = 0; i < chain.length;) {
    if (deadline - Date.now() < 1500) break;
    const pair = chain.slice(i, i + 2);
    try {
      const got = pair.length === 2
        ? await hedged(attempt(pair[0]), attempt(pair[1], i + 2 >= chain.length), HEDGE_MS)
        : await attempt(pair[0], true)();
      return Object.assign(got, { errors });
    } catch (e) {
      (Array.isArray(e) ? e : [e]).forEach((x) => errors.push(why(x)));
      i += pair.length;
    }
  }
  const err = new Error('no model answered');
  err.errors = errors;
  throw err;
}

const SAFE = {
  fr: "Je n'ai pas bien compris, tu peux me redire ça autrement ?",
  en: "I didn't quite get that, could you say it another way?"
};

/* A reply that announces something the app will not do is worse than no reply. */
function reconcile(out, kept, dropped) {
  if (!dropped.length || kept.length) return out;
  return Object.assign({}, out, { reply: SAFE[out.lang] || SAFE.fr, chips: [] });
}

/**
 * @param {object} p
 * @param {Array}  p.messages  conversation, oldest first ({role, content}); "[app] …" turns included
 * @param {object} p.carnet    the figures the model may use (see spec §4)
 * @param {object} p.env       process.env
 * @returns {Promise<{status:number, body:object}>}
 */
async function handleAam({ messages, carnet, env }) {
  if (!carnet || typeof carnet !== 'object') return { status: 400, body: { error: 'carnet manquant' } };
  const chain = chainFromEnv(env);
  if (!chain.length) return { status: 503, body: { error: 'Aucun modèle configuré.' } };

  const prenom = carnet.utilisateur && carnet.utilisateur.prenom;
  const partenaire = carnet.utilisateur && carnet.utilisateur.mode === 'couple' ? carnet.utilisateur.partenaire : null;
  const system = instructions(prenom, partenaire) + '\n\nCARNET de ' + (prenom || 'l\'utilisateur') +
    ' — ce sont les seuls chiffres qui existent.\n' + JSON.stringify(carnet);
  const history = cleanHistory(messages);
  if (!history.length) return { status: 400, body: { error: 'message vide' } };
  const convo = [{ role: 'system', content: system }].concat(history);
  const deadline = Date.now() + (Number(env.AAM_DEADLINE_MS) || (env.VERCEL ? 9000 : 15000));

  let got;
  try {
    got = await ask(chain, convo, deadline);
  } catch (e) {
    console.error('[aam] all models failed:', (e.errors || []).join(' | '));
    return { status: 503, body: { error: 'Assistant indisponible.' } };
  }
  let out = shape(got.answer);
  if (replyHasArabic(out) && deadline - Date.now() > 3000) {
    try {
      const again = await ask(chain, convo.concat([{ role: 'assistant', content: JSON.stringify(out) },
        { role: 'user', content: 'Réécris ta réponse en alphabet latin uniquement, même contenu, même JSON.' }]), deadline);
      out = shape(again.answer);
    } catch (e) { /* latinOnly below still guarantees the script */ }
  }
  out = latinOnly(out);
  const { kept, dropped } = validateActions(out.actions, carnet);
  if (dropped.length) console.warn('[aam] dropped', JSON.stringify(dropped).slice(0, 300));
  out = reconcile(Object.assign(out, { actions: kept }), kept, dropped);
  if (out.actions.some((a) => a.kind === 'confirm')) out.chips = [];
  if (!out.reply.trim()) out.reply = SAFE[out.lang] || SAFE.fr;
  /* `dropped` lets /api/aam log a validation_drop; it is not sent to the app */
  return { status: 200, body: Object.assign(out, { model: got.model, dropped: dropped.length }) };
}

module.exports = { handleAam, chainFromEnv, extractAnswer, DEFAULT_CHAIN, SAFE };
