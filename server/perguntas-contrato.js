'use strict';
// Perguntas de contrato por unidade: dúvidas que só a analista dona da carteira resolve (qual valor vale, qual instrumento vale) e pedidos de documento.
// Importadas pela Gestão CTAI (CSV, com prévia; reimportar não apaga resposta). A resposta só registra a decisão: não altera regra nem valor sozinha.
const L = require('../core/linhas');
const A = require('./auth');
const CART = require('./carteira');
const trilha = require('./trilha');

const { erro } = A;
const agora = () => new Date().toISOString();
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const TIPOS = ['decisao', 'documento'];
const NAO_SEI = 'Ainda não sei';

function chaveDe(contratoId, tipo, pergunta) {
  let h = 0; const t = norm(pergunta);
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return contratoId + '|' + tipo + '|' + h.toString(36) + '|' + t.length;
}

function ler(db, csv) {
  if (typeof csv !== 'string' || !csv.trim()) throw erro(400, 'Envie o conteúdo do arquivo CSV.');
  const { cabecalho, registros } = L.lerCSV(csv);
  const col = {};
  for (const c of cabecalho) col[norm(c).replace(/ /g, '_')] = c;
  for (const k of ['unidade', 'tipo', 'pergunta']) if (!col[k]) throw erro(400, 'O arquivo precisa ter as colunas "unidade", "tipo" e "pergunta". Use o arquivo gerado para esta tela.');
  const v = (r, k) => (col[k] ? String(r[col[k]] || '').trim() : '');
  const porNome = new Map(db.all('SELECT contrato_id, unidade FROM contratos').map((u) => [norm(u.unidade), u]));
  const usuarios = new Map(db.all('SELECT usuario_id, login, nome FROM usuarios').map((u) => [norm(u.login), u]));
  const linhas = [], naoCasadas = new Map(), semAnalista = new Set(), invalidas = [];
  for (const r of registros) {
    const nome = v(r, 'unidade'), tipo = v(r, 'tipo').toLowerCase(), pergunta = v(r, 'pergunta');
    if (!nome && !pergunta) continue;
    const un = porNome.get(norm(nome));
    if (!un) { naoCasadas.set(nome || '(sem unidade)', (naoCasadas.get(nome || '(sem unidade)') || 0) + 1); continue; }
    if (!TIPOS.includes(tipo) || !pergunta) { invalidas.push({ unidade: un.unidade, motivo: !pergunta ? 'sem pergunta' : 'tipo "' + tipo + '" inválido' }); continue; }
    const login = v(r, 'analista');
    if (login && !usuarios.has(norm(login))) semAnalista.add(login);
    let opcoes = v(r, 'opcoes').split('|').map((x) => x.trim()).filter(Boolean);
    if (tipo === 'decisao' && !opcoes.includes(NAO_SEI)) opcoes = opcoes.concat([NAO_SEI]);
    if (tipo === 'documento') opcoes = [];
    linhas.push({ chave: chaveDe(un.contrato_id, tipo, pergunta), contrato_id: un.contrato_id, unidade: un.unidade, analista: login, tipo, pergunta, opcoes: opcoes.join('|'),
      documento_pedido: v(r, 'documento_pedido'), onde_encontrar: v(r, 'onde_encontrar'), valor_atual: v(r, 'valor_atual'), valor_proposto: v(r, 'valor_proposto'),
      o_que_e: v(r, 'o_que_e'), doc_origem: v(r, 'documento_origem'), trecho_origem: v(r, 'trecho_origem'), data_origem: v(r, 'data_origem'), por_que_importa: v(r, 'por_que_importa'), o_que_fazer: v(r, 'o_que_fazer'), impacto: Math.min(3, Math.max(1, parseInt(v(r, 'impacto'), 10) || 2)) });
  }
  return { linhas, naoCasadas: [...naoCasadas.entries()].map(([nome, n]) => ({ nome, linhas: n })), analistasInexistentes: [...semAnalista], invalidas };
}

function previa(db, csv) {
  const { linhas, naoCasadas, analistasInexistentes, invalidas } = ler(db, csv);
  const atuais = new Map(db.all('SELECT chave, resposta, anexo_ok FROM perguntas_contrato').map((x) => [x.chave, x]));
  const por = new Map(); const ana = new Map();
  let novas = 0, atualizadas = 0, comResposta = 0;
  for (const l of linhas) {
    const a = atuais.get(l.chave);
    if (!a) novas++; else { atualizadas++; if (a.resposta || a.anexo_ok) comResposta++; }
    const u = por.get(l.contrato_id) || { unidade: l.unidade, decisoes: 0, documentos: 0 };
    if (l.tipo === 'decisao') u.decisoes++; else u.documentos++;
    por.set(l.contrato_id, u);
    const k = l.analista || '(sem analista)'; ana.set(k, (ana.get(k) || 0) + 1);
  }
  return { resumo: { linhas: linhas.length, unidades: por.size, novas, atualizadas, comResposta },
    unidades: [...por.values()].sort((a, b) => a.unidade.localeCompare(b.unidade)),
    porAnalista: [...ana.entries()].map(([login, n]) => ({ login, perguntas: n })).sort((a, b) => a.login.localeCompare(b.login)),
    naoCasadas, analistasInexistentes, invalidas, podeGravar: linhas.length > 0 };
}

function gravar(db, quem, csv) {
  const { linhas } = ler(db, csv);
  if (!linhas.length) throw erro(400, 'Nenhuma linha do arquivo corresponde a uma unidade cadastrada.');
  let novas = 0, atualizadas = 0;
  db.tx(() => {
    for (const l of linhas) {
      const a = db.get('SELECT id FROM perguntas_contrato WHERE chave = ?', l.chave);
      if (a) {
        db.run('UPDATE perguntas_contrato SET analista=?, pergunta=?, opcoes=?, documento_pedido=?, onde_encontrar=?, valor_atual=?, valor_proposto=?, o_que_e=?, doc_origem=?, trecho_origem=?, data_origem=?, por_que_importa=?, o_que_fazer=?, impacto=?, importado_por=?, importado_em=? WHERE id = ?',
          l.analista, l.pergunta, l.opcoes, l.documento_pedido, l.onde_encontrar, l.valor_atual, l.valor_proposto, l.o_que_e, l.doc_origem, l.trecho_origem, l.data_origem, l.por_que_importa, l.o_que_fazer, l.impacto, quem, agora(), a.id); atualizadas++;
      } else {
        db.run('INSERT INTO perguntas_contrato (chave, contrato_id, analista, tipo, pergunta, opcoes, documento_pedido, onde_encontrar, valor_atual, valor_proposto, o_que_e, doc_origem, trecho_origem, data_origem, por_que_importa, o_que_fazer, impacto, importado_por, importado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          l.chave, l.contrato_id, l.analista, l.tipo, l.pergunta, l.opcoes, l.documento_pedido, l.onde_encontrar, l.valor_atual, l.valor_proposto, l.o_que_e, l.doc_origem, l.trecho_origem, l.data_origem, l.por_que_importa, l.o_que_fazer, l.impacto, quem, agora()); novas++;
      }
    }
    trilha.registrar(db, { usuario: quem, tabela: 'perguntas_contrato', registro: 'importacao', campo: 'importado', valor_novo: { linhas: linhas.length, novas, atualizadas } });
  });
  return { novas, atualizadas, linhas: linhas.length };
}

const aberta = (p) => (p.tipo === 'decisao' ? !p.resposta || p.resposta === NAO_SEI : !p.anexo_ok);
const paraTela = (p, sugestao) => ({ id: p.id, tipo: p.tipo, pergunta: p.pergunta, opcoes: p.opcoes ? p.opcoes.split('|') : [], documento_pedido: p.documento_pedido, onde_encontrar: p.onde_encontrar,
  valor_atual: p.valor_atual, valor_proposto: p.valor_proposto, o_que_e: p.o_que_e || '', doc_origem: p.doc_origem || '', trecho_origem: p.trecho_origem || '', data_origem: p.data_origem || '', por_que_importa: p.por_que_importa || '', o_que_fazer: p.o_que_fazer || '', impacto: p.impacto || 2, analista: p.analista, resposta: p.resposta || null, observacao: p.observacao || '', respondida_por: p.respondida_por, respondida_em: p.respondida_em,
  anexo_ok: !!p.anexo_ok, anexo_em: p.anexo_em, aberta: aberta(p), sugestao: sugestao || null });

// Procura entre os arquivos que já chegaram para a unidade um nome que lembre o documento pedido (só sugere; quem marca é a analista).
function sugestaoDeAnexo(db, p) {
  if (p.tipo !== 'documento' || p.anexo_ok) return null;
  const alvo = norm(p.documento_pedido);
  const numeros = (alvo.match(/\b\d{1,2}\b/g) || []).filter((n) => /º|°|o\b/.test(p.documento_pedido) || true);
  const nomes = [];
  try { for (const r of db.all("SELECT nome FROM alimentar_fila WHERE contrato_id = ? AND estado NOT IN ('descartado','problema') LIMIT 400", p.contrato_id)) nomes.push(r.nome); } catch (_) { /* tabela ausente */ }
  try { for (const r of db.all('SELECT nome_arquivo AS nome FROM gaveta_documentos WHERE contrato_id = ? LIMIT 400', p.contrato_id)) nomes.push(r.nome); } catch (_) { /* tabela ausente */ }
  const chaves = ['termo aditivo', ' ta ', 'aditivo', 'contrato', 'anexo', 'tabela', 'parecer', 'despacho', 'termo de compromisso', 'extrato'].filter((k) => (' ' + alvo + ' ').includes(k));
  for (const n of nomes) {
    const t = ' ' + norm(n) + ' ';
    const okNum = numeros.length ? numeros.some((x) => new RegExp('(^| )0?' + x + '( |o )').test(t)) : false;
    const okChave = chaves.some((k) => t.includes(k));
    if (okNum && okChave) return n;
  }
  return null;
}

function listar(db, contratoId) {
  return db.all('SELECT * FROM perguntas_contrato WHERE contrato_id = ? ORDER BY impacto, tipo, id', contratoId).map((p) => paraTela(p, sugestaoDeAnexo(db, p)));
}

function doItem(db, usuario, id) {
  const p = db.get('SELECT * FROM perguntas_contrato WHERE id = ?', Number(id));
  if (!p) throw erro(404, 'Pergunta não encontrada.');
  CART.exigir(db, usuario, p.contrato_id);
  return p;
}

function responder(db, usuario, id, d) {
  const p = doItem(db, usuario, id);
  if (p.tipo !== 'decisao') throw erro(400, 'Esta é uma pergunta sobre documento: use "Já anexei".');
  const resposta = d && d.resposta ? String(d.resposta).trim() : '';
  const opcoes = p.opcoes ? p.opcoes.split('|') : [];
  if (resposta && !opcoes.includes(resposta)) throw erro(400, 'Escolha uma das opções.');
  const obs = String((d && d.observacao) || '').trim().slice(0, 1000);
  db.run('UPDATE perguntas_contrato SET resposta = ?, observacao = ?, respondida_por = ?, respondida_em = ? WHERE id = ?', resposta || null, obs || null, resposta ? usuario.login : null, resposta ? agora() : null, p.id);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'perguntas_contrato', registro: p.id, campo: 'resposta', valor_anterior: p.resposta, valor_novo: resposta || null, motivo: obs || null });
  return { ok: true };
}

function marcarAnexo(db, usuario, id, ok) {
  const p = doItem(db, usuario, id);
  if (p.tipo !== 'documento') throw erro(400, 'Esta é uma decisão: responda pelas opções.');
  db.run('UPDATE perguntas_contrato SET anexo_ok = ?, anexo_em = ?, respondida_por = ?, respondida_em = ? WHERE id = ?', ok ? 1 : 0, ok ? agora() : null, ok ? usuario.login : null, ok ? agora() : null, p.id);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'perguntas_contrato', registro: p.id, campo: 'anexado', valor_anterior: p.anexo_ok ? 'sim' : 'nao', valor_novo: ok ? 'sim' : 'nao' });
  return { ok: true };
}

// Contadores: por unidade (card) e por analista (painel da Gestão).
function contagens(db) {
  const rows = db.all('SELECT contrato_id, analista, tipo, resposta, anexo_ok FROM perguntas_contrato');
  const porUnidade = {}; const porAnalista = new Map(); let abertas = 0;
  for (const r of rows) {
    const ab = aberta(r);
    const a = porAnalista.get(r.analista || '(sem analista)') || { login: r.analista || '(sem analista)', total: 0, abertas: 0 };
    a.total++; if (ab) { a.abertas++; abertas++; porUnidade[r.contrato_id] = (porUnidade[r.contrato_id] || 0) + 1; }
    porAnalista.set(a.login, a);
  }
  const nomes = new Map(db.all('SELECT login, nome FROM usuarios').map((u) => [u.login, u.nome]));
  return { total: rows.length, abertas, porUnidade, porAnalista: [...porAnalista.values()].map((a) => Object.assign(a, { nome: nomes.get(a.login) || a.login })).sort((x, y) => y.abertas - x.abertas) };
}

// Decisões já registradas (para a superintendente e para o Redator).
function decisoes(db, contratoId) {
  return db.all("SELECT * FROM perguntas_contrato WHERE contrato_id = ? AND ((tipo = 'decisao' AND resposta IS NOT NULL) OR (tipo = 'documento' AND anexo_ok = 1)) ORDER BY respondida_em", contratoId)
    .map((p) => ({ pergunta: p.pergunta, tipo: p.tipo, resposta: p.tipo === 'decisao' ? p.resposta : 'Documento anexado: ' + p.documento_pedido, observacao: p.observacao || '', por: p.respondida_por, em: p.respondida_em,
      texto: 'Decisão da analista' + (p.respondida_por ? ' (' + p.respondida_por + ')' : '') + ': ' + (p.tipo === 'decisao' ? p.resposta : 'documento anexado (' + p.documento_pedido + ')') + (p.observacao ? '. Observação: ' + p.observacao : '') }));
}

function todas(db) {
  const nomes = new Map(db.all('SELECT contrato_id, unidade FROM contratos').map((u) => [u.contrato_id, u.unidade]));
  return db.all('SELECT * FROM perguntas_contrato ORDER BY analista, contrato_id, tipo, id').map((p) => Object.assign(paraTela(p, null), { unidade: nomes.get(p.contrato_id) || p.contrato_id, contrato_id: p.contrato_id }));
}

// Tela URGÊNCIAS: perguntas abertas das unidades da carteira (escopo), agrupadas por unidade e ordenadas pelo impacto no parecer.
function urgencias(db, usuario, escopo) {
  const nomes = new Map(db.all('SELECT contrato_id, unidade FROM contratos').map((u) => [u.contrato_id, u.unidade]));
  const nomesU = new Map(db.all('SELECT login, nome FROM usuarios').map((u) => [u.login, u.nome]));
  const todos = db.all('SELECT * FROM perguntas_contrato ORDER BY impacto, tipo, id').filter((p) => !escopo || escopo.has(p.contrato_id));
  const abertas = todos.filter(aberta);
  const por = new Map();
  for (const p of abertas) {
    const g = por.get(p.contrato_id) || { contrato_id: p.contrato_id, unidade: nomes.get(p.contrato_id) || p.contrato_id, impacto: 3, perguntas: [] };
    g.impacto = Math.min(g.impacto, p.impacto || 2); g.perguntas.push(paraTela(p, sugestaoDeAnexo(db, p))); por.set(p.contrato_id, g);
  }
  const ana = new Map();
  if (['superintendente', 'admin'].includes(usuario.perfil)) for (const p of abertas) { const k = p.analista || '(sem analista)'; const a = ana.get(k) || { login: k, nome: nomesU.get(k) || k, abertas: 0 }; a.abertas++; ana.set(k, a); }
  return { abertas: abertas.length, respondidas: todos.length - abertas.length, unidades: [...por.values()].sort((a, b) => a.impacto - b.impacto || b.perguntas.length - a.perguntas.length || a.unidade.localeCompare(b.unidade)),
    porAnalista: [...ana.values()].sort((x, y) => y.abertas - x.abertas) };
}

module.exports = { urgencias, previa, gravar, listar, responder, marcarAnexo, contagens, decisoes, todas, NAO_SEI };
