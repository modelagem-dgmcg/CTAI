'use strict';
// GUARDA DE DOCUMENTOS (parte do servidor). Primeira leitura de TODO documento que chega à SES-PE, antes de mascarar, extrair, guardar ou mandar à IA.
// Procura comando e texto escondido e conteúdo ativo (ver public/js/guarda-comum.js e docs/SEGURANCA-DOCUMENTOS.md).
//   alta  -> BLOQUEIA e põe em quarentena: não segue para IA, gaveta, Histórico ou Redator; fica só o relatório, o hash e um trecho curto.
//   média -> NEUTRALIZA (tira o que estava escondido) e avisa.
//   baixa -> só registra.
// O arquivo original nunca é guardado. A quarentena guarda o RELATÓRIO (o que foi achado e onde), não o documento.
const crypto = require('crypto');
const JSZip = require('jszip');
const G = require('../public/js/guarda-comum');
const { erro } = require('./auth');
const trilha = require('./trilha');

let banco = null;
const agora = () => new Date().toISOString();
function ligar(db) { banco = db; }

const LIMITES = {
  ENTRADAS: 6000, // arquivos dentro de um DOCX/XLSX/ZIP
  TOTAL_DESCOMPACTADO: 900 * 1024 * 1024,
  PARTE: 60 * 1024 * 1024, // uma parte XML maior que isto não é lida por dentro
  RAZAO: 120, // descompactado / compactado
  PAGINAS_PDF: 400,
  TEMPO_PDF_MS: 40000,
};
const TRIVIAIS = new Set(['pdf:links', 'pdf:abrir-acao-simples', 'controle', 'office:propriedades', 'office:comentarios-vazios']);
const TIPOS_PERIGOSOS = /\.(?:exe|dll|js|jse|vbs|vbe|bat|cmd|ps1|hta|lnk|scr|com|msi|jar|wsf|sh|cpl)$/i;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const ext = (nome) => (String(nome || '').split('.').pop() || '').toLowerCase();
const texto = (xml) => G.textoSimples(String(xml || '').replace(/<\/(?:w:p|a:p|row|si)>/g, ' '));
const ent = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch (_e) { return ' '; } }).replace(/&amp;/g, '&');
const A = (g, cod, onde, msg, tr) => G.achado(g, cod, onde, msg, tr);

// ---------- DOCX ----------
const FILL_CLARO = /^(?:auto|ffffff|fefefe|fdfdfd|fcfcfc|fbfbfb|fafafa)$/i;
const COR_BRANCA = /<w:color\b[^>]*w:val="(?:FFFFFF|FEFEFE|FDFDFD|FCFCFC|FBFBFB|FAFAFA)"/i;
function corridaOculta(rpr, naCelulaEscura) {
  if (!rpr) return '';
  if (/<w:vanish\b(?![^>]*w:val="(?:0|false|off)")/i.test(rpr)) return 'texto oculto do Word (w:vanish)';
  const sz = /<w:sz\b[^>]*w:val="(\d+)"/i.exec(rpr);
  if (sz && Number(sz[1]) < 4) return 'fonte menor que 2 pt';
  if (COR_BRANCA.test(rpr)) {
    const fundo = /<w:shd\b[^>]*w:fill="([0-9A-Fa-f]{6}|auto)"/i.exec(rpr);
    const hl = /<w:highlight\b[^>]*w:val="(?!none|white)\w+"/i.test(rpr);
    return (naCelulaEscura || hl || (fundo && !FILL_CLARO.test(fundo[1]))) ? 'LEVE:texto branco sobre fundo escuro (provável cabeçalho)' : 'texto branco';
  }
  return '';
}
// Percorre as células/corridas do document.xml. Devolve o que está escondido e o XML sem isso (usado na extração).
function varrerDocx(xml) {
  const ocultos = []; const apagados = []; let limpo = '';
  const blocos = xml.split(/(<w:tc\b[\s\S]*?<\/w:tc>)/);
  for (const b of blocos) {
    const ehCelula = b.startsWith('<w:tc');
    const fundo = ehCelula ? /<w:tcPr>[\s\S]*?<w:shd\b[^>]*w:fill="([0-9A-Fa-f]{6})"/i.exec(b) : null;
    const celulaEscura = !!(fundo && !FILL_CLARO.test(fundo[1]));
    limpo += b.replace(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g, (corrida, miolo) => {
      const rpr = (/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(miolo) || [])[1] || '';
      const motivo = corridaOculta(rpr, celulaEscura);
      if (!motivo) return corrida;
      const t = ent([...miolo.matchAll(/<w:(?:t|delText)\b[^>]*>([\s\S]*?)<\/w:(?:t|delText)>/g)].map((x) => x[1]).join(''));
      if (motivo.startsWith('LEVE:')) { ocultos.push({ motivo: motivo.slice(5), texto: t, leve: true }); return corrida; }
      if (t.trim()) ocultos.push({ motivo, texto: t, leve: false });
      return '';
    });
  }
  // texto apagado com "controlar alterações" continua dentro do XML
  limpo = limpo.replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, (m) => { const t = ent([...m.matchAll(/<w:delText\b[^>]*>([\s\S]*?)<\/w:delText>/g)].map((x) => x[1]).join('')); if (t.trim()) apagados.push(t); return ''; });
  const campos = [...limpo.matchAll(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/g)].map((m) => ent(m[1])).concat([...limpo.matchAll(/<w:fldSimple\b[^>]*w:instr="([^"]*)"/g)].map((m) => ent(m[1])));
  limpo = limpo.replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, '').replace(/<w:fldSimple\b[^>]*w:instr="[^"]*"/g, '<w:fldSimple');
  return { limpo, ocultos, apagados, campos };
}
// Usado pelo extrator: XML do Word sem texto oculto, apagado e códigos de campo.
const limparDocxXml = (xml) => varrerDocx(String(xml)).limpo;

function julgarCamposDocx(campos, onde) {
  const out = [];
  for (const c of campos) {
    const t = c.trim();
    if (/^\s*(?:DDE|DDEAUTO)\b/i.test(t)) out.push(A(G.ALTA, 'docx:campo-dde', onde, 'O Word tem campo DDE (executa programa ao abrir).', t));
    else if (/^\s*(?:INCLUDETEXT|INCLUDEPICTURE|LINK|IMPORT|AUTOTEXT|DATABASE|MACROBUTTON|RUN|GOTOBUTTON)\b/i.test(t) && /(?:https?:|\\\\|file:|\.\w{2,4}\b)/i.test(t)) out.push(A(/MACROBUTTON|RUN|DATABASE/i.test(t) ? G.ALTA : G.MEDIA, 'docx:campo-externo', onde, 'O Word tem campo que busca ou executa algo de fora.', t));
  }
  return out;
}

// ---------- propriedades, relações, comentários (comuns a DOCX/XLSX/PPTX) ----------
function julgarRelacoes(nome, xml, onde) {
  const out = [];
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const a = m[1];
    if (!/TargetMode\s*=\s*"External"/i.test(a)) continue;
    const alvo = ent((/Target\s*=\s*"([^"]*)"/i.exec(a) || [])[1] || '');
    const tipo = ((/Type\s*=\s*"([^"]*)"/i.exec(a) || [])[1] || '').split('/').pop();
    const perigoso = /^(?:javascript|vbscript|file|data|ms-\w+|ftp|\\\\)/i.test(alvo) || /^\\\\/.test(alvo) || /^\w+:\\/.test(alvo);
    if (/^(?:oleObject|attachedTemplate|frame|subDocument|externalLinkPath|package|macro|vbaProject|control)$/i.test(tipo)) out.push(A(G.ALTA, 'office:relacao-externa', onde, 'Relação externa perigosa (' + tipo + ') em ' + nome + '.', alvo));
    else if (tipo === 'hyperlink') out.push(A(perigoso || /^http:\/\/(?:\d{1,3}\.){3}\d{1,3}/i.test(alvo) || alvo.length > 300 ? G.MEDIA : G.BAIXA, perigoso ? 'office:link-suspeito' : 'office:link-externo', onde, perigoso ? 'Link suspeito dentro do documento.' : 'Link para endereço externo.', alvo));
    else out.push(A(G.MEDIA, 'office:relacao-externa', onde, 'Relação externa (' + (tipo || 'sem tipo') + ') em ' + nome + ': o arquivo busca conteúdo de fora.', alvo));
  }
  return out;
}
function julgarPropriedades(partes, onde) {
  const out = [];
  for (const [nome, xml] of partes) {
    const valores = [...xml.matchAll(/<(?:dc:|cp:|dcterms:|vt:|ap:)?(?:description|subject|keywords|title|lpwstr|lpstr|Company|Manager|Comments)\b[^>]*>([\s\S]*?)<\//g)].map((m) => ent(m[1]).trim()).filter(Boolean);
    const todos = valores.join('\n');
    if (!todos) continue;
    const frases = G.acharFrases(todos, { onde: nome, planilha: false }).filter((f) => f.g === G.ALTA || f.g === G.MEDIA);
    if (frases.length) out.push(A(G.ALTA, 'office:propriedade-com-comando', nome, 'Propriedade do arquivo (' + nome + ') com comando: ' + frases[0].msg.replace(/\.$/, '') + '.', todos));
    else if (/custom\.xml$/.test(nome) && valores.some((v) => v.length > 120)) out.push(A(G.MEDIA, 'office:propriedade-longa', nome, 'Propriedade personalizada com texto longo (' + Math.max(...valores.map((v) => v.length)) + ' caracteres).', todos));
    else out.push(A(G.BAIXA, 'office:propriedades', nome, 'Propriedades do arquivo preenchidas.', ''));
  }
  return out;
}

async function lerParte(z, nome) {
  const f = z.file(nome); if (!f) return '';
  const tam = f._data && f._data.uncompressedSize;
  if (tam && tam > LIMITES.PARTE) return null;
  return f.async('string');
}

// ---------- ZIP / Office ----------
async function examinarOffice(extensao, buf, onde) {
  const out = []; const info = {};
  let z;
  try { z = await JSZip.loadAsync(buf); } catch (_) { return { achados: [A(G.BAIXA, 'office:ilegivel', onde, 'Não consegui abrir como pacote Office/ZIP (o extrator vai recusar).', '')], info }; }
  const nomes = Object.keys(z.files);
  if (nomes.length > LIMITES.ENTRADAS) out.push(A(G.ALTA, 'zip:muitas-entradas', onde, 'O arquivo tem ' + nomes.length + ' partes dentro (limite ' + LIMITES.ENTRADAS + '): possível bomba de compressão.', ''));
  let total = 0; let pior = 0;
  for (const n of nomes) {
    const d = z.files[n] && z.files[n]._data; if (!d) continue;
    const u = Number(d.uncompressedSize) || 0; const c = Number(d.compressedSize) || 0;
    total += u; if (u > 5 * 1024 * 1024 && c > 0) pior = Math.max(pior, u / c);
    if (G.nomeDeArquivoPerigoso(n)) out.push(A(G.ALTA, 'zip:nome-perigoso', onde, 'Nome de parte com caminho perigoso ("..", pasta raiz).', n));
  }
  if (total > LIMITES.TOTAL_DESCOMPACTADO) out.push(A(G.ALTA, 'zip:bomba', onde, 'O arquivo descompactado passaria de ' + Math.round(LIMITES.TOTAL_DESCOMPACTADO / 1048576) + ' MB: possível bomba de compressão.', ''));
  else if (pior > LIMITES.RAZAO) out.push(A(G.ALTA, 'zip:bomba', onde, 'Taxa de compressão anormal (' + Math.round(pior) + ' vezes): possível bomba de compressão.', ''));
  // ZIP comum (pacote do SEI): só a estrutura importa aqui; cada arquivo de dentro passa pela guarda quando for lido.
  if (extensao === 'zip') return { achados: out, info };
  // partes que não deveriam existir em relatório
  for (const n of nomes) {
    if (/(?:^|\/)vbaProject\.bin$|(?:^|\/)vbaData\.xml$|(?:^|\/)macrosheets\//i.test(n)) out.push(A(G.ALTA, 'office:macro', onde, 'O arquivo tem macro (VBA).', n));
    else if (/(?:^|\/)activeX\//i.test(n)) out.push(A(G.ALTA, 'office:activex', onde, 'O arquivo tem controle ActiveX.', n));
    else if (/(?:^|\/)embeddings\/|oleObject\d*\.bin$/i.test(n)) out.push(A(G.ALTA, 'office:objeto-embutido', onde, 'O arquivo carrega objeto embutido (OLE).', n));
    else if (TIPOS_PERIGOSOS.test(n)) out.push(A(G.ALTA, 'office:executavel', onde, 'O arquivo carrega um arquivo executável/script.', n));
    else if (/(?:^|\/)customUI\//i.test(n)) out.push(A(G.MEDIA, 'office:menu-personalizado', onde, 'O arquivo muda a faixa de opções do Office (customUI).', n));
    else if (/\.(?:docm|xlsm|pptm|zip|rar|7z|gz)$/i.test(n)) out.push(A(G.ALTA, 'office:arquivo-dentro', onde, 'Arquivo compactado ou com macro dentro do documento.', n));
  }
  const ct = await lerParte(z, '[Content_Types].xml');
  if (ct && /macroEnabled|vbaProject/i.test(ct)) out.push(A(G.ALTA, 'office:macro', onde, 'O tipo do arquivo declara macros.', 'macroEnabled'));
  // relações externas
  for (const n of nomes.filter((x) => /\.rels$/.test(x))) { const x = await lerParte(z, n); if (x) out.push(...julgarRelacoes(n, x, onde)); }
  // propriedades
  const props = []; for (const n of nomes.filter((x) => /^docProps\/(?:core|app|custom)\.xml$/.test(x) || /^customXml\/item\d*\.xml$/.test(x))) { const x = await lerParte(z, n); if (x) props.push([n, x]); }
  out.push(...julgarPropriedades(props, onde));

  const julgarTextoDe = async (re, rotulo, codigo) => {
    for (const n of nomes.filter((x) => re.test(x))) {
      const x = await lerParte(z, n); if (x === null) { out.push(A(G.MEDIA, 'zip:parte-grande', onde, 'Parte muito grande (' + n + ') não foi examinada por dentro.', n)); continue; }
      const t = texto(x).trim(); if (!t) continue;
      const f = G.acharFrases(t, { onde: n, planilha: false }).concat(G.acharInvisiveis(t, { onde: n }).filter((y) => y.g === G.ALTA)).filter((y) => y.g === G.ALTA || y.g === G.MEDIA);
      if (f.length) out.push(A(G.ALTA, codigo + '-com-comando', n, rotulo + ' com comando: ' + f[0].msg.replace(/\.$/, '') + '.', t));
      else out.push(A(G.BAIXA, codigo, n, rotulo + ' presente (não entra no texto lido).', ''));
    }
  };
  await julgarTextoDe(/(?:^|\/)(?:comments\d*|threadedComments\/threadedComment\d*|commentAuthors|comments\/comment\d*)\.xml$/, 'Comentários do documento', 'office:comentarios');
  await julgarTextoDe(/^ppt\/notesSlides\/.*\.xml$/, 'Notas do apresentador', 'office:notas');
  await julgarTextoDe(/^word\/(?:footnotes|endnotes)\.xml$/, 'Notas de rodapé', 'office:notas-rodape');

  if (extensao === 'docx') {
    const doc = await lerParte(z, 'word/document.xml');
    if (doc === null) out.push(A(G.MEDIA, 'zip:parte-grande', onde, 'word/document.xml é grande demais para examinar por dentro.', ''));
    else if (doc) {
      const v = varrerDocx(doc);
      for (const o of v.ocultos) out.push(...G.julgarOculto(o.texto, 'word/document.xml', o.motivo, { leve: o.leve }));
      if (v.apagados.length) out.push(...G.julgarOculto(v.apagados.join(' '), 'word/document.xml', 'texto apagado com alterações controladas (ainda dentro do arquivo)', { leve: true }).map((x) => (x.g === G.ALTA ? x : Object.assign({}, x, { g: G.BAIXA }))));
      out.push(...julgarCamposDocx(v.campos, 'word/document.xml'));
      for (const m of doc.matchAll(/<(?:wp:docPr|pic:cNvPr|wps:cNvPr)\b[^>]*\b(?:descr|title)="([^"]{30,})"/g)) {
        const t = ent(m[1]); const f = G.acharFrases(t, { onde: 'texto alternativo', planilha: false }).filter((y) => y.g === G.ALTA || y.g === G.MEDIA);
        if (f.length) { out.push(A(G.ALTA, 'docx:alt-com-comando', 'texto alternativo de imagem', 'Texto alternativo de imagem com comando: ' + f[0].msg.replace(/\.$/, '') + '.', t)); break; }
      }
    }
    for (const n of nomes.filter((x) => /^word\/(?:header|footer)\d*\.xml$/.test(x))) {
      const x = await lerParte(z, n); if (!x) continue;
      const v = varrerDocx(x); for (const o of v.ocultos) out.push(...G.julgarOculto(o.texto, n, o.motivo, { leve: o.leve }));
    }
  }
  if (extensao === 'xlsx') {
    const wb = await lerParte(z, 'xl/workbook.xml'); const rels = await lerParte(z, 'xl/_rels/workbook.xml.rels');
    const alvos = {}; for (const m of String(rels || '').matchAll(/<Relationship\b([^>]*)\/?>/g)) { const id = (/\bId="([^"]*)"/.exec(m[1]) || [])[1]; const tg = (/Target="([^"]*)"/.exec(m[1]) || [])[1]; if (id && tg) alvos[id] = tg.startsWith('/') ? tg.slice(1) : 'xl/' + tg; }
    const ocultas = new Set();
    for (const m of String(wb || '').matchAll(/<sheet\b([^>]*)\/?>/g)) {
      const estado = (/\bstate="([^"]*)"/.exec(m[1]) || [])[1]; const rid = (/r:id="([^"]*)"/.exec(m[1]) || [])[1]; const nm = ent((/\bname="([^"]*)"/.exec(m[1]) || [])[1] || '');
      if (estado === 'hidden' || estado === 'veryHidden') { if (alvos[rid]) ocultas.add(alvos[rid]); info.planilhasOcultas = (info.planilhasOcultas || []).concat(nm); }
    }
    info.pastasOcultas = ocultas;
    const comp = []; const ss = await lerParte(z, 'xl/sharedStrings.xml');
    if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) comp.push(ent([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
    const colunaIdx = (ref) => { const l = /^([A-Z]+)/.exec(ref || ''); if (!l) return 0; let n = 0; for (const c of l[1]) n = n * 26 + (c.charCodeAt(0) - 64); return n; };
    const folhas = nomes.filter((x) => /^xl\/worksheets\/sheet\d+\.xml$/.test(x)).sort();
    let formulasFora = 0;
    for (const n of folhas) {
      const x = await lerParte(z, n); if (x === null) { out.push(A(G.MEDIA, 'zip:parte-grande', onde, 'Planilha muito grande (' + n + ') não foi examinada por dentro.', n)); continue; }
      const planilhaOculta = ocultas.has(n); const ocultoTxt = [];
      const colsOcultas = []; for (const c of x.matchAll(/<col\b([^>]*)\/?>/g)) if (/\bhidden="(?:1|true)"/.test(c[1])) { const mn = Number((/\bmin="(\d+)"/.exec(c[1]) || [])[1]); const mx = Number((/\bmax="(\d+)"/.exec(c[1]) || [])[1]); if (mn && mx) colsOcultas.push([mn, Math.min(mx, mn + 200)]); }
      const celulaTexto = (c) => { const tipo = /\bt="(\w+)"/.exec(c[1]); const v = c[2] ? /<v>([\s\S]*?)<\/v>/.exec(c[2]) : null; const is = c[2] ? /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(c[2]) : null; if (tipo && tipo[1] === 's' && v) return comp[Number(v[1])] || ''; return is ? ent(is[1]) : (v ? ent(v[1]) : ''); };
      for (const r of x.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
        const linhaOculta = /\bhidden="(?:1|true)"/.test(r[1]);
        for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const ref = (/\br="([A-Z]+\d+)"/.exec(c[1]) || [])[1]; const col = colunaIdx(ref);
          const emColOculta = colsOcultas.some(([a, b]) => col >= a && col <= b);
          if (linhaOculta || emColOculta || planilhaOculta) { const t = celulaTexto(c); if (t && String(t).trim() && !/^[-+\d.,%\s]+$/.test(t)) ocultoTxt.push(t); }
          const f = c[2] ? /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(c[2]) : null;
          if (f && formulasFora < 5) {
            const ft = ent(f[1]);
            if (/\b(?:DDE|DDEAUTO|WEBSERVICE|IMPORTDATA|IMPORTXML|IMPORTHTML|IMPORTRANGE|IMPORTFEED|CALL|REGISTER|REGISTER\.ID|EXEC|SHELL)\s*\(|cmd\s*\||msexcel\s*\||\|\s*['"]/i.test(ft) || /^\s*_xlfn\.WEBSERVICE/i.test(ft)) { out.push(A(G.ALTA, 'xlsx:formula-perigosa', n + (ref ? '!' + ref : ''), 'Fórmula que executa comando ou busca dado de fora.', '=' + ft)); formulasFora++; }
            else if (/\bHYPERLINK\s*\(/i.test(ft)) { out.push(A(G.MEDIA, 'xlsx:formula-hyperlink', n + (ref ? '!' + ref : ''), 'Fórmula HYPERLINK (link clicável calculado).', '=' + ft)); formulasFora++; }
          }
          const t2 = c[2] ? celulaTexto(c) : '';
          if (typeof t2 === 'string' && t2.length > 2000) out.push(A(G.MEDIA, 'xlsx:celula-longa', n + (ref ? '!' + ref : ''), 'Célula com texto muito longo (' + t2.length + ' caracteres).', t2));
        }
      }
      if (planilhaOculta) out.push(...G.julgarOculto(ocultoTxt.join(' | '), n, 'planilha oculta', { leve: false }).map((y) => (y.g === G.BAIXA ? Object.assign({}, y, { g: G.MEDIA }) : y)));
      else if (ocultoTxt.length) out.push(...G.julgarOculto(ocultoTxt.join(' | '), n, 'linhas/colunas ocultas', { leve: true }).map((y) => (y.g === G.ALTA ? y : Object.assign({}, y, { g: G.BAIXA }))));
    }
    for (const n of nomes.filter((x) => /^xl\/drawings\/.*\.xml$/.test(x))) {
      const x = await lerParte(z, n); if (!x) continue;
      for (const m of x.matchAll(/<xdr:cNvPr\b[^>]*\b(?:descr|title)="([^"]{30,})"/g)) { const f = G.acharFrases(ent(m[1]), { planilha: false }).filter((y) => y.g === G.ALTA || y.g === G.MEDIA); if (f.length) { out.push(A(G.ALTA, 'xlsx:alt-com-comando', n, 'Texto alternativo de figura com comando.', ent(m[1]))); break; } }
    }
  }
  if (extensao === 'pptx') {
    for (const n of nomes.filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x))) {
      const x = await lerParte(z, n); if (!x) continue;
      if (/<p:sld\b[^>]*\bshow="0"/.test(x)) out.push(...G.julgarOculto(texto(x), n, 'slide oculto', { leve: false }));
      for (const m of x.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
        const rpr = /<a:rPr\b([^>]*)>([\s\S]*?)<\/a:rPr>|<a:rPr\b([^>]*)\/>/.exec(m[1]); if (!rpr) continue;
        const sz = /\bsz="(\d+)"/.exec(rpr[1] || rpr[3] || ''); const branco = /<a:srgbClr\s+val="(?:FFFFFF|FEFEFE)"/i.test(rpr[2] || '');
        const t = ent((/<a:t>([\s\S]*?)<\/a:t>/.exec(m[1]) || [])[1] || '');
        if (t.trim() && ((sz && Number(sz[1]) < 200) || branco)) out.push(...G.julgarOculto(t, n, sz && Number(sz[1]) < 200 ? 'fonte menor que 2 pt' : 'texto branco', { leve: branco && !(sz && Number(sz[1]) < 200) }));
      }
    }
  }
  return { achados: out, info };
}

// ---------- PDF por dentro (PDF.js do unpdf) ----------
async function examinarPdfPorDentro(buf, onde) {
  const out = [];
  let doc = null;
  try {
    const { getDocumentProxy, getResolvedPDFJS } = await import('unpdf');
    const pdfjs = await getResolvedPDFJS(); const OPS = pdfjs.OPS;
    doc = await getDocumentProxy(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    const prazo = Date.now() + LIMITES.TEMPO_PDF_MS;
    try { const anexos = doc.getAttachments ? await doc.getAttachments() : null; if (anexos && Object.keys(anexos).length) out.push(A(G.ALTA, 'pdf:anexo-embutido', onde, 'O PDF carrega ' + Object.keys(anexos).length + ' arquivo(s) dentro dele.', Object.keys(anexos).join(', '))); } catch (_) { /* sem anexos */ }
    try { const js = doc.getJSActions ? await doc.getJSActions() : null; if (js && Object.keys(js).length) out.push(A(G.ALTA, 'pdf:javascript', onde, 'O PDF tem JavaScript.', Object.keys(js).join(', '))); } catch (_) { /* sem js */ }
    try {
      const cfg = doc.getOptionalContentConfig ? await doc.getOptionalContentConfig() : null; let off = 0;
      if (cfg && typeof cfg[Symbol.iterator] === 'function') for (const par of cfg) { const g = Array.isArray(par) ? par[1] : par; if (g && g.visible === false) off++; }
      if (off) out.push(A(G.MEDIA, 'pdf:camada-oculta', onde, 'O PDF tem ' + off + ' camada(s) desligada(s): pode haver conteúdo que ninguém vê.', ''));
    } catch (_) { /* sem camadas */ }
    try {
      const meta = await doc.getMetadata(); const info = (meta && meta.info) || {};
      const campos = ['Title', 'Subject', 'Keywords', 'Author', 'Creator', 'Producer'].map((k) => String(info[k] || '')).concat(Object.values(info.Custom || {}).map(String)).join('\n') + '\n' + String((meta && meta.metadata && meta.metadata.getRaw && meta.metadata.getRaw()) || '').replace(/<[^>]+>/g, ' ');
      const f = G.acharFrases(campos.slice(0, 20000), { onde: 'metadados', planilha: false }).filter((y) => y.g === G.ALTA || y.g === G.MEDIA);
      if (f.length) out.push(A(G.ALTA, 'pdf:metadado-com-comando', 'metadados', 'Metadados do PDF com comando: ' + f[0].msg.replace(/\.$/, '') + '.', campos));
    } catch (_) { /* sem metadados */ }
    const total = Math.min(doc.numPages, LIMITES.PAGINAS_PDF); let parou = false;
    for (let n = 1; n <= total; n++) {
      if (Date.now() > prazo) { parou = true; break; }
      const pag = await doc.getPage(n);
      try {
        const ops = await pag.getOperatorList();
        const ocultos = G.varrerOperadores(OPS, ops, { view: pag.view });
        let fora = '';
        try { const c = await pag.getTextContent(); fora = G.textoForaDaPagina(c.items, pag.view); } catch (_) { /* sem texto */ }
        out.push(...G.julgarPaginaPdf(n, ocultos, fora));
        try { out.push(...G.julgarAnotacoes(n, await pag.getAnnotations())); } catch (_) { /* sem anotações */ }
      } finally { try { pag.cleanup(); } catch (_) { /* já liberada */ } }
      if (out.filter((x) => x.g === G.ALTA).length >= 3) break;
    }
    if (parou || doc.numPages > LIMITES.PAGINAS_PDF) out.push(A(G.BAIXA, 'pdf:parcial', onde, 'O PDF é grande: só as primeiras ' + total + ' páginas foram examinadas por dentro.', ''));
  } catch (e) {
    out.push(A(G.BAIXA, 'pdf:interno-nao-verificado', onde, 'Não consegui examinar o PDF por dentro (' + String((e && e.message) || e).slice(0, 80) + '); a checagem dos bytes foi feita.', ''));
  } finally { try { if (doc) await doc.destroy(); } catch (_) { /* já liberado */ } }
  return out;
}

// ---------- ponto de entrada: bytes ----------
function decodificarHtml(buf) {
  const cab = buf.subarray(0, 4000).toString('latin1');
  const cs = ((/charset\s*=\s*["']?([\w-]+)/i.exec(cab) || [])[1] || 'utf-8').toLowerCase();
  try { return new TextDecoder(cs).decode(buf); } catch (_) { return buf.toString('utf8'); }
}
// Examina o arquivo pelos bytes (primeira coisa que acontece com ele). Devolve { hash, achados, info } — "info" leva o que o extrator precisa para NEUTRALIZAR.
async function examinarArquivo(nome, buf) {
  const e = ext(nome); const onde = String(nome || '').slice(0, 120);
  const out = { hash: sha256(buf), achados: [], info: {} };
  if (G.nomeDeArquivoPerigoso(nome)) out.achados.push(A(G.ALTA, 'zip:nome-perigoso', onde, 'O nome do arquivo tem caminho perigoso ("..", pasta raiz).', nome));
  if (e === 'pdf') {
    if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') {
      out.achados.push(...G.examinarPdfBytes(buf.toString('latin1'), { onde }));
      out.achados.push(...await examinarPdfPorDentro(buf, onde));
    }
  } else if (e === 'docx' || e === 'xlsx' || e === 'pptx') {
    const r = await examinarOffice(e, buf, onde); out.achados.push(...r.achados); out.info = r.info;
  } else if (e === 'html' || e === 'htm') {
    const bruto = decodificarHtml(buf); const r = G.examinarHtml(bruto, { onde }); out.achados.push(...r.achados); out.info.htmlLimpo = r.html;
  } else if (e === 'zip') {
    const r = await examinarOffice('zip', buf, onde); out.achados.push(...r.achados);
  }
  return out;
}

// ---------- decisão, quarentena e registro ----------
function mascararExcerto(t) { try { return require('./mascara').mascarar(String(t || '')).texto; } catch (_) { return String(t || ''); } }
function sanitizarAchados(lista) {
  return (lista || []).slice(0, G.MAX_ACHADOS).map((a) => ({ g: [G.ALTA, G.MEDIA, G.BAIXA].includes(a.g) ? a.g : G.BAIXA, codigo: String(a.codigo || '').slice(0, 60), onde: String(a.onde || '').slice(0, 120), msg: String(a.msg || '').slice(0, 240), trecho: mascararExcerto(G.excerto(a.trecho || '', 140)).slice(0, 160) }));
}
// Achados que o NAVEGADOR relatou (ele leu o PDF/HTML na máquina da analista): o servidor só aceita para ESCALAR (nunca para liberar).
function achadosDoNavegador(g) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.achados)) return [];
  return sanitizarAchados(g.achados.map((a) => ({ g: a && a.g, codigo: a && 'nav:' + String(a.codigo || '').replace(/^nav:/, ''), onde: a && a.onde, msg: a && a.msg, trecho: a && a.trecho })).filter((a) => a.g));
}

function liberacao(hash) {
  if (!banco || !hash) return null;
  try { return banco.get("SELECT * FROM guarda_ocorrencias WHERE hash = ? AND liberado_por IS NOT NULL ORDER BY id DESC LIMIT 1", hash) || null; } catch (_) { return null; }
}
function registrar(r) {
  if (!banco) return null;
  try {
    const achados = sanitizarAchados(r.achados);
    if (!achados.length) return null;
    if (r.decisao === 'registrado' && achados.every((a) => TRIVIAIS.has(a.codigo))) return null;
    const rep = banco.get("SELECT id FROM guarda_ocorrencias WHERE hash = ? AND decisao = ? AND usuario = ? AND criado_em > ? LIMIT 1", r.hash, r.decisao, r.usuario || '', new Date(Date.now() - 6 * 3600 * 1000).toISOString());
    if (rep) return rep.id;
    const resumo = achados.slice().sort((a, b) => G.PESO[b.g] - G.PESO[a.g])[0];
    const ins = banco.run('INSERT INTO guarda_ocorrencias (criado_em, usuario, origem, nome, hash, tamanho, gravidade, decisao, resumo, achados, fila_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      agora(), r.usuario || null, r.origem || null, String(r.nome || '').slice(0, 200), r.hash || null, r.tamanho || null, r.gravidade, r.decisao, resumo.msg.slice(0, 200), JSON.stringify(achados), r.filaId || null);
    const id = Number(ins.lastInsertRowid);
    if (r.decisao !== 'registrado') trilha.registrar(banco, { usuario: r.usuario || 'sistema', tabela: 'guarda_documentos', registro: String(id), campo: r.decisao, valor_novo: { arquivo: String(r.nome || '').slice(0, 120), origem: r.origem || null, gravidade: r.gravidade, achados: achados.length, resumo: resumo.msg.slice(0, 120) }, motivo: 'Guarda de documentos' });
    return id;
  } catch (e) { try { console.error('[guarda] não consegui registrar:', e && e.message); } catch (_) { /* sem console */ } return null; }
}

function mensagemBloqueio(achados) {
  const altos = achados.filter((a) => a.g === G.ALTA);
  const tipos = [...new Set(altos.map((a) => G.rotuloCodigo(a.codigo)))].slice(0, 3).join('; ');
  return 'Bloqueado por segurança: o arquivo tem ' + (tipos || 'conteúdo suspeito') + '. ' + G.oQueFazer(G.ALTA);
}
// Decide e age. Lança erro(422) com .bloqueio quando bloqueia (e ninguém liberou este arquivo). Devolve { acao, gravidade, achados, id, liberado }.
function concluir(achadosBrutos, ctx) {
  const achados = sanitizarAchados(achadosBrutos);
  const d = G.decidir(achados);
  const base = { nome: ctx.nome, hash: ctx.hash, tamanho: ctx.tamanho, usuario: ctx.usuario, origem: ctx.origem, filaId: ctx.filaId, achados, gravidade: d.gravidade };
  if (d.acao === 'bloquear') {
    const lib = liberacao(ctx.hash);
    if (lib) { registrar(Object.assign({}, base, { decisao: 'neutralizado' })); return { acao: 'neutralizar', gravidade: G.ALTA, achados, id: lib.id, liberado: true }; }
    const id = registrar(Object.assign({}, base, { decisao: 'bloqueado' }));
    const e = erro(422, mensagemBloqueio(achados));
    e.bloqueio = resumoPublico({ id, nome: ctx.nome, gravidade: G.ALTA, achados });
    throw e;
  }
  if (d.acao === 'neutralizar') { const id = registrar(Object.assign({}, base, { decisao: 'neutralizado' })); return { acao: 'neutralizar', gravidade: G.MEDIA, achados, id }; }
  if (d.acao === 'registrar') { const id = registrar(Object.assign({}, base, { decisao: 'registrado' })); return { acao: 'registrar', gravidade: G.BAIXA, achados, id }; }
  return { acao: 'seguir', gravidade: 'limpa', achados, id: null };
}
// O que a tela mostra (sem o texto do documento além do trecho curto e escapado).
function resumoPublico(o) {
  const achados = (o.achados || []).filter((a) => a.g === G.ALTA).slice(0, 6);
  return {
    id: o.id || null, arquivo: o.nome || '', gravidade: o.gravidade,
    oQue: [...new Set(achados.map((a) => G.rotuloCodigo(a.codigo)))],
    onde: achados.map((a) => a.onde).filter(Boolean).slice(0, 4),
    porque: 'Documentos com comando ou conteúdo escondido podem tentar fazer o sistema (ou a IA) obedecer ordens que não vieram da SES-PE, por exemplo aprovar um relatório sem conferir ou revelar dados.',
    oQueFazer: G.oQueFazer(G.ALTA),
    achados: achados.map((a) => ({ onde: a.onde, msg: a.msg, trecho: a.trecho })),
  };
}

// Fluxo completo para um ARQUIVO (bytes): exame dos bytes -> o extrator lê usando "info" -> exame do texto. Chamado por server/extrair-texto.js.
async function antes(nome, buf, ctx) {
  const r = await examinarArquivo(nome, buf);
  return { hash: r.hash, achados: r.achados, info: r.info, ctx: Object.assign({}, ctx, { nome: String(nome || ''), hash: r.hash, tamanho: buf.length }) };
}
// Depois de extrair o texto: junta os achados, decide e devolve o texto neutralizado.
function depois(estado, textoExtraido, opc) {
  opc = opc || {};
  const e = ext(estado.ctx.nome);
  const planilha = e === 'csv' || e === 'xlsx' || e === 'txt';
  const t = G.examinarTexto(textoExtraido, { onde: 'texto lido', planilha });
  const todos = estado.achados.concat(t.achados, achadosDoNavegador(opc.navegador));
  const r = concluir(todos, estado.ctx);
  return { texto: r.liberado ? G.removerComandos(t.neutro).texto : t.neutro, resultado: r };
}
// Texto que já chegou como texto (colado, lido no navegador): mesmo exame, sem bytes.
function examinarTextoRecebido(nome, textoRecebido, ctx, navegador) {
  const hash = sha256(Buffer.from(String(textoRecebido), 'utf8'));
  const e = ext(nome);
  const t = G.examinarTexto(textoRecebido, { onde: 'texto recebido', planilha: e === 'csv' || e === 'xlsx' || e === 'txt' || !e });
  const r = concluir(t.achados.concat(achadosDoNavegador(navegador)), Object.assign({}, ctx, { nome: String(nome || ''), hash, tamanho: Buffer.byteLength(String(textoRecebido)) }));
  return { texto: r.liberado ? G.removerComandos(t.neutro).texto : t.neutro, resultado: r, hash };
}
// Texto digitado/colado em campos livres: bloqueia comando explícito, neutraliza o resto. Devolve o texto limpo.
function protegerTexto(textoLivre, ctx) {
  const r = examinarTextoRecebido(ctx && ctx.nome ? ctx.nome : 'texto colado', textoLivre, ctx || {}, null);
  return r.texto;
}

// Anexo guardado como está (mensagens da equipe, material do "Ensinar"): exame rápido e SÍNCRONO só pelos bytes. Alta = recusa o anexo.
function examinarAnexo(nome, buf, ctx) {
  const e = ext(nome); const onde = String(nome || '').slice(0, 120); const ach = [];
  if (G.nomeDeArquivoPerigoso(nome)) ach.push(A(G.ALTA, 'zip:nome-perigoso', onde, 'O nome do arquivo tem caminho perigoso.', nome));
  if (e === 'pdf') ach.push(...G.examinarPdfBytes(buf.toString('latin1'), { onde }));
  else if (e === 'html' || e === 'htm') ach.push(...G.examinarHtml(decodificarHtml(buf), { onde }).achados);
  else if (e === 'docx' || e === 'xlsx' || e === 'pptx' || e === 'zip') {
    const cab = buf.toString('latin1');
    const m = /vbaProject\.bin|vbaData\.xml|activeX\/|embeddings\/|oleObject\d*\.bin|macrosheets\//i.exec(cab);
    if (m) ach.push(A(G.ALTA, 'office:macro', onde, 'O arquivo tem macro, ActiveX ou objeto embutido.', m[0]));
    if (/macroEnabled/i.test(cab.slice(0, 200000))) ach.push(A(G.ALTA, 'office:macro', onde, 'O tipo do arquivo declara macros.', 'macroEnabled'));
  } else if (e === 'txt' || e === 'csv') ach.push(...G.examinarTexto(buf.toString('utf8').slice(0, 2000000), { onde, planilha: true }).achados);
  concluir(ach, { nome, hash: sha256(buf), tamanho: buf.length, usuario: ctx && ctx.usuario, origem: ctx && ctx.origem });
}

// O navegador examinou algo antes de enviar (ZIP com estrutura suspeita, por exemplo) e conta aqui, para constar no registro da superintendência.
function relatoDoNavegador(usuario, b) {
  b = b || {};
  const achados = achadosDoNavegador({ achados: Array.isArray(b.achados) ? b.achados : [] });
  if (!achados.length) throw erro(400, 'Relato vazio.');
  const hash = /^[0-9a-f]{64}$/.test(String(b.hash || '')) ? String(b.hash) : null;
  const d = G.decidir(achados);
  const id = registrar({ nome: String(b.nome || 'arquivo').slice(0, 200), hash, tamanho: Math.max(0, Number(b.tamanho) || 0) || null, usuario: usuario.login, origem: 'navegador', achados, gravidade: d.gravidade, decisao: d.acao === 'bloquear' ? 'bloqueado' : (d.acao === 'neutralizar' ? 'neutralizado' : 'registrado') });
  return { ok: true, id, bloqueado: d.acao === 'bloquear' };
}

// ---------- liberação (superintendência/administração) ----------
function liberar(db, usuario, id, motivo) {
  if (!['admin', 'superintendente'].includes(usuario.perfil)) throw erro(403, 'Só a superintendência ou a administração libera um arquivo bloqueado.');
  const m = String(motivo || '').trim();
  if (m.length < 10) throw erro(400, 'Explique em uma frase por que é seguro liberar (mínimo 10 letras).');
  const o = db.get('SELECT * FROM guarda_ocorrencias WHERE id = ?', Number(id));
  if (!o) throw erro(404, 'Ocorrência não encontrada.');
  if (o.decisao !== 'bloqueado') throw erro(409, 'Esta ocorrência não está bloqueada.');
  if (o.liberado_por) throw erro(409, 'Esta ocorrência já foi liberada.');
  db.run('UPDATE guarda_ocorrencias SET liberado_por = ?, liberado_em = ?, liberado_motivo = ? WHERE id = ?', usuario.login, agora(), m.slice(0, 300), o.id);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'guarda_documentos', registro: String(o.id), campo: 'liberado', valor_anterior: 'bloqueado', valor_novo: { arquivo: o.nome, hash: String(o.hash || '').slice(0, 12) }, motivo: m.slice(0, 300) });
  return { ok: true, id: o.id, aviso: 'Liberado. Envie o arquivo de novo: o sistema vai ler apenas o texto neutralizado (sem o que estava escondido).' };
}
function ocorrencias(db, limite) {
  const lista = db.all('SELECT * FROM guarda_ocorrencias ORDER BY id DESC LIMIT ?', Math.min(200, Number(limite) || 30)).map((o) => ({
    id: o.id, quando: o.criado_em, usuario: o.usuario, origem: o.origem, arquivo: o.nome, gravidade: o.gravidade, decisao: o.decisao, resumo: o.resumo,
    achados: safeJson(o.achados).filter((a) => a.g !== G.BAIXA).slice(0, 8), liberadoPor: o.liberado_por || null, liberadoEm: o.liberado_em || null, liberadoMotivo: o.liberado_motivo || null,
  }));
  const desde = new Date(Date.now() - 30 * 86400000).toISOString();
  const cont = (d) => (db.get('SELECT COUNT(*) n FROM guarda_ocorrencias WHERE decisao = ? AND criado_em > ?', d, desde) || { n: 0 }).n;
  return { bloqueados30d: cont('bloqueado'), neutralizados30d: cont('neutralizado'), aguardando: (db.get("SELECT COUNT(*) n FROM guarda_ocorrencias WHERE decisao = 'bloqueado' AND liberado_por IS NULL AND criado_em > ?", desde) || { n: 0 }).n, lista };
}
function safeJson(s) { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
function detalhe(db, id) {
  const o = db.get('SELECT * FROM guarda_ocorrencias WHERE id = ?', Number(id));
  if (!o) throw erro(404, 'Ocorrência não encontrada.');
  return { id: o.id, quando: o.criado_em, usuario: o.usuario, origem: o.origem, arquivo: o.nome, gravidade: o.gravidade, decisao: o.decisao, hash: o.hash, achados: safeJson(o.achados), liberadoPor: o.liberado_por, liberadoEm: o.liberado_em, liberadoMotivo: o.liberado_motivo };
}

module.exports = {
  ligar, examinarArquivo, examinarAnexo, relatoDoNavegador, antes, depois, examinarTextoRecebido, protegerTexto, concluir, resumoPublico, liberar, ocorrencias, detalhe, limparDocxXml, varrerDocx, sha256, sanitizarAchados, achadosDoNavegador, mensagemBloqueio, LIMITES,
};
