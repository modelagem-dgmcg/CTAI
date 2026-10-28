# Manual da CTAI (passo a passo)

Endereço: `/ctai`. Perfis: **criador** (monta o parecer), **colega** (confere), **superintendente** (confere de novo e autoriza), **administrador** (usuários, demonstração, integrações; **não** confere nem autoriza na mesa).

## Tela inicial e Painel reduzido

- **Criador e colega (analistas):** o menu **não tem o item Painel**; ao entrar, a tela inicial é **Alimentar o Analista** (ou **Unidades**, se a pessoa ainda não tiver carteira). A **Caixa de entrada** deixou de aparecer no menu enquanto as unidades não enviam dados pela internet; a tela continua existindo pelo endereço `#/caixa`. No topo dela há uma **faixa de resumo** de uma linha, clicável: não lidos, prazos vencidos, prazos a vencer, achados com resposta e unidades sem gestor (só as da carteira da pessoa). Cada número abre a lista já filtrada. Links antigos para o Painel (`#/`) levam à Caixa de entrada, sem erro.
- **Superintendente e administrador:** a tela inicial continua sendo o **Painel**, sem mudança. A visão completa por unidade, prazos e alertas fica no **Gestão CTAI**.
- **Para voltar atrás:** coloque `CTAI_PAINEL_ANALISTA=sim` no `.env` (no Render, em Environment) e reinicie. O item Painel e a tela inicial antiga voltam para criadores e colegas. Padrão: `nao`.

## Caixa de entrada, por unidade (todos da CTAI)

**Caixa de entrada** (menu, com o número de não lidos). É uma tela só, **organizada por unidade**: cada unidade da sua carteira é um bloco com a fase, o prazo, os achados abertos e **tudo o que chegou dela**. Os blocos com itens não lidos já vêm abertos; os demais abrem com um clique. A busca por unidade ou município filtra na hora. Itens sem unidade ficam em "Geral". Dentro de cada bloco, em **Quem acompanha esta unidade**, cada colega tem um interruptor: **ligado** = a unidade entra na carteira dele e ele passa a receber os mesmos itens (os pendentes já chegam); **desligado** = sai. Quem acompanha a unidade pode mudar isso, tudo fica na trilha e no histórico da carteira (a superintendente vê em Gestão CTAI > Carteira), e a unidade não pode ficar sem ninguém. Quem ainda não tem carteira vê todas as unidades e não aparece com interruptor; defina a carteira dele em Gestão CTAI. Um item para cada fato que pede atenção: relatório recebido, reenvio ou correção, resposta da unidade a um esclarecimento, prazo do SEI (dia 20) ou do SIMAS (dia 25) **a vencer** ou **vencido**, minuta aguardando a sua conferência, unidade sem gestor, unidade sem carteira (só a superintendente recebe esta) e item redirecionado a você.
- Quem recebe: **quem tem a unidade na carteira**. Co-responsáveis recebem todos os itens. Unidade sem carteira cai na caixa da superintendente. Ninguém vê item de unidade fora da sua carteira (nem pelo endereço); superintendente e administrador veem o que é deles.
- Cada item mostra unidade, tipo, competência, data, se foi lido (por pessoa) e se foi **tratado** (quem e quando). **Abrir** leva direto à tela certa e marca como lido. **Marcar como tratado** vale para todos os destinatários; o primeiro que tratar marca, quem tentar depois é avisado. **Reabrir** é possível e o **Histórico** guarda tudo (criado, lido, tratado, reaberto, redirecionado).
- Filtros por unidade (busca), tipo e situação (pendentes, não lidos, tratados, todos). Dentro de cada unidade a lista vem ordenada por urgência: prazo vencido, prazo a vencer, resposta da unidade, minuta, reenvio, relatório recebido. Avisos de prazo e de unidade sem gestor/carteira fecham sozinhos quando a situação se resolve.
- **Redirecionar item**: envia um item a outra pessoa (ela precisa ter a unidade na carteira) e ela recebe um aviso "redirecionado a você".
- Os textos da caixa trazem só unidade, tipo, competência e versão. Nada de conteúdo de resposta ou dado de paciente.
- **Ausência ou substituição**: faixa no topo da caixa, com liga e desliga. **Ativar ausência** pede o substituto e o período (a superintendente pode fazer para qualquer pessoa; cada analista, só para si). Itens **novos** do período vão para o substituto, marcados "em substituição de fulano", e ele(a) passa a abrir as unidades durante o período. **Desativar** cancela na hora, e **Reativar** repete os dados de uma ausência anterior que ainda não terminou.
- Aviso por e-mail **não existe** nesta versão. Há um ponto de extensão (`avisos.aoCriar` em `server/caixa.js`) para ligar no futuro.

A antiga tela **Minhas unidades** foi incorporada à Caixa de entrada (o endereço antigo leva para ela).

## Menu
**Painel · Pareceres · Analista CTAI · Regras e decisões · Integrações · Trilha · Gestão CTAI** (superintendente e admin) **· Administração** (só admin).

## 1. Painel
Mostra cada unidade, mês a mês: situação, envio recebido, divergências abertas, e os pareceres em andamento. Contratos de demonstração aparecem com a marca "dados fictícios".

## 2. Receber e recalcular uma competência
Quando a unidade envia, a CTAI **recebe e recalcula sozinha**. Abra o mês (botão **Abrir**):
- **Recálculo**: declarado × recalculado, indicador a indicador, com a base (linhas, contagens, declaração) e os alertas (amostra pequena, valor perto do limite, cobertura baixa...). **Recalcular e reler** refaz a conta.
- **Divergências**: onde a unidade declarou uma coisa e as linhas mostram outra. Cada uma pode ser marcada como aberta, explicada ou aceita, **com justificativa**.
- **Evidências**: por indicador, o que comprova (anexo, ata, relatório). Registre o que a equipe viu. Há avaliações de transparência.
- **Achados do Analista**: pontos que o Analista apontou. Você **fixa** (vai para a mesa) ou **descarta** (exige motivo).
- **Envios**: os **dois canais lado a lado**, versão por versão. À esquerda, o que chegou ao **sistema** (data de recebimento, versão e o código curto do rodapé do PDF). À direita, o que a unidade **registrou como documento no SEI** (número, quem registrou e quando). Abaixo, a situação: *Enviado ao sistema* ou *Registrado no SEI*.
  - **Alertas** (aparecem no topo de todas as abas e como selo no Painel): *recebido no sistema sem registro de SEI*; *registro de SEI aponta versão antiga e existe versão mais nova no sistema*; *nova versão no sistema depois do SEI*. Só avisam, nada bloqueia.
  - **Comparar com o PDF que está no SEI (opcional)**: suba o PDF baixado do SEI e o sistema diz se o arquivo é idêntico ao que gerou. **Não é exigido.** O SEI pode alterar o arquivo (carimbo, metadados), então hash diferente não prova que o conteúdo mudou. O arquivo não é guardado.
  - Sem a API do SEI, o elo depende do **registro manual** do número pela unidade. Se ela não registrar, o alerta fica aceso.

## 3. Regras e decisões
Oito dúvidas de regra mudam o resultado (veja `DECISOES.md`). Quem decide é o criador do parecer ou a superintendência (e o admin). Registre a escolha **e onde está escrito ou quem decidiu**. Enquanto não decidido, o sistema usa a ficha do contrato e avisa em todo lugar que a dúvida está aberta.

## 4. Montar o parecer (criador)
1. **Pareceres → Novo parecer**: escolha a unidade, o trimestre e as competências, e (se já tiver) o número do parecer.
2. Na minuta:
   - **Indicadores e pontos**: o ponto adotado começa igual ao recálculo. **Ajustar** permite mudar com **origem** (ajuste manual, parecer, declarado, recálculo) e **justificativa**; zero pede o motivo. Meses sem envio pelo portal (cargas antigas) são somente leitura.
   - **Divergências, desconto e alertas**: a matriz de desconto compara "10% fixo" e "tabela de faixas" para o IGQ **declarado**, **recalculado** e **adotado**. Mostra a regra decidida e o que está em aberto.
   - **Texto do parecer**: abertura, análise e conclusão. **Sugerir texto a partir dos números** preenche só campos vazios. **Pedir ao Analista que leia o texto** aponta números que não fecham, mês errado etc.
3. **Congelar e enviar para conferência**: escolha os colegas e, a partir da versão 2, o **motivo**. A versão fica imutável. Se nada mudou, o sistema recusa. Se o texto mudou depois do congelamento, a tela avisa e pede nova versão.

## 5. Mesa de conferência (colegas e superintendente)
Abra a versão (link na minuta ou no Painel). São **8 itens**: identificação, **documento no SEI**, indicadores, divergências, desconto, alertas, texto, achados.
- O item **Documento no SEI confere com a versão recebida no sistema (código no rodapé do PDF)** é obrigatório, como os outros. Os dados de apoio já vêm abertos: versão recebida, código curto, número do SEI registrado pela unidade e alertas. Abra o documento no SEI, olhe o rodapé do PDF (*Versão vN · código de integridade …*) e compare. Não precisa subir o PDF do SEI.
- Abra **Ver o conteúdo desta versão** para ver exatamente o que foi congelado.
- Dê **OK** ou **Pedir reparo** (o reparo exige comentário). Reparo muda o estado para "com reparo"; o criador corrige e congela nova versão, e a conferência recomeça.
- Cada colega convocado confere todos os itens. Quando todos estão OK, a versão fica **conferida**.
- A **superintendente** dá o OK em todos os itens e então **Autoriza esta versão**. Não precisa ser convocada.
- **Quem criou não confere nem autoriza.** O administrador também não.

> O OK da mesa é **controle interno**, não é assinatura. A assinatura é feita no SEI.

## 6. SEI (criador)
Com a versão **autorizada**, abra o PDF, anexe e assine **no SEI, com a sua própria senha do SEI** (este sistema nunca vê nem guarda). Depois volte à minuta, **Registrar o número do SEI** (este é o SEI do *parecer*; não confunda com o SEI do *relatório da unidade*, que a unidade registra na aba Envios). O parecer passa a "anexado ao SEI", as competências a "parecer emitido" e o texto trava.

## 7. Analista
Tela solo para colar o texto de um relatório e ver os pontos a conferir. Escolha a competência para dar contexto (mês, valores por cor, nível de transparência). "Guardar os achados" os põe na competência para fixar na mesa. As regras locais funcionam sempre; IA só se houver chave e `ANALISTA_ENVIAR_NUVEM=sim`.

## 8. Integrações (admin)
Configura o endereço da API do MV e o **nome** da variável do `.env` que guarda a credencial. **Testar a conexão**, **Prévia (não grava)** e **Buscar agora** (grava lote pendente que o gestor da unidade confirma). Veja `INTEGRACAO-MV.md`.

## 9. Trilha
Registro que só cresce, com a cadeia de códigos. A faixa verde diz "Cadeia íntegra"; se alguém mexer no banco, mostra o evento onde quebrou.

## 10. Administração (admin)
Usuários (criar, redefinir senha, ativar/desativar), saúde do sistema, e **dados de demonstração**: recriar ou apagar (digite `APAGAR`). Apagar só mexe no contrato fictício.

**Zerar dados e começar com dados reais.** Em Administração, o cartão "Zerar dados e começar com dados reais" mostra o que será apagado (contrato e usuários de demonstração, meses, fichas, envios, pareceres, histórico, Caixa de entrada, mensagens, carteiras) e o que será mantido (equipe real, configurações, regras, decisões e a trilha de auditoria). Para confirmar, digite **ZERAR** e a sua senha. O sistema guarda uma cópia do banco antes e oferece o download. **Depois de zerar: Gestão CTAI > Importar, para carregar a carteira real.**


## Checklist de recebimento e prazos

Cada competência com envio tem a aba **Checklist de recebimento** (console da CTAI, dentro da competência).

- O sistema cria o checklist ao receber o envio, com um item para cada documento obrigatório da UPA e dois complementares (transferências e pessoal). Mostra a **competência**, a **data de recebimento** e o **responsável pelo envio**.
- Para cada item: **status** (recebido, pendente, incompleto, não aplicável), **data de recebimento**, **responsável**, **validação** (validado, com divergências, com inconsistências) e **observações**. "Não aplicável" exige o motivo nas observações.
- O sistema sugere o status pelo que a unidade informou. Quando você edita, o item deixa de ser recalculado a cada nova versão; **Voltar ao cálculo do sistema** desfaz isso. Toda alteração fica na trilha.
- **Prazos:** SEI até o dia 20 e SIMAS até o dia 25 do mês seguinte. O painel tem a coluna **Prazos** e a competência mostra o aviso de prazo vencido, a vencer ou entregue com atraso.
- O checklist e os prazos vão para a minuta e para o PDF do parecer (seção **Checklist de recebimento e prazos**) e aparecem na mesa, dentro do item de identificação.


## Gestão CTAI (superintendente e administrador)

Menu **Gestão CTAI**, com oito abas (Painel, Produção, Carteira, Entregas por carteira, Importar, Usuários, Acessos, IA). Só a superintendente e o administrador veem esta área; as outras pessoas da CTAI não têm o menu e recebem "sem acesso" se tentarem pelo endereço.

**Painel.** A visão da superintendente num só lugar. Filtros por **trimestre, unidade e funcionário**; botão **Exportar PDF** gera o mesmo painel em PDF.
- Cartões: unidades, envios recebidos, incompletos e pendentes, prazos vencidos / a vencer / com atraso, achados abertos e vencidos, pareceres em rascunho e congelados, unidades sem carteira.
- **Alertas**: prazo vencido ou a vencer (SEI dia 20, SIMAS dia 25), envio incompleto, achado sem resposta no prazo, queda de 5 pontos ou mais no IGQ, trilha com falha.
- **Por unidade**: fase da conferência (aguardando envio, recebido, tratando divergências, minuta em elaboração, mesa de conferência, autorizado, anexado no SEI), prazos de cada mês, IGQ médio em pontos, percentual pago em média, comparação com o trimestre anterior, achados abertos e parecer.
- **Divergências recorrentes por indicador**: itens que voltam em mais de uma competência.
- **Unidades sem carteira**: o envio delas não tem responsável; escolha o funcionário e clique em Atribuir.
- **Unidades aguardando gestor**: unidades cadastradas em que ninguém foi cadastrado como gestor da unidade (fase "Aguardando gestor", cartão "Sem gestor" e alerta). Saem da fila quando o gestor é criado em Usuários.

**Produção.** Por funcionário e por período (trimestre ou todo o período), com filtro de unidade: itens conferidos na mesa, divergências tratadas, achados encaminhados / respondidos / descartados, minutas criadas e congeladas, tempo médio entre o recebimento do envio e a autorização do parecer, e a **carga atual** (unidades, divergências e achados abertos, minutas em andamento, conferências a fazer). Tudo sai de ações já registradas na trilha e no fluxo. **Não há monitoramento de digitação, de tela aberta nem de tempo online.**

**Carteira.** Define quais unidades cada criador ou colega acompanha. Regras:
- quem tem unidades na carteira vê **só** essas unidades (fila, mesa, achados, relatório trimestral, checklist, decisões) e não abre as outras nem pelo endereço;
- quem ainda não tem nenhuma unidade vê todas (modo compatível); o **modo estrito** faz essa pessoa não ver nada até receber unidades;
- superintendente e administrador veem todas;
- cada mudança entra no **histórico** (quem, quando, motivo) e na trilha.

**Entregas por carteira.** Por analista e por unidade: quando cada relatório chegou, em qual caixa caiu (inclusive "em substituição de"), se foi lido, se foi tratado (quem e quando) e há quanto tempo está pendente. Relatórios **não lidos há mais de N dias** ficam em destaque (N configurável, padrão 3, botão Salvar limite). Unidades sem responsável aparecem à parte, na caixa da superintendente. Filtros por unidade e analista; **Exportar PDF**. Na aba **Produção** há duas colunas novas: tempo médio até a primeira leitura e até o tratamento (relatórios, respostas e minutas).

**Importar (unidades e carteira em lote).** Para cadastrar de uma vez as unidades (UPA, UPAE, Hospital) e distribuí-las entre os analistas.
1. Clique em **Baixar modelo** (dados fictícios) e preencha: `tipo` (UPA, UPAE ou Hospital), `unidade`, `municipio` (opcional) e `analista` (login ou nome; vários analistas na mesma unidade separados por `|`). CSV em UTF-8, separado por `;` ou `,`.
2. Escolha o arquivo. A **prévia** mostra unidades por tipo e por analista, quantas são novas, quantas entram e saem de carteira e o **relatório de problemas** (linha e motivo). **Nada é gravado nesta etapa.**
3. Decida o que a prévia pedir: **analista que não existe** (criar como criador, com a senha temporária, ou pular) e **unidade em duas carteiras** (dividir como co-responsáveis ou manter só um). Linha com erro (tipo inválido, unidade em branco) impede gravar, a não ser que marque **Ignorar linhas com erro**.
4. **Modo**: *Acrescentar* soma às carteiras; *Substituir* faz a carteira de cada analista do arquivo ficar exatamente como o arquivo (quem não está no arquivo não é mexido).
5. **Gravar importação**: tudo ou nada, numa única operação. Fica registrado quem importou, o resumo e cada entrada ou saída de carteira (histórico da aba Carteira, motivo "Importação em lote #n") e na trilha.

Regras: a unidade é identificada por **tipo + nome + município** (UPA Caruaru e UPAE Caruaru são unidades diferentes; o relatório avisa nomes parecidos). Reimportar o mesmo arquivo não duplica unidade nem carteira. Linha repetida na mesma carteira é ignorada. Unidade nova nasce **sem gestor** (aguardando gestor, na fila do Painel) e sem regras do contrato, que são cadastradas depois. A superintendente nunca precisa mexer em banco ou arquivos do servidor.

**Usuários.** Criar, editar nome e perfil, trocar senha (volta para a senha temporária e a pessoa troca no próximo acesso), ativar e desativar. Perfis: administrador, criador, colega, superintendente, gestor da unidade e responsável de setor. A superintendente não cria nem altera administradores. Tudo vai para a trilha; a senha nunca é gravada.

**Acessos.** Registro **somente de leitura** de entradas, tentativas falhas, bloqueios (5 erros = 10 minutos), saídas e **cadastros feitos por gestores de unidade**. Cada linha mostra quando, evento, usuário, perfil, unidade, origem (**rede interna** ou **externa**), IP com o último trecho oculto, navegador e detalhe, e aponta para o evento da trilha encadeada (não dá para editar nem apagar, nem pelo banco). Filtros por período, unidade, usuário, evento e origem; **Exportar CSV** e **Exportar PDF**. Quem entra por túnel aparece como "externa"; usuários da CTAI recusados fora da rede interna aparecem como falha ("recusada fora da rede interna").

**Equipe das unidades.** A CTAI cria só a **unidade e o gestor da unidade** (aba Usuários). Os responsáveis de setor são cadastrados pelo gestor, no Portal da Unidade. A superintendente enxerga o que eles fazem na aba Acessos.

**IA.** Liga e desliga cada provedor, cadastra chave e modelo, testa a conexão e mostra o uso do mês (chamadas e falhas). Tudo começa desligado.
- A chave é guardada **só no servidor, cifrada**, com o segredo `CTAI_SEGREDO` do `.env`. Ela nunca volta para a tela nem entra na trilha: aparece só "configurada" e os 4 últimos caracteres. Sem `CTAI_SEGREDO` o sistema não guarda chaves.
- Para ligar um provedor em **nuvem** é preciso confirmar que o uso foi **aprovado pelo jurídico** (fica registrado quem e quando). Dados reais de unidade só podem ir para provedor aprovado; em nuvem sai somente texto mascarado.
- "Testar" faz uma chamada mínima, sem dado de unidade.

## Chaves de IA (rack)
Em **Administração** (e também em **Gestão CTAI > IA**) fica o **rack de chaves de IA**. Cada chave cadastrada **vale para todos os usuários** do Analista CTAI; não há limite de chaves. Passos: **+ Adicionar chave**, escolha o serviço (Gemini, Groq, Kimi, DeepSeek, OpenRouter ou um servidor local Ollama), cole a chave, marque "uso aprovado pelo jurídico" (serviços em nuvem) e salve. **Gravar e testar** salva e já testa a conexão; **Testar** repete o teste a qualquer momento, e o resultado (respondeu ou falhou, tempo e data) fica na linha da chave.

- **Ordem de tentativa:** com mais de uma chave, o sistema usa a de menor número e, se ela falhar (limite de uso ou chave vencida), passa para a próxima.
- **Suspender** desliga a chave sem apagar; **Apagar** remove de vez. Se todas as chaves de um serviço estiverem suspensas, o serviço fica desligado.
- A chave fica cifrada no servidor (precisa de `CTAI_SEGREDO` com 16 ou mais caracteres) e nunca volta para a tela: só aparecem os 4 últimos caracteres. Tudo (cadastro, troca, suspensão, teste) fica na trilha, sem a chave.
- O teste envia só a pergunta "responda OK", sem nenhum dado de unidade. Para dados reais, a nuvem só recebe texto mascarado e só com a aprovação do jurídico registrada.
- Quem usa o Analista CTAI não vê nada disso: a tela dele mostra apenas os achados.

## Primeiro acesso: Alimentar o Analista
Quem é criador ou colega, tem carteira de unidades e ainda não tem nenhum relatório confirmado no Histórico vê **só** a tela "Alimentar o Analista" (e o "Falar com a equipe"). Administração e superintendência, e quem não tem carteira, não são travados.
1. Solte vários arquivos (ZIP, PDF, Word, Excel, CSV, TXT; até 4 MB cada, ZIP até 40 MB). PDF escaneado, só imagem, não é lido.
2. O sistema lê um por vez, mascara dados pessoais, identifica a unidade e o trimestre (pelo nome ou texto do arquivo) e monta um rascunho do Histórico. Se não achar, pede a unidade e o trimestre na própria linha.
3. Cada arquivo mostra o andamento, o que foi mascarado (só contagens) e as divergências (IA não leu, nota ausente, itens sem trecho verificado, soma diferente da nota, trimestre repetido).
4. Aprove os selecionados ou todos sem divergência; abra um a um quando precisar. Só o confirmado entra nos cruzamentos.
5. "Pular os que deram problema" descarta os que falharam. "Concluir e abrir o menu completo" libera o menu. A administração também pode liberar uma pessoa (POST /api/alimentar/liberar-usuario).
Sem chave de IA válida, os arquivos viram rascunho em branco para preencher à mão (a tela avisa).

## Mascaramento de dados pessoais
Antes de guardar qualquer texto extraído e antes de enviar à IA, o sistema troca CPF, CNS, RG, telefone, e-mail, data de nascimento, prontuário/BAM, endereço residencial e nomes de pacientes (depois de "paciente", "usuário", "Sr./Sra.", "acompanhante", "nome:") por marcadores como [CPF] e [PACIENTE]. Mantém CNPJ, nome de unidade/OSS, valores, número de processo SEI e datas de competência. Havendo chave de IA, uma segunda passada procura nomes que restaram. O arquivo original nunca é gravado; a trilha guarda só a contagem por tipo. Limite: é heurística, pode deixar passar nomes sem rótulo. Remova dados de paciente antes de enviar quando der.

## Contrato e atualizações (termos aditivos) de cada unidade
Na tela de cada unidade, logo abaixo do título, o bloco **Contrato e atualizações** mostra os documentos da pasta "CONTRATOS E TAs - OSS SES" que dizem respeito àquela unidade (busca pelo nome da unidade e pelas pastas), na ordem: contrato, 1º, 2º, 3º termo aditivo.
1. A linha "Pasta atualizada em…" mostra a data do arquivo mais novo. A diretoria só atualiza a pasta no dia 20 de cada mês; fora disso nada muda. "Atualizar a lista" consulta de novo (a lista fica guardada por 1 hora para não pesar).
2. Cada arquivo tem **Abrir no Drive**. Se for Google Doc, aparece **Ler e montar o quadro do contrato**: o sistema lê o texto (com dados pessoais mascarados), propõe o quadro (tipo, nº do aditivo, data, objeto, vigência, valores e repasses, metas e indicadores, regras de desconto e art. 15-A, o que o aditivo muda) com a frase de origem de cada ponto e a marca "confere no texto". PDF e Word só abrem no Drive (o sistema não lê).
3. O quadro nasce como **rascunho**. Confira campo a campo, corrija o que a leitura errou, **Salvar rascunho** e **Confirmar**. Depois de confirmado não se edita. Sem chave de IA, o quadro abre em branco para preencher à mão. Nada vale antes de confirmar.
4. **O que vale hoje**: o sistema aplica o contrato e cada aditivo em ordem (o que o aditivo altera substitui o anterior; o que revoga sai). Enquanto algum quadro for rascunho, o resultado aparece marcado como **proposta**. Se o documento mudar no Drive depois da leitura, aparece "mudou no Drive depois da leitura": ler de novo cria um novo rascunho que substitui o antigo só quando você confirmar.
5. **Aviso de novidade**: quando aparece arquivo novo ou alterado na pasta da unidade, quem tem a unidade na carteira recebe um item "Novo aditivo na pasta" na Caixa de entrada. A conferência é feita ao abrir a unidade e no "Testar" (não há agendador). A primeira consulta de uma unidade só fixa a base, sem aviso.
6. Se a busca pelo nome completo não achar nada, o sistema tenta só a palavra que distingue a unidade (a tela avisa). Em "Buscar com outro termo" você digita o termo que quiser.
7. **Ligar (administração)**: Integrações > Contratos e TAs (Drive): colar o endereço do script (termina em /exec). A chave é **opcional**: só se o script exigir. O endereço e a chave vão cifrados ao banco e nunca voltam para a tela; o navegador nunca chama o script (só o servidor). As variáveis CONTRATOS_DRIVE_URL e CONTRATOS_DRIVE_CHAVE da hospedagem valem mais do que o que foi digitado. O botão **Testar** lista a pasta de uma unidade sua. O código do script está em docs/CONTRATOS-DRIVE.md.

## Completude por carteira (superintendente e administrador)
Gestão > **Completude**: para cada pessoa da equipe, as unidades da carteira com os 4 últimos trimestres encerrados do Histórico (confirmado / rascunho / falta) e a situação do contrato (lido e confirmado, aditivos confirmados, rascunhos por conferir). Unidade "completa" = 4 trimestres confirmados + contrato confirmado + nenhum rascunho pendente. Só leitura.

## GAOCG: unidade que ainda não está lá
Enquanto a base do GAOCG não estiver completa, a unidade que não aparece no cadastro de lá vira só a informação "Sem dado no GAOCG ainda" na revisão do parecer (não é achado). Quando a base estiver completa, a administração ou a superintendência marca a opção "A base do GAOCG já está completa" no cartão do GAOCG em Integrações, e a ausência volta a ser achado de gravidade MÉDIA.

## Alimentar o Analista com o ZIP do SEI (gaveta por mês)

- **Como fazer:** baixe do SEI o ZIP da unidade (um mês) e solte na tela **Alimentar o Analista**. O ZIP pode ter mais de 100 MB: ele é aberto no seu navegador e os arquivos seguem um por vez, em segundo plano (limite de 60 MB por arquivo; os PDFs vão só como texto, ver abaixo). Se a internet cair, o envio tenta de novo sozinho. Imagens soltas e arquivos de banco de dados são ignorados. Se o arquivo for grande demais ou ilegível, aparece o aviso naquele arquivo e o resto continua.
- **O que o sistema guarda:** o texto completo de cada documento, página a página, já com os dados pessoais mascarados, mais os números. O PDF original é descartado. Páginas que parecem só imagem (pouco texto) ficam marcadas, porque o sistema não faz OCR.
- **O PDF é lido na sua máquina:** o navegador abre cada PDF (e cada ofício ou despacho em HTML) no seu computador, tira o texto página a página, **mascara os dados pessoais ali mesmo** e envia ao sistema **só o texto** (poucas centenas de KB, em vez de dezenas de MB). O sistema confere o texto, mascara de novo e soma o contador de "dados protegidos" dos dois lados. Na lista, cada arquivo passa por "Lendo na sua máquina (página 12 de 35)", "Enviando texto" e "Lido". Um arquivo de cada vez, e a memória é liberada ao fim de cada um (funciona em computador antigo). Cada PDF tem até 3 minutos para ser lido.
- **Quando o PDF inteiro é enviado (último recurso):** só se o navegador não achar texto (PDF escaneado, só imagem), não conseguir ler (arquivo com defeito ou com senha) ou passar do tempo. Aparece o aviso "PDF enviado inteiro" com o nome do arquivo e o motivo; o sistema tenta ler no servidor, lê o texto, **e descarta o arquivo**. PDF só imagem continua sem leitura (não há OCR): o arquivo fica com o aviso "não tem texto legível". Word, Excel, CSV, TXT e ZIP pequeno enviado direto seguem o caminho antigo (arquivo inteiro, lido no servidor e descartado).
- **Páginas só imagem dentro de um PDF bom:** o texto das páginas que têm texto segue normalmente; as páginas sem texto (foto, planilha colada como figura) ficam listadas no aviso "Páginas que parecem só imagem".
- **Tabelas do Anexo I:** o leitor do navegador mantém a ordem de leitura do PDF e junta numa linha só o que está na mesma linha da página, com tabulação entre as colunas. Assim a linha do quadro de produção sai como `4.324 [tab] 3.170 [tab] 1.872 [tab] 43,29%` e o extrator de números do servidor acha meta, ofertado, realizado e % como antes.
- **Arquivos do leitor:** o PDF.js (versão 3.11.174, edição legada para navegadores antigos, licença Apache 2.0) fica no próprio sistema, em `public/vendor/pdf.min.js` e `public/vendor/pdf.worker.min.js` (sem CDN). Só é baixado quando alguém solta um PDF e o navegador o guarda para a vez seguinte (o service worker trata como qualquer arquivo estático). A lista de padrões de mascaramento é uma só, em `public/js/mascara-comum.js`, usada pelo navegador e pelo servidor. Para trocar de versão do PDF.js, troque esses dois arquivos e rode `npm run e2e`.
- **Limites do envio de texto:** corpo de até 8 MB por arquivo (`POST /api/alimentar/texto`), só PDF e HTML, com conferência de hash (SHA-256) do texto; o servidor recusa o que não confere e mascara de novo o que receber.
- **Painel de andamento:** mostra a unidade e o mês, quantos documentos foram lidos, páginas lidas e dados protegidos, e a lista do catálogo ganhando o visto um a um. No fim aparece o resumo, por exemplo "Julho: 22 de 23 lidos — falta Anexo 5". Faltar documento nunca bloqueia o envio.
- **Catálogo:** a lista de documentos esperados por tipo de unidade (UPA, UPAE, Hospital) fica em `regras/catalogo-documentos.json`: nome, padrão do nome do arquivo, o que extrair, obrigatório ou opcional e, quando vale, a partir de qual mês. UPAE: ofícios, Anexos I a VII e 1 a 15 (12 a 15 só a partir de set/2026). UPA segue o modelo da UPA Olinda (documentos mensais, parecer trimestral, como já funcionava). Hospital é só um esqueleto, a confirmar com a analista da carteira.
- **Mensal x trimestral:** o dado entra por unidade + mês + tipo de documento (o mês é lido do nome, como 072026 ou jul/26, ou do texto; se não achar, o sistema pergunta). O trimestre **não é arquivo**: é calculado juntando os 3 meses, com aviso do que falta ("Chegaram julho e agosto, falta setembro"). Reenviar um documento corrigido substitui o anterior e o trimestre se atualiza.
- **Números do Anexo I e do ofício:** o sistema só propõe (meta, ofertado, realizado, % por indicador, com o trecho de origem). Você confere, corrige se precisar e confirma; só o confirmado entra no total do trimestre. O conferidor compara ofício x Relatório Mensal e lista as divergências. O que não for encontrado fica vazio.

## Etapa 1 da unidade: Importar Arquivos

As unidades não mandam dados pela internet por ora (o Portal da Unidade está parado). A analista baixa o ZIP, PDF ou Word do SEI e solta na etapa 1 da página da unidade. A página abre no último trimestre encerrado (hoje, 2026-T3); é o trimestre que está sendo montado.

1. **Relatório-modelo.** O primeiro documento de cada unidade é o Parecer CTAI do trimestre anterior (já assinado no SEI), que aparece como "Modelo: parecer do 2026-T2". O sistema guarda o texto já mascarado (o original nunca é guardado) e lê a estrutura: seções, quadros e tabelas, indicadores e as fontes citadas (anexos, SIMAS, informação financeira, parecer da CMA etc.).
2. **Lista de conferência.** Do modelo sai uma lista proposta (nome, palavras do nome do arquivo, obrigatório ou opcional, mensal ou trimestral, origem "unidade" ou "fonte externa", e o trecho do modelo que a originou). A IA só refina; quem confirma é a analista, em "Conferir e confirmar a lista". Dá para renomear, marcar como opcional, tirar e acrescentar. Cada confirmação cria uma nova versão da lista da unidade. Sem modelo, vale a lista padrão do tipo da unidade, com o aviso "Sem relatório anterior: usando a lista padrão da UPAE".
3. **Soltar os arquivos.** A área de soltar usa o mesmo fluxo do Alimentar: o ZIP é aberto no navegador, o PDF é lido na máquina e só o texto (já mascarado) vai ao sistema. Aceita ZIP, PDF e Word. Cada arquivo é associado a um item pelo nome e pelo conteúdo, e o item ganha o check. Item mensal precisa de 3 meses (1/3, 2/3, 3/3). Arquivo que não casa com nenhum item fica em "Avulsos": aponte o item e o mês.
4. **Origem de cada item.** A lista mostra de onde vem cada item:
   - **Da unidade, pelo SEI:** chega por upload (RM, anexos, planilha de monitoramento etc.) e ganha o check sozinho.
   - **Pedida pela CTAI a outro setor:** Despacho da Gerência de Prestação de Contas e Informação financeira da GGCCG. A situação é *Não pedido*, *Pedido* (com a data e o nº do processo SEI, campos livres) ou *Recebido*. Subir o arquivo é opcional; a analista analisa e anota os valores no campo de observação. "Pedido" ainda conta como falta ("pedido, aguardando resposta").
   - **Dentro do processo do parecer:** Parecer Conclusivo da CMA do trimestre anterior. A analista marca "Consultado" e anota a informação.
   - **Gerado no SIMAS pela analista:** o item "SIMAS – Metas atingidas (consolidado do trimestre)" é obrigatório e trimestral (um PDF cobre os 3 meses). Gere no SIMAS o relatório "METAS ATINGIDAS - CONSOLIDADO" e solte aqui; o sistema reconhece pelo nome ("metas atingidas", "consolidado", "simas") e pelo conteúdo. Se o SIMAS estiver fora do ar, marque "SIMAS sem acesso agora" e anote o motivo: a etapa não trava.
   - **Fonte externa (consulta da analista):** qualquer outra consulta que a lista tenha, com check manual e observação.
   Item opcional não segura a conclusão.
   **Planilha de monitoramento (Anexo II, às vezes "planilha consolidada"):** item obrigatório e mensal da unidade (UPAE). Regra da CTAI: se não vier, os indicadores que dependem dela (ostomizados e TEA / neuropediatria) contam como meta não cumprida. A lista mostra o aviso em vermelho e, ao concluir, o estado "sem planilha → meta não cumprida (regra da CTAI)" fica registrado (tabela `imp_ausencias`, rota `GET /api/importar/unidade/:c/:tri/ausencias`), sem inventar valor.
5. **Concluir.** A etapa fica feita quando todos os itens obrigatórios têm check, ou quando a analista clica em "Concluir importação". Com itens faltando o sistema pergunta ("Concluir mesmo assim?"), e isso fica na trilha de auditoria. "Reabrir" desfaz a conclusão.

Quem usa: criador e colega da carteira, superintendente e administrador, sempre dentro da carteira. O texto do relatório-modelo fica guardado para o Redator CTAI (ver `docs/RELATORIO-MODELO.md`); o parecer automático ainda não existe.

### Números do SIMAS (consolidado)
Ao receber o consolidado, o sistema lê sem IA: cabeçalho (unidade, período, quem gerou e quando), grupos com linhas "Descrição, Previsto, Realizado, Atingido %", "Total do Grupo" e a parte de Indicadores. Linhas com previsto 0 e 100% são guardadas como "sem meta". Tudo fica **proposto**: em "Ver e confirmar os números do SIMAS" a analista confere e confirma. O PDF repete os blocos de indicadores sem dizer o mês; o sistema presume pela ordem (1º bloco = 1º mês) e mostra "presumido pela ordem, conferir". A analista ajusta e confirma o mês de cada bloco. Na mesma tela, o conferidor SIMAS × RM (Anexo I) × planilha de monitoramento lista as diferenças por indicador e período (por exemplo, Mamografia em dois grupos do SIMAS, previsto do SIMAS contra as metas dos RM, ostomizados contra a planilha, satisfação 0). Ele só sinaliza; não diz qual fonte está certa. Cada diferença vira um achado "A CONFERIR" da unidade na **Fila de achados** (Analista), com os números comparados e o trecho e arquivo de origem; a analista fixa (aceita) ou descarta com motivo, como nos outros achados. Os já decididos não voltam quando o consolidado é lido de novo.

### Planilha de monitoramento (Anexo II): números lidos
Ao receber o Anexo II de um mês, o sistema lê os números sem IA (`server/extrator-planilha.js`) e os deixa **propostos**, cada um com o trecho de origem, esperando a sua conferência em "Alimentar o Analista". O mês vem de "Registro Mensal - mês ano" no próprio texto (se for diferente do mês em que o arquivo foi guardado, o trecho avisa).
- **Lidos**: consultas médicas (total), consultas de outros profissionais de nível superior (total), sessões de reabilitação (total, fisioterapia, fonoaudiologia, terapia ocupacional), **ostomizados em número de pacientes** (linha "Pessoas com estomia"), bexiga neurogênica, total dos programas, mamografia, neuropediatra e total do PE Acessível, queixas, satisfação, perda primária e absenteísmo.
- **Ostomizados**: só a linha de pacientes vale para o indicador. Nos meses em que a planilha traz **atendimentos** (sessões de enfermagem), eles são guardados com outro nome ("ostomizados_atendimentos") e **não entram** como pacientes.
- **Conferência de contas**: toda linha é conferida por executado ÷ meta contra o percentual impresso. Percentual sem vírgula (erro do OCR) é recalculado e avisado; percentual que não fecha **não vira valor** e o trecho recebe o aviso "[confira: ...]".
- **O que não foi lido** nunca é inferido: o leitor devolve a lista do que faltou (por exemplo, "ostomizados" ou "mamografia"). O texto da planilha varia de mês para mês e o OCR perde linhas e rótulos: sempre confira.
- O conferidor SIMAS × RM × planilha passou a usar esses números: compara pacientes de ostomizados e neuropediatria (TEA) **somados no trimestre**; mês sem número lido, ou mês com só atendimentos, vira "planilha pendente" explicando o que falta. Continua só sinalizando, sem dizer quem está certo.

## Etapa 4 da unidade: Apuração do trimestre (Parecer CTAI)
Na etapa **Produzir** aparece a **Apuração do trimestre**, primeira entrega do Redator CTAI: quadros 01 e 02, apontamentos de descontos, campos manuais, considerações finais sugeridas e a conferência número a número. Os textos corridos das seções 1 a 4, 9 e 10 ainda são redigidos pela analista a partir do parecer do trimestre anterior (o texto dele aparece abaixo, com valores, datas e períodos em destaque para revisar).
**Regras de segurança dos números**
1. **Só entra número confirmado** (RM, planilha, ajuste digitado com motivo). Número só lido (proposto), ausente ou divergente aparece em destaque como PENDENTE, nunca como valor, e impede o "pronto para conferência".
2. **Todo cálculo é refeito por um segundo caminho** (inteiros, sem ponto flutuante) e **lendo de volta o que está escrito** nos quadros, tabelas e considerações finais. Percentual do trimestre = soma dos 3 meses ÷ soma das metas dos 3 meses (com meta constante, ÷ (meta mensal × 3)). Desconto = percentual × repasse total do trimestre. Qualquer diferença bloqueia o "pronto para conferência" com a mensagem do ponto exato.
3. **Percentual de desconto e repasse não são adivinhados.** As regras carregadas dos contratos trazem o *peso* do indicador (mostrado como referência), que **não é** o percentual aplicado. Sem o percentual e o valor do repasse digitados pela analista (com a fonte do repasse), fica "A DEFINIR PELA ANALISTA" e bloqueia. Abaixo de 85%: desconto aplicável; entre 85% e 100%: a regra não está carregada, a analista decide; 100% ou mais: sem desconto. O texto do Art. 15-A (mínimo de 85% e compensação por produção excedente) segue no documento.
4. **Arredondamento**: se a soma das linhas arredondadas difere do total sem arredondar (centavos), o sistema mostra os dois valores e a analista escolhe qual vale.
5. **Seções 7 e 8 e "Impossibilitado de análise" são campos manuais.** Vêm da observação registrada nos itens "Informação financeira" e "Parecer da CMA" da lista de conferência, ou do que a analista digita. Vazio bloqueia.
6. **Considerações finais**: o sistema sugere (achados fixados e indicadores abaixo de 85%), marcadas "sugestão, revisar"; só entram as que a analista aceitar. Percentual ou valor citado num texto aceito precisa existir nos cálculos do trimestre, senão bloqueia.
7. **Termo aditivo**: meta diferente entre os meses do trimestre vira aviso, e o percentual usa a soma das metas de cada mês.
8. **Achados "A CONFERIR"** do trimestre sem decisão bloqueiam o "pronto".
9. **Rastreio e trilha**: a tabela "Conferência número a número" mostra cada número com arquivo, trecho e estado (confirmado ou digitado com motivo). Tudo que a analista altera e o "pronto para conferência" vão para a trilha de auditoria. Mudou qualquer número depois do "pronto", ele cai.
10. **PDF** (apuração: quadros, descontos, seções 7 e 8, impossibilitados e considerações) só sai com "pronto para conferência", pelo mesmo gerador de PDF do sistema.
