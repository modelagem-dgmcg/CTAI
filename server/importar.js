'use strict';
// Importar Arquivos (etapa 1 da página da unidade). A analista da CTAI baixa o ZIP/PDF/Word do SEI e solta no sistema; o sistema lê o texto
// (já mascarado), guarda o texto e dá o "check" na LISTA DE CONFERÊNCIA da unidade. O primeiro documento de cada unidade é o relatório/parecer
// do trimestre anterior, já assinado no SEI: ele vale como MODELO (o texto fica guardado e a estrutura vira uma lista proposta).
// A IA só propõe; a analista confere e confirma a lista antes de ela valer. O arquivo original nunca é guardado.
const U = require('../core/util');
const C = require('./catalogo');
const G = require('./gaveta');
const EST = require('./importar-estrutura');
const SIMAS = require('./simas');
const trilha = require('./trilha');
const { erro } = require('./auth');

const agora = () => new Date().toISOString();
const json = (v) => JSON.stringify(v === undefined ? null : v);
const ler = (s, padrao) => { try { const v = JSON.parse(s); return v === null || v === undefined ? padrao : v; } catch (_) { return padrao; } };
const ia = { propor: (arg) => require('../modules/analista/propor-lista').propor(arg) }; // trocável nos testes

// ---------- unidade e calendário ----------
const unidade = (db, u, contratoId) => G.exigirUnidade(db, u, contratoId);
const tipoDe = (c) => C.tipoDaUnidade(c);
function exigirTri(tri) { if (!C.TRI_OK.test(String(tri || ''))) throw erro(400, 'Informe o trimestre no formato 2026-T4.'); return tri; }
const mesesDe = (tri) => C.mesesDoTrimestre(tri);

// Mês do documento: nome do arquivo, texto que diz a competência com clareza, qualquer pista no texto.
function mesDe(nome, texto) {
  const n = C.mesDoNome(nome); if (n) return n;
  const t = C.mesDoTexto(texto); return t ? t.mes : null;
}

// ---------- lista de conferência ----------
function itemObj(r) {
  return { id: r.id, codigo: r.codigo, nome: r.nome, ordem: r.ordem, obrigatorio: !!r.obrigatorio, periodicidade: r.periodicidade, origem: r.origem, padroes: ler(r.padroes, []), padroes_texto: ler(r.padroes_texto, []),
    palavras: ler(r.palavras, []), trecho: r.trecho || null, confianca: r.confianca || null, a_partir_de: r.a_partir_de || null, fonte_ia: !!r.fonte_ia };
}
const itensDaLista = (db, listaId) => db.all('SELECT * FROM imp_itens WHERE lista_id = ? ORDER BY ordem, id', listaId).map(itemObj);
const listaDe = (db, contratoId, estado) => db.get('SELECT * FROM imp_listas WHERE contrato_id = ? AND estado = ? ORDER BY versao DESC, id DESC LIMIT 1', contratoId, estado);

function tipoRotulo(c) { return tipoDe(c) || 'unidade'; }

// A lista em vigor: a última CONFIRMADA; sem ela, a lista padrão do tipo da unidade (reserva), com aviso claro.
function listaEfetiva(db, c) {
  const conf = listaDe(db, c.contrato_id, 'confirmada');
  if (conf) return { origem: 'confirmada', lista: conf, itens: itensDaLista(db, conf.id), aviso: null };
  const tipo = tipoDe(c);
  const padrao = EST.listaDoCatalogo(tipo);
  const tem = db.get('SELECT 1 AS x FROM imp_modelos WHERE contrato_id = ? AND ativo = 1', c.contrato_id);
  let aviso;
  if (!tipo) aviso = 'Sem relatório anterior e sem o tipo da unidade (UPAE, UPA ou Hospital): não há lista padrão. Envie o relatório do trimestre anterior ou monte a lista à mão.';
  else if (!padrao.itens.length) aviso = 'Sem relatório anterior: a lista padrão do ' + tipo + ' ainda não foi definida. Envie o relatório do trimestre anterior ou monte a lista à mão.';
  else if (tem) aviso = 'Há um relatório-modelo, mas a lista dele ainda não foi confirmada. Enquanto isso, está valendo a lista padrão da ' + tipo + '.';
  else aviso = 'Sem relatório anterior: usando a lista padrão da ' + tipo + '.';
  return { origem: 'catalogo', lista: null, itens: padrao.itens.map((i) => Object.assign({ id: null }, i, { obrigatorio: !!i.obrigatorio, fonte_ia: false })), aviso };
}

function gravarLista(db, usuario, contratoId, d) {
  const versao = (db.get('SELECT MAX(versao) AS v FROM imp_listas WHERE contrato_id = ?', contratoId).v || 0) + 1;
  const id = Number(db.run('INSERT INTO imp_listas (contrato_id, versao, estado, origem, modelo_id, nota, criada_por, criada_em, atualizada_em) VALUES (?,?,?,?,?,?,?,?,?)',
    contratoId, versao, d.estado || 'proposta', d.origem, d.modelo_id || null, d.nota || null, usuario.login, agora(), agora()).lastInsertRowid);
  gravarItens(db, id, d.itens);
  return id;
}
function gravarItens(db, listaId, itens) {
  db.run('DELETE FROM imp_itens WHERE lista_id = ?', listaId);
  const usados = new Set();
  itens.forEach((it0, k) => {
    const it = EST.limparItem(it0, k + 1); if (!it) return;
    if (usados.has(it.codigo)) it.codigo = EST.codigoUnico(it.nome, usados);
    usados.add(it.codigo);
    db.run('INSERT INTO imp_itens (lista_id, ordem, codigo, nome, obrigatorio, periodicidade, origem, padroes, padroes_texto, palavras, trecho, confianca, a_partir_de, fonte_ia) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      listaId, k + 1, it.codigo, it.nome, it.obrigatorio, it.periodicidade, it.origem, json(it.padroes), json(it.padroes_texto), json(it.palavras), it.trecho, it.confianca, it.a_partir_de, it.fonte_ia);
  });
}

// Rascunho = a lista em edição ('proposta'). Se não existe, nasce da lista em vigor.
function rascunho(db, usuario, c) {
  const r = listaDe(db, c.contrato_id, 'proposta');
  if (r) return r;
  const ef = listaEfetiva(db, c);
  const id = gravarLista(db, usuario, c.contrato_id, { origem: ef.origem === 'confirmada' ? 'edicao' : 'catalogo', itens: ef.itens, nota: ef.origem === 'confirmada' ? 'Edição da lista confirmada (versão ' + ef.lista.versao + ').' : 'Edição da lista padrão da ' + tipoRotulo(c) + '.' });
  return db.get('SELECT * FROM imp_listas WHERE id = ?', id);
}

function salvarRascunho(db, usuario, contratoId, itensIn) {
  const c = unidade(db, usuario, contratoId);
  if (!Array.isArray(itensIn)) throw erro(400, 'Envie a lista de itens.');
  if (itensIn.length > 120) throw erro(400, 'A lista pode ter no máximo 120 itens.');
  const ra = rascunho(db, usuario, c);
  const antes = new Map(itensDaLista(db, ra.id).map((i) => [i.codigo, i]));
  const usados = new Set(itensIn.map((i) => String(i.codigo || '')).filter(Boolean));
  const novos = itensIn.map((i) => {
    const prev = i.codigo ? antes.get(String(i.codigo)) : null;
    const nome = String(i.nome || '').trim();
    if (!nome) throw erro(400, 'Todo item precisa de nome.');
    const codigo = prev ? prev.codigo : (i.codigo && !antes.has(String(i.codigo)) ? String(i.codigo) : EST.codigoUnico(nome, usados));
    usados.add(codigo);
    const palavras = Array.isArray(i.palavras) ? i.palavras : (typeof i.palavras === 'string' ? i.palavras.split(',') : (prev ? prev.palavras : []));
    return Object.assign({}, prev || {}, i, { codigo, nome, palavras,
      padroes: Array.isArray(i.padroes) ? i.padroes : (prev ? prev.padroes : EST.padroesDoNome(nome)),
      padroes_texto: Array.isArray(i.padroes_texto) ? i.padroes_texto : (prev ? prev.padroes_texto : []),
      trecho: i.trecho !== undefined ? i.trecho : (prev ? prev.trecho : null), confianca: prev ? prev.confianca : (i.confianca || 'manual'), a_partir_de: i.a_partir_de !== undefined ? i.a_partir_de : (prev ? prev.a_partir_de : null),
      fonte_ia: prev ? prev.fonte_ia : !!i.fonte_ia });
  });
  db.tx(() => {
    gravarItens(db, ra.id, novos);
    db.run('UPDATE imp_listas SET atualizada_em = ? WHERE id = ?', agora(), ra.id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'imp_listas', registro: ra.id, campo: 'rascunho_salvo', valor_novo: { contrato: c.contrato_id, itens: novos.length } });
  });
  return { lista_id: ra.id, itens: novos.length };
}

// Junta ao rascunho os itens da lista padrão que ainda não estão nele (útil quando o relatório-modelo não cita todos os anexos).
function completarComPadrao(db, usuario, contratoId) {
  const c = unidade(db, usuario, contratoId);
  const padrao = EST.listaDoCatalogo(tipoDe(c)).itens;
  if (!padrao.length) throw erro(409, 'Não há lista padrão para este tipo de unidade.');
  const ra = rascunho(db, usuario, c);
  const atuais = itensDaLista(db, ra.id);
  const tem = new Set(atuais.map((i) => i.codigo));
  const juntar = padrao.filter((i) => !tem.has(i.codigo));
  db.tx(() => {
    gravarItens(db, ra.id, atuais.concat(juntar));
    db.run('UPDATE imp_listas SET atualizada_em = ? WHERE id = ?', agora(), ra.id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'imp_listas', registro: ra.id, campo: 'completada_com_padrao', valor_novo: { acrescentados: juntar.map((i) => i.codigo) } });
  });
  return { acrescentados: juntar.length };
}

function descartarRascunho(db, usuario, contratoId) {
  const c = unidade(db, usuario, contratoId);
  const ra = listaDe(db, c.contrato_id, 'proposta');
  if (!ra) return { ok: true };
  db.tx(() => {
    db.run('UPDATE imp_listas SET estado = ?, atualizada_em = ? WHERE id = ?', 'descartada', agora(), ra.id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'imp_listas', registro: ra.id, campo: 'rascunho_descartado', valor_novo: { contrato: c.contrato_id } });
  });
  return { ok: true };
}

function confirmarLista(db, usuario, contratoId) {
  const c = unidade(db, usuario, contratoId);
  const ra = listaDe(db, c.contrato_id, 'proposta');
  if (!ra) throw erro(409, 'Não há lista para confirmar.');
  const itens = itensDaLista(db, ra.id);
  if (!itens.length) throw erro(409, 'A lista está vazia. Acrescente ao menos um item.');
  let recasados = 0;
  db.tx(() => {
    db.run("UPDATE imp_listas SET estado = 'substituida' WHERE contrato_id = ? AND estado = 'confirmada'", c.contrato_id);
    db.run("UPDATE imp_listas SET estado = 'confirmada', confirmada_por = ?, confirmada_em = ?, atualizada_em = ? WHERE id = ?", usuario.login, agora(), agora(), ra.id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'imp_listas', registro: ra.id, campo: 'lista_confirmada', valor_novo: { contrato: c.contrato_id, versao: ra.versao, origem: ra.origem, itens: itens.length, obrigatorios: itens.filter((i) => i.obrigatorio).length } });
    recasados = recasar(db, c);
  });
  return { versao: ra.versao, itens: itens.length, recasados };
}

// ---------- relatório-modelo ----------
async function guardarModelo(db, usuario, d) {
  const c = unidade(db, usuario, d.contrato_id);
  const texto = String(d.texto || '');
  const hash = U.sha256(texto);
  const igual = db.get('SELECT id FROM imp_modelos WHERE contrato_id = ? AND hash = ?', c.contrato_id, hash);
  if (igual) {
    const e = erro(409, 'Este relatório já foi guardado como modelo desta unidade.'); e.modelo_id = igual.id; throw e;
  }
  const cat = C.catalogoDoTipo(tipoDe(c));
  const estrutura = EST.extrairEstrutura(texto, { periodicidadePadrao: cat && cat.periodicidade === 'mensal' ? 'mensal' : 'trimestral', tipo: tipoDe(c) });
  let proposta = EST.propostaLista(estrutura, tipoDe(c));
  // A IA, se estiver ligada, só ACRESCENTA propostas (cada uma com o trecho conferido no texto). Nunca troca nem apaga o que a regra achou.
  let usouIA = false, avisoIA = null;
  try {
    const r = await ia.propor({ texto, itens: proposta.itens, unidade: c.unidade, trimestre: estrutura.trimestre });
    if (r && r.ok) {
      usouIA = true;
      const tem = new Set(proposta.itens.map((i) => i.codigo));
      const nomes = new Set(proposta.itens.map((i) => C.sem(i.nome)));
      for (const n of r.itens || []) {
        if (nomes.has(C.sem(n.nome))) continue;
        const item = EST.limparItem(Object.assign({}, n, { fonte_ia: true, confianca: 'ia', codigo: EST.codigoUnico(n.nome, tem) }), proposta.itens.length + 1);
        if (!item) continue;
        tem.add(item.codigo); nomes.add(C.sem(item.nome)); proposta.itens.push(item);
      }
    } else if (r && r.motivo) avisoIA = r.motivo;
  } catch (_) { /* a IA é só reforço */ }
  const nota = [
    'Proposta a partir do relatório de ' + (estrutura.trimestre || 'trimestre anterior') + (d.nome ? ' (' + String(d.nome).slice(0, 80) + ')' : '') + '.',
    proposta.aviso, usouIA ? 'A IA sugeriu itens a mais; confira cada um.' : null,
  ].filter(Boolean).join(' ');
  let modeloId, listaId;
  db.tx(() => {
    db.run('UPDATE imp_modelos SET ativo = 0 WHERE contrato_id = ?', c.contrato_id);
    modeloId = Number(db.run('INSERT INTO imp_modelos (contrato_id, trimestre, nome_arquivo, hash, paginas, caracteres, texto, mascarados, estrutura, ia, ativo, criado_por, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      c.contrato_id, estrutura.trimestre, String(d.nome || '').replace(/[\\/\r\n"]/g, '_').slice(0, 160), hash, d.paginas || null, texto.length, texto, json(d.mascarados || {}), json(estrutura), usouIA ? 1 : 0, 1, usuario.login, agora()).lastInsertRowid);
    db.run("UPDATE imp_listas SET estado = 'descartada', atualizada_em = ? WHERE contrato_id = ? AND estado = 'proposta'", agora(), c.contrato_id);
    listaId = gravarLista(db, usuario, c.contrato_id, { origem: proposta.vazia ? 'catalogo' : 'modelo', modelo_id: modeloId, itens: proposta.itens, nota });
    trilha.registrar(db, { usuario: usuario.login, tabela: 'imp_modelos', registro: modeloId, campo: 'modelo_guardado', valor_novo: { contrato: c.contrato_id, trimestre: estrutura.trimestre, caracteres: texto.length, secoes: estrutura.secoes.length, itens_propostos: proposta.itens.length, mascarados: d.mascarados || {} } });
  });
  return { modelo_id: modeloId, lista_id: listaId, trimestre: estrutura.trimestre, secoes: estrutura.secoes.length, tabelas: estrutura.tabelas.length, indicadores: estrutura.indicadores.length, itens: proposta.itens.length, ia: usouIA, aviso_ia: avisoIA, aviso: proposta.aviso };
}

function modeloAtivo(db, contratoId) { return db.get('SELECT * FROM imp_modelos WHERE contrato_id = ? AND ativo = 1 ORDER BY id DESC LIMIT 1', contratoId); }
function resumoModelo(m) {
  if (!m) return null;
  const e = ler(m.estrutura, {});
  return { id: m.id, trimestre: m.trimestre, nome_arquivo: m.nome_arquivo, caracteres: m.caracteres, paginas: m.paginas, ia: !!m.ia, criado_por: m.criado_por, criado_em: m.criado_em,
    titulo: e.titulo || null, secoes: e.secoes || [], tabelas: e.tabelas || [], indicadores: e.indicadores || [], fontes: (e.fontes || []).map((f) => ({ codigo: f.codigo, nome: f.nome, origem: f.origem, periodicidade: f.periodicidade, vezes: f.vezes })) };
}
// Texto completo (mascarado) do relatório-modelo: é o que o Redator CTAI vai usar depois (ver docs/RELATORIO-MODELO.md).
function textoDoModelo(db, usuario, contratoId) {
  const c = unidade(db, usuario, contratoId);
  const m = modeloAtivo(db, c.contrato_id);
  if (!m) throw erro(404, 'Esta unidade ainda não tem relatório-modelo.');
  return { id: m.id, trimestre: m.trimestre, nome_arquivo: m.nome_arquivo, texto: m.texto || '' };
}

// ---------- arquivos recebidos ----------
function textoDoArquivo(db, r) {
  if (r.texto) return r.texto;
  if (r.gaveta_id) { const g = db.get('SELECT texto FROM gaveta_documentos WHERE id = ?', r.gaveta_id); return g ? g.texto || '' : ''; }
  return '';
}

// Decide item e mês de um arquivo. Devolve { item, por, mes, aviso }.
function decidir(efetivos, tri, nome, texto) {
  const meses = mesesDe(tri);
  const m = EST.casar(efetivos.filter((i) => i.origem === 'unidade' || i.origem === 'pedida_setor' || i.origem === 'gerado_simas'), nome, texto);
  const item = m ? efetivos.find((i) => i.codigo === m.codigo) : null;
  const mesBruto = mesDe(nome, texto);
  const avisos = [];
  let mes = null;
  if (item && item.periodicidade === 'mensal') {
    if (mesBruto && meses.includes(mesBruto) && (!item.a_partir_de || mesBruto >= item.a_partir_de)) mes = mesBruto;
    else if (mesBruto && !meses.includes(mesBruto)) avisos.push('O mês do arquivo (' + C.rotuloMes(mesBruto) + ') é de outro trimestre.');
    else if (!mesBruto) avisos.push('Não achei o mês do arquivo.');
  } else if (item) mes = null;
  else if (mesBruto && meses.includes(mesBruto)) mes = mesBruto; // avulso: guarda o mês que achou, ajuda a apontar depois
  const triTexto = EST.trimestreDe(String(texto || '').slice(0, 4000));
  if (triTexto && triTexto !== tri) avisos.push('O texto fala de ' + triTexto + ', e esta página é de ' + tri + '. Confira.');
  return { item, por: m ? m.por : null, mes, aviso: avisos.join(' ') || null };
}

// Guarda um arquivo lido (texto já mascarado) e o associa ao item da lista. Síncrono.
function guardarArquivo(db, usuario, d) {
  const c = unidade(db, usuario, d.contrato_id);
  exigirTri(d.trimestre);
  const texto = String(d.texto || '');
  const hash = U.sha256(texto);
  const nome = String(d.nome || 'arquivo').replace(/[\\/\r\n"]/g, '_').slice(0, 160);
  const ef = listaEfetiva(db, c);
  const ja = db.get('SELECT id, item_codigo, mes FROM imp_arquivos WHERE contrato_id = ? AND trimestre = ? AND hash = ?', c.contrato_id, d.trimestre, hash);
  if (ja) {
    const it = ef.itens.find((i) => i.codigo === ja.item_codigo);
    return { estado: 'duplicado', arquivo_id: ja.id, item: ja.item_codigo, itemNome: it ? it.nome : null, mes: ja.mes, motivo: 'Este arquivo já foi importado neste trimestre' + (it ? ' (' + it.nome + ')' : '') + '.' };
  }
  const dec = decidir(ef.itens, d.trimestre, nome, texto);
  const avisos = [dec.aviso];
  if (d.cortado) avisos.push('Texto cortado no limite do sistema.');
  if (d.paginasImagem && d.paginasImagem.length) avisos.push(d.paginasImagem.length + ' página(s) parecem só imagem e podem ter ficado de fora.');
  if (d.avisoOrigem) avisos.push(d.avisoOrigem);
  // Unidade com gaveta mensal (UPAE): o documento do catálogo também entra na gaveta, para manter a leitura dos números e a visão do trimestre.
  let gavetaId = null;
  if (G.usaGaveta(c)) {
    const ident = C.identificar(G.catalogoDe(c), nome, texto);
    const mesG = ident ? mesDe(nome, texto) : null;
    if (ident && mesG && mesesDe(d.trimestre).includes(mesG)) {
      try { gavetaId = G.gravar(db, usuario, { contrato_id: c.contrato_id, mes: mesG, codigo: ident.codigo, parte: ident.parte, nome, texto, paginas: d.paginas, paginasImagem: d.paginasImagem, mascarados: d.mascarados }).id; } catch (e) { if (e.gaveta_id) gavetaId = e.gaveta_id; }
    }
  }
  const id = Number(db.run('INSERT INTO imp_arquivos (contrato_id, trimestre, mes, item_codigo, casamento, nome_arquivo, hash, paginas, caracteres, texto, gaveta_id, mascarados, aviso, criado_por, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    c.contrato_id, d.trimestre, dec.mes, dec.item ? dec.item.codigo : null, dec.por, nome, hash, d.paginas || null, texto.length, gavetaId ? null : texto, gavetaId, json(d.mascarados || {}), avisos.filter(Boolean).join(' ') || null, usuario.login, agora()).lastInsertRowid);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'imp_arquivos', registro: id, campo: 'arquivo_guardado', valor_novo: { contrato: c.contrato_id, trimestre: d.trimestre, item: dec.item ? dec.item.codigo : null, mes: dec.mes, por: dec.por, caracteres: texto.length, paginas: d.paginas || null, mascarados: d.mascarados || {} } });
  if (dec.item && dec.item.codigo === SIMAS.ITEM_CODIGO) {
    const r = SIMAS.registrar(db, usuario, c, d.trimestre, id, texto);
    avisos.push('Consolidado do SIMAS lido: ' + r.grupos + ' grupos, ' + r.linhas + ' linhas e ' + r.indicadores + ' indicadores (números propostos, falta você confirmar).' + (r.aviso ? ' ' + r.aviso : ''));
  }
  const avulso = !dec.item || (dec.item.periodicidade === 'mensal' && !dec.mes);
  return { estado: 'lido', arquivo_id: id, item: dec.item ? dec.item.codigo : null, itemNome: dec.item ? dec.item.nome : null, mes: dec.mes, avulso, aviso: avisos.filter(Boolean).join(' ') || null };
}

// Texto curto para mostrar na fila depois da leitura.
function frase(r) {
  if (r.estado === 'duplicado') return r.motivo;
  if (r.item && !r.avulso) return 'Entrou em: ' + r.itemNome + (r.mes ? ' (' + C.nomeMes(r.mes).toLowerCase() + ')' : '') + '.' + (r.aviso ? ' ' + r.aviso : '');
  if (r.item) return 'Parece ser: ' + r.itemNome + '. Falta indicar o mês.' + (r.aviso ? ' ' + r.aviso : '');
  return 'Não reconheci este arquivo: fica como avulso para você apontar o item.' + (r.aviso ? ' ' + r.aviso : '');
}

// Chamado pela fila do "Alimentar" quando o arquivo veio da página da unidade (destino Importar Arquivos).
async function daFila(db, usuario, item, ex, texto, mascarados, atualizar) {
  try {
    if (item.imp_modelo) {
      const r = await guardarModelo(db, usuario, { contrato_id: item.contrato_id, nome: item.nome, texto, paginas: ex.paginas, mascarados });
      atualizar({ estado: 'lido', texto: null, paginas: ex.paginas || null, caracteres: texto.length, mascarados: json(mascarados), motivo: 'Relatório-modelo guardado: ' + r.secoes + ' seção(ões), ' + r.indicadores + ' indicador(es), ' + r.itens + ' item(ns) propostos para a lista. Confira a lista.' });
      return;
    }
    const r = guardarArquivo(db, usuario, { contrato_id: item.contrato_id, trimestre: item.imp_trimestre, nome: item.nome, texto, paginas: ex.paginas, paginasImagem: ex.paginasImagem, cortado: ex.cortado, mascarados, avisoOrigem: item.origem && /^fallback/.test(item.origem) ? 'O arquivo inteiro foi enviado porque o navegador não conseguiu o texto.' : null });
    atualizar({ estado: r.estado === 'duplicado' ? 'duplicado' : 'lido', texto: null, paginas: ex.paginas || null, caracteres: texto.length, mascarados: json(mascarados), mes: r.mes || null, codigo: r.item || null, motivo: frase(r) });
  } catch (e) {
    if (e.status === 409 && e.modelo_id) atualizar({ estado: 'duplicado', texto: null, motivo: e.message });
    else atualizar({ estado: 'problema', texto: null, motivo: String(e.message || e).slice(0, 220) });
  }
}

// Depois de confirmar uma lista nova, o que não foi apontado à mão é casado de novo com os itens atuais.
function recasar(db, c) {
  const ef = listaEfetiva(db, c);
  const linhas = db.all("SELECT * FROM imp_arquivos WHERE contrato_id = ? AND (casamento IS NULL OR casamento <> 'manual')", c.contrato_id);
  let mudou = 0;
  for (const r of linhas) {
    if (r.casamento === 'manual') continue;
    const texto = textoDoArquivo(db, r);
    const dec = decidir(ef.itens, r.trimestre, r.nome_arquivo, texto);
    const novoItem = dec.item ? dec.item.codigo : null;
    if (novoItem !== r.item_codigo || dec.mes !== r.mes) {
      db.run('UPDATE imp_arquivos SET item_codigo = ?, mes = ?, casamento = ? WHERE id = ?', novoItem, dec.mes, dec.por, r.id); mudou++;
      if (novoItem === SIMAS.ITEM_CODIGO) SIMAS.registrar(db, { login: 'sistema' }, c, r.trimestre, r.id, texto);
    }
  }
  return mudou;
}

function apontar(db, usuario, d) {
  const r = db.get('SELECT * FROM imp_arquivos WHERE id = ?', Number(d.arquivo_id));
  if (!r) throw erro(404, 'Arquivo não encontrado.');
  const c = unidade(db, usuario, r.contrato_id);
  const ef = listaEfetiva(db, c);
  let item = null, mes = null;
  if (d.item) {
    item = ef.itens.find((i) => i.codigo === d.item);
    if (!item) throw erro(400, 'Item fora da lista.');
    if (item.periodicidade === 'mensal') {
      mes = String(d.mes || '');
      if (!mesesDe(r.trimestre).includes(mes)) throw erro(400, 'Escolha o mês do arquivo (' + mesesDe(r.trimestre).map((m) => C.nomeMes(m)).join(', ') + ').');
    }
  }
  db.tx(() => {
    db.run('UPDATE imp_arquivos SET item_codigo = ?, mes = ?, casamento = ? WHERE id = ?', item ? item.codigo : null, mes, 'manual', r.id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'imp_arquivos', registro: r.id, campo: 'item_apontado', valor_anterior: { item: r.item_codigo, mes: r.mes }, valor_novo: { item: item ? item.codigo : null, mes } });
  });
  if (item && item.codigo === SIMAS.ITEM_CODIGO) SIMAS.registrar(db, usuario, c, r.trimestre, r.id, textoDoArquivo(db, r));
  return { ok: true };
}

function tirarArquivo(db, usuario, id) {
  const r = db.get('SELECT * FROM imp_arquivos WHERE id = ?', Number(id));
  if (!r) throw erro(404, 'Arquivo não encontrado.');
  unidade(db, usuario, r.contrato_id);
  db.tx(() => {
    db.run('DELETE FROM imp_arquivos WHERE id = ?', r.id);
    db.run('DELETE FROM imp_simas_numeros WHERE arquivo_id = ?', r.id); db.run('DELETE FROM imp_simas WHERE arquivo_id = ?', r.id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'imp_arquivos', registro: r.id, campo: 'arquivo_retirado', valor_anterior: { nome: r.nome_arquivo, item: r.item_codigo, mes: r.mes, trimestre: r.trimestre } });
  });
  return { ok: true };
}

// Check manual. Três origens não vêm por upload da unidade:
//  - pedida_setor: a CTAI pede a outro setor. situacao nao_pedido | pedido (data e nº do processo SEI) | recebido (o arquivo é opcional);
//  - processo_parecer: fica no processo do parecer. situacao consultado, com a informação anotada;
//  - fonte_externa: consulta da analista (SIMAS). Check simples com observação.
const SITUACOES = { gerado_simas: ['recebido'], pedida_setor: ['nao_pedido', 'pedido', 'recebido'], processo_parecer: ['consultado'], fonte_externa: ['recebido'] };
function marcarCheck(db, usuario, contratoId, tri, d) {
  const c = unidade(db, usuario, contratoId); exigirTri(tri);
  const item = listaEfetiva(db, c).itens.find((i) => i.codigo === d.item);
  if (!item) throw erro(400, 'Item fora da lista.');
  if (!SITUACOES[item.origem]) throw erro(400, 'Este item vem por arquivo da unidade, não por check manual.');
  let mes = '';
  if (item.periodicidade === 'mensal') { mes = String(d.mes || ''); if (!mesesDe(tri).includes(mes)) throw erro(400, 'Escolha o mês.'); }
  const obs = String(d.observacao || '').trim().slice(0, 500);
  let situacao = d.situacao ? String(d.situacao) : (d.marcado === false ? 'nao_pedido' : SITUACOES[item.origem].slice(-1)[0]);
  if (d.marcado === false) situacao = 'nao_pedido';
  if (situacao !== 'nao_pedido' && !SITUACOES[item.origem].includes(situacao)) throw erro(400, 'Situação inválida para este item.');
  const dataPedido = String(d.data_pedido || '').trim().slice(0, 10);
  if (dataPedido && !/^\d{4}-\d{2}-\d{2}$/.test(dataPedido)) throw erro(400, 'Data do pedido inválida.');
  const proc = String(d.processo_sei || '').trim().slice(0, 40);
  if (situacao === 'pedido' && item.origem === 'pedida_setor' && !dataPedido && !proc) { /* campos livres: pode registrar o pedido sem dados */ }
  db.tx(() => {
    if (situacao === 'nao_pedido') db.run('DELETE FROM imp_checks WHERE contrato_id = ? AND trimestre = ? AND item_codigo = ? AND mes = ?', c.contrato_id, tri, item.codigo, mes);
    else db.run('INSERT INTO imp_checks (contrato_id, trimestre, item_codigo, mes, observacao, marcado_por, marcado_em, situacao, data_pedido, processo_sei) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(contrato_id, trimestre, item_codigo, mes) DO UPDATE SET observacao = excluded.observacao, marcado_por = excluded.marcado_por, marcado_em = excluded.marcado_em, situacao = excluded.situacao, data_pedido = excluded.data_pedido, processo_sei = excluded.processo_sei',
      c.contrato_id, tri, item.codigo, mes, obs || null, usuario.login, agora(), situacao, dataPedido || null, proc || null);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'imp_checks', registro: c.contrato_id + '/' + tri + '/' + item.codigo + (mes ? '/' + mes : ''), campo: situacao === 'nao_pedido' ? 'check_desmarcado' : 'check_manual', valor_novo: { situacao, observacao: obs || null, data_pedido: dataPedido || null, processo_sei: proc || null } });
  });
  return { ok: true };
}

// Regra da CTAI: sem a planilha de monitoramento (Anexo II), os indicadores que dependem dela contam como meta NÃO cumprida.
// Só vale para o tipo de unidade que usa essa planilha; nenhum valor é inventado.
const REGRAS_AUSENCIA = {
  anexo_II: { tipos: ['UPAE'], estado: 'sem_planilha_meta_nao_cumprida', indicadores: ['Ostomizados', 'TEA / neuropediatria'],
    texto: 'Sem a planilha de monitoramento, estes indicadores contam como meta não cumprida (regra da CTAI): Ostomizados e TEA / neuropediatria.' },
};
function ausenciasDe(itens, tipo) {
  const out = [];
  for (const it of itens) {
    const r = REGRAS_AUSENCIA[it.codigo];
    if (!r || !r.tipos.includes(tipo) || !it.obrigatorio) continue;
    const meses = it.slots.filter((s) => !s.check).map((s) => s.mes).filter(Boolean);
    if (meses.length) out.push({ item: it.codigo, nome: it.nome, estado: r.estado, indicadores: r.indicadores, texto: r.texto, meses_sem: meses });
  }
  return out;
}
// Grava a regra aplicada (ao concluir); apaga o que deixou de valer.
function registrarAusencias(db, usuario, c, tri, aus) {
  db.run('DELETE FROM imp_ausencias WHERE contrato_id = ? AND trimestre = ?', c.contrato_id, tri);
  for (const a of aus) for (const m of a.meses_sem) for (const ind of a.indicadores)
    db.run('INSERT INTO imp_ausencias (contrato_id, trimestre, mes, item_codigo, indicador, estado, regra, registrado_por, registrado_em) VALUES (?,?,?,?,?,?,?,?,?)', c.contrato_id, tri, m, a.item, ind, a.estado, 'sem planilha → meta não cumprida (regra da CTAI)', usuario.login, agora());
  if (aus.length) trilha.registrar(db, { usuario: usuario.login, tabela: 'imp_ausencias', registro: c.contrato_id + '/' + tri, campo: 'regra_ausencia_aplicada', valor_novo: aus.map((a) => ({ item: a.item, meses: a.meses_sem, estado: a.estado })) });
}

// ---------- o que a tela mostra ----------
function estado(db, usuario, contratoId, tri) {
  const c = unidade(db, usuario, contratoId); exigirTri(tri);
  const ef = listaEfetiva(db, c);
  const meses = mesesDe(tri);
  const arqs = db.all('SELECT id, mes, item_codigo, casamento, nome_arquivo, paginas, caracteres, aviso, criado_em FROM imp_arquivos WHERE contrato_id = ? AND trimestre = ? ORDER BY id', c.contrato_id, tri);
  const checks = db.all('SELECT * FROM imp_checks WHERE contrato_id = ? AND trimestre = ?', c.contrato_id, tri);
  const itens = ef.itens.map((it) => {
    const slotsMes = it.periodicidade === 'mensal' ? meses.filter((m) => !it.a_partir_de || m >= it.a_partir_de) : [''];
    const slots = slotsMes.map((m) => {
      const a = arqs.filter((x) => x.item_codigo === it.codigo && (it.periodicidade === 'mensal' ? x.mes === m : true));
      const ch = checks.find((x) => x.item_codigo === it.codigo && x.mes === m);
      const sit = ch ? (ch.situacao || 'recebido') : null; // checks antigos (sem situação) valem como recebido
      const check = a.length ? 'arquivo' : (ch ? (sit === 'pedido' ? 'pedido' : (sit === 'consultado' ? 'consultado' : 'manual')) : null);
      return { mes: m, rotulo: m ? C.nomeMes(m) : 'Trimestre', check, alternativa_manual: it.origem === 'gerado_simas' && !a.length && !!ch, situacao: a.length ? 'recebido' : (sit || 'nao_pedido'), data_pedido: ch ? ch.data_pedido : null, processo_sei: ch ? ch.processo_sei : null, arquivos: a.map((x) => ({ id: x.id, nome: x.nome_arquivo })), observacao: ch ? ch.observacao : null, por: ch ? ch.marcado_por : null };
    });
    const recebidos = slots.filter((s) => s.check && s.check !== 'pedido').length, esperados = slots.length, pedidos = slots.filter((s) => s.check === 'pedido').length;
    const estadoItem = !esperados ? 'nao_exigido' : (recebidos === esperados ? 'completo' : (recebidos ? 'parcial' : (pedidos ? 'pedido' : (it.obrigatorio ? 'falta' : 'opcional'))));
    return { codigo: it.codigo, nome: it.nome, obrigatorio: it.obrigatorio, periodicidade: it.periodicidade, origem: it.origem, trecho: it.trecho, confianca: it.confianca, a_partir_de: it.a_partir_de, slots, recebidos, esperados, pedidos, estado: estadoItem };
  });
  const avulsos = arqs.filter((x) => {
    const it = ef.itens.find((i) => i.codigo === x.item_codigo);
    return !it || (it.periodicidade === 'mensal' && !meses.includes(x.mes));
  }).map((x) => { const it = ef.itens.find((i) => i.codigo === x.item_codigo); return { id: x.id, nome: x.nome_arquivo, mes: x.mes, paginas: x.paginas, aviso: x.aviso, sugestao: it ? { codigo: it.codigo, nome: it.nome, periodicidade: it.periodicidade } : null }; });
  const contados = itens.filter((i) => i.estado !== 'nao_exigido' && (i.obrigatorio || i.recebidos > 0));
  const obrig = itens.filter((i) => i.obrigatorio && i.estado !== 'nao_exigido');
  const faltam = obrig.filter((i) => i.estado !== 'completo').map((i) => ({ codigo: i.codigo, nome: i.nome, detalhe: i.estado === 'parcial' ? i.recebidos + ' de ' + i.esperados + (i.periodicidade === 'mensal' ? ' meses' : '') + (i.pedidos ? ', ' + i.pedidos + ' pedido(s)' : '') : (i.estado === 'pedido' ? 'pedido, aguardando resposta' : (i.estado === 'falta' && i.origem === 'pedida_setor' ? 'ainda não pedido' : (i.estado === 'falta' && i.origem === 'processo_parecer' ? 'ainda não consultado' : null))) }));
  const completos = contados.filter((i) => i.estado === 'completo').length;
  const curto = (nome) => String(nome).split(' - ')[0];
  const listaFaltas = faltam.map((f) => curto(f.nome) + (f.detalhe ? ' (' + f.detalhe + ')' : ''));
  const fraseFaltas = listaFaltas.length <= 1 ? listaFaltas.join('') : listaFaltas.slice(0, -1).join(', ') + ' e ' + listaFaltas[listaFaltas.length - 1];
  const texto = !contados.length ? 'A lista ainda não tem itens obrigatórios.' : completos + ' de ' + contados.length + ' itens recebidos' + (faltam.length ? ' — falta ' + fraseFaltas : '');
  const feitaPorChecks = obrig.length > 0 && faltam.length === 0;
  const con = db.get('SELECT * FROM imp_conclusoes WHERE contrato_id = ? AND trimestre = ?', c.contrato_id, tri);
  const prop = listaDe(db, c.contrato_id, 'proposta');
  const mod = modeloAtivo(db, c.contrato_id);
  const nums = db.all("SELECT estado, COUNT(*) AS n FROM gaveta_numeros WHERE contrato_id = ? AND mes IN (" + meses.map(() => '?').join(',') + ') GROUP BY estado', c.contrato_id, ...meses);
  const nEst = (e) => (nums.find((x) => x.estado === e) || { n: 0 }).n;
  return {
    contrato: { contrato_id: c.contrato_id, unidade: c.unidade, tipo: tipoDe(c) }, trimestre: tri, meses: meses.map((m) => ({ mes: m, rotulo: C.nomeMes(m) })),
    lista: { origem: ef.origem, versao: ef.lista ? ef.lista.versao : null, confirmada_em: ef.lista ? ef.lista.confirmada_em : null, confirmada_por: ef.lista ? ef.lista.confirmada_por : null, aviso: ef.aviso, vazia: !ef.itens.length },
    proposta: prop ? { id: prop.id, versao: prop.versao, origem: prop.origem, nota: prop.nota, itens: db.get('SELECT COUNT(*) AS n FROM imp_itens WHERE lista_id = ?', prop.id).n, criada_em: prop.criada_em } : null,
    modelo: mod ? { id: mod.id, trimestre: mod.trimestre, nome_arquivo: mod.nome_arquivo, criado_em: mod.criado_em, criado_por: mod.criado_por, ia: !!mod.ia } : null,
    itens, avulsos, arquivos: arqs.length,
    ausencias: ausenciasDe(itens, tipoDe(c)),
    simas: SIMAS.resumoSimples(db, c.contrato_id, tri),
    resumo: { recebidos: completos, total: contados.length, faltam, texto },
    feitaPorChecks, concluida: con ? { em: con.concluida_em, por: con.por, faltantes: ler(con.faltantes, []), observacao: con.observacao } : null,
    feita: !!con || feitaPorChecks,
    numeros: { propostos: nEst('proposto'), confirmados: nEst('confirmado') },
  };
}

function concluir(db, usuario, contratoId, tri, d) {
  const st = estado(db, usuario, contratoId, tri);
  const faltam = st.resumo.faltam.map((f) => f.nome + (f.detalhe ? ' (' + f.detalhe + ')' : ''));
  const semNada = st.arquivos === 0 && st.itens.every((i) => i.slots.every((s) => !s.check));
  if ((faltam.length || semNada) && !(d && d.confirmar_faltantes)) {
    const e = erro(409, semNada ? 'Nenhum arquivo foi recebido neste trimestre.' : 'Faltam itens obrigatórios: ' + faltam.join('; ') + '.');
    e.faltam = faltam; throw e;
  }
  const obs = String((d && d.observacao) || '').trim().slice(0, 500);
  db.tx(() => {
    db.run('INSERT INTO imp_conclusoes (contrato_id, trimestre, concluida_em, por, faltantes, observacao) VALUES (?,?,?,?,?,?) ON CONFLICT(contrato_id, trimestre) DO UPDATE SET concluida_em = excluded.concluida_em, por = excluded.por, faltantes = excluded.faltantes, observacao = excluded.observacao',
      contratoId, tri, agora(), usuario.login, json(faltam), obs || null);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'imp_conclusoes', registro: contratoId + '/' + tri, campo: 'importacao_concluida', valor_novo: { faltantes: faltam, recebidos: st.resumo.recebidos, total: st.resumo.total, sem_arquivos: semNada } , motivo: obs || null });
    registrarAusencias(db, usuario, st.contrato, tri, st.ausencias);
  });
  return { ok: true, faltantes: faltam };
}

function reabrir(db, usuario, contratoId, tri) {
  const c = unidade(db, usuario, contratoId); exigirTri(tri);
  const con = db.get('SELECT * FROM imp_conclusoes WHERE contrato_id = ? AND trimestre = ?', c.contrato_id, tri);
  if (!con) return { ok: true };
  db.tx(() => {
    db.run('DELETE FROM imp_conclusoes WHERE contrato_id = ? AND trimestre = ?', c.contrato_id, tri);
    db.run('DELETE FROM imp_ausencias WHERE contrato_id = ? AND trimestre = ?', c.contrato_id, tri);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'imp_conclusoes', registro: c.contrato_id + '/' + tri, campo: 'importacao_reaberta', valor_anterior: { em: con.concluida_em, por: con.por, faltantes: ler(con.faltantes, []) } });
  });
  return { ok: true };
}

// A lista para a tela de edição: o rascunho (se houver), a lista em vigor, o modelo e as versões.
function visaoLista(db, usuario, contratoId) {
  const c = unidade(db, usuario, contratoId);
  const ef = listaEfetiva(db, c);
  const ra = listaDe(db, c.contrato_id, 'proposta');
  const versoes = db.all("SELECT id, versao, estado, origem, nota, criada_por, criada_em, confirmada_por, confirmada_em, (SELECT COUNT(*) FROM imp_itens WHERE lista_id = imp_listas.id) AS itens FROM imp_listas WHERE contrato_id = ? AND estado IN ('confirmada','substituida','proposta') ORDER BY versao DESC LIMIT 20", c.contrato_id);
  return {
    contrato: { contrato_id: c.contrato_id, unidade: c.unidade, tipo: tipoDe(c) },
    efetiva: { origem: ef.origem, versao: ef.lista ? ef.lista.versao : null, aviso: ef.aviso, itens: ef.itens },
    rascunho: ra ? { id: ra.id, versao: ra.versao, origem: ra.origem, nota: ra.nota, itens: itensDaLista(db, ra.id) } : null,
    modelo: resumoModelo(modeloAtivo(db, c.contrato_id)), versoes,
    padrao_disponivel: EST.listaDoCatalogo(tipoDe(c)).itens.length > 0,
  };
}

// Resultado de cada arquivo da fila (para o painel de andamento da tela).
function fila(db, usuario, ids) {
  const lista = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 400);
  if (!lista.length) return [];
  const linhas = db.all('SELECT id, nome, estado, motivo, paginas, mascarados, codigo, mes FROM alimentar_fila WHERE usuario_id = ? AND id IN (' + lista.map(() => '?').join(',') + ')', usuario.usuario_id, ...lista);
  return linhas.map((r) => ({ id: r.id, nome: r.nome, estado: r.estado, motivo: r.motivo, paginas: r.paginas || 0, protegidos: Object.values(ler(r.mascarados, {})).reduce((t, v) => t + Number(v || 0), 0) }));
}

function ausenciasRegistradas(db, usuario, contratoId, tri) { const c = unidade(db, usuario, contratoId); return db.all('SELECT mes, item_codigo, indicador, estado, regra, registrado_por, registrado_em FROM imp_ausencias WHERE contrato_id = ? AND trimestre = ? ORDER BY mes, indicador', c.contrato_id, tri); }
module.exports = { simas: SIMAS, ausenciasRegistradas, ausenciasDe, estado, visaoLista, listaEfetiva, salvarRascunho, completarComPadrao, descartarRascunho, confirmarLista, guardarModelo, textoDoModelo, guardarArquivo, daFila, recasar, apontar, tirarArquivo, marcarCheck, concluir, reabrir, fila, decidir, mesDe, ia, modeloAtivo, textoDoArquivo };
