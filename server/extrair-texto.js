'use strict';
// Extrai texto de relatórios importados: PDF (com texto), Word (.docx), Excel (.xlsx), CSV e TXT. Não faz OCR de PDF escaneado.
// O texto devolvido já vem MASCARADO (server/mascara.js), então nada pessoal é guardado nem enviado à IA.
const JSZip = require('jszip');
const { erro } = require('./auth');
const { mascarar, somar } = require('./mascara');
const crypto = require('crypto');
const T = require('../public/js/texto-comum');
const GD = require('./guarda-documentos');
const GC = require('../public/js/guarda-comum');

// Limite por arquivo: 60 MB (cabe no Render Starter, 512 MB, porque o sistema lê um arquivo por vez e solta o original logo depois).
const MAX_ARQUIVO = 60 * 1024 * 1024;
const MAX_TEXTO = 3000000; // texto completo, caractere por caractere (um anexo grande tem algumas centenas de milhares)
const TIPOS = ['pdf', 'docx', 'xlsx', 'csv', 'txt', 'html', 'htm'];
// Página de PDF com menos que isto de texto parece ser só imagem (foto, planilha colada como figura): avisa a analista.
const MIN_CHARS_PAGINA = T.MIN_CHARS_PAGINA;
const MB = (n) => (n / 1048576).toFixed(n >= 10485760 ? 0 : 1).replace('.', ',');
const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

async function pdf(buf) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  // Sem copiar o arquivo: a leitura usa a mesma memória do Buffer (importa nos PDFs de dezenas de MB).
  const doc = await getDocumentProxy(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  try {
    const r = await extractText(doc, { mergePages: false });
    const lista = r.text || [];
    const paginasImagem = [];
    lista.forEach((t, i) => { if (String(t).replace(/\s+/g, '').length < MIN_CHARS_PAGINA) paginasImagem.push(i + 1); });
    const paginas = lista.map((t, i) => '--- página ' + (i + 1) + ' ---\n' + t);
    return { texto: paginas.join('\n'), paginas: r.totalPages, paginasImagem };
  } finally { try { await doc.destroy(); } catch (_) { /* já liberado */ } }
}
// HTML do SEI (ofícios, despachos): a mesma leitura roda no navegador (public/js/texto-comum.js).
function html(buf, limpo) { return { texto: limpo != null ? T.htmlParaTexto(limpo) : T.htmlDeBytes(buf), paginas: null }; }
async function docx(buf) {
  const z = await JSZip.loadAsync(buf);
  const f = z.file('word/document.xml');
  if (!f) throw erro(400, 'Arquivo Word inválido.');
  const xml = GD.limparDocxXml(await f.async('string')); // sem texto oculto, apagado (alterações controladas) nem códigos de campo
  const t = xml.replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, ' | ').replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '');
  return { texto: ent(t), paginas: null };
}
async function xlsx(buf, ocultas) {
  const z = await JSZip.loadAsync(buf);
  const ss = z.file('xl/sharedStrings.xml');
  const comp = ss ? [...(await ss.async('string')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => ent([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''))) : [];
  const saidas = [];
  const planilhas = Object.keys(z.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n) && !(ocultas && ocultas.has(n))).sort(); // planilha oculta não entra
  for (const n of planilhas) {
    const xml = await z.file(n).async('string');
    const linhas = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => [...r[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
      const tipo = /t="(\w+)"/.exec(c[1]); const v = c[2] ? /<v>([\s\S]*?)<\/v>/.exec(c[2]) : null; const is = c[2] ? /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(c[2]) : null;
      if (tipo && tipo[1] === 's' && v) return comp[Number(v[1])] || '';
      return is ? ent(is[1]) : (v ? ent(v[1]) : '');
    }).join('\t'));
    saidas.push('--- planilha ' + (saidas.length + 1) + ' ---\n' + linhas.join('\n'));
  }
  return { texto: saidas.join('\n'), paginas: planilhas.length };
}

async function extrair(nome, buf, opc) {
  opc = opc || {};
  const ext = (String(nome).split('.').pop() || '').toLowerCase();
  if (!TIPOS.includes(ext)) throw erro(400, 'Tipo não aceito. Use PDF, Word (.docx), Excel (.xlsx), CSV, TXT ou HTML.');
  if (!buf.length) throw erro(400, 'Arquivo vazio.');
  if (buf.length > MAX_ARQUIVO) throw erro(413, 'Arquivo grande demais (' + MB(buf.length) + ' MB; o limite é ' + MB(MAX_ARQUIVO) + ' MB).');
  // GUARDA DE DOCUMENTOS: a primeira leitura de qualquer arquivo. Alta = bloqueia aqui (nada é extraído, mascarado nem guardado).
  const g = await GD.antes(nome, buf, { usuario: opc.usuario, origem: opc.origem, filaId: opc.filaId });
  if (GC.decidir(g.achados).acao === 'bloquear') GD.concluir(g.achados, g.ctx); // lança se ninguém liberou este arquivo
  let r;
  try {
    if (ext === 'pdf') { if (buf.slice(0, 5).toString('latin1') !== '%PDF-') throw erro(400, 'O arquivo não é um PDF válido.'); r = await pdf(buf); }
    else if (ext === 'docx') r = await docx(buf);
    else if (ext === 'xlsx') r = await xlsx(buf, g.info.pastasOcultas);
    else if (ext === 'html' || ext === 'htm') r = html(buf, g.info.htmlLimpo);
    else r = { texto: buf.toString('utf8').replace(/^\uFEFF/, ''), paginas: null };
  } catch (e) { if (e.status) throw e; throw erro(400, 'Não consegui ler o arquivo (' + String(e.message || e).slice(0, 80) + ').'); }
  const completo = String(r.texto || '').replace(/\u0000/g, '');
  // Segundo exame, agora no texto: caractere invisível, frase de comando, fórmula perigosa. Devolve o texto já neutralizado.
  const gd = GD.depois(g, completo.slice(0, MAX_TEXTO));
  const texto = gd.texto;
  if (texto.replace(/\s+/g, '').length < 80) throw erro(422, 'O arquivo não tem texto legível. Se for PDF escaneado, o sistema não faz OCR: use o arquivo original (Word/Excel/PDF com texto).');
  // O texto sai já mascarado (CPF, CNS, telefone, nome de paciente...). O arquivo original nunca é guardado.
  const m = mascarar(texto);
  return { texto: m.texto, paginas: r.paginas || null, tipo: ext, mascarados: m.mascarados, paginasImagem: r.paginasImagem || [], cortado: completo.length > MAX_TEXTO, guarda: resumoGuarda(gd.resultado), hash: g.hash };
}
// O que a tela precisa saber do exame (só aviso; o relatório completo fica na quarentena/registro).
function resumoGuarda(r) {
  if (!r || r.acao === 'seguir') return null;
  const med = r.achados.filter((a) => a.g !== 'baixa');
  return { acao: r.acao, gravidade: r.gravidade, avisos: [...new Set(med.map((a) => a.msg))].slice(0, 4), id: r.id || null, liberado: !!r.liberado };
}

// Texto que o NAVEGADOR já leu (PDF ou HTML) e mascarou antes de enviar. O servidor não confia: confere tipo, tamanho e integridade (hash),
// refaz a conta das páginas sem texto e MASCARA DE NOVO. O contador de dados protegidos soma o que cada lado mascarou.
const TIPOS_NAVEGADOR = ['pdf', 'html', 'htm'];
const MAX_CORPO_TEXTO = 8 * 1024 * 1024; // corpo JSON do envio de texto
const TIPOS_MASCARA = new Set(require('../public/js/mascara-comum').TIPOS);
function deTexto(nome, d, opc) {
  opc = opc || {};
  const ext = (String(nome).split('.').pop() || '').toLowerCase();
  if (!TIPOS_NAVEGADOR.includes(ext)) throw erro(400, 'Só PDF e HTML podem ser enviados já como texto.');
  if (!d || typeof d.texto !== 'string' || !d.texto.length) throw erro(400, 'Texto vazio.');
  if (typeof d.hash === 'string' && d.hash) {
    if (!/^[0-9a-f]{64}$/.test(d.hash) || crypto.createHash('sha256').update(d.texto, 'utf8').digest('hex') !== d.hash) throw erro(400, 'O texto chegou alterado. Envie de novo.');
  }
  const completo = d.texto.replace(/\u0000/g, '');
  // GUARDA DE DOCUMENTOS (texto que o navegador leu): o navegador já examinou o arquivo e manda o que achou; o servidor examina o texto de novo.
  const gd = GD.examinarTextoRecebido(nome, completo.slice(0, MAX_TEXTO), { usuario: opc.usuario, origem: opc.origem, filaId: opc.filaId }, d.guarda);
  const texto = gd.texto;
  if (texto.replace(/\s+/g, '').length < T.MIN_CHARS_ARQUIVO) throw erro(422, 'O arquivo não tem texto legível. Se for PDF escaneado, o sistema não faz OCR: use o arquivo original (Word/Excel/PDF com texto).');
  let paginas = null; let paginasImagem = [];
  if (ext === 'pdf') {
    const pg = T.paginasDoTexto(texto);
    const dec = Math.floor(Number(d.paginas));
    paginas = Math.min(5000, Math.max(pg.total, Number.isFinite(dec) && dec > 0 ? dec : 0)) || null;
    const extra = (Array.isArray(d.paginasSemTexto) ? d.paginasSemTexto : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= (paginas || 0));
    paginasImagem = Array.from(new Set(pg.imagem.concat(extra))).sort((a, b) => a - b);
  }
  const cliente = {};
  for (const [k, v] of Object.entries((d.mascarados && typeof d.mascarados === 'object') ? d.mascarados : {})) {
    const n = Math.floor(Number(v)); if (TIPOS_MASCARA.has(k) && Number.isFinite(n) && n > 0) cliente[k] = Math.min(n, 1000000);
  }
  const m = mascarar(texto); // segunda máscara, no servidor
  return { texto: m.texto, paginas, tipo: ext, mascarados: somar(cliente, m.mascarados), paginasImagem, cortado: completo.length > MAX_TEXTO || d.cortado === true, guarda: resumoGuarda(gd.resultado), hash: gd.hash };
}

module.exports = { extrair, deTexto, MAX_CORPO_TEXTO, TIPOS_NAVEGADOR, html, MAX_ARQUIVO, MAX_TEXTO, MIN_CHARS_PAGINA, TIPOS, MB };
