/* Dev server for the redesign prototype, with the real Aam Salah behind it.
 *
 *   node scripts/dev-prototype.js        →  http://localhost:8124
 *
 * GET  /            prototype/index.html
 * POST /api/aam     {messages, carnet} → {reply, actions, chips, lang, model}
 *
 * PROTOTYPE ONLY: the browser sends its own carnet because the prototype has no
 * database. In the app, the server builds the carnet from the signed-in user's
 * row (spec §2) and never trusts one from the client. Loopback only. */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) return;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  });
}

const { handleAam, chainFromEnv } = require('../lib/aam-salah');
const PAGE = path.join(root, 'prototype', 'index.html');
const PORT = Number(process.env.PROTOTYPE_PORT) || 8124;
const MAX_BODY = 200 * 1024;

function send(res, status, body, type = 'application/json') {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { req.removeAllListeners('data'); req.resume(); reject(Object.assign(new Error('too large'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(Object.assign(e, { status: 400 })); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'POST' && url === '/api/aam') {
    let body;
    try { body = await readJson(req); } catch (e) { send(res, e.status || 400, { error: 'requête invalide' }); return; }
    try {
      const t0 = Date.now();
      const out = await handleAam({ messages: body.messages, carnet: body.carnet, env: process.env });
      console.log(`[aam] ${out.status} ${out.body.model || '-'} ${Date.now() - t0} ms`);
      send(res, out.status, out.body);
    } catch (e) {
      console.error('[aam] unexpected', e);
      send(res, 500, { error: 'Erreur interne.' });
    }
    return;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && (url === '/' || url === '/index.html')) {
    fs.readFile(PAGE, (err, data) => err ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, data, 'text/html; charset=utf-8'));
    return;
  }
  send(res, 404, 'Not found', 'text/plain');
});

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? 'Port ' + PORT + ' déjà pris (PROTOTYPE_PORT pour en changer).' : e);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  const chain = chainFromEnv(process.env).map((m) => m.provider + ':' + m.model);
  console.log('Prototype : http://localhost:' + PORT);
  console.log('Aam Salah : ' + (chain.length ? chain.join(' → ') + ' → hors ligne' : 'aucune clé, mode hors ligne seulement'));
});

module.exports = server;
