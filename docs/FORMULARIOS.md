# Formulários da unidade

Este arquivo é gerado do código (`core/formularios.js`). Não edite à mão: rode `node scripts/gerar-doc-formularios.js`.

Regra de ouro: **nenhum dado de paciente**. Os campos aceitam só número de protocolo, datas, horas, minutos e categorias. CPF, cartão SUS, e-mail e telefone digitados em texto livre são recusados.

## Fichas por setor

Cada setor da unidade preenche a sua ficha. O gestor da unidade vê todas e envia. A ficha só conta no envio quando está marcada como "pronta".

### Assistência (urgência e emergência) (`assistencia`)

Tempos de espera, retorno em 24 horas e protocolos clínicos (dor torácica, AVE e sepse).

Indicadores: 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.8, 2.9. Listas (linhas): Classificação de risco e tempo até o atendimento; Retorno em até 24 horas; Dor torácica: porta-ECG; IAMCSST: porta-saída; AVE: admissão até avaliação médica; Sepse: porta-antibiótico.

| Campo | Tipo | Faixa | Indicador | Ajuda |
|---|---|---|---|---|
| Espera até o atendimento médico, classificação verde (média, em minutos) (`i2_1_valor`) | numero | 0 a 3000 min | 2.1 | Média do tempo entre a classificação e o primeiro atendimento médico. Pode ficar em branco se você subir as linhas: o sistema calcula. |
| Anexo que comprova (nº SEI ou arquivo) (`i2_1_anexo`) | texto |  | 2.1 | Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação. |
| Espera até o atendimento médico, classificação amarela (média, em minutos) (`i2_2_valor`) | numero | 0 a 3000 min | 2.2 | Mesma conta do item anterior, só para amarelos. |
| Anexo que comprova (nº SEI ou arquivo) (`i2_2_anexo`) | texto |  | 2.2 | Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação. |
| Espera até o atendimento médico, classificação vermelha (média, em minutos) (`i2_3_valor`) | numero | 0 a 3000 min | 2.3 | Mesma conta, só para vermelhos. A meta é de poucos minutos. |
| Anexo que comprova (nº SEI ou arquivo) (`i2_3_anexo`) | texto |  | 2.3 | Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação. |
| Taxa de retorno em até 24 horas (%) (`i2_4_valor`) | percentual | % | 2.4 | Pacientes que voltaram em menos de 24 horas ÷ atendimentos do mês. |
| Anexo que comprova (nº SEI ou arquivo) (`i2_4_anexo`) | texto |  | 2.4 | Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação. |
| Dor torácica: porta-ECG (média, em minutos) (`i2_6_valor`) | numero | 0 a 600 min | 2.6 | Média do tempo entre a chegada e o ECG nos casos de dor torácica. |
| Anexo que comprova (nº SEI ou arquivo) (`i2_6_anexo`) | texto |  | 2.6 | Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação. |
| IAMCSST: porta-saída (média, em minutos) (`i2_7_valor`) | numero | 0 a 1500 min | 2.7 | Tempo médio até a saída (transferência) nos casos de infarto com supra de ST. Informe de onde a contagem parte na coluna de observação. |
| IAMCSST: número de casos no mês (`iam_casos`) | inteiro | 0 a  | 2.7 | Com poucos casos, a média não é confiável; o sistema avisa. |
| Anexo que comprova (nº SEI ou arquivo) (`i2_7_anexo`) | texto |  | 2.7 | Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação. |
| AVE: admissão até avaliação médica (média, em minutos) (`i2_8_valor`) | numero | 0 a 600 min | 2.8 | Tempo médio entre a admissão e a avaliação médica nos casos de AVE. |
| Anexo que comprova (nº SEI ou arquivo) (`i2_8_anexo`) | texto |  | 2.8 | Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação. |
| Sepse: porta-antibiótico (média, em minutos) (`i2_9_valor`) | numero | 0 a 1500 min | 2.9 | Tempo médio entre a chegada e o primeiro antibiótico nos casos de sepse. |
| Anexo que comprova (nº SEI ou arquivo) (`i2_9_anexo`) | texto |  | 2.9 | Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação. |
| Observações da assistência (`assistencia_obs`) | texto_longo |  |  | Explique qualquer situação fora do comum (ex.: sistema fora do ar, ambulâncias indisponíveis). |

### Qualidade e segurança do paciente (`qualidade`)

Protocolos de segurança (PNSP), revisão de óbitos e amostra de prontuários.

Indicadores: 2.5, 2.10. Listas (linhas): Óbitos e revisão.

| Campo | Tipo | Faixa | Indicador | Ajuda |
|---|---|---|---|---|
| Os protocolos básicos de segurança do paciente foram comprovados por relatório? (RDC 36/2013) (`i2_5_valor`) | sim_nao |  | 2.5 | Responda "sim" só se existe relatório que cubra os protocolos básicos. Ata de reunião e lista de presença não substituem o relatório. |
| Quantos dos seis protocolos básicos o relatório cobre (`pnsp_protocolos_abrangidos`) | inteiro | 0 a 6 | 2.5 | Identificação do paciente, cirurgia segura, prevenção de quedas, de lesão por pressão, higiene das mãos e segurança na medicação. |
| Anexo que comprova (nº SEI ou arquivo) (`i2_5_anexo`) | texto |  | 2.5 | Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação. |
| Revisão de óbitos com 24 horas ou mais (%) (`i2_10_valor`) | percentual | % | 2.10 | Óbitos com 24 h ou mais revisados ÷ óbitos com 24 h ou mais. Pode ficar em branco se você subir a lista. |
| Óbitos com 24 horas ou mais de internação (`obitos_24h`) | inteiro | 0 a  | 2.10 | Conte só os que ficaram 24 horas ou mais entre a admissão e o óbito. |
| Desses, quantos foram revisados pela comissão (`obitos_24h_revisados`) | inteiro | 0 a  | 2.10 | Revisão registrada em ata da comissão de óbitos. |
| Anexo que comprova (nº SEI ou arquivo) (`i2_10_anexo`) | texto |  | 2.10 | Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação. |
| Relatório da Comissão de Óbitos (nº SEI ou arquivo) (`obitos_relatorio_comissao`) | texto |  | 2.10 | Obrigatório na lista da Secretaria: o relatório da comissão do mês, com a ata da revisão. Informe o número do documento no SEI ou o nome do arquivo. |
| Prontuários revisados (amostra) (`prontuarios_amostra`) | inteiro | 0 a  |  | Quantos prontuários a comissão revisou no mês. |
| Total de prontuários do mês (`prontuarios_total`) | inteiro | 0 a  |  | Base da amostra. O sistema calcula o percentual real da amostra. |
| Percentual de amostra que o relatório declara (`prontuarios_amostra_pct_declarada`) | percentual | % |  | O que está escrito no relatório (ex.: "2%"). O sistema compara com a conta real. |
| Observações da qualidade (`qualidade_obs`) | texto_longo |  |  |  |

### Ouvidoria, satisfação e transparência (`ouvidoria`)

Pesquisa de satisfação, queixas e respostas, e ficha de transparência.

Indicadores: 2.11, 2.12, 2.13. Listas (linhas): Queixas e respostas.

| Campo | Tipo | Faixa | Indicador | Ajuda |
|---|---|---|---|---|
| Satisfação: usuários que responderam (`satisfacao_respondentes`) | inteiro | 0 a  | 2.11 | Número de questionários respondidos no mês. |
| Satisfação: usuários satisfeitos (`satisfacao_satisfeitos`) | inteiro | 0 a  | 2.11 | Respostas "satisfeito" ou "muito satisfeito" conforme a regra do contrato. |
| Satisfação: total de atendimentos do mês (denominador oficial) (`satisfacao_denominador`) | inteiro | 0 a  | 2.11 | A cobertura mínima é de 10% dos atendimentos. Use o total do BID do mês e informe a fonte nas observações. |
| Satisfação do usuário (%) (`i2_11_valor`) | percentual | % | 2.11 | Satisfeitos ÷ respondentes. Pode ficar em branco: o sistema calcula. |
| Anexo que comprova (nº SEI ou arquivo) (`i2_11_anexo`) | texto |  | 2.11 | Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação. |
| Queixas recebidas no mês (`queixas_recebidas`) | inteiro | 0 a  | 2.12 | Todas as manifestações recebidas no mês, identificadas ou anônimas. |
| Queixas identificadas (não anônimas) (`queixas_identificadas`) | inteiro | 0 a  | 2.12 | Queixas anônimas não contam para o indicador. |
| Respostas aceitas (`queixas_aceitas`) | inteiro | 0 a  | 2.12 | Respostas dadas no prazo e com texto próprio. |
| Aceitação das respostas às queixas (%) (`i2_12_valor`) | percentual | % | 2.12 | Respostas aceitas ÷ queixas identificadas. Pode ficar em branco. |
| Anexo que comprova (nº SEI ou arquivo) (`i2_12_anexo`) | texto |  | 2.12 | Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação. |
| Transparência: nível da ficha de avaliação (`i2_13_valor`) | selecao | Desejado / Moderado / Intermediário / Insuficiente / Crítico | 2.13 | Nível indicado na Ficha de Avaliação de Transparência do mês. |
| Anexo que comprova (nº SEI ou arquivo) (`i2_13_anexo`) | texto |  | 2.13 | Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação. |
| Informações da publicação de transparência (`transparencia_publicacao`) | texto_longo |  | 2.13 | Obrigatório na lista da Secretaria: informações que permitam aferir a qualidade da publicação (endereço da página, data da publicação e o que foi publicado). Não cole dado de paciente. |
| Observações da ouvidoria (`ouvidoria_obs`) | texto_longo |  |  |  |

### Educação permanente (`educacao`)

Execução do plano e adesão às capacitações, por pessoas únicas.

Indicadores: 2.14, 2.15, 2.16. Listas (linhas): Participação nas capacitações.

| Campo | Tipo | Faixa | Indicador | Ajuda |
|---|---|---|---|---|
| Plano: atividades previstas no mês (`educ_previstas`) | inteiro | 0 a  | 2.14 | Atividades do cronograma do plano de educação permanente. |
| Plano: atividades realizadas (`educ_realizadas`) | inteiro | 0 a  | 2.14 | Atividades que aconteceram, com lista de presença. |
| Execução do plano de educação (%) (`i2_14_valor`) | percentual | % | 2.14 | Realizadas ÷ previstas. Pode ficar em branco. |
| Anexo que comprova (nº SEI ou arquivo) (`i2_14_anexo`) | texto |  | 2.14 | Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação. |
| Equipe assistencial: pessoas capacitadas (pessoas únicas) (`educ_capacitados_assist`) | inteiro | 0 a  | 2.15 | Cada pessoa conta uma vez, mesmo que tenha participado de vários temas. Não some participações. |
| Equipe assistencial: pessoas ativas no mês (`educ_ativos_assist`) | inteiro | 0 a  | 2.15 | Quadro de pessoal ativo da equipe assistencial. |
| Adesão da equipe assistencial (%) (`i2_15_valor`) | percentual | % | 2.15 | Capacitadas ÷ ativas. Pode ficar em branco. |
| Anexo que comprova (nº SEI ou arquivo) (`i2_15_anexo`) | texto |  | 2.15 | Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação. |
| Equipe administrativa: pessoas capacitadas (pessoas únicas) (`educ_capacitados_adm`) | inteiro | 0 a  | 2.16 | Mesma regra da equipe assistencial. |
| Equipe administrativa: pessoas ativas no mês (`educ_ativos_adm`) | inteiro | 0 a  | 2.16 | Quadro de pessoal ativo da equipe administrativa. |
| Adesão da equipe administrativa (%) (`i2_16_valor`) | percentual | % | 2.16 | Capacitadas ÷ ativas. Pode ficar em branco. |
| Anexo que comprova (nº SEI ou arquivo) (`i2_16_anexo`) | texto |  | 2.16 | Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação. |
| Observações da educação permanente (`educacao_obs`) | texto_longo |  |  |  |

### Transferências e BID (`bid`)

Totais do Boletim de Informação Diária e lista de transferências.

Indicadores: —. Listas (linhas): Lista de transferências.

| Campo | Tipo | Faixa | Indicador | Ajuda |
|---|---|---|---|---|
| BID: atendimentos médicos no mês (`bid_atendimentos_medicos`) | inteiro | 0 a  |  | Total do BID. A produção por turno deve fechar com este número. |
| BID: atendimentos odontológicos no mês (`bid_atendimentos_odonto`) | inteiro | 0 a  |  | Total do BID. |
| BID: classificações vermelhas (`bid_vermelhos`) | inteiro | 0 a  |  | O sistema compara com as linhas de tempo e com o relatório por turno. |
| BID: classificações amarelas (`bid_amarelos`) | inteiro | 0 a  |  |  |
| BID: classificações verdes (`bid_verdes`) | inteiro | 0 a  |  |  |
| BID: classificações azuis (`bid_azuis`) | inteiro | 0 a  |  |  |
| Relatório por turno: classificações vermelhas (`turno_vermelhos`) | inteiro | 0 a  |  | Se a unidade tem relatório por turno, informe para o cruzamento. |
| Relatório por turno: classificações amarelas (`turno_amarelos`) | inteiro | 0 a  |  |  |
| Relatório por turno: classificações verdes (`turno_verdes`) | inteiro | 0 a  |  |  |
| BID: óbitos no mês (`bid_obitos`) | inteiro | 0 a  |  | Informe o que o BID chama de óbito e confira com a ata da comissão. |
| BID: remoções (transferências) no mês (`bid_remocoes`) | inteiro | 0 a  |  | A lista de transferências deve ter uma linha para cada remoção. |
| Tempo médio até a transferência declarado (minutos) (`transf_media_declarada`) | numero | 0 a  min |  | O valor que o relatório informa. O sistema recalcula pelas linhas. |
| Anexo do BID (nº SEI ou arquivo) (`i_bid_anexo`) | texto |  |  | Número do documento no SEI ou nome do arquivo que comprova o dado. Sem anexo, o item pode ficar sem pontuação. |
| Observações (`bid_obs`) | texto_longo |  |  |  |

### Administrativo e recursos humanos (`rh`)

Quadro de pessoal ativo, gasto com pessoal e escalas.

Indicadores: —. Listas (linhas): Quadro de pessoal.

| Campo | Tipo | Faixa | Indicador | Ajuda |
|---|---|---|---|---|
| Gasto com pessoal no mês (% do repasse) (`gasto_pessoal_pct`) | percentual | % |  | O limite do contrato é 80% (Cláusula Oitava, § 2). O sistema avisa se passar. |
| Quadro assistencial ativo (pessoas) (`quadro_assist_ativos`) | inteiro | 0 a  |  | Use a mesma contagem da educação permanente. |
| Quadro administrativo ativo (pessoas) (`quadro_adm_ativos`) | inteiro | 0 a  |  |  |
| Anexo das escalas (nº SEI ou arquivo) (`i_rh_anexo`) | texto |  |  | Escalas em planilha, não em foto ou impressão. |
| Observações (`rh_obs`) | texto_longo |  |  |  |

## Lista oficial de obrigatórios da UPA e checklist de recebimento

Prazos: envio no **SEI até o dia 20** e no **SIMAS até o dia 25** do mês seguinte à competência. O monitoramento é mensal e a consolidação, trimestral. Atraso e alerta (a vencer em até 5 dias) aparecem no portal da unidade e no console da CTAI.

Ao receber um envio, a CTAI preenche o checklist da Secretaria para cada item: **competência**, **data de recebimento**, **status** (recebido, pendente, incompleto, não aplicável), **responsável pelo envio**, **validação** (divergências e inconsistências) e **observações**. O sistema sugere o status pelo que a unidade informou; a decisão de quem confere prevalece e fica na trilha.

| Item | Grupo | Indicadores | Comprovação exigida (campos) |
|---|---|---|---|
| Produção: relatório mensal de atendimentos | Produção | — | `i_bid_anexo` |
| Eficiência assistencial: tempos da classificação ao atendimento (verde, amarelo, vermelho) | Qualidade | 2.1, 2.2, 2.3 | `i2_1_anexo`, `i2_2_anexo`, `i2_3_anexo` |
| Eficiência assistencial: retorno em até 24 horas | Qualidade | 2.4 | `i2_4_anexo` |
| Eficiência assistencial: relatório de segurança do paciente | Qualidade | 2.5 | `i2_5_anexo` |
| Dor torácica: porta-ECG | Qualidade | 2.6 | `i2_6_anexo` |
| Dor torácica: porta-saída do IAMCSST | Qualidade | 2.7 | `i2_7_anexo` |
| AVE: admissão até avaliação médica | Qualidade | 2.8 | `i2_8_anexo` |
| Sepse: porta-antibiótico | Qualidade | 2.9 | `i2_9_anexo` |
| Vigilância de óbito: relatório da Comissão de Óbitos e percentual de óbitos revisados | Qualidade | 2.10 | `i2_10_anexo`, `obitos_relatorio_comissao` |
| Atenção ao usuário: satisfação | Qualidade | 2.11 | `i2_11_anexo` |
| Atenção ao usuário: aceite das queixas | Qualidade | 2.12 | `i2_12_anexo` |
| Transparência: informações que permitam aferir a qualidade da publicação | Qualidade | 2.13 | `i2_13_anexo`, `transparencia_publicacao` |
| Educação permanente: plano | Qualidade | 2.14 | `i2_14_anexo` |
| Educação permanente: adesão da equipe assistencial | Qualidade | 2.15 | `i2_15_anexo` |
| Educação permanente: adesão da equipe administrativa | Qualidade | 2.16 | `i2_16_anexo` |
| Transferências (complementar) | Complementar | — | — |
| Pessoal e escalas (complementar) | Complementar | — | `i_rh_anexo` |

Transferências e Pessoal ficam como **complementares** (mantidos por decisão): entram no checklist, mas não contam no resumo dos obrigatórios.

## Listas de linhas (CSV ou digitação)

Cada lista aceita CSV com separador `;` ou `,`, com a primeira linha de cabeçalho. O modelo de cada lista está no botão "Baixar o modelo" da própria tela. Colunas com cara de dado pessoal (nome, CPF, prontuário, data de nascimento, telefone, e-mail, endereço) fazem o arquivo inteiro ser **recusado**.

### Classificação de risco e tempo até o atendimento (`classificacao`)

Uma linha por atendimento classificado. Origem: relatório de tempo (ACCR até o primeiro atendimento).

| Coluna | Tipo | Obrigatória | Observação |
|---|---|---|---|
| `protocolo` — Protocolo | texto | sim | Número do atendimento ou do registro. Nunca o nome do paciente, CPF ou prontuário. |
| `cor` — Classificação | selecao | sim | vermelho / laranja / amarelo / verde / azul / fast-track. vermelho, laranja, amarelo, verde, azul ou fast-track |
| `data_classificacao` — Data da classificação | data | não |  |
| `hora_classificacao` — Hora da classificação | hora | não |  |
| `data_atendimento` — Data do atendimento médico | data | não |  |
| `hora_atendimento` — Hora do atendimento médico | hora | não |  |
| `minutos` — Minutos de espera | numero | não | Pode ficar vazio se houver datas e horas. |

### Retorno em até 24 horas (`retorno`)

Uma linha por atendimento do mês, dizendo se o paciente voltou em menos de 24 horas com o mesmo CID.

| Coluna | Tipo | Obrigatória | Observação |
|---|---|---|---|
| `protocolo` — Protocolo | texto | sim | Número do atendimento ou do registro. Nunca o nome do paciente, CPF ou prontuário. |
| `retornou_24h` — Retornou em 24 h? | sim_nao | sim | sim ou não |

### Dor torácica: porta-ECG (`dor_toracica`)

Uma linha por caso de dor torácica. Origem: planilha de protocolos.

| Coluna | Tipo | Obrigatória | Observação |
|---|---|---|---|
| `protocolo` — Protocolo | texto | sim | Número do atendimento ou do registro. Nunca o nome do paciente, CPF ou prontuário. |
| `data_chegada` — Data da chegada | data | não |  |
| `hora_chegada` — Hora da chegada | hora | não |  |
| `data_ecg` — Data do ECG | data | não |  |
| `hora_ecg` — Hora do ECG | hora | não |  |
| `minutos` — Minutos até o ECG | numero | não |  |

### IAMCSST: porta-saída (`iamcsst`)

Uma linha por caso de infarto com supra de ST. Origem: planilha de protocolos e ficha de transferência.

| Coluna | Tipo | Obrigatória | Observação |
|---|---|---|---|
| `protocolo` — Protocolo | texto | sim | Número do atendimento ou do registro. Nunca o nome do paciente, CPF ou prontuário. |
| `data_classificacao` — Data da classificação | data | não |  |
| `hora_classificacao` — Hora da classificação | hora | não |  |
| `data_saida` — Data da saída | data | não |  |
| `hora_saida` — Hora da saída | hora | não |  |
| `minutos` — Minutos até a saída | numero | não |  |
| `contagem_desde` — Contagem parte de | selecao | não | classificação / ECG. De onde o tempo foi contado: classificação ou ECG. |

### AVE: admissão até avaliação médica (`ave`)

Uma linha por caso de AVE. Origem: planilha de protocolos.

| Coluna | Tipo | Obrigatória | Observação |
|---|---|---|---|
| `protocolo` — Protocolo | texto | sim | Número do atendimento ou do registro. Nunca o nome do paciente, CPF ou prontuário. |
| `data_admissao` — Data da admissão | data | não |  |
| `hora_admissao` — Hora da admissão | hora | não |  |
| `data_avaliacao` — Data da avaliação médica | data | não |  |
| `hora_avaliacao` — Hora da avaliação médica | hora | não |  |
| `minutos` — Minutos até a avaliação | numero | não |  |

### Sepse: porta-antibiótico (`sepse`)

Uma linha por caso de sepse. Origem: planilha de protocolos.

| Coluna | Tipo | Obrigatória | Observação |
|---|---|---|---|
| `protocolo` — Protocolo | texto | sim | Número do atendimento ou do registro. Nunca o nome do paciente, CPF ou prontuário. |
| `data_chegada` — Data da chegada | data | não |  |
| `hora_chegada` — Hora da chegada | hora | não |  |
| `data_antibiotico` — Data do antibiótico | data | não |  |
| `hora_antibiotico` — Hora do antibiótico | hora | não |  |
| `minutos` — Minutos até o antibiótico | numero | não |  |

### Óbitos e revisão (`obitos`)

Uma linha por óbito do mês, com as datas de admissão e de óbito e se foi revisado. Origem: BID e ata da comissão.

| Coluna | Tipo | Obrigatória | Observação |
|---|---|---|---|
| `protocolo` — Protocolo | texto | sim | Número do atendimento ou do registro. Nunca o nome do paciente, CPF ou prontuário. |
| `data_admissao` — Data da admissão | data | sim |  |
| `hora_admissao` — Hora da admissão | hora | não |  |
| `data_obito` — Data do óbito | data | sim |  |
| `hora_obito` — Hora do óbito | hora | não |  |
| `revisado` — Revisado pela comissão? | sim_nao | sim | sim ou não |

### Queixas e respostas (`queixas`)

Uma linha por queixa. Anônimas contam como "não" em identificada e não entram no indicador.

| Coluna | Tipo | Obrigatória | Observação |
|---|---|---|---|
| `protocolo` — Protocolo | texto | sim | Número do atendimento ou do registro. Nunca o nome do paciente, CPF ou prontuário. |
| `identificada` — Identificada? | sim_nao | sim | sim ou não |
| `data_recebimento` — Data do recebimento | data | sim |  |
| `data_resposta` — Data da resposta | data | não |  |
| `resposta_propria` — Resposta com texto próprio? | sim_nao | não | sim ou não. Resposta copiada de outra queixa é "não". |

### Participação nas capacitações (`educacao_participacao`)

Uma linha por pessoa e por tema. Use um código interno da pessoa (matrícula ou código gerado), nunca o nome ou o CPF.

| Coluna | Tipo | Obrigatória | Observação |
|---|---|---|---|
| `codigo_pessoa` — Código da pessoa | texto | sim | Código interno do colaborador. Não escreva o nome. |
| `area` — Área | selecao | sim | assistencial / administrativa. assistencial ou administrativa |
| `categoria_profissional` — Categoria profissional | texto | não | Ex.: médico, enfermeiro, técnico, recepção. |
| `tema` — Tema da capacitação | texto | sim |  |
| `data` — Data | data | não |  |
| `participou` — Participou? | sim_nao | sim | sim ou não |

### Lista de transferências (`transferencias`)

Uma linha por transferência. A lista deve ter todas as remoções do mês (compare com o BID).

| Coluna | Tipo | Obrigatória | Observação |
|---|---|---|---|
| `protocolo` — Protocolo | texto | sim | Número do atendimento ou do registro. Nunca o nome do paciente, CPF ou prontuário. |
| `data_solicitacao` — Data da solicitação | data | não |  |
| `hora_solicitacao` — Hora da solicitação | hora | não |  |
| `data_saida` — Data da saída | data | não |  |
| `hora_saida` — Hora da saída | hora | não |  |
| `minutos` — Minutos até a saída | numero | não |  |
| `destino` — Destino | texto | não | Unidade ou tipo de leito de destino. |

### Quadro de pessoal (`quadro_pessoal`)

Uma linha por pessoa do quadro, com código interno. É o denominador da adesão às capacitações.

| Coluna | Tipo | Obrigatória | Observação |
|---|---|---|---|
| `codigo_pessoa` — Código da pessoa | texto | sim | Mesmo código usado na participação nas capacitações. |
| `area` — Área | selecao | sim | assistencial / administrativa.  |
| `categoria_profissional` — Categoria profissional | texto | não |  |
| `ativo` — Ativo no mês? | sim_nao | sim | sim ou não |

## Pontuação (regra `undefined`)

| Item | Indicador | Máx. | Faixas |
|---|---|---|---|
| 2.1 | Tempo classificação até atendimento (verde) | 5 | até 120 min: 5 · até 180 min: 3 · até 240 min: 1 · acima: 0 |
| 2.2 | Tempo classificação até atendimento (amarelo) | 6 | até 60 min: 6 · até 120 min: 4 · até 180 min: 2 · acima: 0 |
| 2.3 | Tempo classificação até atendimento (vermelho) | 7 | até 5 min: 7 · até 6 min: 4 · até 10 min: 2 · acima: 0 **(pendente: parecer tratou como binário (0 se não atingiu); planilha por faixa)** |
| 2.4 | Taxa de retorno em até 24h | 5 | até 5 %: 5 · acima: 0 |
| 2.5 | Conformidade PNSP (relatório comprobatório, RDC 36/2013) | 4 | Atende: 4 ponto(s); não atende: 0 |
| 2.6 | Dor torácica: porta-ECG | 7 | até 10 min: 7 · acima: 0 |
| 2.7 | Dor torácica: porta-saída IAMCSST | 7 | até 30 min: 7 · acima: 0 **(pendente: meta ≤30 min (abr/mai) ou <120 min (jun): confirmar)** |
| 2.8 | AVE: admissão até avaliação médica | 7 | até 10 min: 7 · acima: 0 |
| 2.9 | Sepse: porta-antibiótico | 7 | até 60 min: 7 · acima: 0 |
| 2.10 | Revisão de óbitos ≥24h | 5 | acima de 90 %: 5 · a partir de 80 %: 3 · abaixo: 0 **(pendente: definição de óbito no BID e identificação dos ≥24h)** |
| 2.11 | Satisfação do usuário | 6 | a partir de 90 %: 6 · a partir de 80 %: 4 · a partir de 70 %: 2 · abaixo: 0 **(pendente: denominador oficial do mês)** |
| 2.12 | Aceite das queixas | 6 | a partir de 80 %: 6 · abaixo: 0 |
| 2.13 | Transparência | 7 | Desejado 7 · Moderado 5 · Intermediário 3 · Insuficiente 1 · Crítico 0 |
| 2.14 | Plano de educação permanente executado | 7 | a partir de 100 %: 7 · a partir de 90 %: 5 · a partir de 80 %: 3 · a partir de 70 %: 1 · abaixo: 0 |
| 2.15 | Adesão da equipe assistencial | 7 | a partir de 80 %: 7 · a partir de 70 %: 5 · a partir de 60 %: 3 · abaixo: 0 **(pendente: contar pessoas únicas? denominador)** |
| 2.16 | Adesão da equipe administrativa | 7 | a partir de 80 %: 7 · a partir de 70 %: 5 · a partir de 60 %: 3 · abaixo: 0 **(pendente: contar pessoas únicas? denominador)** |
