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
