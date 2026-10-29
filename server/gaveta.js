'use strict';
// Gaveta por mês: guarda o TEXTO COMPLETO (mascarado) de cada documento, por unidade + mês + tipo de documento do catálogo.
// O trimestre é uma visão CALCULADA com os 3 meses (não existe arquivo de trimestre). Corrigir um mês (reenviar o documento) atualiza o trimestre.
// Números do Anexo I e do ofício/despacho: a regra só propõe, a analista confere e confirma. O original do arquivo nunca é guardado.
const U = require('../core/util');
const C = require('./catalogo');
const E = require('./extrator-rm');
const P = require('./extrator-planilha');
const trilha = require('./trilha');
const CART = require('./carteira');
const { erro } = require('./auth');

const agora = () => new Date().toISOString();
const CAMPOS = ['meta', 'ofertado', 'regulado', 'realizado', 'pct', 'pct_ofertado'];

function exigirUnidade(db, usuario, contratoId) {
  const c = db.get('SELECT contrato_id, unidade, oss, tipo, demo FROM contratos WHERE contrato_id = ?', String(contratoId || ''));
  if (!c) throw erro(404, 'Unidade não encontrada.');
  CART.exigir(db, usuario, c.contrato_id);
  return c;
}
const catalogoDe = (c) => C.catalogoDoTipo(C.tipoDaUnidade(c));
// A unidade usa a gaveta mensal quando o catálogo do tipo dela é de fluxo "gaveta" (hoje, UPAE).
const usaGaveta = (c) => { const cat = catalogoDe(c); return !!cat && cat.fluxo === 'gaveta'; };

// ---------- gravar ----------
function lerNumeros(codigo, texto, mes) {
  if (codigo === 'anexo_II') {
    const r = P.extrairPlanilha(texto);
    const dif = r.periodo && mes && r.periodo !== mes ? '[confira: a planilha diz ' + r.periodo + ' mas foi guardada em ' + mes + '] ' : '';
    return r.numeros.map((n) => Object.assign(n, { trecho: dif + n.trecho }));
  }
  if (codigo === 'anexo_I') return E.extrairProducaoRM(texto);
  if (codigo === 'oficio_justificativa' || codigo === 'despacho') return E.extrairOficio(texto);
  return [];
}
function gravar(db, usuario, d) {
  const c = db.get('SELECT contrato_id, unidade, tipo FROM contratos WHERE contrato_id = ?', String(d.contrato_id || ''));
  if (!c) throw erro(404, 'Unidade não encontrada.');
  if (!C.MES_OK.test(String(d.mes || ''))) throw erro(400, 'Informe o mês no formato 2026-07.');
  const codigo = String(d.codigo || 'outro').slice(0, 40), parte = String(d.parte || '').slice(0, 60);
  const texto = String(d.texto || '');
  const hash = U.sha256(texto);
  const cat = catalogoDe(c); const defDoc = C.documento(cat, codigo);
  const igual = db.get('SELECT id, mes, codigo, parte FROM gaveta_documentos WHERE contrato_id = ? AND hash = ?', c.contrato_id, hash);
  if (igual) { const e = erro(409, 'Este documento já estava guardado (' + C.rotuloMes(igual.mes) + ').'); e.gaveta_id = igual.id; throw e; }
  const antes = db.get('SELECT id, versao FROM gaveta_documentos WHERE contrato_id = ? AND mes = ? AND codigo = ? AND parte = ?', c.contrato_id, d.mes, codigo, parte);
  const pgImg = Array.isArray(d.paginasImagem) && d.paginasImagem.length ? d.paginasImagem.join(',') : null;
  const nomeArq = String(d.nome || '').replace(/[\\/\r\n"]/g, '_').slice(0, 160);
  let propostos = 0;
  const id = db.tx(() => {
    let id2;
    if (antes) {
      id2 = antes.id;
      db.run('UPDATE gaveta_documentos SET nome_arquivo = ?, hash = ?, paginas = ?, paginas_imagem = ?, caracteres = ?, texto = ?, mascarados = ?, versao = versao + 1, atualizado_em = ? WHERE id = ?',
        nomeArq, hash, d.paginas || null, pgImg, texto.length, texto, JSON.stringify(d.mascarados || {}), agora(), id2);
      db.run('DELETE FROM gaveta_numeros WHERE doc_id = ?', id2); // números da versão antiga não valem para o texto novo
    } else {
      id2 = Number(db.run('INSERT INTO gaveta_documentos (contrato_id, mes, codigo, parte, nome_arquivo, hash, paginas, paginas_imagem, caracteres, texto, mascarados, versao, criado_por, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        c.contrato_id, d.mes, codigo, parte, nomeArq, hash, d.paginas || null, pgImg, texto.length, texto, JSON.stringify(d.mascarados || {}), 1, usuario.login, agora(), agora()).lastInsertRowid);
    }
    if (defDoc && defDoc.extrator) {
      for (const n of lerNumeros(codigo, texto, d.mes)) {
        db.run('INSERT OR IGNORE INTO gaveta_numeros (doc_id, contrato_id, mes, fonte, chave, rotulo, meta, ofertado, regulado, realizado, pct, pct_ofertado, trecho, estado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          id2, c.contrato_id, d.mes, codigo, n.chave, n.rotulo, n.meta, n.ofertado, n.regulado, n.realizado, n.pct, n.pct_ofertado, n.trecho || null, 'proposto');
        propostos++;
      }
    }
    trilha.registrar(db, { usuario: usuario.login, tabela: 'gaveta_documentos', registro: id2, campo: antes ? 'substituido' : 'guardado', valor_novo: { contrato: c.contrato_id, mes: d.mes, codigo, parte, versao: antes ? antes.versao + 1 : 1, caracteres: texto.length, paginas: d.paginas || null, mascarados: d.mascarados || {} } });
    return id2;
  });
  return { id, substituiu: !!antes, versao: antes ? antes.versao + 1 : 1, numeros: propostos };
}

// ---------- ler ----------
function documentos(db, contratoId, mes) {
  return db.all('SELECT id, codigo, parte, nome_arquivo, paginas, paginas_imagem, caracteres, mascarados, versao, criado_em, atualizado_em FROM gaveta_documentos WHERE contrato_id = ? AND mes = ? ORDER BY id', contratoId, mes)
    .map((x) => { let m = {}; try { m = JSON.parse(x.mascarados || '{}'); } catch (_) { /* vazio */ } return Object.assign(x, { mascarados: m, paginas_imagem: x.paginas_imagem ? x.paginas_imagem.split(',').map(Number) : [] }); });
}
const numeros = (db, contratoId, mes) => db.all('SELECT n.*, d.nome_arquivo AS arquivo, d.paginas AS paginas_arquivo FROM gaveta_numeros n LEFT JOIN gaveta_documentos d ON d.id = n.doc_id WHERE n.contrato_id = ? AND n.mes = ? ORDER BY n.doc_id, n.id', contratoId, mes);

function resumoLinha(cat, mes, lac) {
  const total = lac.obrigatorios + lac.chegaram.filter((d) => !d.obrigatorio).length;
  const lidos = lac.chegaram.length;
  const falta = lac.faltam.length ? ' — falta ' + C.frase(lac.faltam) : '';
  return C.nomeMes(mes) + ': ' + lidos + ' de ' + total + ' lidos' + falta;
}

// Conferidor ofício x RM de um mês (usa os números que existirem, propostos ou confirmados).
function conferirMes(db, contratoId, mes) {
  const todos = numeros(db, contratoId, mes);
  const rm = todos.filter((n) => n.fonte === 'anexo_I');
  const div = [];
  for (const fonte of ['oficio_justificativa', 'despacho']) {
    const lista = todos.filter((n) => n.fonte === fonte);
    if (!lista.length || !rm.length) continue;
    div.push(...E.conferir(rm, lista, fonte === 'despacho' ? 'O despacho' : 'O ofício de justificativa'));
  }
  return div;
}

function mesVisao(db, usuario, contratoId, mes) {
  const c = exigirUnidade(db, usuario, contratoId);
  if (!C.MES_OK.test(String(mes || ''))) throw erro(400, 'Informe o mês no formato 2026-07.');
  const tipo = C.tipoDaUnidade(c); const cat = C.catalogoDoTipo(tipo);
  const docs = documentos(db, c.contrato_id, mes);
  const lac = C.lacunas(cat, mes, docs);
  const itens = lac.esperados.map((d) => {
    const dd = docs.filter((x) => x.codigo === d.codigo);
    return { codigo: d.codigo, nome: d.nome, obrigatorio: !!d.obrigatorio, observacao: d.observacao || null, estado: dd.length ? 'recebido' : (d.obrigatorio ? 'falta' : 'opcional'), docs: dd.map((x) => x.id), partes: dd.map((x) => x.parte).filter(Boolean), paginas_imagem: dd.reduce((s, x) => s + x.paginas_imagem.length, 0) };
  });
  const outros = docs.filter((x) => lac.fora.some((f) => f.id === x.id)).map((x) => ({ id: x.id, codigo: x.codigo, nome_arquivo: x.nome_arquivo }));
  return {
    contrato: { contrato_id: c.contrato_id, unidade: c.unidade, tipo }, mes, rotulo: C.rotuloMes(mes), trimestre: C.trimestreDoMes(mes),
    periodicidade: cat ? cat.periodicidade : null, itens, outros, documentos: docs.map((x) => ({ id: x.id, codigo: x.codigo, parte: x.parte, nome_arquivo: x.nome_arquivo, paginas: x.paginas, paginas_imagem: x.paginas_imagem, caracteres: x.caracteres, versao: x.versao, atualizado_em: x.atualizado_em })),
    faltam: lac.faltam.map((d) => ({ codigo: d.codigo, nome: d.nome })), resumo: cat ? resumoLinha(cat, mes, lac) : null,
    numeros: numeros(db, c.contrato_id, mes), divergencias: conferirMes(db, c.contrato_id, mes),
  };
}

// Todos os meses que a unidade já tem na gaveta, com o que chegou e o que falta, e os trimestres que eles formam.
function visaoUnidade(db, usuario, contratoId) {
  const c = exigirUnidade(db, usuario, contratoId);
  const cat = catalogoDe(c);
  const meses = db.all('SELECT DISTINCT mes FROM gaveta_documentos WHERE contrato_id = ? ORDER BY mes DESC', c.contrato_id).map((r) => r.mes);
  const lista = meses.map((mes) => { const docs = documentos(db, c.contrato_id, mes); const lac = C.lacunas(cat, mes, docs); return { mes, rotulo: C.rotuloMes(mes), trimestre: C.trimestreDoMes(mes), documentos: docs.length, faltam: lac.faltam.length, resumo: resumoLinha(cat, mes, lac) }; });
  const tris = [...new Set(meses.map(C.trimestreDoMes))].sort().reverse();
  return { contrato: { contrato_id: c.contrato_id, unidade: c.unidade, tipo: C.tipoDaUnidade(c) }, meses: lista, trimestres: tris };
}

// Trimestre calculado: junta os 3 meses. Nada é guardado; corrigir um mês muda o resultado na próxima leitura.
function trimestreVisao(db, usuario, contratoId, tri) {
  const c = exigirUnidade(db, usuario, contratoId);
  if (!C.TRI_OK.test(String(tri || ''))) throw erro(400, 'Informe o trimestre no formato 2026-T3.');
  const cat = catalogoDe(c);
  const ms = C.mesesDoTrimestre(tri);
  const meses = ms.map((mes) => {
    const docs = documentos(db, c.contrato_id, mes); const lac = C.lacunas(cat, mes, docs);
    return { mes, rotulo: C.rotuloMes(mes), nome: C.nomeMes(mes), chegou: docs.length > 0, documentos: docs.length, faltam: lac.faltam.map((d) => ({ codigo: d.codigo, nome: d.nome })), resumo: docs.length ? resumoLinha(cat, mes, lac) : null };
  });
  const chegaram = meses.filter((m) => m.chegou), faltam = meses.filter((m) => !m.chegou);
  const baixa = (m) => m.nome.toLowerCase();
  let aviso;
  if (!chegaram.length) aviso = 'Nenhum mês deste trimestre chegou ainda.';
  else if (!faltam.length) aviso = 'Os três meses chegaram.';
  else aviso = (chegaram.length === 1 ? 'Chegou ' : 'Chegaram ') + chegaram.map(baixa).join(' e ') + ', falta' + (faltam.length > 1 ? 'm ' : ' ') + faltam.map(baixa).join(' e ') + '.';
  const incompletos = chegaram.filter((m) => m.faltam.length);
  const nums = db.all("SELECT * FROM gaveta_numeros WHERE contrato_id = ? AND fonte = 'anexo_I' AND mes IN (" + ms.map(() => '?').join(',') + ') ORDER BY id', c.contrato_id, ...ms);
  const chaves = [];
  for (const n of nums) if (!chaves.find((x) => x.chave === n.chave)) chaves.push({ chave: n.chave, rotulo: n.rotulo });
  const producao = chaves.map((k) => {
    const por = {}; const conf = [];
    for (const mes of ms) {
      const n = nums.find((x) => x.chave === k.chave && x.mes === mes);
      if (n) { por[mes] = { meta: n.meta, ofertado: n.ofertado, realizado: n.realizado, pct: n.pct, estado: n.estado, id: n.id }; if (n.estado === 'confirmado') conf.push(n); }
    }
    // O total do trimestre só soma meses CONFIRMADOS pela analista (o que a leitura apenas propôs não entra).
    const soma = (campo) => (conf.length && conf.every((n) => n[campo] !== null) ? conf.reduce((s, n) => s + n[campo], 0) : null);
    const meta = soma('meta'), ofertado = soma('ofertado'), realizado = soma('realizado');
    return { chave: k.chave, rotulo: k.rotulo, por_mes: por, total: { meses_confirmados: conf.length, meta, ofertado, realizado, pct_realizado: meta ? Math.round((realizado / meta) * 10000) / 100 : null } };
  });
  const pendentes = nums.filter((n) => n.estado !== 'confirmado').length;
  return { contrato: { contrato_id: c.contrato_id, unidade: c.unidade, tipo: C.tipoDaUnidade(c) }, trimestre: tri, rotulo: tri.slice(6) + 'º trimestre de ' + tri.slice(0, 4), meses, aviso, completo: !faltam.length && !incompletos.length, incompletos: incompletos.map((m) => ({ mes: m.mes, faltam: m.faltam })), producao, numeros_a_conferir: pendentes };
}

// ---------- conferir / confirmar números ----------
const numOuNull = (v, nome) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : E.numeroBR(String(v).trim());
  if (n === null || !Number.isFinite(n)) throw erro(400, 'O valor de "' + nome + '" não é um número.');
  return n;
};
function confirmarNumeros(db, usuario, ids, edicoes) {
  const feitos = [];
  db.tx(() => {
    for (const id of Array.isArray(ids) ? ids : []) {
      const n = db.get('SELECT * FROM gaveta_numeros WHERE id = ?', Number(id));
      if (!n) throw erro(404, 'Número não encontrado.');
      exigirUnidade(db, usuario, n.contrato_id);
      const ed = (edicoes && edicoes[id]) || {};
      const novo = {};
      for (const k of CAMPOS) novo[k] = Object.prototype.hasOwnProperty.call(ed, k) ? numOuNull(ed[k], k) : n[k];
      db.run("UPDATE gaveta_numeros SET meta = ?, ofertado = ?, regulado = ?, realizado = ?, pct = ?, pct_ofertado = ?, estado = 'confirmado', confirmado_por = ?, confirmado_em = ? WHERE id = ?",
        novo.meta, novo.ofertado, novo.regulado, novo.realizado, novo.pct, novo.pct_ofertado, usuario.login, agora(), n.id);
      trilha.registrar(db, { usuario: usuario.login, tabela: 'gaveta_numeros', registro: n.id, campo: 'confirmado', valor_anterior: CAMPOS.reduce((o, k) => Object.assign(o, { [k]: n[k] }), {}), valor_novo: novo });
      feitos.push(n.id);
    }
  });
  return { confirmados: feitos.length };
}

function documento(db, usuario, id, comTexto) {
  const d = db.get('SELECT * FROM gaveta_documentos WHERE id = ?', Number(id));
  if (!d) throw erro(404, 'Documento não encontrado.');
  exigirUnidade(db, usuario, d.contrato_id);
  const { texto, mascarados, ...resto } = d;
  let m = {}; try { m = JSON.parse(mascarados || '{}'); } catch (_) { /* vazio */ }
  return Object.assign(resto, { mascarados: m, paginas_imagem: d.paginas_imagem ? d.paginas_imagem.split(',').map(Number) : [] }, comTexto ? { texto: texto || '' } : {});
}

const total = (db, contratoIds) => (contratoIds.length ? db.get(`SELECT COUNT(*) AS n FROM gaveta_documentos WHERE contrato_id IN (${contratoIds.map(() => '?').join(',')})`, ...contratoIds).n : 0);

// Apaga um documento da gaveta (e os números lidos dele). Fica na trilha quem apagou e o que era.
function excluirDocumento(db, usuario, id) {
  const d = db.get('SELECT * FROM gaveta_documentos WHERE id = ?', Number(id));
  if (!d) return false;
  exigirUnidade(db, usuario, d.contrato_id);
  db.tx(() => {
    db.run('DELETE FROM gaveta_numeros WHERE doc_id = ?', d.id);
    db.run('DELETE FROM gaveta_documentos WHERE id = ?', d.id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'gaveta_documentos', registro: d.id, campo: 'excluido', valor_anterior: { contrato: d.contrato_id, mes: d.mes, codigo: d.codigo, parte: d.parte, nome: d.nome_arquivo }, motivo: 'Excluído pela analista na tela Alimentar' });
  });
  return true;
}

module.exports = { excluirDocumento, gravar, documentos, numeros, conferirMes, mesVisao, visaoUnidade, trimestreVisao, confirmarNumeros, documento, usaGaveta, catalogoDe, exigirUnidade, resumoLinha, total };
