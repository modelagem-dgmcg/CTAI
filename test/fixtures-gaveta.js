'use strict';
// Arquivos SINTÉTICOS (dados inventados) que imitam a forma dos documentos reais da UPAE. Nunca use arquivos reais nos testes.
const MES = { '2026-07': ['jul/26', 'Julho/2026', '07/2026'], '2026-08': ['ago/26', 'Agosto/2026', '08/2026'], '2026-09': ['set/26', 'Setembro/2026', '09/2026'] };

// Texto do Anexo I como sai da leitura de PDF (rótulo, números no fim da linha).
function rmTexto(mes, v) {
  const [p, rot, num] = MES[mes]; v = Object.assign({ cm: [4000, 3000, 1800, '45,00%'], nm: [900, 1700, 1100, '122,22%'], sr: [1800, 2100, 900, '50,00%'] }, v || {});
  const lin = (rotulo, a) => `${p}\n${rotulo}\nTotal de\nAtendimentos/Mês ${a[0].toLocaleString('pt-BR')} ${a[1].toLocaleString('pt-BR')} ${a[2].toLocaleString('pt-BR')} ${a[3]}\n`;
  return `--- página 1 ---\nUPAE Teste. Relatório Mensal ${rot}. Texto de apresentação da unidade, suficiente para passar do mínimo de caracteres legíveis do arquivo.\n--- página 2 ---\n1. INDICADORES DE PRODUÇÃO\nNo período de análise do referido relatório os indicadores tiveram os seguintes resultados.\n` +
    lin('Consultas\nMédicas\nEspecializadas', v.cm) + lin('Consultas de\nEspecialidades\nnão médicas', v.nm) + lin('Sessões de\nReabilitação', v.sr) +
    `Fonte: Agenda Médica/BID/Planilha Monitoramento\n1. Indicadores de Produção\nEnvelope eletrônico 123\n--- página 3 ---\n2. INDICADORES DE QUALIDADE\nSatisfação do usuário ${p} 100% 99,32%\nRM ${num}\n`;
}

// Ofício de justificativa em HTML (como baixa do SEI, iso-8859-1 com entidades).
function oficioJustificativaHtml(mes, v) {
  const [, rot, num] = MES[mes]; v = Object.assign({ cmOf: '3.000', cmRe: '1.800', ostOf: '140', ostRe: '102', ostPct: '19,29%', fisOf: '2.100', fisRe: '900', fisPct: '50,00%' }, v || {});
  const html = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1" /><title>SEI - Of&iacute;cio</title><style>p{color:red}</style></head><body>
<p>Of&iacute;cio N&ordm; 25/2026</p><p>Escada, 20 de agosto de 2026</p>
<p>Assunto: Justificativa para o n&atilde;o atingimento de metas contratuais - Demanda de pacientes regulados ${num} do CG 021/2022</p>
<p>A Funda&ccedil;&atilde;o apresenta a justificativa para o n&atilde;o cumprimento das metas no m&ecirc;s de ${rot}, conforme explanado abaixo:</p>
<p>CONSULTAS M&Eacute;DICAS</p>
<p>- Consultas M&eacute;dicas Ofertadas pela UPAE Teste: ${v.cmOf}</p><p>- Consultas M&eacute;dicas reguladas pela Regula&ccedil;&atilde;o do Estado: 600</p><p>- Total de consultas realizadas: ${v.cmRe}</p>
<p>PROGRAMA DE OSTOMIZADOS</p>
<p>- Atendimento Ofertados pela UPAE Teste: ${v.ostOf}</p><p>- Total de Atendimento de Ostomizados realizados: ${v.ostRe}</p><p>- % de cumprimento de Atendimento de Ostomizados contratado x realizado: ${v.ostPct}</p>
<p>SESS&Otilde;ES DE REABILITA&Ccedil;&Atilde;O</p>
<p>- Sess&otilde;es de Fisioterapia Ofertadas pela UPAE Teste: ${v.fisOf}</p><p>- Total de Sess&otilde;es de Fisioterapia realizada: ${v.fisRe}</p><p>- % de cumprimento de Sess&otilde;es de Fisioterapia contratada x realizada: ${v.fisPct}</p>
<p>Cordialmente, Coordena&ccedil;&atilde;o. Texto de enchimento para passar do m&iacute;nimo de caracteres leg&iacute;veis do arquivo.</p></body></html>`;
  return Buffer.from(html, 'latin1');
}
const oficioEnvioHtml = (mes) => Buffer.from(`<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1" /></head><body><p>Of&iacute;cio N&ordm; 24/2026</p><p>Assunto: RM ${MES[mes][2]} - UPAE TESTE</p><p>A Funda&ccedil;&atilde;o vem por meio deste, encaminhar o Relat&oacute;rio Mensal &ndash; ${MES[mes][1]} e seus respectivos anexos. Texto de enchimento para passar do m&iacute;nimo de caracteres leg&iacute;veis.</p></body></html>`, 'latin1');

// Anexo qualquer em TXT (o texto só precisa ter conteúdo; "extra" muda o hash).
const anexoTxt = (titulo, mes, extra) => Buffer.from(`${titulo} - UPAE Teste - ${MES[mes][1]}. ${extra || ''} Conteúdo do anexo com texto de enchimento para passar do mínimo de caracteres legíveis do arquivo da unidade. `.repeat(2));

// Nomes de arquivo como o SEI entrega, por código do catálogo. Devolve [{nome, buf}] de um mês completo.
const ANEXOS = [['anexo_II', 'Anexo_ANEXO_II___Planilha_de_Monitoramento'], ['anexo_III', 'Anexo_ANEXO_III___Escala_Medica__OCI'], ['anexo_IV', 'Anexo_ANEXO_IV___BID'], ['anexo_V', 'Anexo_ANEXO_V___Relatorio_SIA_SUS___OCI'], ['anexo_VI', 'Anexo_ANEXO_VI___Cadastro_Profissionais_CNES'], ['anexo_VII', 'Anexo_ANEXO_VII___Planilha_Profissionais_CNES'],
  ['anexo_1', 'Anexo_1_Relatorio_das_Atividades_da_Ouvidoria'], ['anexo_1_1', 'Anexo_1.1_Relatorio_Geral_da_Ouvidoria'], ['anexo_2', 'Anexo_2_Relatorio_Matriciamento'], ['anexo_3', 'Anexo_3_Relatorio_Supervisao_do_Cuidado'], ['anexo_4', 'Anexo_4_Relatorio_dos_Programas_Especiais'],
  ['anexo_5', 'Anexo_5_Reuniao_Ordinaria_Comissao_de_Obito'], ['anexo_6', 'Anexo_6_Reuniao_Ordinaria_Comissao_de_Prontuarios'], ['anexo_7', 'Anexo_7_Reuniao_Ordinaria_CFTP'], ['anexo_8', 'Anexo_8_Relatorio_CCIH'], ['anexo_9', 'Anexo_9_Relatorio_NSP'], ['anexo_10', 'Anexo_10_Relatorio_Projeto_de_Cuidadores'], ['anexo_11', 'Anexo_11_Relatorio_de_Educacao_Permanente']];
function mesCompleto(mes, opc) {
  opc = opc || {}; const sufixo = (opc.semAno ? '' : '_' + mes.slice(5) + mes.slice(0, 4));
  const f = [{ nome: '[01]-9000001_GOVPE___Oficio_24.html', buf: oficioEnvioHtml(mes) }, { nome: '[02]-9000002_GOVPE___Oficio_25.html', buf: oficioJustificativaHtml(mes, opc.oficio) },
    { nome: '[03]-9000003_Relatorio_ANEXO_I___RM___UPAE_Teste' + sufixo + '.txt', buf: Buffer.from(rmTexto(mes, opc.rm)) }];
  ANEXOS.forEach(([cod, base], i) => { if (!(opc.sem || []).includes(cod)) f.push({ nome: '[' + String(i + 4).padStart(2, '0') + ']-90000' + (10 + i) + '_' + base + '___UPAE_Teste.txt', buf: anexoTxt(base, mes, opc.extra) }); });
  return f;
}
module.exports = { rmTexto, oficioJustificativaHtml, oficioEnvioHtml, anexoTxt, mesCompleto, ANEXOS, MES };
