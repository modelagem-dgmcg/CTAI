'use strict';
// Planilha de Monitoramento (Anexo II) SINTÉTICA, no jeito do texto lido por OCR: números inventados, sem nada de unidade real.
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
// opc.ostomizados: 'pessoas' | 'atendimentos' | 'ausente'; opc.pctMedicas: texto do % impresso das consultas médicas
function planilhaTexto(mes, opc) {
  const o = Object.assign({ ostomizados: 'pessoas', pctMedicas: '92,50%', mamografia: true }, opc || {});
  const [ano, mm] = mes.split('-');
  const L = [];
  L.push('Planilha de Monitoramento - Contrato de Gestão (teste)');
  L.push('Registro Mensal - ' + MESES[Number(mm) - 1] + ' ' + ano);
  L.push('Especialidades Médicas Primeira Consulta Interconsulta Subsequente TOTAL');
  L.push('Cardiologia 400 450 380 20,00% 70 0');
  L.push('Ortopedia 500 550 420 25,00% 30 0');
  L.push('Total 900 | 1000 | 800 | 40,00% | 100 0 600 | 500 | 450 20,00% 50 0 700 | 650 | 600 30,00% | 40 0 2150 2200 1850 2000 ' + o.pctMedicas);
  L.push('D - Disponibilizado');
  L.push('A - Agendado');
  L.push('E - Executado');
  L.push('Outros Profissionais de Nível Superior Meta | %');
  L.push('Enfermagem 100 90 85 5 0');
  L.push('Psicologia 100 90 85 5 0');
  L.push('Psicologia — Neurodiversidade 0 3 3 0 0');
  L.push('Enfermagem — Neurodiversidade 0 0 0 0 0');
  L.push('Total 300 280 270 10 0 250 108,00');
  if (o.ostomizados === 'pessoas') {
    L.push('Programas Assistenciais Meta | %');
    L.push('Pessoas com Estomia A 70 30 30 0 0 70 | 42,8571');
    L.push('Pessoas com Bexiga Neurogênica A 20 10 10 20');
    L.push('Total 90 40 40 0 0 90 | 44,44');
  } else if (o.ostomizados === 'atendimentos') {
    L.push('Atendimentos de Ostomizados Sessões Meta %');
    L.push('Enfermagem 100 20 20 0 0 100 20,00');
    L.push('Farmácia 0 0');
    L.push('Total 100 20 20 0 0 120 16,67');
  }
  L.push('Sessões de Reabilitação');
  L.push('Fisioterapia/Sessões 500 300 250 50 0 280 89,29');
  L.push('Fonoaudiologia/Sessões 200 100 90 10 0 100 90,00');
  L.push('Total 700 400 340 60 0 380 89,47');
  if (o.mamografia) L.push('Mamografia 250 250 0 0 3,00%');
  L.push('PE Acessível');
  L.push('Neuropediatra 20 20 22 -2 0');
  L.push('Psiquiatria 40 35 34 1 0');
  L.push('Total 60 55 56 -1 0 154 36,36');
  L.push('Queixas recebidas 7');
  L.push('Queixas tratadas 7');
  return L.join('\n');
}
module.exports = { planilhaTexto };

// Parecer SINTÉTICO do trimestre anterior (2026-T3), usado como relatório-modelo nos testes do texto corrido.
function modeloTexto() {
  return [
    'PARECER TÉCNICO CTAI N.º 101/2026',
    'UNIDADE TESTE - UNIDADE PERNAMBUCANA DE TESTE - 3º TRIMESTRE DE 2026',
    'Objeto: Análise técnica dos relatórios do 3° trimestre de 2026 (julho a setembro) no âmbito do Contrato de Gestão n.º 001/2020, firmado entre a SES/PE e a OSS Organização de Teste.',
    '1. DA INTRODUÇÃO',
    'Chegam a esta Comissão os relatórios mensais das competências de julho a setembro de 2026 (3º trimestre), para análise técnica do Contrato de Gestão n.º 001/2020.',
    'Os resultados de agosto de 2026 foram os mais baixos, com 45,50% da meta.',
    'É o que se tinha para relatar.',
    '2. DA FUNDAMENTAÇÃO LEGAL',
    'Para a emissão do presente Parecer, esta Comissão refere-se ao Artigo 35 do Decreto, in verbis:',
    '“(...) Art. 35. As atribuições da Comissão Técnica de Acompanhamento Interno serão executadas da seguinte forma: III - emissão de parecer trimestral;”',
    'É o que dispõe a Lei no caso concreto.',
    '3. DA IDENTIFICAÇÃO DO CONTRATO DE GESTÃO, DA ORGANIZAÇÃO SOCIAL DE SAÚDE E UNIDADE DE SAÚDE',
    'Organização Social de Saúde (OSS): Organização de Teste;',
    'Prazo de vigência: foi formalizado o 2º Termo Aditivo, que prorroga a vigência até 31 de dezembro de 2026;',
    'Celebrado em 18 de agosto de 2022, entre a SES/PE e a OSS;',
    'Período analisado: Julho a setembro de 2026;',
    'Repasse financeiro mensal: o valor global mensal de repasse corresponde a R$ 100.000,10 (cem mil reais e dez centavos), sendo R$ 90.000,00 (noventa mil reais) a título de custeio.',
    '4. DO SISTEMA DE MONITORAMENTO DE METAS ASSISTENCIAIS - SIMAS',
    'A Secretaria formalizou contrato para o Sistema de Monitoramento de Metas Assistenciais (SIMAS), conforme Portaria SES/PE n.º 471 de 14 de julho de 2022.',
    'Os dados dos pareceres emitidos a partir do 1º trimestre de 2024 foram obtidos através do SIMAS.',
    '5. DA ANÁLISE DOS INDICADORES ASSISTENCIAIS CONTRATUAIS',
    'Conforme o Anexo Técnico I do Contrato de Gestão.',
    '6. DOS APONTAMENTOS DE DESCONTOS',
    'VALOR DE REPASSE MENSAL - Julho R$ 100.000,10',
    'VALOR DE REPASSE MENSAL - Agosto R$ 100.000,10',
    'VALOR DE REPASSE MENSAL - Setembro R$ 100.000,10',
    '9. DAS CONSIDERAÇÕES FINAIS',
    'Diante do exposto, esta Comissão faz as seguintes considerações:',
    '1. Esta Comissão observou a ausência de consultas de Reumatologia nos meses de julho a setembro, e a Unidade foi notificada pelo processo SEI n.º 2300000999.000515/2026-30.',
    '2. O indicador de mamografia alcançou 46,15% no trimestre anterior e a Unidade deve regularizar a oferta.',
    '3. Recomenda-se detalhar melhor os relatórios de matriciamento.',
    '10. DA CONCLUSÃO',
    'A Comissão, fundamentada no inciso IV do artigo 15 da Lei Estadual n.º 15.210/2013, elabora o presente parecer.',
    'Recife, data da assinatura eletrônica.',
  ].join('\n');
}
module.exports.modeloTexto = modeloTexto;
