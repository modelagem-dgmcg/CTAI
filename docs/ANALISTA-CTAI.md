# Analista CTAI

O Analista da CTAI é o motor do sistema CTAI. Ele é **separado** do Analista da diretoria (e do Raio-X, do Acervo e da Gestão): usa a mesma ideia e o mesmo jeito de ler documentos, mas tem **banco, usuários e permissões próprios**. Nada de um lado enxerga o outro.

Onde fica: console da CTAI, menu **Analista CTAI** (`#/analista`).

## O que ele faz

| Aba | O que faz |
|---|---|
| Fila | Reúne os achados que pedem ação em todas as unidades: novos, aguardando a unidade, respondidos. Mostra os que estão com prazo vencido. |
| Relatório trimestral | Abre a minuta da unidade com as competências do trimestre e escreve uma primeira versão do texto (abertura, análise, conclusão) com os números já conferidos. O criador edita à vontade. Ao congelar, a versão fica **imutável**, vai para a mesa de conferência e sai em **PDF**. Chamar de novo nunca apaga o que foi editado. |
| Conferência com o acervo | Fonte **opcional** (SIMAS ou outro banco da SES), só leitura. Compara o recálculo da CTAI com o que o acervo tem do mesmo mês e gera divergências de origem "acervo". Repetir não duplica. Hoje lê um arquivo JSON exportado (`adapters/acervo/`); quando houver acesso à base ou à API, só esse adaptador muda. |
| Ler um texto | Cola o texto de um relatório e aponta o que merece conferência (extenso × número, percentual, soma, mês, cor trocada, transparência, trecho copiado). Pode guardar os achados numa competência. |
| Normas por unidade | Cadastro do que vale para cada contrato (cláusula, regra, portaria). O Analista sugere até 2 normas ligadas a cada achado, por palavras em comum. É apoio de consulta, **não parecer jurídico**. |

## Ciclo de um achado

`novo` → a equipe **fixa na mesa**, **descarta com motivo** ou **encaminha à unidade** (com setor e prazo) → a unidade **responde** (gestor responde qualquer um; responsável de setor, só o do seu setor) → a equipe **aceita e fixa**, pede **novo esclarecimento** ou descarta.

- A unidade vê só o que foi encaminhado a ela (tipo, trecho, pedido e prazo), em **Esclarecimentos** no portal. Nunca vê os achados internos nem quem leu.
- Encaminhar e responder ficam na trilha de auditoria, com texto e nome.
- Quem encaminha: criador, superintendente e administrador. O colega conferente não.

## O que veio do Analista da diretoria (a lógica, sem copiar nada de lá)

Ciclo dos achados (encaminhar, responder, pendentes), normas por unidade, trilha de atividade e sessões. Nenhuma chave nem endereço de backend foi copiado; as chaves de IA continuam só no `.env` e desligadas por padrão.

## Segurança e LGPD

- Sem dado de paciente. Texto que vai a provedor de IA em nuvem sai **mascarado** e só com `ANALISTA_ENVIAR_NUVEM=sim`. CPF aparece só com os 3 primeiros dígitos.
- O acervo é só leitura e o arquivo precisa ficar dentro da pasta `data/`.
- O repositório é público: só dados de **demonstração** (marcados na tela e no PDF). Normas de exemplo são textos inventados, sem valor normativo.

## Saída

Somente **PDF** por enquanto. Word e Excel ficaram de fora por decisão.
