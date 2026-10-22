'use strict';
// Modo de exposição: o que cada origem alcança.
//  - Rede interna: tudo (Portal da Unidade, console da CTAI, Gestão CTAI, administração).
//  - Origem externa (túnel/internet): só o Portal da Unidade (telas, /api/unidade, login). O resto responde 404, como se não existisse.
// Uma requisição é considerada EXTERNA quando:
//  1. o Host ou o X-Forwarded-Host está em CTAI_HOSTS_PUBLICOS; ou
//  2. traz cabeçalho de túnel (Cf-Connecting-Ip, Cf-Ray, Cf-Visitor, Cf-Ipcountry, Cdn-Loop, X-Tunnel); ou
//  3. traz X-Forwarded-Host ou Forwarded que não esteja em CTAI_HOSTS_INTERNOS (proxy desconhecido = não confiar).
// CTAI_EXPOSICAO: "restrita" (padrão, seguro) aplica o bloqueio; "aberta" desliga (só para desenvolvimento local).
//
// LISTA DE IPs INTERNOS (CTAI_IPS_INTERNOS, ex.: o IP público da SES; aceita IPv4, IPv6 e CIDR como 200.1.2.0/24):
// quando definida, só é INTERNA a requisição cujo IP de cliente esteja na lista; todas as demais são externas (só o Portal da Unidade).
// Se o IP não puder ser determinado, é externa. Os critérios de host/túnel acima passam a não valer (a lista manda).
// Como o IP do cliente é obtido (premissa de proxy):
//  - CTAI_IP_CABECALHO (ex.: cf-connecting-ip): usa esse cabeçalho, que a PLATAFORMA define e sobrescreve. Só use se tiver certeza disso.
//  - senão, X-Forwarded-For com CTAI_PROXY_SALTOS (padrão 1): cada proxy confiável ACRESCENTA no fim o IP de quem falou com ele; então o
//    cliente é o N-ésimo valor contado do fim. Valores à esquerda podem ter sido forjados pelo cliente e são ignorados.
//    Sem proxy (acesso direto na rede interna): CTAI_PROXY_SALTOS=0 usa o IP da conexão.
//  - CTAI_PROXIES_CONFIAVEIS (opcional, IPs/CIDR): só aceita cabeçalhos se a conexão vier de um desses proxies; senão usa o IP da conexão.
// Para conferir o que o servidor enxerga: abra /api/origem no navegador (mostra seu IP, a classificação e os cabeçalhos).
const net = require('node:net');
const config = require('./config');
const A = require('./auth');

const lista = (k) => String(config.env(k, '')).split(',').map((s) => s.trim().toLowerCase().replace(/:\d+$/, '')).filter(Boolean);
const modo = () => (String(config.env('CTAI_EXPOSICAO', 'restrita')).trim().toLowerCase() === 'aberta' ? 'aberta' : 'restrita');
const hostDe = (v) => String(v || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
// ---- lista de IPs internos e IP do cliente ----
function blocoDe(chave) {
  const bl = new net.BlockList(); let n = 0;
  for (const bruto of String(config.env(chave, '')).split(',').map((x) => x.trim()).filter(Boolean)) {
    const [ip0, pref] = bruto.split('/');
    const ip = normalizar(ip0);
    const tipo = net.isIP(ip) === 6 ? 'ipv6' : (net.isIP(ip) === 4 ? 'ipv4' : null);
    if (!tipo) continue;
    try {
      if (pref === undefined) bl.addAddress(ip, tipo);
      else { const p = Number(pref); if (!Number.isInteger(p) || p < 0 || p > (tipo === 'ipv4' ? 32 : 128)) continue; bl.addSubnet(ip, p, tipo); }
      n++;
    } catch (_) { /* entrada inválida é ignorada */ }
  }
  return { bl, n };
}
function normalizar(ip) {
  let v = String(ip || '').trim().replace(/^\[|\]$/g, '');
  v = v.replace(/^::ffff:/i, '');
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(v)) v = v.replace(/:\d+$/, '');
  return v;
}
function dentro(bloco, ip) { if (!ip || !bloco.n) return false; const t = net.isIP(ip); return t ? bloco.bl.check(ip, t === 6 ? 'ipv6' : 'ipv4') : false; }
const listaInternaDefinida = () => blocoDe('CTAI_IPS_INTERNOS').n > 0 || String(config.env('CTAI_IPS_INTERNOS', '')).trim() !== '';
const inteiro = (v, padrao) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 10 ? n : padrao; };

// IP do cliente de forma segura. Devolve { ip|null, fonte }.
function clienteIp(req) {
  const conexao = normalizar(req.socket && req.socket.remoteAddress);
  const confiaveis = blocoDe('CTAI_PROXIES_CONFIAVEIS');
  if (confiaveis.n > 0 && !dentro(confiaveis, conexao)) return { ip: net.isIP(conexao) ? conexao : null, fonte: 'conexão direta (não veio de proxy confiável)' };
  const cab = String(config.env('CTAI_IP_CABECALHO', '')).trim().toLowerCase();
  if (cab) {
    const v = normalizar(String(req.headers[cab] || '').split(',')[0]);
    return net.isIP(v) ? { ip: v, fonte: 'cabeçalho ' + cab } : { ip: null, fonte: 'cabeçalho ' + cab + ' ausente ou inválido' };
  }
  const saltos = inteiro(config.env('CTAI_PROXY_SALTOS', '1'), 1);
  if (saltos === 0) return { ip: net.isIP(conexao) ? conexao : null, fonte: 'conexão direta' };
  const partes = [].concat(req.headers['x-forwarded-for'] || []).join(',').split(',').map((x) => normalizar(x)).filter(Boolean);
  if (partes.length < saltos) return { ip: null, fonte: 'X-Forwarded-For com menos de ' + saltos + ' valor(es)' };
  const v = partes[partes.length - saltos];
  return net.isIP(v) ? { ip: v, fonte: 'X-Forwarded-For, ' + saltos + 'º valor contado do fim' } : { ip: null, fonte: 'X-Forwarded-For inválido' };
}

const CABECALHOS_TUNEL = ['cf-connecting-ip', 'cf-ray', 'cf-visitor', 'cf-ipcountry', 'cdn-loop', 'x-tunnel'];

function origemDe(req) {
  if (req._origem) return req._origem;
  if (listaInternaDefinida()) {
    const c = clienteIp(req);
    const dentroDaLista = dentro(blocoDe('CTAI_IPS_INTERNOS'), c.ip);
    const externa = !dentroDaLista;
    req._origem = { externa, tipo: externa ? 'externa' : 'interna', motivo: !c.ip ? 'IP indeterminado (' + c.fonte + ')' : (dentroDaLista ? 'IP na lista de internos' : 'IP fora da lista de internos'), ip: c.ip };
    return req._origem;
  }
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
function mascarar(bruto) {
  if (!bruto) return null;
  if (config.env('CTAI_IP_COMPLETO', 'nao') === 'sim') return bruto;
  if (bruto.includes(':')) return bruto.split(':').slice(0, 3).join(':') + ':…';
  const p = bruto.split('.');
  return p.length === 4 ? p.slice(0, 3).join('.') + '.x' : bruto.slice(0, 20);
}
function ipDe(req) {
  const configurado = listaInternaDefinida() || ['CTAI_IP_CABECALHO', 'CTAI_PROXY_SALTOS', 'CTAI_PROXIES_CONFIAVEIS'].some((k) => String(config.env(k, '')).trim() !== '');
  if (configurado) return mascarar(clienteIp(req).ip);
  const bruto = String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || '').trim().replace(/^::ffff:/, '');
  if (!bruto) return null;
  if (config.env('CTAI_IP_COMPLETO', 'nao') === 'sim') return bruto;
  if (bruto.includes(':')) return bruto.split(':').slice(0, 3).join(':') + ':…';
  const p = bruto.split('.');
  return p.length === 4 ? p.slice(0, 3).join('.') + '.x' : bruto.slice(0, 20);
}
const agenteDe = (req) => String(req.headers['user-agent'] || '').slice(0, 160) || null;

const ABERTOS_EXTERNOS = [
  /^\/$/, /^\/unidade(\.html)?$/, /^\/index(\.html)?$/, /^\/api\/unidade(\/|$)/, /^\/api\/auth(\/|$)/, /^\/api\/meta$/, /^\/api\/regras\//, /^\/api\/saude$/, /^\/saude$/, /^\/api\/origem$/,
  /^\/css\//, /^\/icons\//, /^\/js\/(core|login|unidade)\.js$/, /^\/sw\.js$/, /^\/manifest\.webmanifest$/, /^\/favicon\.ico$/, /^\/fontes\//, /^\/fonts\//,
];

// Primeira peça da cadeia: marca a origem e, se for externa, deixa passar só o Portal da Unidade.
function barreira(db) {
  return (req, res, next) => {
    const o = origemDe(req);
    req.origem = o;
    if (!o.externa || modo() === 'aberta') return next();
    if (ABERTOS_EXTERNOS.some((re) => re.test(req.path))) return next();
    // Exceção nominal: logins listados em CTAI_USUARIOS_EXTERNOS (ex.: admin) alcançam o console de fora da rede, com sessão válida.
    if (db) { try { const u = A.usuarioDaSessao(db, req); if (u && externoLiberado(u.login)) return next(); } catch (_) { /* segue bloqueando */ } }
    if (req.path.startsWith('/api/')) return res.status(404).json({ erro: 'Rota não encontrada.' });
    return res.status(404).type('text/plain').send('Not found');
  };
}

// Logins liberados nominalmente para acessar o console de fora da rede (CTAI_USUARIOS_EXTERNOS=admin,outro). Vazio = ninguém.
const externoLiberado = (login) => lista('CTAI_USUARIOS_EXTERNOS').includes(String(login || '').trim().toLowerCase());

// Perfis da CTAI só se autenticam e só usam sessão dentro da rede interna (salvo os logins liberados nominalmente).
function perfilPermitido(req, perfil, login) {
  if (modo() === 'aberta') return true;
  return !origemDe(req).externa || A.PERFIS_UNIDADE.includes(perfil) || externoLiberado(login);
}

module.exports = { clienteIp, listaInternaDefinida, origemDe, ipDe, agenteDe, barreira, perfilPermitido, externoLiberado, modo };
