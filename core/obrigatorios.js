'use strict';
// Lista oficial de documentos e relatórios obrigatórios de uma UPA e o checklist de recebimento da Secretaria.
// O que está fora desta lista só fica no sistema se for "complementar" (transferências e pessoal, mantidos por decisão).
const STATUS = ['recebido', 'pendente', 'incompleto', 'não aplicável'];
const VALIDACOES = ['', 'validado', 'com divergências', 'com inconsistências'];

// docs: campos da ficha que comprovam o item (todos devem estar preenchidos para "recebido").
const ITENS = [
  { id: 'producao', titulo: 'Produção: relatório mensal de atendimentos', grupo: 'Produção', indicadores: [], campos: ['bid_atendimentos_medicos'], docs: ['i_bid_anexo'] },
  { id: 'eficiencia', titulo: 'Eficiência assistencial: tempos da classificação ao atendimento (verde, amarelo, vermelho)', grupo: 'Qualidade', indicadores: ['2.1', '2.2', '2.3'], docs: ['i2_1_anexo', 'i2_2_anexo', 'i2_3_anexo'] },
  { id: 'retorno', titulo: 'Eficiência assistencial: retorno em até 24 horas', grupo: 'Qualidade', indicadores: ['2.4'], docs: ['i2_4_anexo'] },
  { id: 'seguranca', titulo: 'Eficiência assistencial: relatório de segurança do paciente', grupo: 'Qualidade', indicadores: ['2.5'], docs: ['i2_5_anexo'] },
  { id: 'dor_toracica', titulo: 'Dor torácica: porta-ECG', grupo: 'Qualidade', indicadores: ['2.6'], docs: ['i2_6_anexo'] },
  { id: 'iamcsst', titulo: 'Dor torácica: porta-saída do IAMCSST', grupo: 'Qualidade', indicadores: ['2.7'], docs: ['i2_7_anexo'] },
  { id: 'ave', titulo: 'AVE: admissão até avaliação médica', grupo: 'Qualidade', indicadores: ['2.8'], docs: ['i2_8_anexo'] },
  { id: 'sepse', titulo: 'Sepse: porta-antibiótico', grupo: 'Qualidade', indicadores: ['2.9'], docs: ['i2_9_anexo'] },
  { id: 'obitos', titulo: 'Vigilância de óbito: relatório da Comissão de Óbitos e percentual de óbitos revisados', grupo: 'Qualidade', indicadores: ['2.10'], docs: ['i2_10_anexo', 'obitos_relatorio_comissao'] },
  { id: 'satisfacao', titulo: 'Atenção ao usuário: satisfação', grupo: 'Qualidade', indicadores: ['2.11'], docs: ['i2_11_anexo'] },
  { id: 'queixas', titulo: 'Atenção ao usuário: aceite das queixas', grupo: 'Qualidade', indicadores: ['2.12'], docs: ['i2_12_anexo'] },
  { id: 'transparencia', titulo: 'Transparência: informações que permitam aferir a qualidade da publicação', grupo: 'Qualidade', indicadores: ['2.13'], docs: ['i2_13_anexo', 'transparencia_publicacao'] },
  { id: 'educ_plano', titulo: 'Educação permanente: plano', grupo: 'Qualidade', indicadores: ['2.14'], docs: ['i2_14_anexo'] },
  { id: 'educ_assist', titulo: 'Educação permanente: adesão da equipe assistencial', grupo: 'Qualidade', indicadores: ['2.15'], docs: ['i2_15_anexo'] },
  { id: 'educ_adm', titulo: 'Educação permanente: adesão da equipe administrativa', grupo: 'Qualidade', indicadores: ['2.16'], docs: ['i2_16_anexo'] },
  { id: 'transferencias', titulo: 'Transferências (complementar)', grupo: 'Complementar', complementar: true, indicadores: [], campos: ['bid_remocoes'], docs: [], fonte: 'transferencias' },
  { id: 'pessoal', titulo: 'Pessoal e escalas (complementar)', grupo: 'Complementar', complementar: true, indicadores: [], campos: ['gasto_pessoal_pct'], docs: ['i_rh_anexo'] },
];

// Indicadores 2.1 a 2.9 de tempo e retorno: quando o valor é só digitado, a unidade deve informar também numerador e denominador.
const BASES = {
  '2.1': ['i2_1_soma', 'i2_1_n'], '2.2': ['i2_2_soma', 'i2_2_n'], '2.3': ['i2_3_soma', 'i2_3_n'], '2.4': ['i2_4_retornos', 'i2_4_saidas'],
  '2.6': ['i2_6_soma', 'i2_6_n'], '2.7': ['i2_7_soma', 'iam_casos'], '2.8': ['i2_8_soma', 'i2_8_n'], '2.9': ['i2_9_soma', 'i2_9_n'],
};

const preenchido = (v) => v !== undefined && v !== null && String(v).trim() !== '';

// Situação sugerida pelo que a unidade informou. Nunca devolve "não aplicável" (essa é decisão de pessoa).
// flat: campos de todas as fichas; indicadores: snapshot.indicadores; resumoLinhas: snapshot.resumoLinhas.
function situacaoSugerida(item, flat, indicadores, resumoLinhas) {
  const valores = item.indicadores.map((id) => {
    const c = (indicadores || {})[id];
    return c && c.valor !== null && c.valor !== undefined && c.valor !== '';
  });
  const temValor = item.indicadores.length ? valores.some(Boolean) : (item.campos || []).some((c) => preenchido(flat[c])) || (item.fonte && resumoLinhas && resumoLinhas[item.fonte] && resumoLinhas[item.fonte].n > 0);
  const semBase = (id) => { const c = (indicadores || {})[id]; return !!BASES[id] && !!c && c.origem === 'digitado' && !BASES[id].every((f) => preenchido(flat[f])); };
  const valorCompleto = item.indicadores.length ? valores.every(Boolean) && !item.indicadores.some(semBase) : (item.campos || []).every((c) => preenchido(flat[c])) || !!(item.fonte && resumoLinhas && resumoLinhas[item.fonte] && resumoLinhas[item.fonte].n > 0);
  const docsOk = (item.docs || []).filter((d) => preenchido(flat[d])).length;
  const docsTotal = (item.docs || []).length;
  if (!temValor && docsOk === 0) return 'pendente';
  if (valorCompleto && docsOk === docsTotal) return 'recebido';
  return 'incompleto';
}

// Motivo curto do "incompleto" para mostrar ao conferente.
function faltas(item, flat, indicadores, resumoLinhas) {
  const f = [];
  const valores = item.indicadores.filter((id) => { const c = (indicadores || {})[id]; return !(c && c.valor !== null && c.valor !== undefined && c.valor !== ''); });
  const semBase = item.indicadores.filter((id) => { const c = (indicadores || {})[id]; return !!BASES[id] && !!c && c.origem === 'digitado' && !BASES[id].every((x) => preenchido(flat[x])); });
  if (valores.length) f.push('sem valor: ' + valores.join(', '));
  if (semBase.length) f.push('sem numerador e denominador: ' + semBase.join(', '));
  else if (!item.indicadores.length && (item.campos || []).some((c) => !preenchido(flat[c])) && !(item.fonte && resumoLinhas && resumoLinhas[item.fonte] && resumoLinhas[item.fonte].n > 0)) f.push('sem o total do mês');
  const semDoc = (item.docs || []).filter((d) => !preenchido(flat[d]));
  if (semDoc.length) f.push('sem comprovação (' + semDoc.length + ' de ' + item.docs.length + ')');
  return f;
}

module.exports = { BASES, ITENS, STATUS, VALIDACOES, situacaoSugerida, faltas, preenchido };
