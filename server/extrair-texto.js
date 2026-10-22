'use strict';
// Extrai texto de relatórios importados: PDF (com texto), Word (.docx), Excel (.xlsx), CSV e TXT. Não faz OCR de PDF escaneado.
const JSZip = require('jszip');
const { erro } = require('./auth');

const MAX_ARQUIVO = 4 * 1024 * 1024;
const MAX_TEXTO = 400000;
const TIPOS = ['pdf', 'docx', 'xlsx', 'csv', 'txt'];
const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

async function pdf(buf) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(buf));
  const r = await extractText(doc, { mergePages: false });
  const paginas = (r.text || []).map((t, i) => '--- página ' + (i + 1) + ' ---\n' + t);
  return { texto: paginas.join('\n'), paginas: r.totalPages };
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
  if (!TIPOS.includes(ext)) throw erro(400, 'Tipo não aceito. Use PDF, Word (.docx), Excel (.xlsx), CSV ou TXT.');
  if (!buf.length) throw erro(400, 'Arquivo vazio.');
  if (buf.length > MAX_ARQUIVO) throw erro(413, 'Arquivo acima de 4 MB.');
  let r;
  try {
    if (ext === 'pdf') { if (buf.slice(0, 5).toString('latin1') !== '%PDF-') throw erro(400, 'O arquivo não é um PDF válido.'); r = await pdf(buf); }
    else if (ext === 'docx') r = await docx(buf);
    else if (ext === 'xlsx') r = await xlsx(buf);
    else r = { texto: buf.toString('utf8').replace(/^﻿/, ''), paginas: null };
  } catch (e) { if (e.status) throw e; throw erro(400, 'Não consegui ler o arquivo (' + String(e.message || e).slice(0, 80) + ').'); }
  const texto = String(r.texto || '').replace(/\u0000/g, '').slice(0, MAX_TEXTO);
  if (texto.replace(/\s+/g, '').length < 80) throw erro(422, 'O arquivo não tem texto legível. Se for PDF escaneado, o sistema não faz OCR: use o arquivo original (Word/Excel/PDF com texto).');
  return { texto, paginas: r.paginas || null, tipo: ext };
}

module.exports = { extrair, MAX_ARQUIVO, TIPOS };
