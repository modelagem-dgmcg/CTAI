'use strict';
// Cliente HTTP do sistema da unidade (MV). Só lê. As credenciais vêm de variáveis de ambiente.
const config = require('../../server/config');

function cabecalhosDeAuth(auth) {
  const env = config.env;
  if (!auth || auth.tipo === 'nenhuma') return {};
  if (auth.tipo === 'bearer') { const t = env(auth.tokenEnv, ''); if (!t) throw new Error('A variável ' + auth.tokenEnv + ' não está definida no .env.'); return { authorization: 'Bearer ' + t }; }
  if (auth.tipo === 'basic') {
    const u = env(auth.usuarioEnv, ''), s = env(auth.senhaEnv, '');
    if (!u || !s) throw new Error('As variáveis ' + auth.usuarioEnv + ' e ' + auth.senhaEnv + ' não estão definidas no .env.');
    return { authorization: 'Basic ' + Buffer.from(u + ':' + s).toString('base64') };
  }
  if (auth.tipo === 'apikey') { const k = env(auth.chaveEnv, ''); if (!k) throw new Error('A variável ' + auth.chaveEnv + ' não está definida no .env.'); return { [auth.cabecalho || 'x-api-key']: k }; }
  throw new Error('Tipo de autenticação desconhecido: ' + auth.tipo);
}

async function obterJson(url, cabecalhos, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs || 30000);
  const ini = Date.now();
  try {
    const r = await fetch(url, { headers: Object.assign({ accept: 'application/json' }, cabecalhos), signal: ctl.signal });
    const txt = await r.text();
    const ms = Date.now() - ini;
    if (!r.ok) { const e = new Error('HTTP ' + r.status + ' ' + txt.slice(0, 160)); e.status = r.status; e.ms = ms; throw e; }
    let corpo;
    try { corpo = JSON.parse(txt); } catch (_) { const e = new Error('Resposta que não é JSON.'); e.ms = ms; throw e; }
    return { corpo, ms, status: r.status };
  } catch (e) {
    if (e.name === 'AbortError') { const x = new Error('Tempo esgotado (' + (timeoutMs || 30000) + ' ms).'); x.ms = Date.now() - ini; throw x; }
    if (e.ms === undefined) e.ms = Date.now() - ini;
    throw e;
  } finally { clearTimeout(t); }
}

module.exports = { cabecalhosDeAuth, obterJson };
