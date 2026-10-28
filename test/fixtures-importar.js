'use strict';
// Arquivos SINTÉTICOS (dados inventados) para testar Importar Arquivos: um "parecer do trimestre anterior" fictício, em texto, PDF e Word,
// e os arquivos de um trimestre novo. Nunca use documento real nos testes.
const JSZip = require('jszip');
const PDFDocument = require('pdfkit');

const ENCHIMENTO = ' Texto de enchimento para passar do mínimo de caracteres legíveis do arquivo da unidade.';

// Parecer fictício da "UPAE Teste" no 3º trimestre de 2026, com seções, quadros, indicadores e menções a anexos e fontes.
function textoParecer() {
  return [
    'PARECER TÉCNICO CTAI N.º 999/2026',
    'UPAE TESTE - 3º TRIMESTRE DE 2026',
    'Objeto: análise técnica trimestral dos relatórios mensais da UPAE Teste, julho a setembro de 2026 (3º trimestre).',
    '1. DA INTRODUÇÃO',
    'Chegam a esta Comissão os relatórios assistenciais mensais de julho a setembro de 2026.' + ENCHIMENTO,
    '2. DA FUNDAMENTAÇÃO LEGAL',
    'Conforme o Anexo Técnico I do Contrato de Gestão n.º 000/2099, as metas são analisadas a cada trimestre.',
    '3. DAS FONTES DE DADOS',
    'Os dados de produção vieram do Anexo I - Relatório Mensal (RM) enviado todo mês pela unidade.',
    'O boletim está no Anexo IV - BID e a produção faturada no Anexo V - SIA/SUS.',
    'Os profissionais constam no Anexo VI - Cadastro de Profissionais (CNES).',
    'A Ouvidoria enviou o Anexo 1 - Atividades da Ouvidoria e o Anexo 1.1 - NPS e CSAT.',
    'A Comissão de Óbito apresentou a ata no Anexo 5 - Comissão de Óbito.',
    'Os números de produção foram conferidos no SIMAS pela analista.',
    'Conforme o Despacho 12 da Gerência de Prestação de Contas, as prestações de contas chegaram no prazo.',
    'As informações financeiras do período constam do processo (GAOCG).',
    'Os dados de escala seguem conforme planilha de escala médica apresentada pela unidade.',
    '4. DA ANÁLISE DOS INDICADORES',
    '4.1 Dos Indicadores de Produção',
    'Quadro 01 – Resultados do 3º trimestre de 2026',
    'Nº | Indicador | Meta | Produção | Status',
    '1.1 | Consultas médicas especializadas | 4.000 | 3.100 | Meta não cumprida',
    '1.2 | Consultas de especialidades não médicas | 900 | 1.100 | Meta cumprida',
    '1.3 | Sessões de reabilitação | 1.800 | 1.900 | Meta cumprida',
    'Quadro 02 – Qualidade',
    '3.1 Satisfação do usuário 90% 95%',
    '5. DA CONCLUSÃO',
    'Esta Comissão encaminha o parecer.' + ENCHIMENTO,
  ].join('\n');
}

// Word mínimo (só o que o leitor do sistema usa: word/document.xml), com um parágrafo por linha.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function docxDe(texto) {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  z.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    String(texto).split('\n').map((l) => '<w:p><w:r><w:t>' + esc(l) + '</w:t></w:r></w:p>').join('') + '</w:body></w:document>');
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// PDF com texto (uma linha de texto por linha do parecer), várias páginas se precisar.
function pdfDe(texto) {
  return new Promise((ok) => {
    const d = new PDFDocument({ margin: 40 }); const p = [];
    d.on('data', (x) => p.push(x)); d.on('end', () => ok(Buffer.concat(p)));
    d.fontSize(10);
    for (const l of String(texto).split('\n')) d.text(l, { width: 500 });
    d.end();
  });
}

// Arquivos de um trimestre novo (2026-T4): nomes como o SEI entrega. mesNome = 'Outubro'..; mes = '10'.
const MESES_T4 = [['10', 'Outubro'], ['11', 'Novembro'], ['12', 'Dezembro']];
const corpo = (titulo, mes, extra, ano) => Buffer.from(titulo + ' - UPAE Teste - competência ' + mes + '/' + (ano || 2026) + '. ' + (extra || '') + ENCHIMENTO.repeat(2));
// Devolve [{ nome, buf }] de um mês: Anexo I, IV, V, VI e Ouvidoria (1 e 1.1), mais o Anexo 5.
function mes(mm, opc) {
  opc = opc || {}; const x = opc.extra || ''; const ano = opc.ano || 2026;
  const f = [
    ['[03]-9000003_Relatorio_ANEXO_I___RM___UPAE_Teste_' + mm + ano + '.txt', 'Relatório Mensal', 'ri'],
    ['[06]-9000006_Planilha_ANEXO_IV___BID___UPAE_Teste_' + mm + ano + '.txt', 'Boletim BID', 'bid'],
    ['[07]-9000007_Anexo_ANEXO_V___Relatorio_SIA_SUS___UPAE_Teste_' + mm + '.txt', 'Relatório SIA/SUS', 'sia'],
    ['[08]-9000008_Anexo_ANEXO_VI___Cadastro_Profissionais_CNES___UPAE_Teste_' + mm + '.txt', 'Cadastro CNES', 'cnes'],
    ['[10]-9000010_Anexo_1_Relatorio_das_Atividades_da_Ouvidoria_SES___UPAE_' + mm + '.txt', 'Ouvidoria', 'ouv'],
    ['[11]-9000011_Anexo_1.1_NPS___CSAT_Ouvidoria___UPAE_Teste_' + mm + ano + '.txt', 'NPS e CSAT', 'nps'],
    ['[16]-9000016_Anexo_5_Reuniao_Ordinaria_Comissao_de_Obito___UPAE_Teste_' + mm + ano + '.txt', 'Ata da Comissão de Óbito', 'obito'],
  ];
  return f.filter(([, , c]) => !(opc.sem || []).includes(c)).map(([nome, titulo]) => ({ nome, buf: corpo(titulo, mm, x, ano) }));
}
// Mesmo conjunto, mas cada arquivo como PDF (com texto) ou Word, já com nome .pdf/.docx. (Os do mês 1 são PDF; o resto, a critério de quem chama.)
async function mesEmPdf(mm, opc, formato) {
  const base = mes(mm, opc); const out = [];
  for (const a of base) out.push({ nome: a.nome.replace(/\.txt$/, formato === 'docx' ? '.docx' : '.pdf'), buf: formato === 'docx' ? await docxDe(a.buf.toString('utf8')) : await pdfDe(a.buf.toString('utf8')) });
  return out;
}


// Consolidado do SIMAS (SINTÉTICO, só a FORMA do relatório real): cabeçalho, grupos com "Total do Grupo", descrição quebrada em duas linhas,
// Mamografia em dois grupos e os blocos de indicadores repetidos 3 vezes sem rótulo de mês. Números inventados.
function simasTexto(opc) {
  opc = opc || {}; const p = opc.periodos || '10/2026, 11/2026, 12/2026';
  const cab = (n) => `UPAE Teste - ORGANIZACAO FICTICIA DE TESTE...                                   Pg.: ${n}/3\nUPAE Teste (00000000000191)\n\n\nMETAS ATINGIDAS - CONSOLIDADO\n${p}                                       [SIMAS]\n\n`;
  const rod = '\n\nOrganização Social / CTAI - Analista de Teste...    01/02/2027 10:30:16   [Powered by brgaap]\n';
  const ind = (nomeA, regra, val, sim, nomeB) => `   ${nomeA}\n                                        ${regra}                ${val}          ${sim}                    -\n${nomeB ? '   ' + nomeB + '\n' : ''}\n`;
  return cab(1) + `                                           Ambulatorial\n\n\nDescrição                                                  Previsto   Realizado     Atingido%\n\nTEA ATENDIMENTOS MEDICOS\n\n\n Neuropediatra                                                462          160           34,63%\n\n\n                                         Total do Grupo:      462         160            34,63%\n\n\nAtendimento Ambulatorial Não Médico\n\n\n Nutrição                                                       0          868             100%\n\n\n Fisioterapia                                                   0        1.243             100%\n\n\n                                         Total do Grupo:     2.880       2.111          73,3%\n\n\nMatriciamento e Supervisão\n\n\n Matriciamento das equipes de Saúde da Família dos Municípios\n                                                                    24           35         145,83%\n da Área de Abrangência\n\n\n Supervisão dos Cuidados Prestados nas Unidades Básicas de\n                                                                    24           61         254,17%\nSaúde\n\n\n                                         Total do Grupo:       48          96              200%\n\n\nProgramas Especiais\n\n\n Atendimentos a Ostomizados                                   345          146           42,32%\n\n\n                                         Total do Grupo:      345         146           42,32%` + rod
    + cab(2) + `                                             SADT\nDescrição                                                 Previsto       Realizado      Atingido%\nSADT UPAE\n Análises Clínicas                                             0            8.121              100%\n Mamografia                                                442              0                   0%\n                                     Total do Grupo:               442            8.121         1837,33%\n                                       SADT Especial\n Mamografia                                                  1.498                815             54,41%\n                                     Total do Grupo:              1.498               815              54,41%\n\n                                                  Indicadores\n\n\n                                                                                                 Pontuação\nDescrição                                       Previsto             Realizado       Atingido\n                                                                                                   Atingida\n\n Agrupamento: Indicadores Não\n                                                                                                               -\n Agrupados\n\n\n`
    + ind('Qualidade do Preenchimento de', 'Maior ou igual a 85', '100', 'Sim', 'Prontuários') + ind('Índice de Satisfação do Usuário', 'Maior ou igual a 90', '0', 'Não', '(CTT Novo)') + `   Perda Primária PE                    N/A 0                                0           Sim                    -\n\n` + rod
    + cab(3) + `                                                                                   Pontuação\nDescrição                                    Previsto      Realizado   Atingido\n                                                                                     Atingida\n\n`
    + ind('Qualidade do Preenchimento de', 'Maior ou igual a 85', '97.5', 'Sim', 'Prontuários') + ind('Índice de Satisfação do Usuário', 'Maior ou igual a 90', '0', 'Não', '(CTT Novo)') + `   Perda Primária PE                    N/A 0                                0           Sim                    -\n\n`
    + ind('Qualidade do Preenchimento de', 'Maior ou igual a 85', '94.12', 'Sim', 'Prontuários') + ind('Índice de Satisfação do Usuário', 'Maior ou igual a 90', '0', 'Não', '(CTT Novo)') + `   Perda Primária PE                    N/A 0                                0           Sim                    -\n\n                                                                                        Total: 0\n` + rod;
}
module.exports = { simasTexto, mesEmPdf, textoParecer, docxDe, pdfDe, mes, corpo, MESES_T4, ENCHIMENTO };
