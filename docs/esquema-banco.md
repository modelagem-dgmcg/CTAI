# Esquema do banco (10 tabelas + o vínculo com o SEI)

Cada tabela é uma aba da planilha Google privada. A primeira linha é o cabeçalho. Chaves terminam em `_id`. Nenhuma tabela guarda nome, CPF, prontuário ou data de nascimento de paciente.

## 1. contratos
`contrato_id` · `unidade` · `oss` · `numero_cg` · `vigencia_inicio` · `vigencia_fim` · `valor_mensal_global` · `base_desconto_mensal` · `observacao`

## 2. termos_aditivos
`ta_id` · `contrato_id` · `numero` · `data_assinatura` · `vigencia_inicio` · `vigencia_fim` · `efeito` (valor, prazo, indicador, equipe) · `processo_sei`

## 3. regras
`regra_id` · `versao` (ex.: igq_v1) · `contrato_id` · `vigente_de` · `vigente_ate` · `arquivo_json` · `pendencias` · `aprovada_por` · `data_aprovacao`
O conteúdo vive em `regras/igq_v1.json`. Cada mudança de regra gera nova versão; a competência aponta a versão usada.

## 4. competencias
`competencia_id` (ex.: 2026-05) · `contrato_id` · `regra_id` · `mes_implantacao` (sim/não) · `processo_sei` · `parecer_numero` · `status` (aberta, em análise, parecer emitido, fechada)

## 5. indicadores_oss
Valor e pontos declarados pela OSS no relatório.
`competencia_id` · `indicador_id` (2.1 a 2.16) · `valor_declarado` · `pontos_declarados` · `texto_analise` · `documento_id`

## 6. indicadores_ctai
Valor e pontos adotados pela CTAI (parecer ou recálculo aprovado).
`competencia_id` · `indicador_id` · `valor_adotado` · `pontos_adotados` · `motivo_do_zero` · `origem` (parecer, recalculo, ajuste manual) · `justificativa` · `responsavel`

## 7. evidencias
`evidencia_id` · `competencia_id` · `indicador_id` · `documento_id` (número SEI do anexo) · `tipo` (relatório, ata, lista, BID, planilha) · `paginas` · `hash_arquivo` · `lido_por` · `data_leitura`

## 8. linhas_brutas
Uma linha por registro dos anexos, sem dado de paciente: protocolo ou registro anonimizado, datas e horas, minutos, classificação de risco, destino, médico acompanhou (sim/não).
`linha_id` · `competencia_id` · `fonte` (transferencias, protocolos, queixas, exames, educacao) · `protocolo` · `data_inicio` · `hora_inicio` · `data_fim` · `hora_fim` · `minutos` · `categoria` · `documento_id`
Guardar `protocolo` (número de registro) e não o nome. Se o registro permitir identificar o paciente fora do hospital, guardar só um código gerado pelo app.

## 9. divergencias
`divergencia_id` · `competencia_id` · `indicador_id` · `tema` · `declarado` · `recalculado` · `diferenca` · `gravidade` (alta, média, baixa) · `status` (aberta, explicada, aceita, enviada à OSS) · `documento_id` · `observacao`

## 10. pareceres_descontos e trilha
Parte A, `pareceres_descontos`: `competencia_id` · `igq_oss` · `igq_ctai` · `modo_desconto` (fixo, faixa) · `desconto_pct` · `desconto_valor` · `parecer_numero` · `data_parecer`
Parte B, `trilha_auditoria`: `evento_id` · `data_hora` · `usuario` · `tabela` · `registro` · `campo` · `valor_anterior` · `valor_novo` · `motivo`
Toda alteração de `indicadores_ctai`, `regras` e `pareceres_descontos` grava uma linha na trilha. Linhas da trilha nunca são editadas.

## 11. envio_sei (vínculo com o SEI)
`sei_id` · `envio_id` · `cid` · `sei_numero` (só dígitos, 6 a 12) · `registrado_por` · `registrado_em` · `motivo`
Uma linha por registro ou correção do número do documento no SEI de uma versão de envio. A vigente é a mais recente da versão. Não se altera (gatilho) e só se apaga em contrato de demonstração. Cada linha tem um evento na trilha. Criada com `CREATE TABLE IF NOT EXISTS`: bancos existentes ganham a tabela vazia ao iniciar, sem mexer em nada.

## Regras de integridade
- Competência com `mes_implantacao = sim` não gera desconto.
- Soma dos pontos adotados nunca passa de 100; cada indicador nunca passa do seu máximo.
- Todo zero em `indicadores_ctai` exige `motivo_do_zero`.
- Mudança de regra com competência já fechada cria nova versão e não altera a fechada.
- Média de tempo a menos de 5% do limite e amostra menor que 10 casos geram alerta.
- Cobertura dos relatórios de tempo abaixo de 90% do BID gera alerta.

## Contratos e TAs (Drive)
- `contratos_drive_config` (endereço do script e chave opcional cifrada), `contratos_drive_estado` (último teste), `contratos_drive_cache` (lista de arquivos por termo, 1 h).
- `contrato_pasta` / `contrato_pasta_estado`: o que já se viu da pasta de cada unidade (base do aviso de arquivo novo ou alterado).
- `contrato_docs` (um quadro por documento lido: tipo, nº do aditivo, data, objeto, vigência, valor, "o que muda", estado rascunho → confirmado → substituido) e `contrato_pontos` (valores, repasses, metas, indicadores, descontos/art. 15-A, com efeito novo/altera/revoga/mantém e trecho de origem).

