'use strict';
// "Alimentar o Analista": primeiro acesso de quem tem carteira e ainda não tem histórico confirmado.
// A pessoa solta vários arquivos (ZIP, PDF, Word, Excel, CSV, TXT); o servidor lê, MASCARA dado pessoal, identifica unidade e trimestre
// e monta rascunhos do Histórico (a IA só propõe). Um arquivo por vez, em segundo plano. Só o confirmado entra nos cruzamentos.
// O arquivo original NUNCA é guardado: fica só na memória do servidor até ser lido.
const JSZip = require('jszip');
const crypto = require('crypto');
const A = require('./auth');
const CART = require('./carteira');
const H = require('./historico');
const X = require('./extrair-texto');
const M = require('./mascara');
const C = require('./catalogo');
const G = require('./gaveta');
const trilha = require('./trilha');
const { erro } = A;

const ELEGIVEIS = ['criador', 'colega'];
const FINAIS = ['pronto', 'aprovado', 'duplicado', 'problema', 'descartado'];
const OCUPADOS = ['fila', 'lendo', 'montando'];
const PENDENTES = ['espera'].concat(OCUPADOS); // 'espera': registrado, o navegador ainda vai enviar o arquivo
const MAX_ZIP = 300;
const MAX_LOTE = 400;
const ESPERA_MAX_MIN = 25; // lote parado há mais que isto (aba fechada, rede caída) vira "interrompido"
const IGNORAR = /\.(png|jpe?g|gif|bmp|tiff?|webp|svg|ico|db|ini|lnk|tmp|bak|ds_store)$|^(thumbs\.db|desktop\.ini)$/i;
const agora = () => new Date().toISOString();
const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const memoria = new Map(); // id da fila -> Buffer (o original só existe aqui, até ser lido)
let rodando = false;

// ---------- quem fica travado ----------
function confirmadosNaCarteira(db, usuarioId) {
  const meus = CART.doUsuario(db, usuarioId);
  if (!meus.length) return 0;
  return db.get(`SELECT COUNT(*) AS n FROM hist_relatorios WHERE estado = 'confirmado' AND contrato_id IN (${meus.map(() => '?').join(',')})`, ...meus).n + G.total(db, meus);
}
function trava(db, u) {
  if (!u || !ELEGIVEIS.includes(u.perfil)) return { trava: false, motivo: 'perfil' };
  if (!CART.doUsuario(db, u.usuario_id).length) return { trava: false, motivo: 'sem carteira' };
  if (db.get('SELECT 1 AS x FROM alimentar_liberacao WHERE usuario_id = ?', u.usuario_id)) return { trava: false, motivo: 'liberado' };
  if (confirmadosNaCarteira(db, u.usuario_id) > 0) return { trava: false, motivo: 'já tem histórico' };
  return { trava: true, motivo: 'primeiro acesso' };
}

// ---------- IA ----------
function iaPronta() {
  try {
    const providers = require('../modules/analista/providers');
    const est = providers.estado();
    return est.ordem.some((n) => { const p = providers.PROVEDORES[n]; return p && p.ativo() && (!p.nuvem || est.enviarNuvem || (p.nuvemLiberada && p.nuvemLiberada())); });
  } catch (_) { return false; }
}

// ---------- identificar unidade, trimestre e tipo ----------
function trimestreDe(s) {
  const t = String(s || '');
  let m = /(20\d{2})\s*[-_/. ]?\s*T\s*([1-4])\b/i.exec(t) || null;
  if (m) return m[1] + '-T' + m[2];
  m = /\bT\s*([1-4])\s*[-_/. ]?\s*(20\d{2})\b/i.exec(t);
  if (m) return m[2] + '-T' + m[1];
  m = /\b([1-4])\s*[ºo°ª]?\s*(?:tri(?:mestre)?)\b[^0-9]{0,12}(20\d{2})/i.exec(t);
  if (m) return m[2] + '-T' + m[1];
  return null;
}
// Trimestre do arquivo, da pista mais forte para a mais fraca: escrito no nome ou no texto (2026-T3, 3º tri), mês dito no nome, no ZIP ou no texto,
// maioria dos arquivos do mesmo envio e, por fim, o trimestre que a equipe está fechando agora (o anterior ao atual), sempre com aviso para conferir.
function resolverTrimestre(db, item, texto, lote) {
  const explicito = trimestreDe(item.nome) || trimestreDe(String(texto || '').slice(0, 4000));
  if (explicito) return { tri: explicito, aviso: null };
  const mes = C.mesDoNome(item.nome) || (lote && lote.zip ? C.mesDoNome(lote.zip) : null) || (C.mesDoTexto(texto) || {}).mes || null;
  if (mes) return { tri: C.trimestreDoMes(mes), aviso: 'Trimestre deduzido do mês ' + C.rotuloMes(mes) + '. Confira.' };
  if (lote && lote.tri) return { tri: lote.tri, aviso: 'Trimestre igual ao dos outros arquivos do mesmo envio. Confira.' };
  try { const GE = require('./gestao'); const t = GE.anterior(GE.trimestreAtual()); if (t) return { tri: t, aviso: 'Trimestre assumido: ' + t + ' (o que está sendo fechado agora). Confira.' }; } catch (_) { /* sem palpite */ }
  return { tri: null, aviso: null };
}
function unidadeDe(db, meus, nome, texto) {
  const base = sem(nome + ' ' + String(texto || '').slice(0, 6000));
  const unidades = meus.map((id) => db.get('SELECT contrato_id, unidade FROM contratos WHERE contrato_id = ?', id)).filter(Boolean);
  const achadas = unidades.filter((u) => { const n = sem(u.unidade); return n.length >= 4 && base.includes(n); });
  if (achadas.length === 1) return { contrato_id: achadas[0].contrato_id, assumida: false };
  if (!achadas.length && unidades.length === 1) return { contrato_id: unidades[0].contrato_id, assumida: true };
  return null;
}
const tipoDe = (nome, texto) => (/parecer/i.test(nome + ' ' + String(texto || '').slice(0, 1500)) ? 'parecer' : /relat[oó]rio/i.test(nome) ? 'relatório da OSS' : 'parecer');

// ---------- fila ----------
const set = (db, id, campos) => {
  const ks = Object.keys(campos);
  db.run(`UPDATE alimentar_fila SET ${ks.map((k) => k + ' = ?').join(', ')}, atualizado_em = ? WHERE id = ?`, ...ks.map((k) => campos[k]), agora(), id);
};
function entrar(db, usuario, nome, buf, lote) {
  const id = Number(db.run('INSERT INTO alimentar_fila (usuario_id, lote, nome, tamanho, estado, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?)', usuario.usuario_id, lote || null, String(nome).slice(0, 160), buf.length, 'fila', agora(), agora()).lastInsertRowid);
  memoria.set(id, buf);
  return id;
}

// Recebe um arquivo (ou ZIP, que vira vários).
async function receber(db, usuario, nomeBruto, buf) {
  const nome = String(nomeBruto || 'arquivo').replace(/[\\/\r\n"]/g, '_').slice(0, 160);
  const ext = (nome.split('.').pop() || '').toLowerCase();
  const lote = agora();
  const ids = [];
  if (!buf || !buf.length) throw erro(400, 'Arquivo vazio.');
  if (ext === 'zip') {
    let z;
    try { z = await JSZip.loadAsync(buf); } catch (_) { throw erro(400, 'Não consegui abrir o ZIP.'); }
    const entradas = Object.values(z.files).filter((f) => !f.dir && !/(^|\/)(\.|__MACOSX)/.test(f.name));
    if (entradas.length > MAX_ZIP) throw erro(413, 'O ZIP tem mais de ' + MAX_ZIP + ' arquivos. Divida em partes.');
    for (const f of entradas) {
      const base = f.name.split('/').pop();
      const e = (base.split('.').pop() || '').toLowerCase();
      if (IGNORAR.test(base)) continue;
      if (!X.TIPOS.includes(e)) { const id = entrar(db, usuario, base, Buffer.alloc(0), lote); memoria.delete(id); set(db, id, { estado: 'problema', motivo: 'Tipo não aceito (use PDF, Word, Excel, CSV, TXT ou HTML).' }); ids.push(id); continue; }
      const b = await f.async('nodebuffer');
      if (b.length > X.MAX_ARQUIVO) { const id = entrar(db, usuario, base, Buffer.alloc(0), lote); memoria.delete(id); set(db, id, { estado: 'problema', motivo: 'Arquivo grande demais (' + X.MB(b.length) + ' MB; o limite é ' + X.MB(X.MAX_ARQUIVO) + ' MB).' }); ids.push(id); continue; }
      ids.push(entrar(db, usuario, base, b, lote));
    }
    if (!entradas.length) throw erro(400, 'O ZIP não tem arquivos.');
  } else {
    if (!X.TIPOS.includes(ext)) throw erro(400, 'Tipo não aceito. Use ZIP, PDF, Word (.docx), Excel (.xlsx), CSV, TXT ou HTML.');
    if (buf.length > X.MAX_ARQUIVO) throw erro(413, 'Arquivo grande demais (' + X.MB(buf.length) + ' MB; o limite é ' + X.MB(X.MAX_ARQUIVO) + ' MB).');
    ids.push(entrar(db, usuario, nome, buf, lote));
  }
  trilha.registrar(db, { usuario: usuario.login, tabela: 'alimentar_fila', registro: ids[0], campo: 'recebido', valor_novo: { arquivos: ids.length, bytes: buf.length } });
  setImmediate(() => agendar(db));
  return { ids };
}

// ---------- lote enviado pelo navegador (ZIP aberto na tela) ----------
// O navegador abre o ZIP, avisa a lista dos arquivos úteis (aqui) e manda um por vez. Cada arquivo ganha uma linha na fila já na largada,
// o que permite mostrar o andamento desde o início e retomar de onde parou se a rede cair.
const nomeLimpo = (n) => String(n || 'arquivo').split(/[\\/]/).pop().replace(/[\r\n"]/g, '_').slice(0, 160);
function registrarLote(db, usuario, corpo) {
  const lista = Array.isArray(corpo && corpo.arquivos) ? corpo.arquivos : [];
  if (!lista.length) throw erro(400, 'Nenhum arquivo para ler.');
  if (lista.length > MAX_LOTE) throw erro(413, 'São mais de ' + MAX_LOTE + ' arquivos. Divida em partes.');
  const zip = corpo.zip ? nomeLimpo(corpo.zip) : null;
  const lote = agora() + '#' + Math.random().toString(36).slice(2, 6);
  const meus = CART.doUsuario(db, usuario.usuario_id);
  // Destino fixo (página da unidade, Importar Arquivos): a unidade e o trimestre já vêm definidos; nada é adivinhado pelo nome.
  const dest = corpo.destino && typeof corpo.destino === 'object' ? corpo.destino : null;
  let impUn = null, impTri = null, impModelo = 0;
  if (dest) {
    impUn = G.exigirUnidade(db, usuario, dest.contrato_id);
    impTri = String(dest.trimestre || '');
    if (!C.TRI_OK.test(impTri)) throw erro(400, 'Trimestre inválido.');
    impModelo = dest.modelo ? 1 : 0;
    if (impModelo && lista.length !== 1) throw erro(400, 'O relatório do trimestre anterior é um arquivo só.');
  }
  const unZip = zip && !dest ? unidadeDe(db, meus, zip, '') : null;
  const itens = [];
  for (const a of lista) {
    const nome = nomeLimpo(a && a.nome); const tam = Math.max(0, Number(a && a.tamanho) || 0);
    const ext = (nome.split('.').pop() || '').toLowerCase();
    let estado = 'espera', motivo = null;
    if (a && a.motivo) { estado = 'problema'; motivo = String(a.motivo).slice(0, 220); }
    else if (!X.TIPOS.includes(ext)) { estado = 'problema'; motivo = 'Tipo não aceito (use PDF, Word, Excel, CSV, TXT ou HTML).'; }
    else if (tam > X.MAX_ARQUIVO) { estado = 'problema'; motivo = 'Arquivo grande demais (' + X.MB(tam) + ' MB; o limite é ' + X.MB(X.MAX_ARQUIVO) + ' MB).'; }
    // identificação antecipada pelo nome (a leitura do texto confirma ou corrige depois)
    let contrato = null, codigo = null, parte = null;
    const un = dest ? (estado === 'espera' ? { contrato_id: impUn.contrato_id } : null) : (estado === 'espera' ? (unidadeDe(db, meus, nome, '') || unZip) : null);
    if (un && !dest) {
      contrato = un.contrato_id;
      const c = db.get('SELECT * FROM contratos WHERE contrato_id = ?', contrato);
      if (c && G.usaGaveta(c)) { const id = C.identificar(G.catalogoDe(c), nome, ''); if (id) { codigo = id.codigo; parte = id.parte; } }
    }
    if (un && dest) contrato = un.contrato_id;
    const mes = estado === 'espera' && !dest ? C.mesDoNome(nome) : null;
    const id = Number(db.run('INSERT INTO alimentar_fila (usuario_id, lote, nome, tamanho, estado, motivo, contrato_id, mes, codigo, parte, zip_nome, imp_trimestre, imp_modelo, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      usuario.usuario_id, lote, nome, tam, estado, motivo, contrato, mes, codigo, parte, zip, impTri, impTri ? impModelo : null, agora(), agora()).lastInsertRowid);
    itens.push({ id, nome, estado });
  }
  trilha.registrar(db, { usuario: usuario.login, tabela: 'alimentar_fila', registro: itens[0].id, campo: 'lote_registrado', valor_novo: { arquivos: itens.length, zip, importar: impUn ? { contrato: impUn.contrato_id, trimestre: impTri, modelo: !!impModelo } : null } });
  return { lote, itens };
}

// Recebe os bytes de um arquivo já registrado e só responde depois de lê-lo: o navegador manda o próximo em seguida, então a memória do
// servidor nunca guarda mais de um arquivo grande. Reenviar o que já foi recebido (rede que caiu na volta) é inofensivo.
// Origem do que chegou: 'navegador' = o navegador leu o arquivo na máquina da analista e mandou só o texto (já mascarado);
// 'fallback-*' = o arquivo inteiro veio porque o navegador não conseguiu o texto; sem origem = arquivo enviado direto (Word, Excel, TXT, ZIP pequeno).
const ORIGENS = ['fallback-sem-texto', 'fallback-erro', 'fallback-tempo'];
const AVISO_ORIGEM = {
  'fallback-sem-texto': 'O navegador não achou texto neste PDF (parece só imagem); o arquivo inteiro foi enviado para o sistema tentar ler.',
  'fallback-erro': 'O navegador não conseguiu ler este PDF; o arquivo inteiro foi enviado para o sistema tentar ler.',
  'fallback-tempo': 'A leitura deste PDF no navegador demorou demais; o arquivo inteiro foi enviado para o sistema ler.',
};
const avisoOrigem = (o) => AVISO_ORIGEM[o] || null;
const juntar = (...partes) => partes.filter(Boolean).join(' ') || null;

async function receberDoLote(db, usuario, filaId, buf, origem) {
  const i = doItem(db, usuario, filaId);
  if (i.estado !== 'espera') return { id: i.id, estado: i.estado, repetido: true };
  if (!buf || !buf.length) throw erro(400, 'Arquivo vazio.');
  if (buf.length > X.MAX_ARQUIVO) { set(db, i.id, { estado: 'problema', motivo: 'Arquivo grande demais (' + X.MB(buf.length) + ' MB; o limite é ' + X.MB(X.MAX_ARQUIVO) + ' MB).' }); return { id: i.id, estado: 'problema' }; }
  memoria.set(i.id, buf);
  set(db, i.id, { estado: 'fila', tamanho: buf.length, origem: ORIGENS.includes(origem) ? origem : null });
  await agendar(db);
  return { id: i.id, estado: db.get('SELECT estado FROM alimentar_fila WHERE id = ?', i.id).estado };
}

// Texto que o navegador leu e mascarou na máquina da analista (PDF página a página, ou HTML do SEI). Corpo JSON pequeno (até 8 MB):
// { texto, hash (sha-256 do texto), paginas, paginasSemTexto, mascarados }. O servidor valida tudo e mascara de novo (ver X.deTexto).
async function receberTexto(db, usuario, filaId, corpo) {
  const i = doItem(db, usuario, filaId);
  if (i.estado !== 'espera') return { id: i.id, estado: i.estado, repetido: true };
  if (!corpo || typeof corpo !== 'object') throw erro(400, 'Texto inválido.');
  const ext = (i.nome.split('.').pop() || '').toLowerCase();
  if (!X.TIPOS_NAVEGADOR.includes(ext)) throw erro(400, 'Só PDF e HTML podem ser enviados já como texto.');
  if (typeof corpo.texto !== 'string' || !corpo.texto.length) throw erro(400, 'Texto vazio.');
  if (typeof corpo.hash === 'string' && corpo.hash && crypto.createHash('sha256').update(corpo.texto, 'utf8').digest('hex') !== corpo.hash) throw erro(400, 'O texto chegou alterado. Envie de novo.');
  memoria.set(i.id, { texto: corpo.texto, hash: corpo.hash, paginas: corpo.paginas, paginasSemTexto: corpo.paginasSemTexto, mascarados: corpo.mascarados, cortado: corpo.cortado === true });
  set(db, i.id, { estado: 'fila', tamanho: Math.max(i.tamanho || 0, Buffer.byteLength(corpo.texto)), origem: 'navegador' });
  await agendar(db);
  return { id: i.id, estado: db.get('SELECT estado FROM alimentar_fila WHERE id = ?', i.id).estado };
}

// Contexto do lote (vários arquivos soltos juntos, em geral de um mesmo ZIP): unidade e mês que a maioria dos arquivos já mostrou.
function loteDe(db, item) {
  if (!item.lote) return { zip: null, contrato_id: null, mes: null, tri: null };
  const rows = db.all("SELECT contrato_id, mes, trimestre FROM alimentar_fila WHERE usuario_id = ? AND lote = ? AND id <> ? AND estado NOT IN ('descartado','problema')", item.usuario_id, item.lote, item.id);
  const topo = (arr) => { const m = new Map(); arr.filter(Boolean).forEach((x) => m.set(x, (m.get(x) || 0) + 1)); const o = [...m.entries()].sort((a, b) => b[1] - a[1]); return o.length && (o.length === 1 || o[0][1] > o[1][1]) ? o[0][0] : null; };
  return { zip: item.zip_nome || null, contrato_id: topo(rows.map((r) => r.contrato_id)), mes: topo(rows.map((r) => r.mes)), tri: topo(rows.map((r) => r.trimestre)) };
}
// Ordem de confiança para o mês: nome do arquivo, texto que diz a competência com clareza, nome do ZIP, maioria do lote, qualquer pista no texto.
function mesDoDocumento(nome, texto, lote) {
  const doNome = C.mesDoNome(nome); if (doNome) return doNome;
  const tx = C.mesDoTexto(texto); if (tx && tx.forte) return tx.mes;
  const doZip = lote.zip ? C.mesDoNome(lote.zip) : null; if (doZip) return doZip;
  return lote.mes || (tx ? tx.mes : null);
}

async function umArquivo(db, item) {
  const u = db.get('SELECT * FROM usuarios WHERE usuario_id = ?', item.usuario_id);
  const buf = memoria.get(item.id);
  if (!buf) { set(db, item.id, { estado: 'problema', motivo: 'O servidor foi reiniciado antes de ler este arquivo. Envie de novo.' }); return; }
  set(db, item.id, { estado: 'lendo' });
  let ex;
  try { ex = Buffer.isBuffer(buf) ? await X.extrair(item.nome, buf) : X.deTexto(item.nome, buf); } catch (e) { set(db, item.id, { estado: 'problema', motivo: String(e.message || e).slice(0, 220) }); memoria.delete(item.id); return; }
  memoria.delete(item.id); // o original some da memória assim que é lido
  let texto = ex.texto; let mascarados = ex.mascarados || {};
  // Reforço opcional: segunda passada pela IA para nomes de pacientes que escaparam das regras fixas.
  if (iaPronta()) { const r = await M.reforcarComIA(texto); if (r.usada) { texto = r.texto; if (r.nomes) mascarados = M.somar(mascarados, { 'nome (IA)': r.nomes }); } }
  // Veio da página da unidade (Importar Arquivos): guarda o texto, casa com a lista de conferência e não passa pelo Histórico.
  if (item.imp_trimestre) { await require('./importar').daFila(db, u, item, ex, texto, mascarados, (campos) => set(db, item.id, campos)); return; }
  await decidir(db, u, item, ex, texto, mascarados);
}

// Daqui em diante só se usa o texto já lido: serve tanto à leitura nova quanto à reavaliação de arquivos que esperam.
async function decidir(db, u, item, ex, texto, mascarados) {
  const meus = CART.doUsuario(db, u.usuario_id);
  const lote = loteDe(db, item);
  let un = unidadeDe(db, meus, item.nome, texto);
  if (!un && lote.contrato_id && meus.includes(lote.contrato_id)) un = { contrato_id: lote.contrato_id, assumida: false };
  // Unidade com catálogo mensal (UPAE): vai para a gaveta por mês.
  if (un) {
    const c = db.get('SELECT * FROM contratos WHERE contrato_id = ?', un.contrato_id);
    if (G.usaGaveta(c) && (await viaGaveta(db, u, item, ex, texto, mascarados, c, lote, un))) return;
  }
  const rt = resolverTrimestre(db, item, texto, lote);
  const tri = rt.tri;
  const tipo = tipoDe(item.nome, texto);
  if (!un || !tri) {
    set(db, item.id, { estado: 'precisa_dados', texto, paginas: ex.paginas || null, mascarados: JSON.stringify(mascarados), contrato_id: un ? un.contrato_id : null, trimestre: tri, documento_tipo: tipo,
      paginas_imagem: (ex.paginasImagem || []).join(',') || null, caracteres: texto.length,
      motivo: !un && !tri ? 'Não identifiquei a unidade nem o trimestre.' : !un ? 'Não identifiquei a unidade.' : 'Não identifiquei o trimestre.' });
    return;
  }
  await montar(db, item.id, u, { contrato_id: un.contrato_id, trimestre: tri, documento_tipo: tipo, texto, paginas: ex.paginas || null, mascarados, nome: item.nome, aviso: juntar(un.assumida ? 'Unidade assumida (única da sua carteira). Confira.' : null, rt.aviso, avisoOrigem(item.origem)) });
}

const avisoImagens = (pg, total) => (pg && pg.length ? pg.length + ' página(s) parecem só imagem (pouco texto) e podem ter ficado de fora' + (total ? ' (de ' + total + ')' : '') + ': ' + pg.slice(0, 12).join(', ') + (pg.length > 12 ? '...' : '') + '.' : null);
const baseNome = (n) => String(n || '').replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/^\s*\[\d+\]-\d+_/, '').replace(/[^\wÀ-ÿ]+/g, ' ').trim().slice(0, 60);

// Devolve true quando o arquivo foi tratado pela gaveta (ou ficou esperando o mês); false para seguir o caminho de parecer.
async function viaGaveta(db, u, item, ex, texto, mascarados, c, lote, un) {
  const cat = G.catalogoDe(c);
  const ident = C.identificar(cat, item.nome, texto);
  if (!ident && /parecer/i.test(item.nome + ' ' + texto.slice(0, 1500))) return false; // parecer antigo da UPAE: segue como histórico trimestral
  const codigo = ident ? ident.codigo : 'outro';
  const parte = ident ? ident.parte : baseNome(item.nome);
  const mes = mesDoDocumento(item.nome, texto, lote);
  const imagens = ex.paginasImagem || [];
  const comum = { contrato_id: c.contrato_id, codigo, parte, mes: mes || null, trimestre: mes ? C.trimestreDoMes(mes) : null, documento_tipo: 'gaveta', paginas: ex.paginas || null, caracteres: texto.length, paginas_imagem: imagens.join(',') || null, mascarados: JSON.stringify(mascarados) };
  if (!mes) {
    set(db, item.id, Object.assign(comum, { estado: 'precisa_dados', texto, motivo: 'Não identifiquei o mês.' }));
    return true;
  }
  await gravarNaGaveta(db, u, item.id, c, { mes, codigo, parte, nome: item.nome, texto, paginas: ex.paginas, paginasImagem: imagens, mascarados, ident, un, cortado: ex.cortado, origem: item.origem }, comum);
  return true;
}

async function gravarNaGaveta(db, u, filaId, c, d, comum) {
  try {
    const r = G.gravar(db, u, { contrato_id: c.contrato_id, mes: d.mes, codigo: d.codigo, parte: d.parte, nome: d.nome, texto: d.texto, paginas: d.paginas, paginasImagem: d.paginasImagem, mascarados: d.mascarados });
    const avisos = [];
    if (d.un && d.un.assumida) avisos.push('Unidade assumida (única da sua carteira). Confira.');
    if (d.codigo === 'outro') avisos.push('Não está no catálogo da ' + (C.tipoDaUnidade(c) || 'unidade') + ': guardado como documento avulso de ' + C.rotuloMes(d.mes) + '.');
    if (r.substituiu) avisos.push('Substituiu a versão anterior (agora versão ' + r.versao + ').');
    const im = avisoImagens(d.paginasImagem, d.paginas); if (im) avisos.push(im);
    if (d.cortado) avisos.push('Texto cortado no limite do sistema.');
    const ao = avisoOrigem(d.origem); if (ao) avisos.push(ao);
    set(db, filaId, Object.assign({}, comum, { estado: 'lido', texto: null, gaveta_id: r.id, motivo: avisos.join(' ') || null }));
  } catch (e) {
    if (e.status === 409) set(db, filaId, Object.assign({}, comum, { estado: 'duplicado', texto: null, gaveta_id: e.gaveta_id || null, motivo: e.message }));
    else set(db, filaId, { estado: 'problema', texto: null, motivo: String(e.message || e).slice(0, 220) });
  }
}

async function montar(db, id, u, d) {
  set(db, id, { estado: 'montando', contrato_id: d.contrato_id, trimestre: d.trimestre, documento_tipo: d.documento_tipo, motivo: d.aviso || null });
  try {
    const r = await H.importarTexto(db, u, { contrato_id: d.contrato_id, trimestre: d.trimestre, documento_tipo: d.documento_tipo, nome: d.nome, texto: d.texto, paginas: d.paginas, mascarados: d.mascarados });
    set(db, id, { estado: 'pronto', hist_id: r.hist_id, ia_ok: r.ia.ok ? 1 : 0, texto: null, mascarados: JSON.stringify(d.mascarados || {}), motivo: r.ia.ok ? (d.aviso || null) : (r.ia.motivo ? 'Sem leitura por IA: preencha à mão. ' + (d.aviso || '') : d.aviso || null) });
  } catch (e) {
    if (e.status === 409) set(db, id, { estado: 'duplicado', hist_id: e.hist_id || null, texto: null, motivo: 'Este arquivo já tinha sido importado.' });
    else set(db, id, { estado: 'problema', texto: null, motivo: String(e.message || e).slice(0, 220) });
  }
}

// Um lote por vez, um arquivo por vez: quem pede espera a vez (a memória do servidor é pequena).
let cadeia = Promise.resolve();
function agendar(db) { cadeia = cadeia.then(() => processar(db)).catch(() => {}); return cadeia; }

async function processar(db) {
  if (rodando) return; rodando = true;
  try {
    for (;;) {
      const item = db.get("SELECT * FROM alimentar_fila WHERE estado = 'fila' ORDER BY id LIMIT 1");
      if (!item) break;
      try { await umArquivo(db, item); } catch (e) { memoria.delete(item.id); set(db, item.id, { estado: 'problema', motivo: 'Erro inesperado: ' + String(e.message || e).slice(0, 160) }); }
    }
  } finally { rodando = false; }
}

// Ao subir o servidor, o que estava no meio do caminho não tem mais o arquivo na memória.
function recuperar(db) {
  try { db.run("UPDATE alimentar_fila SET estado = 'problema', motivo = 'O servidor foi reiniciado antes de ler este arquivo. Envie de novo.', atualizado_em = ? WHERE estado IN ('espera','fila','lendo','montando')", agora()); } catch (_) { /* tabela ainda não existe */ }
}

// ---------- o que a pessoa vê ----------
function divergencias(db, item) {
  if (item.estado !== 'pronto' || !item.hist_id) return [];
  const r = db.get('SELECT * FROM hist_relatorios WHERE hist_id = ?', item.hist_id);
  if (!r) return [];
  const f = H.filhos(db, item.hist_id);
  const d = [];
  if (!item.ia_ok && !f.indicadores.length && !f.achados.length && !f.recomendacoes.length) d.push('A IA não leu este arquivo: preencha à mão.');
  if (item.ia_ok && r.igq === null) d.push('Nota total não encontrada no texto. Confira no documento e preencha à mão.');
  const sem0 = [...f.indicadores, ...f.achados, ...f.recomendacoes].filter((x) => !x.verificada).length;
  if (sem0) d.push(sem0 + ' item(ns) sem trecho conferido no texto. Podem estar certos, mas confira antes de aprovar.');
  const pts = f.indicadores.filter((x) => x.pontos !== null);
  if (r.igq !== null && pts.length) { const s = pts.reduce((t, x) => t + Number(x.pontos), 0); if (Math.abs(s - r.igq) > 1) d.push('A soma das notas dos indicadores (' + s.toFixed(1).replace('.', ',') + ') não bate com a nota total (' + String(r.igq).replace('.', ',') + ').'); }
  const outro = db.get("SELECT hist_id FROM hist_relatorios WHERE contrato_id = ? AND trimestre = ? AND hist_id <> ?", r.contrato_id, r.trimestre, r.hist_id);
  if (outro) d.push('Já existe outro relatório deste trimestre para esta unidade.');
  return d;
}

// Lote parado (aba fechada, rede caída) não fica "esperando" para sempre.
function encerrarParados(db, usuarioId) {
  const corte = new Date(Date.now() - ESPERA_MAX_MIN * 60000).toISOString();
  const parados = db.all("SELECT DISTINCT lote FROM alimentar_fila WHERE usuario_id = ? AND estado = 'espera'", usuarioId);
  for (const p of parados) {
    const ult = db.get("SELECT MAX(atualizado_em) AS t FROM alimentar_fila WHERE usuario_id = ? AND lote IS ?", usuarioId, p.lote).t;
    if (ult && ult < corte) db.run("UPDATE alimentar_fila SET estado = 'problema', motivo = 'O envio parou antes de este arquivo chegar. Solte o ZIP de novo: o que já foi lido não se repete.', atualizado_em = ? WHERE usuario_id = ? AND lote IS ? AND estado = 'espera'", agora(), usuarioId, p.lote);
  }
}

const ESTADO_PAINEL = (e) => (e === 'espera' || e === 'fila' ? 'espera' : e === 'lendo' || e === 'montando' ? 'lendo' : e === 'problema' ? 'problema' : e === 'precisa_dados' ? 'atencao' : 'lido');
const topo = (arr) => { const m = new Map(); arr.filter(Boolean).forEach((x) => m.set(x, (m.get(x) || 0) + 1)); const o = [...m.entries()].sort((a, b) => b[1] - a[1]); return o.length ? o[0][0] : null; };

// Painel do último lote: unidade e mês, contadores e a lista de documentos do catálogo (cinza, lendo, lido).
function painel(db, u, linhas) {
  const alvo = linhas.filter((i) => i.lote).slice(-1)[0];
  if (!alvo) return null;
  const doLote = linhas.filter((i) => i.lote === alvo.lote);
  const contratoId = topo(doLote.map((i) => i.contrato_id));
  const c = contratoId ? db.get('SELECT * FROM contratos WHERE contrato_id = ?', contratoId) : null;
  const cat = c && G.usaGaveta(c) ? G.catalogoDe(c) : null;
  const mes = topo(doLote.map((i) => i.mes)) || (alvo.zip_nome ? C.mesDoNome(alvo.zip_nome) : null);
  const pend = doLote.filter((i) => PENDENTES.includes(i.estado));
  const feitos = doLote.length - pend.length;
  const soma = (f) => doLote.reduce((t, i) => t + (f(i) || 0), 0);
  const mascarados = doLote.reduce((t, i) => t + Object.values(i.mascarados || {}).reduce((x, y) => x + y, 0), 0);
  const imagens = doLote.filter((i) => (i.paginasImagem || []).length).map((i) => ({ id: i.id, arquivo: i.nome, paginas: i.paginasImagem }));
  const p = {
    lote: alvo.lote, zip: alvo.zip_nome || null, ativo: pend.length > 0, concluido: pend.length === 0,
    contrato_id: contratoId, unidade: c ? c.unidade : null, tipo: c ? C.tipoDaUnidade(c) : null, mes, mesRotulo: mes ? C.rotuloMes(mes) : null, mesNome: mes ? C.nomeMes(mes) : null, trimestre: mes ? C.trimestreDoMes(mes) : null,
    fallback: doLote.filter((i) => ORIGENS.includes(i.origem)).map((i) => ({ id: i.id, arquivo: i.nome, motivo: avisoOrigem(i.origem) })),
    catalogo: !!cat, arquivos: { total: doLote.length, feitos, lidos: doLote.filter((i) => ['lido', 'pronto', 'aprovado'].includes(i.estado)).length, duplicados: doLote.filter((i) => i.estado === 'duplicado').length, problemas: doLote.filter((i) => i.estado === 'problema').length, atencao: doLote.filter((i) => i.estado === 'precisa_dados').length },
    paginas: soma((i) => i.paginas), caracteres: soma((i) => i.caracteres), protegidos: mascarados, paginasImagem: imagens, itens: [], extras: [], faltam: [], resumo: null, avisoTrimestre: null,
  };
  const arqs = (cod) => doLote.filter((i) => i.codigo === cod);
  if (cat && mes) {
    const noGaveta = G.documentos(db, contratoId, mes);
    const lac = C.lacunas(cat, mes, noGaveta);
    const aguardando = pend.some((i) => !i.codigo);
    const lista = lac.esperados.filter((d) => d.obrigatorio || arqs(d.codigo).length || noGaveta.some((x) => x.codigo === d.codigo));
    p.itens = lista.map((d) => {
      const rs = arqs(d.codigo); const est = rs.map((r) => ESTADO_PAINEL(r.estado));
      let estado;
      if (rs.length) estado = est.includes('lendo') ? 'lendo' : est.includes('espera') ? 'espera' : est.includes('lido') ? 'lido' : est.includes('atencao') ? 'atencao' : 'problema';
      else if (noGaveta.some((x) => x.codigo === d.codigo)) estado = 'lido';
      else estado = aguardando ? 'aguardando' : 'falta';
      return { codigo: d.codigo, nome: d.nome, curto: C.nomeCurto(d), obrigatorio: !!d.obrigatorio, estado, arquivos: rs.map((r) => r.nome), ids: rs.map((r) => r.id), motivo: (rs.find((r) => r.motivo && ['problema', 'atencao'].includes(ESTADO_PAINEL(r.estado))) || {}).motivo || null };
    });
    p.extras = doLote.filter((i) => !i.codigo || !lista.some((d) => d.codigo === i.codigo)).map((i) => ({ id: i.id, nome: i.nome, estado: ESTADO_PAINEL(i.estado), motivo: i.motivo }));
    p.faltam = p.concluido ? lac.faltam.map((d) => ({ codigo: d.codigo, nome: d.nome })) : [];
    if (p.concluido) {
      p.resumo = G.resumoLinha(cat, mes, lac) + (p.arquivos.problemas ? ' (' + p.arquivos.problemas + ' arquivo(s) com problema)' : '') + '.';
      try { p.avisoTrimestre = G.trimestreVisao(db, u, contratoId, C.trimestreDoMes(mes)).aviso; } catch (_) { /* sem permissão: não mostra */ }
    }
  } else {
    p.itens = doLote.map((i) => ({ codigo: null, nome: i.nome, curto: i.nome, obrigatorio: false, estado: ESTADO_PAINEL(i.estado), arquivos: [i.nome], ids: [i.id], motivo: ['problema', 'precisa_dados'].includes(i.estado) ? i.motivo : null }));
    if (p.concluido) p.resumo = p.arquivos.lidos + p.arquivos.duplicados + ' de ' + p.arquivos.total + ' arquivos lidos' + (p.arquivos.problemas ? '; ' + p.arquivos.problemas + ' com problema' : '') + (p.arquivos.atencao ? '; ' + p.arquivos.atencao + ' esperando você' : '') + '.';
  }
  return p;
}

function estado(db, u) {
  const t = trava(db, u);
  encerrarParados(db, u.usuario_id);
  const brutos = db.all('SELECT * FROM alimentar_fila WHERE usuario_id = ? AND estado <> ? AND imp_trimestre IS NULL ORDER BY id DESC LIMIT 600', u.usuario_id, 'descartado').reverse();
  const itens = brutos.map((i) => {
    const c = i.contrato_id ? db.get('SELECT unidade FROM contratos WHERE contrato_id = ?', i.contrato_id) : null;
    let masc = {}; try { masc = JSON.parse(i.mascarados || '{}'); } catch (_) { /* vazio */ }
    return { id: i.id, nome: i.nome, estado: i.estado, motivo: i.motivo, contrato_id: i.contrato_id, unidade: c ? c.unidade : null, trimestre: i.trimestre, documento_tipo: i.documento_tipo, hist_id: i.hist_id, ia_ok: !!i.ia_ok, mascarados: masc, divergencias: divergencias(db, i),
      lote: i.lote, zip_nome: i.zip_nome, codigo: i.codigo, parte: i.parte, mes: i.mes, mesRotulo: i.mes ? C.rotuloMes(i.mes) : null, paginas: i.paginas, caracteres: i.caracteres, gaveta_id: i.gaveta_id,
      paginasImagem: i.paginas_imagem ? String(i.paginas_imagem).split(',').map(Number) : [], origem: i.origem || null };
  });
  const n = (...es) => itens.filter((i) => es.includes(i.estado)).length;
  const meus = CART.doUsuario(db, u.usuario_id).map((id) => db.get('SELECT contrato_id, unidade, tipo FROM contratos WHERE contrato_id = ?', id)).filter(Boolean)
    .map((c) => ({ contrato_id: c.contrato_id, unidade: c.unidade, fluxo: G.usaGaveta(c) ? 'gaveta' : 'trimestre', tipo: C.tipoDaUnidade(c) }));
  const resumo = { total: itens.length, lidos: n('pronto', 'aprovado', 'duplicado', 'lido'), aprovados: n('aprovado'), problemas: n('problema'), pendentes: n(...PENDENTES), precisaDados: n('precisa_dados') };
  const ia = iaPronta();
  return { trava: t.trava, motivo: t.motivo, itens, resumo, unidades: meus, painel: painel(db, u, brutos.map((r, k) => Object.assign({}, r, { mascarados: itens[k].mascarados, paginasImagem: itens[k].paginasImagem }))), ia: { pronta: ia, mensagem: ia ? null : 'A leitura por IA não está ligada. Os arquivos viram rascunho em branco, para você preencher à mão. Peça ao administrador para cadastrar uma chave em Gestão CTAI > IA.' },
    podeLiberar: resumo.pendentes === 0 && resumo.precisaDados === 0 && resumo.total > 0 };
}

function doItem(db, u, id) {
  const i = db.get('SELECT * FROM alimentar_fila WHERE id = ?', Number(id));
  if (!i || i.usuario_id !== u.usuario_id) throw erro(404, 'Arquivo não encontrado.');
  return i;
}

async function identificar(db, u, id, d) {
  const i = doItem(db, u, id);
  if (i.estado !== 'precisa_dados') throw erro(409, 'Este arquivo não está esperando identificação.');
  const c = H.exigirUnidade(db, u, d.contrato_id);
  let masc = {}; try { masc = JSON.parse(i.mascarados || '{}'); } catch (_) { /* vazio */ }
  if (G.usaGaveta(c)) {
    if (!C.MES_OK.test(String(d.mes || ''))) throw erro(400, 'Informe o mês no formato 2026-07.');
    const ident = i.codigo ? { codigo: i.codigo, parte: i.parte || '' } : C.identificar(G.catalogoDe(c), i.nome, i.texto || '');
    const codigo = ident ? ident.codigo : 'outro';
    const parte = ident ? ident.parte : baseNome(i.nome);
    const imagens = i.paginas_imagem ? String(i.paginas_imagem).split(',').map(Number) : [];
    set(db, i.id, { estado: 'montando', contrato_id: c.contrato_id, mes: d.mes, trimestre: C.trimestreDoMes(d.mes), codigo, parte });
    await gravarNaGaveta(db, u, i.id, c, { mes: d.mes, codigo, parte, nome: i.nome, texto: i.texto || '', paginas: i.paginas, paginasImagem: imagens, mascarados: masc, un: null, origem: i.origem },
      { contrato_id: c.contrato_id, codigo, parte, mes: d.mes, trimestre: C.trimestreDoMes(d.mes), documento_tipo: 'gaveta', paginas: i.paginas, caracteres: (i.texto || '').length, paginas_imagem: i.paginas_imagem, mascarados: i.mascarados });
    return { ok: true };
  }
  if (!/^\d{4}-T[1-4]$/.test(String(d.trimestre || ''))) throw erro(400, 'Informe o trimestre no formato 2026-T2.');
  await montar(db, i.id, u, { contrato_id: d.contrato_id, trimestre: d.trimestre, documento_tipo: ['parecer', 'relatório da OSS', 'outro'].includes(d.documento_tipo) ? d.documento_tipo : (i.documento_tipo === 'gaveta' ? 'parecer' : i.documento_tipo || 'parecer'), texto: i.texto || '', paginas: i.paginas, mascarados: masc, nome: i.nome, aviso: avisoOrigem(i.origem) });
  return { ok: true };
}

// Aplica de novo as regras (unidade, mês, trimestre) aos arquivos que esperam a pessoa, usando o texto já guardado: não precisa enviar de novo.
async function reavaliar(db, u) {
  const itens = db.all("SELECT * FROM alimentar_fila WHERE usuario_id = ? AND estado = 'precisa_dados' AND texto IS NOT NULL AND imp_trimestre IS NULL ORDER BY id", u.usuario_id);
  let resolvidos = 0;
  for (const i of itens) {
    let masc = {}; try { masc = JSON.parse(i.mascarados || '{}'); } catch (_) { /* vazio */ }
    const ex = { paginas: i.paginas, paginasImagem: i.paginas_imagem ? String(i.paginas_imagem).split(',').map(Number) : [] };
    try { await decidir(db, u, i, ex, i.texto, masc); } catch (e) { set(db, i.id, { estado: 'problema', motivo: String(e.message || e).slice(0, 200) }); continue; }
    const depois = db.get('SELECT estado FROM alimentar_fila WHERE id = ?', i.id);
    if (depois && depois.estado !== 'precisa_dados') resolvidos++;
  }
  return { reavaliados: itens.length, resolvidos, restantes: itens.length - resolvidos };
}

function descartar(db, u, id) {
  const i = doItem(db, u, id);
  if (OCUPADOS.includes(i.estado)) throw erro(409, 'Este arquivo está sendo lido. Aguarde.');
  memoria.delete(i.id);
  if (i.estado === 'aprovado') throw erro(409, 'Este relatório já foi confirmado.');
  if (i.hist_id && i.estado === 'pronto') { try { H.excluirRascunho(db, u, i.hist_id); } catch (_) { /* já descartado */ } }
  if (i.estado === 'lido' && i.gaveta_id) G.excluirDocumento(db, u, i.gaveta_id); // sai também da gaveta do mês
  set(db, i.id, { estado: 'descartado', texto: null });
}

// Exclui de uma vez todos os arquivos de um ZIP enviado (os já aprovados e os que ainda estão sendo lidos ficam).
function descartarLote(db, u, d) {
  const zip = String((d && d.zip_nome) || ''), lote = String((d && d.lote) || '');
  if (!zip && !lote) throw erro(400, 'Informe o ZIP.');
  const itens = zip ? db.all("SELECT id FROM alimentar_fila WHERE usuario_id = ? AND zip_nome = ? AND estado <> 'descartado' AND imp_trimestre IS NULL", u.usuario_id, zip)
    : db.all("SELECT id FROM alimentar_fila WHERE usuario_id = ? AND lote = ? AND estado <> 'descartado' AND imp_trimestre IS NULL", u.usuario_id, lote);
  let excluidos = 0, mantidos = 0;
  for (const x of itens) { try { descartar(db, u, x.id); excluidos++; } catch (_) { mantidos++; } }
  return { excluidos, mantidos };
}

function aprovar(db, u, ids) {
  const feitos = []; const falhas = [];
  for (const id of (Array.isArray(ids) ? ids : [])) {
    try {
      const i = doItem(db, u, id);
      if (i.estado !== 'pronto' || !i.hist_id) throw erro(409, 'Este arquivo não está pronto para aprovar.');
      H.confirmar(db, u, i.hist_id);
      set(db, i.id, { estado: 'aprovado' });
      feitos.push(i.id);
    } catch (e) { falhas.push({ id: Number(id), motivo: e.message }); }
  }
  trilha.registrar(db, { usuario: u.login, tabela: 'alimentar_fila', registro: feitos[0] || '', campo: 'aprovacao_em_bloco', valor_novo: { aprovados: feitos.length, falhas: falhas.length } });
  return { aprovados: feitos.length, falhas };
}

function pularProblemas(db, u) {
  const r = db.run("UPDATE alimentar_fila SET estado = 'descartado', atualizado_em = ? WHERE usuario_id = ? AND estado IN ('problema','precisa_dados')", agora(), u.usuario_id);
  return { puladas: Number(r.changes || 0) };
}

function liberar(db, u, quem, motivo) {
  db.run('INSERT INTO alimentar_liberacao (usuario_id, liberado_em, por, motivo) VALUES (?,?,?,?) ON CONFLICT(usuario_id) DO UPDATE SET liberado_em = excluded.liberado_em, por = excluded.por, motivo = excluded.motivo', u.usuario_id, agora(), quem, motivo || null);
  trilha.registrar(db, { usuario: quem, tabela: 'alimentar_liberacao', registro: u.usuario_id, campo: 'liberado', valor_novo: { login: u.login, motivo: motivo || null } });
  return { ok: true };
}
function liberarProprio(db, u) {
  const e = estado(db, u);
  if (e.resumo.pendentes) throw erro(409, 'Ainda há arquivos sendo lidos. Aguarde terminar.');
  if (e.resumo.precisaDados) throw erro(409, 'Há arquivos esperando você indicar a unidade e o trimestre. Indique ou use "Pular os que deram problema".');
  if (!e.resumo.total) throw erro(409, 'Envie ao menos um arquivo. Se não tiver nenhum agora, peça à administração para liberar o seu acesso.');
  return liberar(db, u, u.login, 'Concluiu o primeiro envio (' + e.resumo.lidos + ' lidos, ' + e.resumo.problemas + ' com problema)');
}

module.exports = { trava, estado, receber, registrarLote, receberDoLote, receberTexto, avisoOrigem, agendar, IGNORAR, MAX_LOTE, ESPERA_MAX_MIN, loteDe, mesDoDocumento, identificar, reavaliar, resolverTrimestre, descartar, descartarLote, aprovar, pularProblemas, liberar, liberarProprio, recuperar, processar, trimestreDe, unidadeDe, ELEGIVEIS };
