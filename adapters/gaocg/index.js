'use strict';
// Leitura do GAOCG (sistema de SOF, empenhos e recibos). SÓ LEITURA: a chave do GAOCG não escreve nada.
// Configuração (painel da hospedagem, nunca no repositório): GAOCG_API_URL (termina em /exec) e GAOCG_API_CHAVE.
// A chave vai na consulta, como o GAOCG exige; por isso este módulo nunca registra a URL completa em log ou erro.
const ENDPOINTS = ['api_unidades', 'api_sof', 'api_notasEmpenho', 'api_recibos'];
const TEMPO_MS = 45000;

function config(env) {
  const e = env || process.env;
  const url = String(e.GAOCG_API_URL || '').trim();
  const chave = String(e.GAOCG_API_CHAVE || '').trim();
  return { url, chave, ligada: !!(url && chave) };
}

// O formato exato varia; aceita lista direta ou a primeira lista dentro do objeto.
function linhasDe(j) {
  if (Array.isArray(j)) return j;
  if (!j || typeof j !== 'object') return [];
  for (const k of ['dados', 'items', 'itens', 'registros', 'resultados', 'linhas', 'data', 'lista']) if (Array.isArray(j[k])) return j[k];
  for (const v of Object.values(j)) if (Array.isArray(v)) return v;
  return [];
}

function criar(env, fetchImpl) {
  const cfg = config(env);
  const f = fetchImpl || globalThis.fetch;
  async function consultar(endpoint, filtros) {
    if (!cfg.ligada) throw new Error('GAOCG não configurado (faltam GAOCG_API_URL e GAOCG_API_CHAVE).');
    if (!ENDPOINTS.includes(endpoint)) throw new Error('Consulta não permitida: ' + endpoint);
    const q = new URLSearchParams({ action: endpoint, chave: cfg.chave, pageSize: '100000' });
    for (const [k, v] of Object.entries(filtros || {})) if (v !== undefined && v !== null && v !== '' && !['action', 'chave'].includes(k)) q.set(k, String(v));
    const t0 = Date.now();
    let r, txt;
    try {
      r = await f(cfg.url + (cfg.url.includes('?') ? '&' : '?') + q.toString(), { redirect: 'follow', signal: AbortSignal.timeout(TEMPO_MS) });
      txt = await r.text();
    } catch (err) { throw new Error('Não consegui falar com o GAOCG: ' + (err && err.name === 'TimeoutError' ? 'demorou mais de 45 s.' : 'falha de rede.')); }
    let j;
    try { j = JSON.parse(txt); } catch (_) { throw new Error('O GAOCG respondeu algo que não entendi (HTTP ' + r.status + ').'); }
    if (j && (j.ok === false || j.sucesso === false || (j.erro && !Array.isArray(j)))) throw new Error('O GAOCG recusou: ' + String(j.erro || j.mensagem || 'sem detalhe').slice(0, 120));
    return { linhas: linhasDe(j), ms: Date.now() - t0, bruto: j };
  }
  return { ligada: cfg.ligada, consultar };
}

module.exports = { criar, config, linhasDe, ENDPOINTS, tipo: 'gaocg', nome: 'GAOCG (leitura de SOF, empenhos e recibos)' };
