'use strict';
// Renderizador de PDF a partir de um "modelo de documento" (lista de blocos).
// O mesmo modelo alimenta o PDF e o texto lido pelo Analista, então o que se vê é o que se confere.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const FONTES_DIR = path.join(__dirname, 'fontes');
const COR = { escuro: '#12303B', claro: '#F6F4EF', acento: '#16697D', ciano: '#5FD0E8', ambar: '#A8620A', vermelho: '#9B2335', cinza: '#4F6B78', texto: '#14242B', linha: '#DDD8CC' };

function registrarFontes(doc) {
  const f = (arq) => path.join(FONTES_DIR, arq);
  try {
    doc.registerFont('Texto', f('ibm-plex-sans-latin-400-normal.ttf'));
    doc.registerFont('TextoMedio', f('ibm-plex-sans-latin-500-normal.ttf'));
    doc.registerFont('TextoNegrito', f('ibm-plex-sans-latin-600-normal.ttf'));
    doc.registerFont('Titulo', f('source-serif-4-latin-600-normal.ttf'));
    doc.font('Texto');
    return true;
  } catch (e) {
    doc.registerFont('Texto', 'Helvetica');
    doc.registerFont('TextoMedio', 'Helvetica');
    doc.registerFont('TextoNegrito', 'Helvetica-Bold');
    doc.registerFont('Titulo', 'Times-Bold');
    doc.font('Texto');
    return false;
  }
}

// A fonte do PDF não tem alguns símbolos matemáticos; troca por equivalentes legíveis.
function limpar(s) {
  return s.replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/→/g, '->').replace(/≠/g, '<>').replace(/≈/g, '~').replace(/\u2009|\u202f/g, ' ');
}
function limparProfundo(v) {
  if (typeof v === 'string') return limpar(v);
  if (Array.isArray(v)) return v.map(limparProfundo);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = limparProfundo(v[k]); return o; }
  return v;
}

function texto(v) {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

// modelo: { titulo, subtitulo, demo, rodape, cabecalhoCurto, blocos: [...] }
// blocos: { tipo: 'titulo', nivel, texto } | { tipo: 'paragrafo', texto, negrito? } | { tipo: 'chaveValor', itens: [[k, v]] }
//       | { tipo: 'tabela', titulo?, colunas: [{ rotulo, largura (peso), alinhar }], linhas: [[...]], destaque?: (indice)=>cor }
//       | { tipo: 'aviso', texto, nivel: 'info'|'atencao' } | { tipo: 'lista', itens: [...] } | { tipo: 'espaco', altura }
function renderizar(modeloOriginal) {
  const modelo = limparProfundo(modeloOriginal);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margins: { top: 78, bottom: 70, left: 50, right: 50 }, bufferPages: true,
      info: { Title: modelo.titulo, Author: 'CTAI – Comissão Técnica de Acompanhamento Interno', Subject: modelo.subtitulo || '', Producer: 'Sistema CTAI' },
    });
    const partes = [];
    doc.on('data', (d) => partes.push(d));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    try {
      registrarFontes(doc);
      const L = doc.page.margins.left;
      const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const topo = doc.page.margins.top;
      const limite = () => doc.page.height - doc.page.margins.bottom;

      // Capa simples no início do conteúdo
      doc.font('Titulo').fontSize(20).fillColor(COR.escuro).text(modelo.titulo, L, topo - 6, { width: W });
      if (modelo.subtitulo) doc.moveDown(0.2).font('Texto').fontSize(10.5).fillColor(COR.cinza).text(modelo.subtitulo, { width: W });
      doc.moveDown(0.8);

      const garantir = (altura) => { if (doc.y + altura > limite()) doc.addPage(); };

      for (const b of modelo.blocos) {
        if (b.tipo === 'titulo') {
          garantir(b.nivel === 1 ? 110 : 80); // título não fica sozinho no fim da página
          doc.moveDown(b.nivel === 1 ? 0.9 : 0.5);
          doc.font(b.nivel === 1 ? 'Titulo' : 'TextoNegrito').fontSize(b.nivel === 1 ? 14 : 11).fillColor(b.nivel === 1 ? COR.acento : COR.escuro).text(b.texto, L, doc.y, { width: W });
          if (b.nivel === 1) { const y = doc.y + 2; doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.7).strokeColor(COR.linha).stroke(); doc.y = y + 6; }
          else doc.moveDown(0.2);
        } else if (b.tipo === 'paragrafo') {
          doc.font(b.negrito ? 'TextoNegrito' : 'Texto').fontSize(9.5).fillColor(COR.texto);
          garantir(doc.heightOfString(texto(b.texto), { width: W }) + 4);
          doc.text(texto(b.texto), L, doc.y, { width: W, align: 'left', lineGap: 1.5 });
          doc.moveDown(0.4);
        } else if (b.tipo === 'lista') {
          doc.font('Texto').fontSize(9.5).fillColor(COR.texto);
          for (const it of b.itens) {
            const h = doc.heightOfString('•  ' + it, { width: W - 12 });
            garantir(h + 3);
            doc.text('•  ' + it, L + 6, doc.y, { width: W - 12, lineGap: 1.5 });
            doc.moveDown(0.15);
          }
          doc.moveDown(0.3);
        } else if (b.tipo === 'chaveValor') {
          doc.fontSize(9.5);
          for (const [k, v] of b.itens) {
            doc.font('TextoNegrito');
            const hk = doc.heightOfString(k, { width: 150 });
            doc.font('Texto');
            const hv = doc.heightOfString(texto(v), { width: W - 160 });
            const h = Math.max(hk, hv) + 4;
            garantir(h);
            const y = doc.y;
            doc.font('TextoNegrito').fillColor(COR.cinza).text(k, L, y, { width: 150 });
            doc.font('Texto').fillColor(COR.texto).text(texto(v), L + 160, y, { width: W - 160 });
            doc.y = y + h;
          }
          doc.moveDown(0.3);
        } else if (b.tipo === 'aviso') {
          const cor = b.nivel === 'atencao' ? COR.ambar : COR.acento;
          doc.font('Texto').fontSize(9);
          const h = doc.heightOfString(texto(b.texto), { width: W - 20 }) + 12;
          garantir(h + 4);
          const y = doc.y;
          doc.rect(L, y, W, h).fillColor('#F3EFE6').fill();
          doc.rect(L, y, 3, h).fillColor(cor).fill();
          doc.fillColor(COR.texto).text(texto(b.texto), L + 12, y + 6, { width: W - 20 });
          doc.y = y + h + 6;
        } else if (b.tipo === 'espaco') {
          doc.moveDown((b.altura || 8) / 12);
        } else if (b.tipo === 'tabela') {
          if (b.titulo) { garantir(30); doc.font('TextoNegrito').fontSize(10).fillColor(COR.escuro).text(b.titulo, L, doc.y, { width: W }); doc.moveDown(0.25); }
          const soma = b.colunas.reduce((s, c) => s + (c.largura || 1), 0);
          const larguras = b.colunas.map((c) => ((c.largura || 1) / soma) * W);
          const pad = 4;
          const desenharLinha = (celulas, opc) => {
            doc.font(opc.cabecalho ? 'TextoNegrito' : 'Texto').fontSize(8.5);
            let h = 0;
            celulas.forEach((c, i) => { h = Math.max(h, doc.heightOfString(texto(c), { width: larguras[i] - pad * 2 })); });
            h += pad * 2;
            if (doc.y + h > limite()) { doc.addPage(); if (!opc.cabecalho && b.colunas) desenharLinha(b.colunas.map((c) => c.rotulo), { cabecalho: true }); }
            const y = doc.y;
            if (opc.cabecalho) doc.rect(L, y, W, h).fillColor(COR.escuro).fill();
            else if (opc.zebra) doc.rect(L, y, W, h).fillColor('#F3EFE6').fill();
            let x = L;
            celulas.forEach((c, i) => {
              doc.font(opc.cabecalho ? 'TextoNegrito' : 'Texto').fontSize(8.5).fillColor(opc.cabecalho ? '#F6F4EF' : (opc.cor && opc.cor[i]) || COR.texto);
              doc.text(texto(c), x + pad, y + pad, { width: larguras[i] - pad * 2, align: b.colunas[i].alinhar || 'left' });
              x += larguras[i];
            });
            doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.4).strokeColor(COR.linha).stroke();
            doc.y = y + h;
          };
          desenharLinha(b.colunas.map((c) => c.rotulo), { cabecalho: true });
          b.linhas.forEach((ln, idx) => desenharLinha(ln.map((c) => (c && typeof c === 'object' && 'texto' in c) ? c.texto : c), { zebra: idx % 2 === 1, cor: b.cores ? b.cores(ln, idx) : null }));
          doc.moveDown(0.6);
        }
      }

      // Cabeçalho, marca d'água e rodapé em todas as páginas
      const intervalo = doc.bufferedPageRange();
      for (let i = 0; i < intervalo.count; i++) {
        doc.switchToPage(i);
        const m = doc.page.margins;
        doc.page.margins = { top: 0, bottom: 0, left: m.left, right: m.right };
        const pw = doc.page.width, ph = doc.page.height;
        // faixa superior
        doc.rect(0, 0, pw, 30).fillColor(COR.escuro).fill();
        doc.font('TextoNegrito').fontSize(8).fillColor(COR.ciano).text('CTAI', L, 11, { width: 60, lineBreak: false });
        doc.font('Texto').fontSize(8).fillColor('#C9D9DE').text(modelo.cabecalhoCurto || modelo.titulo, L + 40, 11, { width: pw - L * 2 - 40, lineBreak: false, ellipsis: true });
        if (modelo.demo) {
          doc.save();
          doc.rotate(-35, { origin: [pw / 2, ph / 2] });
          doc.font('TextoNegrito').fontSize(46).fillColor('#9B2335').opacity(0.10).text('DEMONSTRAÇÃO – dados fictícios', 40, ph / 2 - 30, { width: pw - 80, align: 'center', lineBreak: false });
          doc.restore();
          doc.opacity(1);
          doc.rect(0, 30, pw, 14).fillColor('#9B2335').fill();
          doc.font('TextoNegrito').fontSize(7.5).fillColor('#FFFFFF').text('DEMONSTRAÇÃO – dados fictícios. Este documento não vale como relatório oficial.', L, 34, { width: pw - L * 2, align: 'center', lineBreak: false });
        }
        // rodapé
        const y = ph - 48;
        doc.moveTo(L, y).lineTo(pw - L, y).lineWidth(0.5).strokeColor(COR.linha).stroke();
        doc.font('Texto').fontSize(7.5).fillColor(COR.cinza).text(modelo.rodape || '', L, y + 5, { width: pw - L * 2 - 70, lineBreak: true });
        doc.font('TextoNegrito').fontSize(8).fillColor(COR.escuro).text('Página ' + (i + 1) + ' de ' + intervalo.count, pw - L - 90, y + 5, { width: 90, align: 'right', lineBreak: false });
        doc.page.margins = m;
      }
      doc.end();
    } catch (e) { reject(e); }
  });
}

// Texto simples do modelo, para o Analista e para conferências de texto × tabela.
function textoDoModelo(modelo) {
  const linhas = [modelo.titulo, modelo.subtitulo || ''];
  for (const b of modelo.blocos) {
    if (b.tipo === 'titulo' || b.tipo === 'paragrafo' || b.tipo === 'aviso') linhas.push(String(b.texto));
    else if (b.tipo === 'lista') for (const i of b.itens) linhas.push('- ' + i);
    else if (b.tipo === 'chaveValor') for (const [k, v] of b.itens) linhas.push(k + ': ' + (v === null || v === undefined ? '' : v));
    else if (b.tipo === 'tabela') {
      if (b.titulo) linhas.push(b.titulo);
      linhas.push(b.colunas.map((c) => c.rotulo).join(' | '));
      for (const ln of b.linhas) linhas.push(ln.map((c) => (c && typeof c === 'object' && 'texto' in c) ? c.texto : (c === null || c === undefined ? '' : c)).join(' | '));
    }
  }
  return linhas.join('\n');
}

// Tabelas como matrizes (para somar totais).
function tabelasDoModelo(modelo) {
  return modelo.blocos.filter((b) => b.tipo === 'tabela').map((b) => ({ titulo: b.titulo || '', colunas: b.colunas.map((c) => c.rotulo), linhas: b.linhas.map((ln) => ln.map((c) => (c && typeof c === 'object' && 'texto' in c) ? c.texto : c)) }));
}

module.exports = { renderizar, textoDoModelo, tabelasDoModelo, COR };
