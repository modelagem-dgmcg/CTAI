'use strict';
// Extrai texto de relatórios importados: PDF (com texto), Word (.docx), Excel (.xlsx), CSV e TXT. Não faz OCR de PDF escaneado.
// O texto devolvido já vem MASCARADO (server/mascara.js), então nada pessoal é guardado nem enviado à IA.
const JSZip = require('jszip');
const { erro } = require('./auth');
const { mascarar } = require('./mascara');

// Limite por arquivo: 60 MB (cabe no Render Starter, 512 MB, porque o sistema lê um arquivo por vez e solta o original logo depois).
const MAX_ARQUIVO = 60 * 1024 * 1024;
const MAX_TEXTO = 3000000; // texto completo, caractere por caractere (um anexo grande tem algumas centenas de milhares)
const TIPOS = ['pdf', 'docx', 'xlsx', 'csv', 'txt', 'html', 'htm'];
// Página de PDF com menos que isto de texto parece ser só imagem (foto, planilha colada como figura): avisa a analista.
const MIN_CHARS_PAGINA = 40;
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
// HTML do SEI (ofícios, despachos): tira marcação, mantém o texto e as quebras de linha. A codificação vem do próprio arquivo (normalmente iso-8859-1).
const NOMEADAS = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ordm: 'º', ordf: 'ª', deg: '°', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', bull: '•', sect: '§', middot: '·', times: '×', iexcl: '¡', iquest: '¿', copy: '©', ccedil: 'ç', Ccedil: 'Ç', ntilde: 'ñ', Ntilde: 'Ñ' };
const ACENTOS = { acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈' };
function entidade(nome) {
  if (NOMEADAS[nome] !== undefined) return NOMEADAS[nome];
  const m = /^([aeiouAEIOU])(acute|grave|circ|tilde|uml)$/.exec(nome);
  return m ? (m[1] + ACENTOS[m[2]]).normalize('NFC') : null;
}
function html(buf) {
  const cab = buf.subarray(0, 4000).toString('latin1');
  const cs = (/charset\s*=\s*["']?([\w-]+)/i.exec(cab) || [])[1] || 'utf-8';
  let bruto;
  try { bruto = new TextDecoder(cs).decode(buf); } catch (_) { bruto = buf.toString('utf8'); }
  const t = bruto.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h\d|li|table|ul|ol)>/gi, '\n').replace(/<\/t[dh]>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([A-Za-z]+);/g, (a, n) => { const e = entidade(n); return e === null ? a : e; });
  const texto = t.replace(/\r/g, '').replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
  return { texto, paginas: null };
}
async function docx(buf) {
  const z = await JSZip.loadAsync(buf);
  const f = z.file('word/document.xml');
  if (!f) throw erro(400, 'Arquivo Word inválido.');
  const xml = await f.async('string');
  const t = xml.replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, ' | ').replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '');
  return { texto: ent(t), paginas: null };
}
async function xlsx(buf) {
  const z = await JSZip.loadAsync(buf);
  const ss = z.file('xl/sharedStrings.xml');
  const comp = ss ? [...(await ss.async('string')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => ent([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''))) : [];
  const saidas = [];
  const planilhas = Object.keys(z.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
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

async function extrair(nome, buf) {
  const ext = (String(nome).split('.').pop() || '').toLowerCase();
  if (!TIPOS.includes(ext)) throw erro(400, 'Tipo não aceito. Use PDF, Word (.docx), Excel (.xlsx), CSV, TXT ou HTML.');
  if (!buf.length) throw erro(400, 'Arquivo vazio.');
  if (buf.length > MAX_ARQUIVO) throw erro(413, 'Arquivo grande demais (' + MB(buf.length) + ' MB; o limite é ' + MB(MAX_ARQUIVO) + ' MB).');
  let r;
  try {
    if (ext === 'pdf') { if (buf.slice(0, 5).toString('latin1') !== '%PDF-') throw erro(400, 'O arquivo não é um PDF válido.'); r = await pdf(buf); }
    else if (ext === 'docx') r = await docx(buf);
    else if (ext === 'xlsx') r = await xlsx(buf);
    else if (ext === 'html' || ext === 'htm') r = html(buf);
    else r = { texto: buf.toString('utf8').replace(/^﻿/, ''), paginas: null };
  } catch (e) { if (e.status) throw e; throw erro(400, 'Não consegui ler o arquivo (' + String(e.message || e).slice(0, 80) + ').'); }
  const completo = String(r.texto || '').replace(/\u0000/g, '');
  const texto = completo.slice(0, MAX_TEXTO);
  if (texto.replace(/\s+/g, '').length < 80) throw erro(422, 'O arquivo não tem texto legível. Se for PDF escaneado, o sistema não faz OCR: use o arquivo original (Word/Excel/PDF com texto).');
  // O texto sai já mascarado (CPF, CNS, telefone, nome de paciente...). O arquivo original nunca é guardado.
  const m = mascarar(texto);
  return { texto: m.texto, paginas: r.paginas || null, tipo: ext, mascarados: m.mascarados, paginasImagem: r.paginasImagem || [], cortado: completo.length > MAX_TEXTO };
}

module.exports = { extrair, html, MAX_ARQUIVO, MAX_TEXTO, MIN_CHARS_PAGINA, TIPOS, MB };
