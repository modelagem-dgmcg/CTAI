'use strict';
// Painel simples de completude por carteira: para cada unidade, quais trimestres do histórico estão confirmados, em rascunho ou faltando,
// e se o contrato (com os termos aditivos) já foi lido e confirmado. Só leitura; não altera nada.
const CART = require('./carteira');

const triDe = (d) => d.getUTCFullYear() + '-T' + (Math.floor(d.getUTCMonth() / 3) + 1);
// Os últimos n trimestres JÁ ENCERRADOS (o atual ainda está em andamento), do mais recente para o mais antigo.
function ultimosTrimestres(n, hoje) {
  const d = hoje ? new Date(hoje) : new Date(Date.now() - 3 * 3600 * 1000);
  let a = d.getUTCFullYear(), q = Math.floor(d.getUTCMonth() / 3) + 1;
  const out = [];
  for (let i = 0; i < n; i++) { q -= 1; if (q < 1) { q = 4; a -= 1; } out.push(a + '-T' + q); }
  return out;
}

function unidade(db, c, tris) {
  const hist = db.all('SELECT trimestre, estado FROM hist_relatorios WHERE contrato_id = ?', c.contrato_id);
  const trimestres = {};
  for (const t of tris) {
    const lista = hist.filter((x) => x.trimestre === t);
    trimestres[t] = lista.some((x) => x.estado === 'confirmado') ? 'confirmado' : (lista.length ? 'rascunho' : 'falta');
  }
  const docs = db.all("SELECT tipo, estado FROM contrato_docs WHERE contrato_id = ? AND estado != 'substituido'", c.contrato_id);
  const conf = docs.filter((d) => d.estado === 'confirmado');
  const pasta = db.get('SELECT total FROM contrato_pasta_estado WHERE contrato_id = ?', c.contrato_id);
  const contrato = {
    situacao: conf.some((d) => d.tipo === 'contrato') ? 'confirmado' : (docs.some((d) => d.tipo === 'contrato' && d.estado === 'rascunho') ? 'rascunho' : 'falta'),
    aditivos_confirmados: conf.filter((d) => d.tipo === 'aditivo').length, rascunhos: docs.filter((d) => d.estado === 'rascunho').length, pasta_consultada: !!pasta, arquivos_na_pasta: pasta ? pasta.total : null,
  };
  const completo = tris.every((t) => trimestres[t] === 'confirmado') && contrato.situacao === 'confirmado' && contrato.rascunhos === 0;
  return { contrato_id: c.contrato_id, unidade: c.unidade, demo: !!c.demo, trimestres, contrato, completo };
}

function painel(db, hoje) {
  const tris = ultimosTrimestres(4, hoje);
  const contratos = db.all('SELECT contrato_id, unidade, demo FROM contratos ORDER BY demo, unidade');
  const por = new Map(contratos.map((c) => [c.contrato_id, c]));
  const funcionarios = CART.porFuncionario(db).filter((f) => f.ativo).map((f) => ({
    usuario_id: f.usuario_id, nome: f.nome, perfil: f.perfil, unidades: f.unidades.map((id) => por.get(id)).filter(Boolean).sort((a, b) => a.unidade.localeCompare(b.unidade, 'pt-BR')).map((c) => unidade(db, c, tris)),
  }));
  const sem = CART.semCarteira(db).map((c) => unidade(db, c, tris));
  const todas = funcionarios.flatMap((f) => f.unidades).concat(sem);
  return { trimestres: tris, funcionarios, sem_carteira: sem, resumo: { unidades: todas.length, completas: todas.filter((u) => u.completo).length, contratos_lidos: todas.filter((u) => u.contrato.situacao === 'confirmado').length } };
}

module.exports = { painel, ultimosTrimestres, triDe };
