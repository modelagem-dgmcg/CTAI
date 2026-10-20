'use strict';
// Modo de exposição: o que cada origem alcança.
//  - Rede interna: tudo (Portal da Unidade, console da CTAI, Gestão CTAI, administração).
//  - Origem externa (túnel/internet): só o Portal da Unidade (telas, /api/unidade, login). O resto responde 404, como se não existisse.
// Uma requisição é considerada EXTERNA quando:
//  1. o Host ou o X-Forwarded-Host está em CTAI_HOSTS_PUBLICOS; ou
//  2. traz cabeçalho de túnel (Cf-Connecting-Ip, Cf-Ray, Cf-Visitor, Cf-Ipcountry, Cdn-Loop, X-Tunnel); ou
//  3. traz X-Forwarded-Host ou Forwarded que não esteja em CTAI_HOSTS_INTERNOS (proxy desconhecido = não confiar).
// CTAI_EXPOSICAO: "restrita" (padrão, seguro) aplica o bloqueio; "aberta" desliga (só para desenvolvimento local).
const config = require('./config');
const A = require('./auth');

const lista = (k) => String(config.env(k, '')).split(',').map((s) => s.trim().toLowerCase().replace(/:\d+$/, '')).filter(Boolean);
const modo = () => (String(config.env('CTAI_EXPOSICAO', 'restrita')).trim().toLowerCase() === 'aberta' ? 'aberta' : 'restrita');
const hostDe = (v) => String(v || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
const CABECALHOS_TUNEL = ['cf-connecting-ip', 'cf-ray', 'cf-visitor', 'cf-ipcountry', 'cdn-loop', 'x-tunnel'];

function origemDe(req) {
  if (req._origem) return req._origem;
  const publicos = lista('CTAI_HOSTS_PUBLICOS'), internos = lista('CTAI_HOSTS_INTERNOS');
  const host = hostDe(req.headers.host), fwd = hostDe(req.headers['x-forwarded-host']);
  let externa = false, motivo = 'rede interna';
  if (publicos.includes(host) || (fwd && publicos.includes(fwd))) { externa = true; motivo = 'host público'; }
  else if (CABECALHOS_TUNEL.some((c) => req.headers[c] !== undefined)) { externa = true; motivo = 'cabeçalho de túnel'; }
  else if ((fwd && !internos.includes(fwd)) || (req.headers.forwarded && !internos.includes(hostDe((/host=([^;,\s]+)/i.exec(req.headers.forwarded) || [])[1])))) { externa = true; motivo = 'proxy com host encaminhado'; }
  req._origem = { externa, tipo: externa ? 'externa' : 'interna', motivo };
  return req._origem;
}

// IP de quem acessa, mascarado por padrão (último trecho oculto). CTAI_IP_COMPLETO=sim guarda inteiro.
function ipDe(req) {
  const bruto = String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || '').trim().replace(/^::ffff:/, '');
  if (!bruto) return null;
  if (config.env('CTAI_IP_COMPLETO', 'nao') === 'sim') return bruto;
  if (bruto.includes(':')) return bruto.split(':').slice(0, 3).join(':') + ':…';
  const p = bruto.split('.');
  return p.length === 4 ? p.slice(0, 3).join('.') + '.x' : bruto.slice(0, 20);
}
const agenteDe = (req) => String(req.headers['user-agent'] || '').slice(0, 160) || null;

const ABERTOS_EXTERNOS = [
  /^\/$/, /^\/unidade(\.html)?$/, /^\/index(\.html)?$/, /^\/api\/unidade(\/|$)/, /^\/api\/auth(\/|$)/, /^\/api\/meta$/, /^\/api\/regras\//, /^\/api\/saude$/,
  /^\/css\//, /^\/icons\//, /^\/js\/(core|login|unidade)\.js$/, /^\/sw\.js$/, /^\/manifest\.webmanifest$/, /^\/favicon\.ico$/, /^\/fontes\//, /^\/fonts\//,
];

// Primeira peça da cadeia: marca a origem e, se for externa, deixa passar só o Portal da Unidade.
function barreira() {
  return (req, res, next) => {
    const o = origemDe(req);
    req.origem = o;
    if (!o.externa || modo() === 'aberta') return next();
    if (ABERTOS_EXTERNOS.some((re) => re.test(req.path))) return next();
    if (req.path.startsWith('/api/')) return res.status(404).json({ erro: 'Rota não encontrada.' });
    return res.status(404).type('text/plain').send('Not found');
  };
}

// Perfis da CTAI só se autenticam e só usam sessão dentro da rede interna.
function perfilPermitido(req, perfil) {
  if (modo() === 'aberta') return true;
  return !origemDe(req).externa || A.PERFIS_UNIDADE.includes(perfil);
}

module.exports = { origemDe, ipDe, agenteDe, barreira, perfilPermitido, modo };
