/* Shared chat-proxy core. Its front door is server.js, locally (api/chat.js on
 * Vercel was retired in Phase 7); lib/aam-salah reuses its helpers. Two jobs
 * live here:
 *
 *  1. DATA ISOLATION. The browser used to build the whole system prompt, budget
 *     context included, and the proxy forwarded it verbatim — so the server had
 *     no idea whose figures it was sending to Mistral, and RLS was the only
 *     thing standing between two accounts. Now the client sends the prompt
 *     TEMPLATE with a {{STATE}} placeholder and nothing else; the context is
 *     read here, from the row whose user_id matches the access token, using
 *     that same token (so RLS still applies as a second, independent barrier).
 *     A request that arrives with the placeholder already filled is refused.
 *
 *  2. LANGUE. Français par défaut, anglais si l'utilisateur écrit en anglais ;
 *     alphabet latin dans tous les cas, jamais d'arabe — voir latinOnly().
 */
'use strict';

var STATE_TOKEN = '{{STATE}}';
var MAX_HISTORY = 12;
var MAX_CONTENT = 2000;
var MAX_SYSTEM = 20000;

/* ── date helpers (mirror of app.js) ─────────────────────────── */

function pad(n) { return String(n).padStart(2, '0'); }

function serverToday() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/* The client's calendar day is what the user sees, and the server may sit in a
 * different timezone — at a month boundary that changes which month gets
 * summarised. Accept the browser's date, but only within a day of ours, so it
 * cannot be used to select an arbitrary reporting window. */
function resolveToday(claimed) {
  var here = serverToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(claimed || ''))) return here;
  var diff = Math.abs(Date.parse(claimed + 'T00:00:00Z') - Date.parse(here + 'T00:00:00Z'));
  return isFinite(diff) && diff <= 36 * 3600 * 1000 ? claimed : here;
}

/* ── budget summary ──────────────────────────────────────────
 * Les chiffres viennent de budget-facts.js, le MÊME fichier que charge le
 * navigateur pour la carte d'accueil. C'est ce qui garantit que la bulle ne
 * peut pas annoncer un reste que l'écran contredit. */

var BudgetFacts = require('../budget-facts');
var captureAiGeneration = require('./ai-observability').captureAiGeneration;

function buildSummary(data, today, nudgeSeen) {
  return BudgetFacts.build(data, today, nudgeSeen);
}

/* ── prompt assembly ─────────────────────────────────────────── */

/* Returns null when the caller did not hand us a clean template: either the
 * placeholder is missing (context already baked in — possibly someone else's)
 * or it appears twice (a second, forged state block could be smuggled in). */
function injectState(template, summary) {
  if (typeof template !== 'string' || !template || template.length > MAX_SYSTEM) return null;
  var first = template.indexOf(STATE_TOKEN);
  if (first === -1 || first !== template.lastIndexOf(STATE_TOKEN)) return null;
  return template.replace(STATE_TOKEN, function () { return summary; });
}

function cleanHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-MAX_HISTORY).map(function (m) {
    return {
      role: (m && m.role === 'assistant') ? 'assistant' : 'user',
      content: String((m && m.content) || '').slice(0, MAX_CONTENT)
    };
  }).filter(function (m) { return m.content; });
}

/* ── langue : français ou anglais, alphabet latin, jamais d'arabe ──
 *
 * Ce qui est verrouillé ici, c'est l'ALPHABET, pas la langue. Le français
 * reste le défaut et l'anglais est la seule autre langue admise — le modèle
 * choisit d'après le dernier message, le filet ci-dessous se contente de
 * garantir qu'aucune écriture arabe n'atteint la bulle. */

/* Arabic, Arabic Supplement/Extended-A, and the presentation-form blocks. */
var ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

function hasArabic(s) { return ARABIC_RE.test(String(s == null ? '' : s)); }

function replyHasArabic(d) {
  if (!d) return false;
  if (hasArabic(d.reply)) return true;
  return Array.isArray(d.chips) && d.chips.some(hasArabic);
}

/* Appended as one extra turn when a first answer came back in Arabic script.
 * Ne force PAS le français : si l'échange se fait en anglais, réclamer du
 * français ferait dérailler la conversation pour un problème d'alphabet. */
var LANG_NUDGE = 'RAPPEL IMPÉRATIF : ta réponse précédente contenait de l\'écriture arabe, ce qui est interdit. ' +
  'Réécris-la intégralement en alphabet latin, sans un seul caractère arabe, ' +
  'dans la langue qui convient au dernier message de l\'utilisateur : en anglais s\'il écrit en anglais, ' +
  'en français dans tous les autres cas. ' +
  'Les mots tunisiens sont autorisés uniquement translittérés en lettres latines (Ahla bik, Aslema, Tedalel, behi, chwaya).';

var FALLBACK = {
  fr: { noted: 'C\'est noté ✅', ask: 'Ahla bik ! Redis-moi ça en deux mots, je te réponds en français 🙂' },
  en: { noted: 'Got it ✅', ask: 'Sorry, say that again in a few words and I\'ll answer in English 🙂' }
};

/* Last line of defence: whatever the model did, nothing in Arabic script ever
 * reaches the bubble. Actions survive, so a recorded expense is never lost just
 * because the wording came back wrong. */
function latinOnly(data) {
  var out = Object.assign({}, data || {});
  out.lang = out.lang === 'en' ? 'en' : 'fr';
  if (Array.isArray(out.chips)) out.chips = out.chips.filter(function (c) { return !hasArabic(c); });
  if (hasArabic(out.reply)) {
    var f = FALLBACK[out.lang];
    out.reply = (Array.isArray(out.actions) && out.actions.length) ? f.noted : f.ask;
  }
  return out;
}

/* ── Supabase ────────────────────────────────────────────────── */

/* The token is the only thing we trust: whatever id it resolves to is the only
 * row this request may ever read. */
async function resolveUserId(cfg, token) {
  try {
    var r = await fetch(cfg.supabaseUrl + '/auth/v1/user', {
      headers: { apikey: cfg.supabaseKey, Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(5000)
    });
    if (!r.ok) return null;
    var u = await r.json();
    return (u && typeof u.id === 'string' && u.id) ? u.id : null;
  } catch (e) {
    return null;
  }
}

/* Scoped twice over: an explicit user_id filter here, and the caller's own JWT
 * so RLS independently rejects anything that filter might have missed. */
async function fetchUserData(cfg, token, userId) {
  var url = cfg.supabaseUrl + '/rest/v1/' + cfg.table +
    '?select=data,user_id&user_id=eq.' + encodeURIComponent(userId) + '&limit=1';
  var r = await fetch(url, {
    headers: { apikey: cfg.supabaseKey, Authorization: 'Bearer ' + token, Accept: 'application/json' },
    signal: AbortSignal.timeout(5000)
  });
  if (!r.ok) throw new Error('budget_data read failed: ' + r.status);
  var rows = await r.json();
  if (!Array.isArray(rows) || !rows.length) return null;
  /* Paranoia, cheap: never summarise a row that is not this user's. */
  if (rows[0].user_id && rows[0].user_id !== userId) throw new Error('row/user mismatch');
  return rows[0].data || null;
}

/* ── fournisseurs de modèle ────────────────────────────────────
 *
 * Mistral reste le défaut et n'est pas retiré : il se met en veille dès que
 * CHAT_PROVIDER nomme quelqu'un d'autre, et revenir en arrière se fait en
 * effaçant cette seule ligne du .env. Tous parlent le même dialecte
 * (chat/completions à la OpenAI), donc seuls l'URL, le modèle et le nom de la
 * variable de clé changent d'une entrée à l'autre. */
var PROVIDERS = {
  mistral: {
    url: 'https://api.mistral.ai/v1/chat/completions',
    model: 'mistral-small-latest',
    keyVar: 'MISTRAL_API_KEY',
    label: 'Mistral',
    jsonMode: true
  },
  /* TokenRouter — passerelle compatible OpenAI (z-ai/glm-5.3 et consorts).
   * À l'essai. La clé vit dans TOKENROUTER_API_KEY, jamais dans le dépôt. */
  tokenrouter: {
    url: 'https://api.tokenrouter.com/v1/chat/completions',
    model: 'z-ai/glm-5.3-free',
    keyVar: 'TOKENROUTER_API_KEY',
    label: 'TokenRouter',
    jsonMode: true
  }
};

var DEFAULT_PROVIDER = 'mistral';

function parseModelJson(raw) {
  var s = String(raw == null ? '' : raw);
  try {
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    return JSON.parse(s.slice(a, b + 1));
  } catch (e) {
    /* Rien d'exploitable. Un modèle à raisonnement peut rendre un content VIDE
     * (tout le budget de sortie parti dans le raisonnement) — observé sur
     * glm-5.3 avec un max_tokens trop bas. Répondre « c'est noté » dans ce
     * cas-là serait un mensonge : aucune action n'accompagne la phrase, donc
     * la dépense serait perdue en silence. On redemande. */
    return { reply: s.trim() || FALLBACK.fr.ask, actions: [], chips: [] };
  }
}

/* Whatever came back, the client always gets the same shape: a string reply,
 * an array of action objects, an array of short string chips. */
function shape(d) {
  var o = (d && typeof d === 'object') ? d : {};
  return Object.assign({}, o, {
    reply: typeof o.reply === 'string' ? o.reply : (o.reply == null ? '' : String(o.reply)),
    actions: Array.isArray(o.actions) ? o.actions.filter(function (a) { return a && typeof a === 'object'; }) : [],
    chips: Array.isArray(o.chips) ? o.chips.filter(function (c) { return typeof c === 'string'; }).slice(0, 4) : []
  });
}

/* Un fournisseur qui ne répond pas ne doit pas figer la bulle : chaque appel a
 * une échéance, et un 429 / 5xx / délai dépassé a droit à UNE seconde chance si
 * le temps restant le permet. Le free tier de Mistral renvoie des 429 en rafale. */
function retryable(e) { return e && (e.timeout || e.status === 429 || e.status >= 500); }
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function callModelOnce(cfg, messages, ms, observability) {
  var body = { model: cfg.model, messages: messages };
  /* Le JSON-mode n'est pas universel : quand un fournisseur ne le propose pas,
   * on s'en passe et parseModelJson va rechercher l'objet dans la prose. */
  if (cfg.jsonMode) body.response_format = { type: 'json_object' };
  var started = Date.now();
  var capture = function (details) {
    if (!observability) return;
    captureAiGeneration(Object.assign({
      env: cfg.env,
      distinctId: observability.distinctId,
      sessionId: observability.sessionId,
      traceId: observability.traceId,
      provider: cfg.provider,
      model: cfg.model,
      input: messages,
      latency: (Date.now() - started) / 1000
    }, details));
  };
  var r;
  try {
    r = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms)
    });
  } catch (e) {
    capture({ isError: true });
    var te = new Error(cfg.label + ' API timeout');
    te.timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (!te.timeout) te.message = 'Could not reach ' + cfg.label + ' API';
    throw te;
  }
  if (!r.ok) {
    capture({ httpStatus: r.status, isError: true });
    var text = await r.text();
    var err = new Error(cfg.label + ' API error ' + r.status);
    err.status = r.status;
    err.detail = text.slice(0, 500);
    err.retryAfter = Number(r.headers.get('retry-after')) || 0;
    throw err;
  }
  var json = await r.json();
  var msg = json.choices && json.choices[0] && json.choices[0].message;
  var content = msg && msg.content;
  capture({
    output: content,
    usage: json.usage,
    httpStatus: r.status,
    isError: typeof content !== 'string' || !content
  });
  return content;
}

async function callModel(cfg, messages, deadline, observability) {
  var left = function () { return deadline - Date.now(); };
  try {
    return await callModelOnce(cfg, messages, Math.max(1000, left()), observability);
  } catch (e) {
    var wait = Math.min(3000, (e.retryAfter || 1) * 1000);
    if (!retryable(e) || left() - wait < 4000) throw e;
    await sleep(wait);
    return callModelOnce(cfg, messages, left(), observability);
  }
}

/* ── request handler (transport-agnostic) ────────────────────── */

async function handleChatRequest(cfg, token, payload) {
  /* Fail closed. Without Supabase we cannot establish whose budget this is, and
   * answering anyway is exactly the cross-account leak we are guarding against. */
  if (!cfg.supabaseUrl || !cfg.supabaseKey) {
    return { status: 503, body: { error: 'Authentification indisponible.' } };
  }
  if (!token) return { status: 401, body: { error: 'Non autorisé.' } };

  var userId = await resolveUserId(cfg, token);
  if (!userId) return { status: 401, body: { error: 'Non autorisé.' } };

  if (!cfg.key) {
    return { status: 500, body: { error: cfg.keyVar + ' is not set on the server.' } };
  }

  var data;
  try {
    data = await fetchUserData(cfg, token, userId);
  } catch (e) {
    return { status: 502, body: { error: 'Lecture du carnet impossible.' } };
  }

  var today = resolveToday(payload && payload.today);
  /* nudgeSeen ne peut que TAIRE un rappel, jamais fabriquer un chiffre : le
     client a le droit de dire « celui-là, je l'ai déjà affiché ». */
  var seen = Array.isArray(payload && payload.nudgeSeen)
    ? payload.nudgeSeen.slice(0, 40).map(function (k) { return String(k).slice(0, 64); })
    : [];
  var facts = buildSummary(data, today, seen);
  var system = injectState(payload && payload.system, facts.text);
  if (system === null) {
    /* Either no placeholder, or a pre-filled context: the client does not get to
     * choose what Aam Salah knows. */
    return { status: 400, body: { error: 'Contexte invalide.' } };
  }

  var history = cleanHistory(payload && payload.messages);
  var messages = [{ role: 'system', content: system }].concat(history);

  var out;
  var deadline = Date.now() + cfg.deadlineMs;
  var aiTurn = function () {
    return { distinctId: userId, sessionId: 'chat-' + userId, traceId: crypto.randomUUID() };
  };
  try {
    out = parseModelJson(await callModel(cfg, messages, deadline, aiTurn()));
    if (replyHasArabic(out) && deadline - Date.now() > 3000) {
      /* One retry if time allows, then the filter below takes over. */
      out = parseModelJson(await callModel(cfg, messages.concat([
        { role: 'assistant', content: JSON.stringify(out) },
        { role: 'user', content: LANG_NUDGE }
      ]), deadline, aiTurn()));
    }
  } catch (e) {
    /* The provider's own error text stays in the server log: it can name the
     * account, the quota or the model, none of which the browser needs. The
     * client falls back to its local parser on any non-200. */
    console.error('[chat]', e && e.message, e && e.detail ? String(e.detail).slice(0, 200) : '');
    var busy = e && (e.status === 429 || e.timeout);
    return { status: busy ? 503 : 502, body: { error: busy ? 'Assistant occupé, réessaie dans un instant.' : 'Assistant indisponible.' } };
  }

  /* Le client mémorise la clé pour que le même rappel ne reparte pas au
     message suivant. */
  var body = latinOnly(shape(out));
  if (facts.nudgeKeys && facts.nudgeKeys.length) body.nudgeKeys = facts.nudgeKeys;
  return { status: 200, body: body };
}

function bearer(headers) {
  var auth = (headers && (headers.authorization || headers.Authorization)) || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

/* Le projet et la clé publiable du dépôt. La clé est publiable — RLS est la
 * vraie frontière — donc ce n'est pas une fuite. Ce qui posait problème, c'est
 * le silence : un déploiement où SUPABASE_URL n'est pas renseigné lisait et
 * écrivait la base de production sans que rien ne le signale. Le repli reste
 * (il fait tourner le poste de dev tel quel) mais il s'annonce désormais. */
var DEFAULT_SUPABASE_URL = 'https://gfbakmwllhuhfdydbcfa.supabase.co';
var DEFAULT_SUPABASE_KEY = 'sb_publishable_QOqEOHTTNlmU-5twCIheiQ_Spki7gWm';

/* Un CHAT_PROVIDER inconnu ne fait pas tomber le serveur : on retombe sur
 * Mistral, qui a toujours marché. */
function providerName(env) {
  var name = String(env.CHAT_PROVIDER || '').trim().toLowerCase();
  return PROVIDERS[name] ? name : DEFAULT_PROVIDER;
}

function configFromEnv(env) {
  var name = providerName(env);
  var p = PROVIDERS[name];
  var prefix = name.toUpperCase();
  return {
    supabaseUrl: env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
    supabaseKey: env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY,
    table: env.SUPABASE_TABLE || 'budget_data',
    provider: name,
    label: p.label,
    keyVar: p.keyVar,
    key: env[p.keyVar] || '',
    /* Trois crans, du plus général au plus précis : le défaut du fournisseur,
     * sa variable dédiée (MISTRAL_MODEL, TOKENROUTER_MODEL…), puis CHAT_MODEL
     * qui tranche — de quoi essayer un autre modèle sans toucher au code. */
    model: env.CHAT_MODEL || env[prefix + '_MODEL'] || p.model,
    url: env.CHAT_API_URL || env[prefix + '_API_URL'] || p.url,
    jsonMode: p.jsonMode,
    /* Total time for one chat turn, retries included. Vercel cuts a function
     * at 10 s by default, so stay under it there; locally, allow more. */
    deadlineMs: Number(env.CHAT_DEADLINE_MS) || (env.VERCEL ? 9000 : 20000),
    env: env
  };
}

/* Vrai quand la configuration vient du dépôt et non de l'environnement :
 * server.js s'en sert pour prévenir au démarrage. */
function usingDefaultSupabase(env) {
  return !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY;
}

module.exports = {
  STATE_TOKEN: STATE_TOKEN,
  DEFAULT_SUPABASE_URL: DEFAULT_SUPABASE_URL,
  usingDefaultSupabase: usingDefaultSupabase,
  buildSummary: buildSummary,
  injectState: injectState,
  cleanHistory: cleanHistory,
  hasArabic: hasArabic,
  replyHasArabic: replyHasArabic,
  latinOnly: latinOnly,
  shape: shape,
  parseModelJson: parseModelJson,
  resolveToday: resolveToday,
  resolveUserId: resolveUserId,
  fetchUserData: fetchUserData,
  handleChatRequest: handleChatRequest,
  configFromEnv: configFromEnv,
  providerName: providerName,
  PROVIDERS: PROVIDERS,
  bearer: bearer
};
