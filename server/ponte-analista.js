'use strict';
// Ponte do Mensageiro com o Analista da diretoria. Usa o adaptador adapters/analista (chave de serviço da CTAI, só três rotas).
// Configuração: ANALISTA_API_URL e ANALISTA_SERVICO_CHAVE (veja docs/INTEGRACAO-ANALISTA.md). Só texto.
const { criar } = require('../adapters/analista');
const { erro } = require('./auth');

const adaptador = () => criar();
const configurada = () => adaptador().ligada;
const exigir = () => { const a = adaptador(); if (!a.ligada) throw erro(503, 'Ponte com o Analista não configurada.'); return a; };
const envolver = async (fn) => { try { return await fn(); } catch (e) { if (e.status) throw e; throw erro(502, String(e.message || e).slice(0, 200)); } };

// Contato = pessoa ativa no Analista. O "id" é o e-mail dela.
const contatos = () => envolver(async () => (await exigir().contatos()).map((c) => ({ id: String(c.email), nome: String(c.nome || c.email), grupo: false, gerencia: c.gerencia || '' })));
const conversa = (id) => envolver(async () => (await exigir().conversa(String(id || ''))).map((m) => ({ meu: !!m.daCtai, de: m.nome || '', texto: String(m.texto || ''), criado_em: m.enviadoEm || null })));
const enviar = (id, texto, remetente) => {
  const t = String(texto || '').trim().slice(0, 3000);
  if (!t) throw erro(400, 'Escreva a mensagem.');
  return envolver(() => exigir().enviar({ para: String(id || ''), texto: t, deQuem: String(remetente || '').slice(0, 60) }));
};

module.exports = { configurada, contatos, conversa, enviar };
