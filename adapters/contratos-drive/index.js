'use strict';
// Contratos e Termos Aditivos (Google Drive da diretoria), por um Apps Script de SÓ LEITURA.
// Configuração (painel da hospedagem ou tela de Integrações): CONTRATOS_DRIVE_URL (termina em /exec) e, só se o script exigir, CONTRATOS_DRIVE_CHAVE.
// Os contratos e termos aditivos são documentos públicos (LAI): a chave é OPCIONAL. Se vier vazia, o parâmetro "chave" não é enviado.
// Este módulo roda só no servidor (o navegador nunca chama o script) e nunca registra a URL completa em log ou erro.
const TEMPO_MS = 60000;

function config(env) {
  const e = env || process.env;
  const url = String(e.CONTRATOS_DRIVE_URL || '').trim();
  const chave = String(e.CONTRATOS_DRIVE_CHAVE || '').trim();
  return { url, chave, ligada: !!url };
}

function criar(env, fetchImpl) {
  const cfg = config(env);
  const f = fetchImpl || globalThis.fetch;
  async function chamar(parametros) {
    if (!cfg.ligada) throw new Error('Contratos e TAs (Drive) não configurado: falta o endereço do script (CONTRATOS_DRIVE_URL).');
    const q = new URLSearchParams(parametros);
    if (cfg.chave) q.set('chave', cfg.chave);
    const t0 = Date.now();
    let r, txt;
    try {
      r = await f(cfg.url + (cfg.url.includes('?') ? '&' : '?') + q.toString(), { redirect: 'follow', signal: AbortSignal.timeout(TEMPO_MS) });
      txt = await r.text();
    } catch (err) { throw new Error('Não consegui falar com a pasta de contratos: ' + (err && err.name === 'TimeoutError' ? 'demorou mais de 60 s.' : 'falha de rede.')); }
    let j;
    try { j = JSON.parse(txt); } catch (_) { throw new Error('A pasta de contratos respondeu algo que não entendi (HTTP ' + r.status + ').'); }
    if (!j || typeof j !== 'object' || j.ok === false || (j.erro && j.ok !== true)) throw new Error('A pasta de contratos recusou: ' + String((j && (j.erro || j.mensagem)) || 'sem detalhe').slice(0, 140));
    return { json: j, ms: Date.now() - t0 };
  }
  // Lista os documentos cujo nome ou caminho de pastas contém todas as palavras do termo.
  async function listar(termo) {
    const { json, ms } = await chamar({ acao: 'listar', termo: String(termo || '') });
    const arquivos = (Array.isArray(json.arquivos) ? json.arquivos : []).map((a) => ({
      id: String(a.id || ''), nome: String(a.nome || ''), pasta: String(a.pasta || ''), caminho: String(a.caminho || ''), tipo: String(a.tipo || ''),
      tamanho_kb: Number(a.tamanho_kb) || 0, atualizado_em: a.atualizado_em ? String(a.atualizado_em) : null, url: String(a.url_visualizacao || a.url || ''),
    })).filter((a) => a.id);
    return { arquivos, ms };
  }
  // Texto de um Google Doc da pasta.
  async function ler(id) {
    const { json, ms } = await chamar({ acao: 'ler', id: String(id || '') });
    return { id: String(json.id || id), nome: String(json.nome || ''), texto: String(json.texto || ''), truncado: !!json.truncado, atualizado_em: json.atualizado_em ? String(json.atualizado_em) : null, url: String(json.url_visualizacao || ''), ms };
  }
  return { ligada: cfg.ligada, listar, ler };
}

module.exports = { criar, config, tipo: 'contratos-drive', nome: 'Contratos e TAs (Drive) · leitura' };
