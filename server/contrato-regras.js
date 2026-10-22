'use strict';
// Regras descritivas do contrato (hospitais e UPAE): quadro de indicadores, metas, pesos e fontes, lidos do contrato e dos TAs.
// Entram por importação (arquivo JSON) ou digitação, sempre "a conferir". Não alimentam o recálculo do IGQ; servem de referência
// para a análise e para o Redator. Nunca vão para o repositório: ficam só no banco.
const trilha = require('./trilha');
const { erro } = require('./auth');

const agora = () => new Date().toISOString();
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const podeGerir = (u) => ['criador', 'superintendente', 'admin'].includes(u.perfil);
const txt = (v, n) => (v === null || v === undefined ? '' : String(v)).trim().slice(0, n);
const numero = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

function normalizar(d) {
  if (!d || typeof d !== 'object') throw erro(400, 'Arquivo de regras inválido.');
  const ind = (Array.isArray(d.indicadores) ? d.indicadores : []).slice(0, 80).map((i) => ({
    tipo: ['producao', 'qualidade', 'monitoramento'].includes(i.tipo) ? i.tipo : 'qualidade',
    nome: txt(i.nome, 200), peso_pct_total: numero(i.peso_pct_total), peso_pct_variavel: numero(i.peso_pct_variavel),
    especificacao: txt(i.especificacao, 600), meta: txt(i.meta, 800), fonte: txt(i.fonte, 400), clausula: txt(i.clausula, 120),
  })).filter((i) => i.nome);
  return {
    unidade: txt(d.unidade, 200), contrato_numero: txt(d.contrato_numero, 60), oss: txt(d.oss, 200),
    valor_mensal: txt(d.valor_mensal, 40), fixa_pct: numero(d.fixa_pct), variavel_pct: numero(d.variavel_pct),
    indicadores: ind, observacoes: (Array.isArray(d.observacoes) ? d.observacoes : []).slice(0, 30).map((x) => txt(x, 600)).filter(Boolean),
    cobertura: txt(d.cobertura, 300), fonte_arquivo: txt(d.fonte_arquivo, 200), tas_no_arquivo: numero(d.tas_no_arquivo),
  };
}

function ler(db, contratoId) {
  const l = db.get('SELECT * FROM contrato_regras WHERE contrato_id = ?', contratoId);
  if (!l) return null;
  return { conteudo: JSON.parse(l.conteudo), origem: l.origem, importado_por: l.importado_por, importado_em: l.importado_em, conferida: !!l.conferida_por, conferida_por: l.conferida_por, conferida_em: l.conferida_em };
}

function gravar(db, usuario, contratoId, dados, origem) {
  const c = db.get('SELECT contrato_id FROM contratos WHERE contrato_id = ?', contratoId);
  if (!c) throw erro(404, 'Unidade não encontrada.');
  const conteudo = normalizar(dados);
  const antes = db.get('SELECT 1 FROM contrato_regras WHERE contrato_id = ?', contratoId);
  db.run('INSERT INTO contrato_regras (contrato_id, conteudo, origem, importado_por, importado_em, conferida_por, conferida_em) VALUES (?,?,?,?,?,NULL,NULL) ON CONFLICT(contrato_id) DO UPDATE SET conteudo = excluded.conteudo, origem = excluded.origem, importado_por = excluded.importado_por, importado_em = excluded.importado_em, conferida_por = NULL, conferida_em = NULL',
    contratoId, JSON.stringify(conteudo), origem || 'importação', usuario.login, agora());
  trilha.registrar(db, { usuario: usuario.login, tabela: 'contrato_regras', registro: contratoId, campo: antes ? 'substituicao' : 'importacao', valor_novo: { indicadores: conteudo.indicadores.length, origem: origem || 'importação' } });
  return ler(db, contratoId);
}

function importar(db, usuario, contratoId, dados) {
  if (!podeGerir(usuario)) throw erro(403, 'Só quem cria o parecer, a superintendência ou o administrador importa regras.');
  return gravar(db, usuario, contratoId, dados, 'importação por unidade');
}

// Arquivo com várias unidades: cada item traz "chaves" (trechos do nome da unidade) para achar a unidade certa na carteira.
function importarLote(db, usuario, lista) {
  if (!['superintendente', 'admin'].includes(usuario.perfil)) throw erro(403, 'A importação em lote é da superintendência ou do administrador.');
  if (!Array.isArray(lista) || !lista.length) throw erro(400, 'O arquivo não traz nenhuma unidade.');
  const contratos = db.all('SELECT contrato_id, unidade FROM contratos WHERE demo = 0').map((c) => ({ id: c.contrato_id, nome: semAcento(c.unidade), unidade: c.unidade }));
  const importadas = [], semPar = [], duvida = [];
  for (const it of lista) {
    const chaves = (Array.isArray(it.chaves) && it.chaves.length ? it.chaves : [it.unidade]).map(semAcento).filter(Boolean);
    const par = contratos.filter((c) => chaves.some((k) => c.nome.includes(k)));
    if (!par.length) { semPar.push(it.unidade || chaves[0]); continue; }
    if (par.length > 1) { duvida.push({ arquivo: it.unidade, unidades: par.map((x) => x.unidade) }); continue; }
    try { gravar(db, usuario, par[0].id, it, 'importação em lote'); importadas.push({ arquivo: it.unidade, unidade: par[0].unidade, indicadores: (it.indicadores || []).length }); } catch (e) { semPar.push((it.unidade || '') + ' (' + e.message + ')'); }
  }
  return { importadas, semPar, duvida };
}

function marcarConferida(db, usuario, contratoId) {
  if (!podeGerir(usuario)) throw erro(403, 'Só quem cria o parecer, a superintendência ou o administrador confere regras.');
  if (!db.get('SELECT 1 FROM contrato_regras WHERE contrato_id = ?', contratoId)) throw erro(409, 'Esta unidade não tem regras importadas.');
  db.run('UPDATE contrato_regras SET conferida_por = ?, conferida_em = ? WHERE contrato_id = ?', usuario.login, agora(), contratoId);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'contrato_regras', registro: contratoId, campo: 'conferida', valor_novo: { por: usuario.login } });
  return ler(db, contratoId);
}

module.exports = { ler, importar, importarLote, marcarConferida, normalizar, semAcento };
