# Decisões tomadas e dúvidas de regra

Este arquivo tem duas partes: (A) dúvidas de **regra do contrato** que mudam o resultado e precisam de decisão de quem manda; (B) decisões de **construção** que tomei sem perguntar, para você contestar.

## A. Dúvidas de regra que mudam o resultado

O sistema já traz as 8 perguntas na tela **Regras e decisões** (por contrato). Cada decisão exige **onde está escrito ou quem decidiu**. Enquanto aberta, vale a ficha do contrato (padrão da coluna "Padrão usado agora") e todo relatório, mesa e PDF avisa que a dúvida está aberta.

| # | Pergunta | Padrão usado agora | O que muda |
|---|---|---|---|
| 1 | Desconto é **10% fixo** abaixo de 90 ou segue a **tabela de faixas**? (o Anexo II não está nos arquivos) | a matriz mostra os dois lado a lado; nenhum é "adotado" até decidir | é a maior diferença de valor no desconto |
| 2 | Tempo da **classificação vermelha**: por faixa (5/6/10 min) ou só a meta? | por faixa | pontos do item 2.3 |
| 3 | Meta do **IAMCSST** porta-saída: até 30 min ou menos de 120 min a partir de junho? | até 30 min | pontos do item 2.7 |
| 4 | O que o BID chama de **óbito** e como identificar os de 24 h ou mais? | pelas linhas de óbitos (≥ 24 h) | item 2.10 |
| 5 | **Educação**: adesão por pessoas únicas? Denominador = ativos do mês ou esperados? | pessoas únicas ÷ ativos | itens 2.15 e 2.16 |
| 6 | O **17º TA** e o **piso da enfermagem** entram na base do desconto? | base atual do contrato, com aviso de "a confirmar" | valor do desconto |
| 7 | **Satisfação**: denominador de abril, 13.922 (parecer) ou 11.454 (relatório)? | o que a unidade enviar | item 2.11 de abril |
| 8 | A CTAI deve registrar o **motivo de cada zero** no parecer? | o sistema **exige** motivo para zero (mais seguro; é só deixar de exigir se a resposta for não) | texto do parecer |

Observação extra: o rodapé "Pixeon" nos documentos pode indicar um **segundo sistema** (por exemplo, prontuário ou imagem) ao lado do MV. Se for, a integração terá mais de uma fonte; o rack já suporta mais de uma integração por contrato.

## B. Decisões de construção (contestáveis)

1. **Chave de competência `cid`**: `competencias` usa uma chave numérica própria (`cid`) em vez de (contrato, mês), para as telas e rotas ficarem simples.
2. **Ficha pronta antes de enviar**: o envio é bloqueado se alguma ficha de setor não estiver "pronta" ou se houver lote da API pendente. Evita relatório com buraco; se for rígido demais, é uma linha em `server/envios.js` (`situacaoAntesDoEnvio`).
3. **Superintendente dá OK em todos os itens** antes de autorizar (não basta "autorizar"). Reflete "Nath confere novamente". **Não precisa ser convocada** na congelada.
4. **Administrador não entra na mesa**: não confere nem autoriza. Pode abrir e montar uma minuta para apoiar; nesse caso ele é o criador dela e, como todo criador, fica fora da conferência. Evita que quem administra o sistema aprove o próprio trabalho.
5. **Quem criou não confere nem autoriza**. Vale também para o texto: só o criador edita, e só até o SEI ser registrado.
6. **Mudou depois de congelar → nova versão com motivo**; sem mudança, o sistema recusa (409). O estado "mudou desde o congelamento" é calculado comparando o hash do conteúdo vivo com o da última versão.
7. **Envios são imutáveis**: o PDF é gerado **antes** da transação; correção = nova versão com motivo obrigatório.
8. **Analista**: sempre roda as **regras locais** (sem internet, sem chave) e, além delas, o **primeiro provedor de IA que funcionar**, na ordem de `ANALISTA_ORDEM`. Nuvem só com chave **e** `ANALISTA_ENVIAR_NUVEM=sim`, e só texto mascarado. Achados da IA cujo `trecho` não existe no texto são **descartados** (anti-invenção).
9. **Modelos e URLs dos provedores de IA** são configuráveis por variável de ambiente e **não foram testados** (sem chave aqui).
10. **Dados de demonstração sintéticos**: não existem linhas reais no repositório. O contrato `DEMO-UPA` tem linhas geradas (protocolo `DEMO-…`) com discrepâncias propositais, marcado "DEMONSTRAÇÃO – dados fictícios" na tela e no PDF. O admin recria ou apaga (digitando `APAGAR`).
11. **Senha temporária única** (`CTAI_SENHA_TEMPORARIA`) com troca obrigatória no primeiro acesso. Em produção, defina uma senha diferente no `.env`.
12. **Mês de abril é implantação**: sem desconto, em qualquer cenário.
13. **Rack do MV só lê**, valida com as mesmas regras de dado pessoal do CSV, grava como **lote pendente** e só vale depois do gestor confirmar. Campos não mapeados nem são lidos.
14. **Arquivos de fonte (TTF) no repositório**: o PDF não depende de internet.
15. **Sem build no front-end**: JS e CSS puros. Fácil de manter e de auditar; se crescer, pode migrar.
16. **Dois canais enquanto não há API do SEI** (decisão do usuário): (1) os **dados** vão ao sistema da CTAI, para recálculo independente; (2) o **PDF assinado** vai pelo SEI, como documento oficial. O elo é o **número do documento no SEI**, que o gestor da unidade registra por versão. Sem a API, esse elo depende de registro manual: se a unidade não registrar, o sistema só alerta.
17. **Nada bloqueia por falta de SEI**: o envio não depende do registro. Só alerta (unidade e CTAI). Bloquear faria a unidade mandar o PDF por fora do sistema.
18. **Registro do SEI só de acréscimo**: tabela própria `envio_sei`, nunca UPDATE do envio. Corrigir exige motivo e cria nova linha, na tabela e na trilha. Só `gestor_unidade` (e admin) registra. Número só com dígitos, 6 a 12, sem "conserto" automático da entrada. O mesmo número não vale para duas versões da mesma competência.
19. **Item obrigatório na mesa**: *Documento no SEI confere com a versão recebida no sistema*. Os dados de apoio (versão, código curto, número do SEI, alertas) **entram no conteúdo congelado**, e portanto no hash da minuta. Consequência assumida: mudar o registro do SEI depois do congelamento marca a minuta como alterada e exige nova versão. Versões congeladas **antes** desta mudança ficam sem o dado de apoio e com o item novo pendente.
20. **Comparação por upload do PDF do SEI: opcional**, sem guardar o arquivo e sem bloquear. O SEI pode alterar o arquivo (carimbo de assinatura, metadados), então hash diferente não prova divergência. O que vale na rotina é o **código no rodapé do PDF** (versão + 12 primeiros caracteres do hash do envio).
21. **Alertas usam a hora do primeiro registro**: corrigir o número depois não muda *quando* a unidade declarou aquela versão no SEI.
