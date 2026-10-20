'use strict';
// Definição dos formulários (fichas por setor) e das tabelas de linhas brutas.
// Tudo sai dos indicadores 2.1 a 2.16 do igq_v1 e da lista de pedidos (docs/lista-de-pedidos.md).
// Nenhum campo recebe nome, CPF, prontuário ou data de nascimento de paciente.

const SETORES = [
  {
    id: 'assistencia',
    nome: 'Assistência (urgência e emergência)',
    resumo: 'Tempos de espera, retorno em 24 horas e protocolos clínicos (dor torácica, AVE e sepse).',
    indicadores: ['2.1', '2.2', '2.3', '2.4', '2.6', '2.7', '2.8', '2.9'],
    fontes: ['classificacao', 'retorno', 'dor_toracica', 'iamcsst', 'ave', 'sepse'],
  },
  {
    id: 'qualidade',
    nome: 'Qualidade e segurança do paciente',
    resumo: 'Protocolos de segurança (PNSP), revisão de óbitos e amostra de prontuários.',
    indicadores: ['2.5', '2.10'],
    fontes: ['obitos'],
  },
  {
    id: 'ouvidoria',
    nome: 'Ouvidoria, satisfação e transparência',
    resumo: 'Pesquisa de satisfação, queixas e respostas, e ficha de transparência.',
    indicadores: ['2.11', '2.12', '2.13'],
    fontes: ['queixas'],
  },
  {
    id: 'educacao',
    nome: 'Educação permanente',
    resumo: 'Execução do plano e adesão às capacitações, por pessoas únicas.',
    indicadores: ['2.14', '2.15', '2.16'],
    fontes: ['educacao_participacao'],
  },
  {
    id: 'bid',
    nome: 'Transferências e BID',
    resumo: 'Totais do Boletim de Informação Diária e lista de transferências.',
    indicadores: [],
    fontes: ['transferencias'],
  },
  {
    id: 'rh',
    nome: 'Administrativo e recursos humanos',
    resumo: 'Quadro de pessoal ativo, gasto com pessoal e escalas.',
    indicadores: [],
    fontes: ['quadro_pessoal'],
  },
];

const ANEXO_AJUDA = 'Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação.';
const CATEGORIAS_TRANSPARENCIA = ['Desejado', 'Moderado', 'Intermediário', 'Insuficiente', 'Crítico'];

function campo(id, rotulo, tipo, extra) {
  return Object.assign({ id, rotulo, tipo }, extra || {});
}
const anexo = (ind) => campo('i' + ind.replace('.', '_') + '_anexo', 'Anexo que comprova (nº SEI ou arquivo)', 'texto', { indicador: ind, ajuda: ANEXO_AJUDA });

// Campos de cada setor, por indicador.
const CAMPOS = {
  assistencia: [
    campo('i2_1_valor', 'Espera até o atendimento médico, classificação verde (média, em minutos)', 'numero', { indicador: '2.1', unidade: 'min', min: 0, max: 3000, ajuda: 'Média do tempo entre a classificação e o primeiro atendimento médico. Pode ficar em branco se você subir as linhas: o sistema calcula.' }),
    anexo('2.1'),
    campo('i2_2_valor', 'Espera até o atendimento médico, classificação amarela (média, em minutos)', 'numero', { indicador: '2.2', unidade: 'min', min: 0, max: 3000, ajuda: 'Mesma conta do item anterior, só para amarelos.' }),
    anexo('2.2'),
    campo('i2_3_valor', 'Espera até o atendimento médico, classificação vermelha (média, em minutos)', 'numero', { indicador: '2.3', unidade: 'min', min: 0, max: 3000, ajuda: 'Mesma conta, só para vermelhos. A meta é de poucos minutos.' }),
    anexo('2.3'),
    campo('i2_4_valor', 'Taxa de retorno em até 24 horas (%)', 'percentual', { indicador: '2.4', unidade: '%', ajuda: 'Pacientes que voltaram em menos de 24 horas ÷ atendimentos do mês.' }),
    anexo('2.4'),
    campo('i2_6_valor', 'Dor torácica: porta-ECG (média, em minutos)', 'numero', { indicador: '2.6', unidade: 'min', min: 0, max: 600, ajuda: 'Média do tempo entre a chegada e o ECG nos casos de dor torácica.' }),
    anexo('2.6'),
    campo('i2_7_valor', 'IAMCSST: porta-saída (média, em minutos)', 'numero', { indicador: '2.7', unidade: 'min', min: 0, max: 1500, ajuda: 'Tempo médio até a saída (transferência) nos casos de infarto com supra de ST. Informe de onde a contagem parte na coluna de observação.' }),
    campo('iam_casos', 'IAMCSST: número de casos no mês', 'inteiro', { indicador: '2.7', min: 0, ajuda: 'Com poucos casos, a média não é confiável; o sistema avisa.' }),
    anexo('2.7'),
    campo('i2_8_valor', 'AVE: admissão até avaliação médica (média, em minutos)', 'numero', { indicador: '2.8', unidade: 'min', min: 0, max: 600, ajuda: 'Tempo médio entre a admissão e a avaliação médica nos casos de AVE.' }),
    anexo('2.8'),
    campo('i2_9_valor', 'Sepse: porta-antibiótico (média, em minutos)', 'numero', { indicador: '2.9', unidade: 'min', min: 0, max: 1500, ajuda: 'Tempo médio entre a chegada e o primeiro antibiótico nos casos de sepse.' }),
    anexo('2.9'),
    campo('assistencia_obs', 'Observações da assistência', 'texto_longo', { ajuda: 'Explique qualquer situação fora do comum (ex.: sistema fora do ar, ambulâncias indisponíveis).' }),
  ],
  qualidade: [
    campo('i2_5_valor', 'Os protocolos básicos de segurança do paciente foram comprovados por relatório? (RDC 36/2013)', 'sim_nao', { indicador: '2.5', ajuda: 'Responda "sim" só se existe relatório que cubra os protocolos básicos. Ata de reunião e lista de presença não substituem o relatório.' }),
    campo('pnsp_protocolos_abrangidos', 'Quantos dos seis protocolos básicos o relatório cobre', 'inteiro', { indicador: '2.5', min: 0, max: 6, ajuda: 'Identificação do paciente, cirurgia segura, prevenção de quedas, de lesão por pressão, higiene das mãos e segurança na medicação.' }),
    anexo('2.5'),
    campo('i2_10_valor', 'Revisão de óbitos com 24 horas ou mais (%)', 'percentual', { indicador: '2.10', unidade: '%', ajuda: 'Óbitos com 24 h ou mais revisados ÷ óbitos com 24 h ou mais. Pode ficar em branco se você subir a lista.' }),
    campo('obitos_24h', 'Óbitos com 24 horas ou mais de internação', 'inteiro', { indicador: '2.10', min: 0, ajuda: 'Conte só os que ficaram 24 horas ou mais entre a admissão e o óbito.' }),
    campo('obitos_24h_revisados', 'Desses, quantos foram revisados pela comissão', 'inteiro', { indicador: '2.10', min: 0, ajuda: 'Revisão registrada em ata da comissão de óbitos.' }),
    anexo('2.10'),
    campo('prontuarios_amostra', 'Prontuários revisados (amostra)', 'inteiro', { min: 0, ajuda: 'Quantos prontuários a comissão revisou no mês.' }),
    campo('prontuarios_total', 'Total de prontuários do mês', 'inteiro', { min: 0, ajuda: 'Base da amostra. O sistema calcula o percentual real da amostra.' }),
    campo('prontuarios_amostra_pct_declarada', 'Percentual de amostra que o relatório declara', 'percentual', { unidade: '%', ajuda: 'O que está escrito no relatório (ex.: "2%"). O sistema compara com a conta real.' }),
    campo('qualidade_obs', 'Observações da qualidade', 'texto_longo', {}),
  ],
  ouvidoria: [
    campo('satisfacao_respondentes', 'Satisfação: usuários que responderam', 'inteiro', { indicador: '2.11', min: 0, ajuda: 'Número de questionários respondidos no mês.' }),
    campo('satisfacao_satisfeitos', 'Satisfação: usuários satisfeitos', 'inteiro', { indicador: '2.11', min: 0, ajuda: 'Respostas "satisfeito" ou "muito satisfeito" conforme a regra do contrato.' }),
    campo('satisfacao_denominador', 'Satisfação: total de atendimentos do mês (denominador oficial)', 'inteiro', { indicador: '2.11', min: 0, ajuda: 'A cobertura mínima é de 10% dos atendimentos. Use o total do BID do mês e informe a fonte nas observações.' }),
    campo('i2_11_valor', 'Satisfação do usuário (%)', 'percentual', { indicador: '2.11', unidade: '%', ajuda: 'Satisfeitos ÷ respondentes. Pode ficar em branco: o sistema calcula.' }),
    anexo('2.11'),
    campo('queixas_recebidas', 'Queixas recebidas no mês', 'inteiro', { indicador: '2.12', min: 0, ajuda: 'Todas as manifestações recebidas no mês, identificadas ou anônimas.' }),
    campo('queixas_identificadas', 'Queixas identificadas (não anônimas)', 'inteiro', { indicador: '2.12', min: 0, ajuda: 'Queixas anônimas não contam para o indicador.' }),
    campo('queixas_aceitas', 'Respostas aceitas', 'inteiro', { indicador: '2.12', min: 0, ajuda: 'Respostas dadas no prazo e com texto próprio.' }),
    campo('i2_12_valor', 'Aceitação das respostas às queixas (%)', 'percentual', { indicador: '2.12', unidade: '%', ajuda: 'Respostas aceitas ÷ queixas identificadas. Pode ficar em branco.' }),
    anexo('2.12'),
    campo('i2_13_valor', 'Transparência: nível da ficha de avaliação', 'selecao', { indicador: '2.13', opcoes: CATEGORIAS_TRANSPARENCIA, ajuda: 'Nível indicado na Ficha de Avaliação de Transparência do mês.' }),
    anexo('2.13'),
    campo('ouvidoria_obs', 'Observações da ouvidoria', 'texto_longo', {}),
  ],
  educacao: [
    campo('educ_previstas', 'Plano: atividades previstas no mês', 'inteiro', { indicador: '2.14', min: 0, ajuda: 'Atividades do cronograma do plano de educação permanente.' }),
    campo('educ_realizadas', 'Plano: atividades realizadas', 'inteiro', { indicador: '2.14', min: 0, ajuda: 'Atividades que aconteceram, com lista de presença.' }),
    campo('i2_14_valor', 'Execução do plano de educação (%)', 'percentual', { indicador: '2.14', unidade: '%', ajuda: 'Realizadas ÷ previstas. Pode ficar em branco.' }),
    anexo('2.14'),
    campo('educ_capacitados_assist', 'Equipe assistencial: pessoas capacitadas (pessoas únicas)', 'inteiro', { indicador: '2.15', min: 0, ajuda: 'Cada pessoa conta uma vez, mesmo que tenha participado de vários temas. Não some participações.' }),
    campo('educ_ativos_assist', 'Equipe assistencial: pessoas ativas no mês', 'inteiro', { indicador: '2.15', min: 0, ajuda: 'Quadro de pessoal ativo da equipe assistencial.' }),
    campo('i2_15_valor', 'Adesão da equipe assistencial (%)', 'percentual', { indicador: '2.15', unidade: '%', ajuda: 'Capacitadas ÷ ativas. Pode ficar em branco.' }),
    anexo('2.15'),
    campo('educ_capacitados_adm', 'Equipe administrativa: pessoas capacitadas (pessoas únicas)', 'inteiro', { indicador: '2.16', min: 0, ajuda: 'Mesma regra da equipe assistencial.' }),
    campo('educ_ativos_adm', 'Equipe administrativa: pessoas ativas no mês', 'inteiro', { indicador: '2.16', min: 0, ajuda: 'Quadro de pessoal ativo da equipe administrativa.' }),
    campo('i2_16_valor', 'Adesão da equipe administrativa (%)', 'percentual', { indicador: '2.16', unidade: '%', ajuda: 'Capacitadas ÷ ativas. Pode ficar em branco.' }),
    anexo('2.16'),
    campo('educacao_obs', 'Observações da educação permanente', 'texto_longo', {}),
  ],
  bid: [
    campo('bid_atendimentos_medicos', 'BID: atendimentos médicos no mês', 'inteiro', { min: 0, ajuda: 'Total do BID. A produção por turno deve fechar com este número.' }),
    campo('bid_atendimentos_odonto', 'BID: atendimentos odontológicos no mês', 'inteiro', { min: 0, ajuda: 'Total do BID.' }),
    campo('bid_vermelhos', 'BID: classificações vermelhas', 'inteiro', { min: 0, ajuda: 'O sistema compara com as linhas de tempo e com o relatório por turno.' }),
    campo('bid_amarelos', 'BID: classificações amarelas', 'inteiro', { min: 0, ajuda: '' }),
    campo('bid_verdes', 'BID: classificações verdes', 'inteiro', { min: 0, ajuda: '' }),
    campo('bid_azuis', 'BID: classificações azuis', 'inteiro', { min: 0, ajuda: '' }),
    campo('turno_vermelhos', 'Relatório por turno: classificações vermelhas', 'inteiro', { min: 0, ajuda: 'Se a unidade tem relatório por turno, informe para o cruzamento.' }),
    campo('turno_amarelos', 'Relatório por turno: classificações amarelas', 'inteiro', { min: 0, ajuda: '' }),
    campo('turno_verdes', 'Relatório por turno: classificações verdes', 'inteiro', { min: 0, ajuda: '' }),
    campo('bid_obitos', 'BID: óbitos no mês', 'inteiro', { min: 0, ajuda: 'Informe o que o BID chama de óbito e confira com a ata da comissão.' }),
    campo('bid_remocoes', 'BID: remoções (transferências) no mês', 'inteiro', { min: 0, ajuda: 'A lista de transferências deve ter uma linha para cada remoção.' }),
    campo('transf_media_declarada', 'Tempo médio até a transferência declarado (minutos)', 'numero', { unidade: 'min', min: 0, ajuda: 'O valor que o relatório informa. O sistema recalcula pelas linhas.' }),
    campo('i_bid_anexo', 'Anexo do BID (nº SEI ou arquivo)', 'texto', { ajuda: ANEXO_AJUDA }),
    campo('bid_obs', 'Observações', 'texto_longo', {}),
  ],
  rh: [
    campo('gasto_pessoal_pct', 'Gasto com pessoal no mês (% do repasse)', 'percentual', { unidade: '%', ajuda: 'O limite do contrato é 80% (Cláusula Oitava, § 2). O sistema avisa se passar.' }),
    campo('quadro_assist_ativos', 'Quadro assistencial ativo (pessoas)', 'inteiro', { min: 0, ajuda: 'Use a mesma contagem da educação permanente.' }),
    campo('quadro_adm_ativos', 'Quadro administrativo ativo (pessoas)', 'inteiro', { min: 0, ajuda: '' }),
    campo('i_rh_anexo', 'Anexo das escalas (nº SEI ou arquivo)', 'texto', { ajuda: 'Escalas em planilha, não em foto ou impressão.' }),
    campo('rh_obs', 'Observações', 'texto_longo', {}),
  ],
};

// Colunas das tabelas de linhas brutas. "destino" diz em qual coluna genérica o valor vai;
// sem destino, vai para o campo "dados".
const col = (nome, rotulo, tipo, extra) => Object.assign({ nome, rotulo, tipo }, extra || {});
const PROTOCOLO = col('protocolo', 'Protocolo', 'texto', { obrigatorio: true, destino: 'protocolo', ajuda: 'Número do atendimento ou do registro. Nunca o nome do paciente, CPF ou prontuário.' });

const FONTES = {
  classificacao: {
    nome: 'Classificação de risco e tempo até o atendimento', setor: 'assistencia', indicadores: ['2.1', '2.2', '2.3'],
    ajuda: 'Uma linha por atendimento classificado. Origem: relatório de tempo (ACCR até o primeiro atendimento).',
    colunas: [PROTOCOLO,
      col('cor', 'Classificação', 'selecao', { obrigatorio: true, destino: 'categoria', opcoes: ['vermelho', 'laranja', 'amarelo', 'verde', 'azul', 'fast-track'], ajuda: 'vermelho, laranja, amarelo, verde, azul ou fast-track' }),
      col('data_classificacao', 'Data da classificação', 'data', { destino: 'data_inicio' }),
      col('hora_classificacao', 'Hora da classificação', 'hora', { destino: 'hora_inicio' }),
      col('data_atendimento', 'Data do atendimento médico', 'data', { destino: 'data_fim' }),
      col('hora_atendimento', 'Hora do atendimento médico', 'hora', { destino: 'hora_fim' }),
      col('minutos', 'Minutos de espera', 'numero', { destino: 'minutos', ajuda: 'Pode ficar vazio se houver datas e horas.' })],
    exige: 'minutos_ou_datas',
  },
  retorno: {
    nome: 'Retorno em até 24 horas', setor: 'assistencia', indicadores: ['2.4'],
    ajuda: 'Uma linha por atendimento do mês, dizendo se o paciente voltou em menos de 24 horas com o mesmo CID.',
    colunas: [PROTOCOLO, col('retornou_24h', 'Retornou em 24 h?', 'sim_nao', { obrigatorio: true, destino: 'categoria', ajuda: 'sim ou não' })],
  },
  dor_toracica: {
    nome: 'Dor torácica: porta-ECG', setor: 'assistencia', indicadores: ['2.6'],
    ajuda: 'Uma linha por caso de dor torácica. Origem: planilha de protocolos.',
    colunas: [PROTOCOLO,
      col('data_chegada', 'Data da chegada', 'data', { destino: 'data_inicio' }), col('hora_chegada', 'Hora da chegada', 'hora', { destino: 'hora_inicio' }),
      col('data_ecg', 'Data do ECG', 'data', { destino: 'data_fim' }), col('hora_ecg', 'Hora do ECG', 'hora', { destino: 'hora_fim' }),
      col('minutos', 'Minutos até o ECG', 'numero', { destino: 'minutos' })],
    exige: 'minutos_ou_datas',
  },
  iamcsst: {
    nome: 'IAMCSST: porta-saída', setor: 'assistencia', indicadores: ['2.7'],
    ajuda: 'Uma linha por caso de infarto com supra de ST. Origem: planilha de protocolos e ficha de transferência.',
    colunas: [PROTOCOLO,
      col('data_classificacao', 'Data da classificação', 'data', { destino: 'data_inicio' }), col('hora_classificacao', 'Hora da classificação', 'hora', { destino: 'hora_inicio' }),
      col('data_saida', 'Data da saída', 'data', { destino: 'data_fim' }), col('hora_saida', 'Hora da saída', 'hora', { destino: 'hora_fim' }),
      col('minutos', 'Minutos até a saída', 'numero', { destino: 'minutos' }),
      col('contagem_desde', 'Contagem parte de', 'selecao', { opcoes: ['classificação', 'ECG'], ajuda: 'De onde o tempo foi contado: classificação ou ECG.' })],
    exige: 'minutos_ou_datas',
  },
  ave: {
    nome: 'AVE: admissão até avaliação médica', setor: 'assistencia', indicadores: ['2.8'],
    ajuda: 'Uma linha por caso de AVE. Origem: planilha de protocolos.',
    colunas: [PROTOCOLO,
      col('data_admissao', 'Data da admissão', 'data', { destino: 'data_inicio' }), col('hora_admissao', 'Hora da admissão', 'hora', { destino: 'hora_inicio' }),
      col('data_avaliacao', 'Data da avaliação médica', 'data', { destino: 'data_fim' }), col('hora_avaliacao', 'Hora da avaliação médica', 'hora', { destino: 'hora_fim' }),
      col('minutos', 'Minutos até a avaliação', 'numero', { destino: 'minutos' })],
    exige: 'minutos_ou_datas',
  },
  sepse: {
    nome: 'Sepse: porta-antibiótico', setor: 'assistencia', indicadores: ['2.9'],
    ajuda: 'Uma linha por caso de sepse. Origem: planilha de protocolos.',
    colunas: [PROTOCOLO,
      col('data_chegada', 'Data da chegada', 'data', { destino: 'data_inicio' }), col('hora_chegada', 'Hora da chegada', 'hora', { destino: 'hora_inicio' }),
      col('data_antibiotico', 'Data do antibiótico', 'data', { destino: 'data_fim' }), col('hora_antibiotico', 'Hora do antibiótico', 'hora', { destino: 'hora_fim' }),
      col('minutos', 'Minutos até o antibiótico', 'numero', { destino: 'minutos' })],
    exige: 'minutos_ou_datas',
  },
  obitos: {
    nome: 'Óbitos e revisão', setor: 'qualidade', indicadores: ['2.10'],
    ajuda: 'Uma linha por óbito do mês, com as datas de admissão e de óbito e se foi revisado. Origem: BID e ata da comissão.',
    colunas: [PROTOCOLO,
      col('data_admissao', 'Data da admissão', 'data', { obrigatorio: true, destino: 'data_inicio' }), col('hora_admissao', 'Hora da admissão', 'hora', { destino: 'hora_inicio' }),
      col('data_obito', 'Data do óbito', 'data', { obrigatorio: true, destino: 'data_fim' }), col('hora_obito', 'Hora do óbito', 'hora', { destino: 'hora_fim' }),
      col('revisado', 'Revisado pela comissão?', 'sim_nao', { obrigatorio: true, destino: 'categoria', ajuda: 'sim ou não' })],
  },
  queixas: {
    nome: 'Queixas e respostas', setor: 'ouvidoria', indicadores: ['2.12'],
    ajuda: 'Uma linha por queixa. Anônimas contam como "não" em identificada e não entram no indicador.',
    colunas: [PROTOCOLO,
      col('identificada', 'Identificada?', 'sim_nao', { obrigatorio: true, destino: 'categoria', ajuda: 'sim ou não' }),
      col('data_recebimento', 'Data do recebimento', 'data', { obrigatorio: true, destino: 'data_inicio' }),
      col('data_resposta', 'Data da resposta', 'data', { destino: 'data_fim' }),
      col('resposta_propria', 'Resposta com texto próprio?', 'sim_nao', { ajuda: 'sim ou não. Resposta copiada de outra queixa é "não".' })],
  },
  educacao_participacao: {
    nome: 'Participação nas capacitações', setor: 'educacao', indicadores: ['2.15', '2.16'],
    ajuda: 'Uma linha por pessoa e por tema. Use um código interno da pessoa (matrícula ou código gerado), nunca o nome ou o CPF.',
    colunas: [col('codigo_pessoa', 'Código da pessoa', 'texto', { obrigatorio: true, destino: 'protocolo', ajuda: 'Código interno do colaborador. Não escreva o nome.' }),
      col('area', 'Área', 'selecao', { obrigatorio: true, destino: 'categoria', opcoes: ['assistencial', 'administrativa'], ajuda: 'assistencial ou administrativa' }),
      col('categoria_profissional', 'Categoria profissional', 'texto', { ajuda: 'Ex.: médico, enfermeiro, técnico, recepção.' }),
      col('tema', 'Tema da capacitação', 'texto', { obrigatorio: true }),
      col('data', 'Data', 'data', { destino: 'data_inicio' }),
      col('participou', 'Participou?', 'sim_nao', { obrigatorio: true, ajuda: 'sim ou não' })],
  },
  transferencias: {
    nome: 'Lista de transferências', setor: 'bid', indicadores: [],
    ajuda: 'Uma linha por transferência. A lista deve ter todas as remoções do mês (compare com o BID).',
    colunas: [PROTOCOLO,
      col('data_solicitacao', 'Data da solicitação', 'data', { destino: 'data_inicio' }), col('hora_solicitacao', 'Hora da solicitação', 'hora', { destino: 'hora_inicio' }),
      col('data_saida', 'Data da saída', 'data', { destino: 'data_fim' }), col('hora_saida', 'Hora da saída', 'hora', { destino: 'hora_fim' }),
      col('minutos', 'Minutos até a saída', 'numero', { destino: 'minutos' }),
      col('destino', 'Destino', 'texto', { ajuda: 'Unidade ou tipo de leito de destino.' })],
    exige: 'minutos_ou_datas',
  },
  quadro_pessoal: {
    nome: 'Quadro de pessoal', setor: 'rh', indicadores: ['2.15', '2.16'],
    ajuda: 'Uma linha por pessoa do quadro, com código interno. É o denominador da adesão às capacitações.',
    colunas: [col('codigo_pessoa', 'Código da pessoa', 'texto', { obrigatorio: true, destino: 'protocolo', ajuda: 'Mesmo código usado na participação nas capacitações.' }),
      col('area', 'Área', 'selecao', { obrigatorio: true, destino: 'categoria', opcoes: ['assistencial', 'administrativa'] }),
      col('categoria_profissional', 'Categoria profissional', 'texto', {}),
      col('ativo', 'Ativo no mês?', 'sim_nao', { obrigatorio: true, ajuda: 'sim ou não' })],
  },
};

function setor(id) { return SETORES.find((s) => s.id === id); }
function camposDoSetor(id) { return CAMPOS[id] || []; }
function todosOsCampos() {
  const out = {};
  for (const s of SETORES) for (const c of CAMPOS[s.id]) out[c.id] = Object.assign({ setor: s.id }, c);
  return out;
}

module.exports = { SETORES, CAMPOS, FONTES, setor, camposDoSetor, todosOsCampos, CATEGORIAS_TRANSPARENCIA };
