'use strict';
// Acesso ao Google Drive por CONTA DE SERVIÇO (sem senha de pessoa). Sem dependências: assina o JWT com o próprio Node.
// Variáveis: CTAI_DRIVE_CHAVE (o JSON da chave, puro ou em base64) e CTAI_ACERVO_PASTA (id da pasta do Acervo, compartilhada com o e-mail da conta de serviço).
const crypto = require('node:crypto');
const config = require('./config');

const ESCOPO = 'https://www.googleapis.com/auth/drive';
let cache = { token: null, ate: 0 };

function chave() {
  const bruto = String(config.env('CTAI_DRIVE_CHAVE', '')).trim();
  if (!bruto) return null;
  try { const txt = bruto.startsWith('{') ? bruto : Buffer.from(bruto, 'base64').toString('utf8'); const j = JSON.parse(txt); return j.client_email && j.private_key ? j : null; } catch (_) { return null; }
}
const pastaRaiz = () => String(config.env('CTAI_ACERVO_PASTA', '')).trim();
const ligado = () => !!chave() && !!pastaRaiz();
const b64u = (x) => Buffer.from(x).toString('base64url');

async function token() {
  if (cache.token && Date.now() < cache.ate - 60000) return cache.token;
  const k = chave(); if (!k) throw new Error('Falta a chave da conta de serviço (CTAI_DRIVE_CHAVE).');
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64u(JSON.stringify({ iss: k.client_email, scope: ESCOPO, aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600 }));
  const assinatura = crypto.createSign('RSA-SHA256').update(corpo).sign(k.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: corpo + '.' + assinatura }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('O Google recusou a chave da conta de serviço: ' + String(j.error_description || j.error || r.status).slice(0, 120));
  cache = { token: j.access_token, ate: Date.now() + (j.expires_in || 3600) * 1000 };
  return cache.token;
}

async function api(url, opcoes) {
  const t = await token();
  const r = await fetch(url, Object.assign({}, opcoes, { headers: Object.assign({ authorization: 'Bearer ' + t }, opcoes && opcoes.headers) }));
  const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch (_) { /* vazio */ }
  if (!r.ok) throw new Error('Drive ' + r.status + ': ' + String((j.error && j.error.message) || txt).slice(0, 140));
  return j;
}
const aspas = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const D = 'https://www.googleapis.com/drive/v3/files';
const COMUM = 'supportsAllDrives=true&includeItemsFromAllDrives=true';

async function acharNome(nome, paiId, pasta) {
  const q = "name = '" + aspas(nome) + "' and '" + paiId + "' in parents and trashed = false" + (pasta ? " and mimeType = 'application/vnd.google-apps.folder'" : '');
  const j = await api(D + '?' + COMUM + '&fields=files(id,name)&q=' + encodeURIComponent(q));
  return (j.files || [])[0] || null;
}
async function garantirPasta(nome, paiId) {
  const ja = await acharNome(nome, paiId, true); if (ja) return ja.id;
  const j = await api(D + '?supportsAllDrives=true&fields=id', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: nome, mimeType: 'application/vnd.google-apps.folder', parents: [paiId] }) });
  return j.id;
}
// Cria o arquivo de texto ou, se já existe com o mesmo nome na pasta, troca o conteúdo (não duplica).
async function gravarTexto(nome, texto, paiId) {
  const ja = await acharNome(nome, paiId, false);
  const lim = 'ctai' + crypto.randomBytes(8).toString('hex');
  const meta = ja ? {} : { name: nome, parents: [paiId] };
  const corpo = '--' + lim + '\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + lim + '\r\ncontent-type: text/plain; charset=UTF-8\r\n\r\n' + texto + '\r\n--' + lim + '--';
  const url = 'https://www.googleapis.com/upload/drive/v3/files' + (ja ? '/' + ja.id : '') + '?uploadType=multipart&supportsAllDrives=true&fields=id';
  const j = await api(url, { method: ja ? 'PATCH' : 'POST', headers: { 'content-type': 'multipart/related; boundary=' + lim }, body: corpo });
  return { id: j.id, substituiu: !!ja };
}
async function testar() { return api(D + '/' + pastaRaiz() + '?supportsAllDrives=true&fields=id,name,capabilities(canAddChildren)'); }

module.exports = { ligado, pastaRaiz, garantirPasta, gravarTexto, testar, emailConta: () => (chave() || {}).client_email || null };
