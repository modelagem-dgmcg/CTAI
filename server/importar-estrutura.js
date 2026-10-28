'use strict';
// Importar Arquivos, parte pura (não lê banco): lê o texto de um relatório/parecer do trimestre anterior e extrai a ESTRUTURA
// (seções, quadros/tabelas, indicadores e as FONTES/ANEXOS citados); propõe a lista de conferência da unidade; casa um arquivo recebido
// com um item da lista (por padrão de nome + conteúdo). Regra determinística primeiro; a IA (modules/analista/propor-lista.js) só refina.
const C = require('./catalogo');

const sem = C.sem;
// unidade = chega pelo SEI (upload); pedida_setor = a CTAI pede a outro setor (despacho, informação financeira); processo_parecer = fica no próprio processo do parecer (parecer da CMA); fonte_externa = consulta da analista (SIMAS)
const ORIGENS = ['unidade', 'pedida_setor', 'processo_parecer', 'fonte_externa'];
const PERIODOS = ['mensal', 'trimestral'];

// ---------- utilidades ----------
const linhasDe = (texto) => String(texto || '').replace(/\r/g, '').split('\n');
const corta = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
const maiuscula = (s) => { const letras = String(s).replace(/[^A-Za-zÀ-ÿ]/g, ''); if (letras.length < 3) return false; const up = letras.replace(/[^A-ZÀ-Ý]/g, '').length; return up / letras.length >= 0.75; };
const ROMANO = /^(?=[IVX])X{0,2}(IX|IV|V?I{0,3})$/;
const MESES_NOME = /^(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)$/i;

function trimestreDe(s) {
  const t = String(s || '');
  let m = /(20\d{2})\s*[-_/. ]?\s*T\s*([1-4])\b/i.exec(t);
  if (m) return m[1] + '-T' + m[2];
  m = /\b([1-4])\s*[ºo°ª]?\s*(?:tri(?:mestre)?)\b[^0-9]{0,14}(20\d{2})/i.exec(t);
  if (m) return m[2] + '-T' + m[1];
  return null;
}

// Marcadores "--- página N ---" que a leitura de PDF deixa no texto: dizem de que página veio o trecho.
function paginaNaLinha(linhas, i) {
  for (let k = i; k >= 0; k--) { const m = /^--- página (\d+) ---$/.exec(linhas[k].trim()); if (m) return Number(m[1]); }
  return null;
}

// ---------- seções ----------
function secoesDe(linhas) {
  const out = []; let titulo = null;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i].trim();
    if (!l || /^--- (página|planilha) \d+ ---$/.test(l)) continue;
    if (titulo === null && l.length <= 160 && maiuscula(l) && !/^\d+(\.\d+)*$/.test(l)) { titulo = corta(l, 160); continue; }
    if (l.length > 150) continue;
    let m = /^(\d{1,2}(?:\.\d{1,2}){0,2})[.)]?\s+(\S.{2,140})$/.exec(l);
    if (m && !/^\d+([.,]\d+)?\s*%?$/.test(m[2]) && !/[;:]$/.test(l)) {
      const resto = m[2];
      const dosDas = /^(D[AEO]S?|Da|De|Do|Das|Dos)\s+[A-Za-zÀ-ÿ]/.test(resto);
      if (maiuscula(resto) || (dosDas && !/[.]$/.test(resto))) {
        const nivel = m[1].split('.').length;
        out.push({ numero: m[1], titulo: corta(resto, 140), nivel, linha: i + 1, pagina: paginaNaLinha(linhas, i) });
        continue;
      }
    }
    m = /^([IVX]{1,5})\s*[-–.)]\s+(\S.{2,120})$/.exec(l);
    if (m && ROMANO.test(m[1]) && maiuscula(m[2])) { out.push({ numero: m[1], titulo: corta(m[2], 140), nivel: 1, linha: i + 1, pagina: paginaNaLinha(linhas, i) }); continue; }
    if (maiuscula(l) && l.length >= 8 && l.length <= 100 && !/\d{3,}/.test(l) && !/[;,]$/.test(l) && l.split(/\s+/).length >= 2) {
      out.push({ numero: null, titulo: corta(l, 140), nivel: 1, linha: i + 1, pagina: paginaNaLinha(linhas, i) });
    }
  }
  // com seções numeradas de verdade, linhas só em maiúsculas (cabeçalho de quadro, assinatura) não são seção
  const numeradas = out.filter((x) => x.numero);
  return { titulo, secoes: (numeradas.length >= 3 ? numeradas : out).slice(0, 80) };
}

// ---------- quadros e tabelas ----------
function tabelasDe(linhas) {
  const out = []; const visto = new Set();
  const REC = /^(Quadro|Tabela|Gr[aá]fico|Figura)\s*(?:n[.º°]*\s*)?(\d+)\b\s*[-–:.]?\s*(.*)$/i;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i].trim();
    const m = REC.exec(l);
    if (m && l.length <= 200 && !/^(Quadro|Tabela)s?\s+\d+(,|\s+e\s)/i.test(l)) {
      const chave = sem(m[1]) + ' ' + Number(m[2]);
      if (visto.has(chave)) continue; visto.add(chave);
      out.push({ tipo: sem(m[1]) === 'grafico' ? 'gráfico' : sem(m[1]), numero: Number(m[2]), titulo: corta(l, 160), linha: i + 1, pagina: paginaNaLinha(linhas, i), colunas: [] });
    }
  }
  // tabelas em texto corrido (Word com " | ", Excel com tabulação): bloco de 2+ linhas seguidas com vários separadores
  const ehLinhaTab = (s) => (s.split(' | ').length >= 3 || s.split('\t').length >= 3);
  for (let i = 0; i < linhas.length; i++) {
    if (!ehLinhaTab(linhas[i])) continue;
    let j = i; while (j + 1 < linhas.length && ehLinhaTab(linhas[j + 1])) j++;
    if (j - i + 1 >= 2) {
      const sep = linhas[i].includes(' | ') ? ' | ' : '\t';
      const colunas = linhas[i].split(sep).map((c) => corta(c, 40)).filter(Boolean).slice(0, 12);
      const ja = out.find((t) => t.linha >= i - 3 && t.linha <= i + 1);
      if (ja) { if (!ja.colunas.length) ja.colunas = colunas; ja.linhas = j - i + 1; }
      else {
        let k = i - 1; while (k >= 0 && !linhas[k].trim()) k--;
        const tit = k >= 0 && linhas[k].trim().length <= 120 && !/^--- /.test(linhas[k].trim()) ? corta(linhas[k], 120) : 'Tabela sem título';
        out.push({ tipo: 'tabela', numero: null, titulo: tit, linha: i + 1, pagina: paginaNaLinha(linhas, i), colunas, linhas: j - i + 1 });
      }
    }
    i = j;
  }
  return out.sort((a, b) => a.linha - b.linha).slice(0, 60);
}

// ---------- indicadores ----------
function indicadoresDe(linhas) {
  const out = []; const visto = new Set();
  const poe = (numero, nome, i) => {
    nome = corta(nome.replace(/\s*[|\t].*$/, ''), 110).replace(/[\s–-]+$/, '');
    if (nome.length < 5 || MESES_NOME.test(nome) || /^[\d.,%\s]+$/.test(nome)) return;
    const chave = (numero || '') + '|' + sem(nome); if (visto.has(chave)) return; visto.add(chave);
    out.push({ numero: numero || null, nome, trecho: corta(linhas[i], 200), linha: i + 1, pagina: paginaNaLinha(linhas, i) });
  };
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i].trim();
    // "1.1 Consultas médicas 4.324 ..." / "1.1 | Consultas médicas | 4.324"
    let m = /^(\d{1,2}\.\d{1,2})\s*(?:\||\t|\s)\s*(?:(?:Janeiro|Fevereiro|Mar[cç]o|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s+)?([A-ZÀ-Ý][^|\t\d]{4,110}?)(?:\s*[|\t]|\s+\d|\s*$)/.exec(l);
    if (m && !/^(Quadro|Tabela)/i.test(m[2]) && !/^(Do|Da|Dos|Das)\s/.test(m[2])) { poe(m[1], m[2], i); continue; }
    // texto de HTML: o número fica sozinho numa linha e o nome vem duas ou três linhas depois (depois do mês)
    if (/^\d{1,2}\.\d{1,2}$/.test(l)) {
      for (let k = i + 1; k <= i + 4 && k < linhas.length; k++) {
        const t = linhas[k].trim();
        if (!t || MESES_NOME.test(t) || /^[\d.,%\s]+$/.test(t)) continue;
        if (/^[A-ZÀ-Ý]/.test(t) && t.length >= 5 && t.length <= 120) poe(l, t, i);
        break;
      }
      continue;
    }
    m = /^indicador(?:es)?\s*[:\-–]\s*(.{5,110})$/i.exec(l);
    if (m) poe(null, m[1], i);
  }
  return out.slice(0, 80);
}

// ---------- fontes e anexos ----------
// Fontes nomeadas (sem número de anexo). "equivale" lista os anexos que já cobrem a mesma coisa (aí o item avulso não é criado).
// padroes: texto procurado no NOME do arquivo (sem acento, minúsculas); palavras: ajuda extra, editável pela analista.
const FONTES = [
  { codigo: 'relatorio_mensal', nome: 'Relatório Mensal (RM)', re: /relat[oó]rios? (?:assistenciais? )?mensa(?:l|is)|\bRM\b/i, origem: 'unidade', periodicidade: 'mensal', obrigatorio: true, padroes: ['\\brm\\b', 'relatorio mensal'], equivale: ['anexo_I'] },
  { codigo: 'bid', nome: 'BID (boletim de produção)', re: /\bBID\b|boletim de produ[cç][aã]o/, origem: 'unidade', periodicidade: 'mensal', obrigatorio: true, padroes: ['\\bbid\\b', 'boletim de producao'], equivale: ['anexo_IV'] },
  { codigo: 'sia_sus', nome: 'SIA/SUS', re: /\bSIA\s*\/?\s*SUS\b|\bSIA\b/, origem: 'unidade', periodicidade: 'mensal', obrigatorio: true, padroes: ['\\bsia\\b', 'sia sus'], equivale: ['anexo_V'] },
  { codigo: 'cnes', nome: 'CNES (cadastro de profissionais)', re: /\bCNES\b/, origem: 'unidade', periodicidade: 'mensal', obrigatorio: true, padroes: ['\\bcnes\\b'], equivale: ['anexo_VI', 'anexo_VII'] },
  { codigo: 'ouvidoria', nome: 'Ouvidoria e satisfação do usuário', re: /ouvidoria|\bNPS\b|\bCSAT\b|queixas? recebidas|satisfa[cç][aã]o do usu[aá]rio/i, origem: 'unidade', periodicidade: 'mensal', obrigatorio: true, padroes: ['ouvidoria', '\\bnps\\b', '\\bcsat\\b', 'satisfacao'], equivale: ['anexo_1', 'anexo_1_1'] },
  { codigo: 'simas', nome: 'SIMAS (consulta da analista)', re: /\bSIMAS\b/, origem: 'fonte_externa', periodicidade: 'mensal', obrigatorio: true, padroes: ['\\bsimas\\b'] },
  { codigo: 'despacho_financeiro', nome: 'Despacho financeiro / prestação de contas', re: /despachos?\b[^\n]{0,160}(?:ger[eê]ncia|presta[cç][aã]o de contas|financeir|GAFCG|GGCCG|GAOCG)|(?:ger[eê]ncia de presta[cç][aã]o de contas|prestac[aã]o de contas)[^\n]{0,80}despacho/i, origem: 'pedida_setor', periodicidade: 'mensal', obrigatorio: true, padroes: ['despacho'] },
  { codigo: 'financeiro', nome: 'Informação financeira (GGCCG), trimestre anterior', re: /informa[cç][oõ]es financeiras|INFORMA[CÇ][AÃ]O N[.º°o]*\s*\d+[^\n]{0,40}GG|gasto com pessoal|\bGAOCG\b/, origem: 'pedida_setor', periodicidade: 'trimestral', obrigatorio: true, padroes: ['informacao', 'financeir', 'gaocg'] },
  { codigo: 'parecer_cma', nome: 'Parecer conclusivo da CMA', re: /parecer conclusivo da (?:CMA|Comiss[aã]o Mista)/i, origem: 'processo_parecer', periodicidade: 'trimestral', obrigatorio: false, padroes: ['\\bcma\\b', 'comissao mista'] },
  { codigo: 'prestacao_contas', nome: 'Relatório de prestação de contas', re: /relat[oó]rio de presta[cç][aã]o de contas|presta[cç][oõ]es de contas/i, origem: 'pedida_setor', periodicidade: 'mensal', obrigatorio: false, padroes: ['prestacao de contas'] },
];
// "conforme/de acordo com o relatório X": o que vem depois do tipo de documento vira um item de confiança baixa
const REF = /(?:conforme|de acordo com|segundo|constante d[oa]s?|apresentad[oa]s? (?:no|na|pelo|pela))\s+(?:o |a |os |as )?((?:relat[oó]rio|of[ií]cio|ata|laudo|boletim)s?\s+(?:de |da |do |dos |das )?[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ /-]{2,50})/gi;
const PLAN = /\b(planilhas?\s+(?:de |da |do |dos |das )[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ /-]{3,40})/gi;

// Planilha de monitoramento (Anexo II; às vezes chega como "planilha consolidada"): obrigatória e mensal.
// Regra da CTAI: sem ela, os indicadores que dependem dela contam como meta não cumprida (ver importar.js, REGRAS_AUSENCIA).
const PADROES_PLANILHA_MON = ['\\banexo ii\\b', 'planilha de monitoramento', 'monitoramento', 'consolidad'];
const PLANILHA_MON = () => ({ codigo: 'anexo_II', nome: 'Anexo II - Planilha de Monitoramento', origem: 'unidade', periodicidade: 'mensal', obrigatorio: true, padroes: PADROES_PLANILHA_MON.slice(), palavras: [], tipo: 'anexo', ordem: ordemAnexo('II') });
const nomeCitado = (n) => corta(String(n).split(/\s+(?:constante|apresentad|enviad|elaborad|encaminhad|realizad|pela|pelo|que|para|foi|conforme|e\s)/i)[0].replace(/[\s–-]+$/, ''), 70);
const slug = (s) => sem(s).replace(/\s+/g, '_').slice(0, 40);
const contextoPeriodo = (linha) => { const s = sem(linha); return /\bmensa(l|is)\b/.test(s) ? 'mensal' : (/\b(trimestra(l|is)|semestral|anual)\b/.test(s) ? 'trimestral' : null); };

function anexoPadrao(id) {
  if (/^\d+\.\d+$/.test(id)) return ['\\banexo ' + id.replace('.', ' ') + '\\b'];
  if (/^\d+$/.test(id)) return ['\\banexo ' + id + '\\b(?! \\d)'];
  return ['\\banexo ' + id.toLowerCase() + '\\b'];
}
const anexoCodigo = (id) => 'anexo_' + (/^\d/.test(id) ? id.replace('.', '_') : id);
const ordemAnexo = (id) => (/^\d/.test(id) ? 100 + Number(id.split('.')[0]) + (Number(id.split('.')[1] || 0) / 100) : (['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'].indexOf(id) + 1));

function fontesDe(linhas, ctx) {
  ctx = ctx || {};
  const porCodigo = new Map();
  const padrao = ctx.periodicidadePadrao || 'trimestral';
  const nomeCatalogo = (codigo) => { const cat = C.catalogoDoTipo('UPAE'); const d = cat && C.documento(cat, codigo); return d ? d.nome : null; };
  const poe = (f, i, extra) => {
    const atual = porCodigo.get(f.codigo);
    if (atual) { atual.vezes++; return; }
    porCodigo.set(f.codigo, Object.assign({ vezes: 1, trecho: corta(linhas[i], 240), linha: i + 1, pagina: paginaNaLinha(linhas, i), confianca: 'alta' }, f, extra || {}));
  };
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l.trim()) continue;
    // Anexo I..XX / 1..15 / 1.1 (o "Anexo Técnico" do contrato não é arquivo que a unidade envia)
    const re = /\b(?:Anexo|ANEXO|anexo)s?\s+(?!T[ée]cnico|T[ÉE]CNICO|t[ée]cnico)([IVX]{1,5}|\d{1,2}(?:\.\d{1,2})?)\b(?!\s*(?:do|da)\s+(?:contrato|termo|edital))/g;
    let m;
    while ((m = re.exec(l))) {
      const id = m[1];
      if (!/^\d/.test(id) && !ROMANO.test(id)) continue;
      const codigo = anexoCodigo(id);
      const depois = l.slice(m.index + m[0].length);
      const t = /^\s*[-–:.]\s*([A-Za-zÀ-ÿ0-9][^\n;.,()]{2,60})/.exec(depois);
      let titulo = t ? t[1].split(/\s+(?:e|no|na|nos|nas|que|foi|com|enviad[oa]s?|apresentad[oa]s?|anexo)\s+/i)[0].replace(/\s+(e|do|da|de|que|foi|com)$/i, '').trim() : '';
      if (/^(do|da|dos|das|ao|aos)\s+(contrato|termo|processo)/i.test(titulo)) continue;
      if (titulo.length < 3) titulo = '';
      // unidade UPAE: o nome do catálogo (é o que os arquivos do SEI trazem); nos outros tipos, o título como está no modelo
      const doCat = ctx.tipo === 'UPAE' ? nomeCatalogo(codigo) : null;
      const nome = doCat || (titulo ? 'Anexo ' + id + ' - ' + titulo : 'Anexo ' + id);
      const per = contextoPeriodo(l) || padrao;
      poe({ codigo, nome, origem: 'unidade', periodicidade: per, obrigatorio: true, padroes: anexoPadrao(id), palavras: [], tipo: 'anexo', ordem: ordemAnexo(id) }, i, titulo || doCat ? {} : { confianca: 'media' });
    }
    for (const f of FONTES) if (f.re.test(l)) poe({ codigo: f.codigo, nome: f.nome, origem: f.origem, periodicidade: f.periodicidade, obrigatorio: f.obrigatorio, padroes: f.padroes.slice(), palavras: [], tipo: 'fonte', equivale: f.equivale || [], ordem: 500 + FONTES.indexOf(f) }, i);
    let r;
    REF.lastIndex = 0;
    while ((r = REF.exec(l))) {
      const nome = nomeCitado(r[1]);
      if (sem(nome).split(' ').length < 2 || /\bmensa(l|is)\b/.test(sem(nome))) continue;
      poe({ codigo: 'ref_' + slug(nome), nome: nome[0].toUpperCase() + nome.slice(1), origem: 'unidade', periodicidade: contextoPeriodo(l) || padrao, obrigatorio: false, padroes: [], palavras: [sem(nome)], tipo: 'citado', ordem: 800 }, i, { confianca: 'baixa' });
    }
    PLAN.lastIndex = 0;
    while ((r = PLAN.exec(l))) {
      const nome = nomeCitado(r[1]);
      if (/monitoramento|consolidad/i.test(nome)) { poe(PLANILHA_MON(), i, { confianca: 'alta' }); continue; }
      poe({ codigo: 'planilha_' + slug(nome.replace(/^planilhas?\s+(de |da |do |dos |das )/i, '')), nome: nome[0].toUpperCase() + nome.slice(1), origem: 'unidade', periodicidade: contextoPeriodo(l) || padrao, obrigatorio: false, padroes: [], palavras: [sem(nome)], tipo: 'citado', ordem: 850 }, i, { confianca: 'baixa' });
    }
  }
  const todos = [...porCodigo.values()];
  for (const f of todos) if (f.codigo === 'anexo_II') { f.obrigatorio = true; f.periodicidade = 'mensal'; f.origem = 'unidade'; f.padroes = [...new Set((f.padroes || []).concat(PADROES_PLANILHA_MON))]; }
  // o que um anexo já cobre não vira item avulso (ex.: "BID" quando existe "Anexo IV - BID")
  const temAnexo = new Set(todos.filter((f) => f.tipo === 'anexo').map((f) => f.codigo));
  const lista = todos.filter((f) => !(f.equivale || []).some((c) => temAnexo.has(c)));
  return lista.sort((a, b) => a.ordem - b.ordem || a.linha - b.linha);
}

// ---------- estrutura completa ----------
function extrairEstrutura(texto, ctx) {
  const linhas = linhasDe(texto);
  const s = secoesDe(linhas);
  return {
    versao: 1, titulo: s.titulo, trimestre: trimestreDe(String(texto || '').slice(0, 5000)),
    secoes: s.secoes, tabelas: tabelasDe(linhas), indicadores: indicadoresDe(linhas), fontes: fontesDe(linhas, ctx).map((f) => { const sc = s.secoes.filter((x) => x.linha && x.linha <= f.linha).pop(); return sc && sc.numero ? Object.assign(f, { trecho: '[Seção ' + sc.numero + '] ' + f.trecho }) : f; }),
    linhas: linhas.length, caracteres: String(texto || '').length,
  };
}

// ---------- itens da lista ----------
function limparItem(i, ordem) {
  const nome = corta(i.nome, 120);
  if (!nome) return null;
  const codigo = String(i.codigo || '').replace(/[^A-Za-z0-9_.]/g, '_').slice(0, 60) || ('item_' + slug(nome));
  return {
    codigo, nome, ordem,
    obrigatorio: i.obrigatorio === false || i.obrigatorio === 0 ? 0 : 1,
    periodicidade: PERIODOS.includes(i.periodicidade) ? i.periodicidade : 'mensal',
    origem: ORIGENS.includes(i.origem) ? i.origem : 'unidade',
    padroes: (Array.isArray(i.padroes) ? i.padroes : []).map(String).filter((p) => p.length <= 120).slice(0, 12),
    padroes_texto: (Array.isArray(i.padroes_texto) ? i.padroes_texto : []).map(String).filter((p) => p.length <= 120).slice(0, 12),
    palavras: (Array.isArray(i.palavras) ? i.palavras : []).map((p) => sem(p)).filter(Boolean).slice(0, 12),
    trecho: i.trecho ? corta(i.trecho, 300) : null, confianca: i.confianca ? String(i.confianca).slice(0, 10) : null,
    a_partir_de: C.MES_OK.test(String(i.a_partir_de || '')) ? i.a_partir_de : null,
    fonte_ia: i.fonte_ia ? 1 : 0,
  };
}
// padrões automáticos quando o item é novo (nome do anexo ou palavras do nome)
function padroesDoNome(nome) {
  const m = /\banexo\s+([IVX]{1,5}|\d{1,2}(?:\.\d{1,2})?)\b/i.exec(nome);
  if (m) return anexoPadrao(/^\d/.test(m[1]) ? m[1] : m[1].toUpperCase());
  return [];
}
function codigoUnico(nome, usados) {
  const base = 'item_' + (slug(nome) || 'novo'); let c = base, n = 2;
  while (usados.has(c)) c = base + '_' + n++;
  return c;
}

// Proposta de lista a partir da estrutura. { itens, aviso, vazia }
// Tipo com catálogo completo de anexos (UPAE): o parecer quase nunca cita todos, então o que o catálogo tem e o modelo não cita entra também,
// marcado como "da lista padrão" (a analista confere e tira o que não vale). Fonte genérica (ex.: "BID") dá lugar ao anexo do catálogo que a cobre.
function propostaLista(estrutura, tipo) {
  const cat = C.catalogoDoTipo(tipo);
  const fontes = estrutura.fontes || [];
  let itens = fontes.map((f, k) => limparItem({ ...f, trecho: (f.pagina ? 'p. ' + f.pagina + ': ' : '') + f.trecho }, k + 1)).filter(Boolean);
  if (!itens.length) return { itens: listaDoCatalogo(tipo).itens, aviso: 'Não achei anexos nem fontes no relatório. Partindo da lista padrão' + (cat ? ' da ' + tipo : '') + '.', vazia: true };
  let aviso = null;
  if (cat && cat.fluxo === 'gaveta') {
    const padrao = listaDoCatalogo(tipo).itens;
    const codigos = new Set(padrao.map((i) => i.codigo));
    const citado = new Map(); // código do catálogo -> fonte genérica que o cobre
    for (const f of fontes) for (const c of f.equivale || []) if (codigos.has(c)) citado.set(c, f);
    const cobertas = new Set(fontes.filter((f) => (f.equivale || []).length && f.equivale.every((c) => codigos.has(c))).map((f) => f.codigo));
    itens = itens.filter((i) => !cobertas.has(i.codigo));
    const tem = new Set(itens.map((i) => i.codigo));
    let acrescentou = 0;
    for (const p of padrao) {
      if (tem.has(p.codigo)) continue;
      const f = citado.get(p.codigo);
      itens.push(Object.assign({}, p, f ? { trecho: corta((f.pagina ? 'p. ' + f.pagina + ': ' : '') + f.trecho, 300), confianca: 'alta' } : {}));
      if (!f) acrescentou++;
    }
    if (acrescentou) aviso = acrescentou + ' item(ns) vieram da lista padrão da ' + tipo + ' porque o relatório não os cita.';
    // ordem: anexos na ordem do catálogo, depois as demais fontes na ordem em que o modelo as citou
    const ordemCat = new Map(padrao.map((p, k) => [p.codigo, k]));
    itens.sort((a, b) => (ordemCat.has(a.codigo) ? ordemCat.get(a.codigo) : 1000) - (ordemCat.has(b.codigo) ? ordemCat.get(b.codigo) : 1000));
    itens.forEach((i, k) => { i.ordem = k + 1; });
  }
  return { itens, aviso, vazia: false };
}

// Lista padrão por tipo de unidade (reserva quando não há relatório anterior).
function listaDoCatalogo(tipo) {
  const cat = C.catalogoDoTipo(tipo);
  if (!cat) return { itens: [], tipo };
  const base = cat.periodicidade === 'mensal' ? 'mensal' : 'trimestral';
  const itens = cat.documentos.filter((d) => d.papel !== 'modelo').map((d, k) => limparItem({
    codigo: d.codigo, nome: d.nome, obrigatorio: !!d.obrigatorio, periodicidade: d.periodicidade || base, origem: 'unidade',
    padroes: d.padroes_nome || [], padroes_texto: d.padroes_texto || [], palavras: [], trecho: d.observacao || null, confianca: 'catalogo', a_partir_de: d.a_partir_de || null,
  }, k + 1));
  return { itens, tipo };
}

// ---------- casar arquivo com item ----------
// Devolve { codigo, por: 'nome'|'conteudo' } ou null. nome e texto crus; aqui tudo é normalizado.
const rx = (p) => { try { return new RegExp(p); } catch (_) { return null; } };
function casar(itens, nome, texto) {
  const n = sem(C.limpaNome(nome));
  const inicio = sem(String(texto || '').slice(0, 600));
  const acha = (alvo, it, lista) => (lista || []).some((p) => { const r = rx(p); return r && r.test(alvo); });
  // 1) pelo NOME do arquivo (padrões e palavras)
  for (const it of itens) if (acha(n, it, it.padroes) || (it.palavras || []).some((p) => p && n.includes(p))) return { codigo: it.codigo, por: 'nome' };
  // 2) pelo CONTEÚDO: o começo do documento diz que anexo é, ou traz o nome do item
  for (const it of itens) {
    const ehAnexo = /^anexo_/.test(it.codigo);
    if (ehAnexo && acha(inicio, it, it.padroes)) return { codigo: it.codigo, por: 'conteudo' };
    if (acha(sem(String(texto || '').slice(0, 3000)), it, it.padroes_texto)) return { codigo: it.codigo, por: 'conteudo' };
    const nm = sem(it.nome.replace(/^anexo\s+\S+\s*[-–]\s*/i, ''));
    if (nm.split(' ').length >= 2 && nm.length >= 10 && inicio.includes(nm)) return { codigo: it.codigo, por: 'conteudo' };
  }
  return null;
}

module.exports = { extrairEstrutura, propostaLista, listaDoCatalogo, casar, limparItem, padroesDoNome, codigoUnico, trimestreDe, secoesDe, tabelasDe, indicadoresDe, fontesDe, ORIGENS, PERIODOS, corta, slug };
