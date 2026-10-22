'use strict';
// Ponte com o Analista da diretoria: consultar contatos e trocar mensagens (conversas sincronizadas).
// Usa a URL da API do Analista e uma CHAVE DE SERVIÇO própria da CTAI. A chave só abre três rotas
// (contatos, enviar mensagem, ler conversa); não lê processos, documentos nem achados.
//
// Configuração (.env):
//   ANALISTA_API_URL=https://script.google.com/macros/s/.../exec
//   ANALISTA_SERVICO_CHAVE=ctai_...   (gerada no menu da planilha do Analista; NUNCA vai para o repositório)
// Sem as duas, a ponte fica desligada e nada quebra.
//
// A chave vai SEMPRE no corpo da chamada (o servidor recusa se vier no endereço).

const TEMPO_MS = 30000;

function config(env) {
  const e = env || process.env;
  const url = String(e.ANALISTA_API_URL || '').trim();
  const chave = String(e.ANALISTA_SERVICO_CHAVE || '').trim();
  return { url, chave, ligada: !!(url && chave) };
}

function criar(env, fetchImpl) {
  const cfg = config(env);
  const f = fetchImpl || globalThis.fetch;

  async function chamar(acao, corpo) {
    if (!cfg.ligada) throw new Error('A ponte com o Analista está desligada (faltam ANALISTA_API_URL e ANALISTA_SERVICO_CHAVE).');
    let r;
    try {
      r = await f(cfg.url + '?action=' + encodeURIComponent(acao), {
        method: 'POST',
        // text/plain evita a checagem prévia (preflight) que o Apps Script não responde.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({}, corpo, { servico_chave: cfg.chave })),
        redirect: 'follow',
        signal: AbortSignal.timeout(TEMPO_MS),
      });
    } catch (err) {
      throw new Error('Não consegui falar com o Analista: ' + (err && err.name === 'TimeoutError' ? 'demorou mais de 30 s.' : (err && err.message) || err));
    }
    let j;
    try { j = await r.json(); } catch (_) { throw new Error('O Analista respondeu algo que não entendi (HTTP ' + r.status + ').'); }
    if (!j || j.ok === false) throw new Error((j && j.erro) || 'O Analista recusou o pedido.');
    return j;
  }

  return {
    ligada: cfg.ligada,
    // [{ nome, email, gerencia }]
    async contatos() { return (await chamar('servico/contatos', {})).contatos || []; },
    // Envia como "CTAI — <deQuem>". Dados pessoais (CPF, RG, e-mail, telefone) são trocados por marcador no servidor.
    async enviar({ para, texto, deQuem }) {
      const j = await chamar('servico/mensagem-enviar', { para_email: para, texto, de_nome: deQuem || '' });
      return { id: j.mensagem.id, conversaId: j.mensagem.conversa_id, enviadoEm: j.mensagem.enviado_em, dadosPessoaisTrocados: j.dados_pessoais_trocados || 0 };
    },
    // Conversa inteira com a pessoa (as duas pontas). `desde` (ISO) traz só o que veio depois.
    async conversa(com, desde) {
      const j = await chamar('servico/mensagens-listar', { com_email: com, desde: desde || '' });
      return (j.mensagens || []).map((m) => ({ id: m.id, daCtai: !!m.da_ctai, nome: m.de_nome, texto: m.texto, enviadoEm: m.enviado_em }));
    },
  };
}

module.exports = { criar, config, tipo: 'analista', nome: 'Analista da diretoria (mensagens e contatos)' };
