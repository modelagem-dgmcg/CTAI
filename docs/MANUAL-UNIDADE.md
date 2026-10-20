# Manual do Portal da Unidade (passo a passo)

Endereço: `/unidade`. Quem usa: o **gestor da unidade** (vê tudo e envia) e os **responsáveis de setor** (preenchem só a ficha do seu setor).

> Nunca coloque dado de paciente. Use o número de protocolo. O sistema recusa nome, CPF, cartão SUS, prontuário, data de nascimento, telefone e e-mail.

## 1. Primeiro acesso
Entre com o usuário e a senha temporária. O sistema pede para trocar a senha (mínimo de 8 caracteres, com letras e números). Este sistema **não pede nem guarda** a senha do SEI.

## 2. Escolher o mês
Em **Meses**, abra o mês que está aberto. A tela **Resumo** mostra:
- quantas fichas estão prontas (são 6 setores);
- quantas linhas já foram confirmadas;
- os pontos que a regra do contrato daria (só informativo: a pontuação final é da CTAI);
- se já existe versão enviada.

## 3. Preencher a ficha do setor
Clique em **Ver a ficha** no cartão do setor.
- Cada campo explica o que é. Campos numéricos mostram a faixa aceita; se digitar fora, o sistema mostra o erro **no próprio campo**.
- **Pode deixar o valor em branco se subir as linhas**: o sistema calcula a média a partir delas.
- **Anexo que comprova**: escreva o número do documento no SEI ou o nome do arquivo. Sem anexo, o item pode ficar sem pontuação.
- **Salvar rascunho** guarda sem fechar. **Salvar e marcar como pronta** diz ao gestor que a ficha terminou. Dá para reabrir depois.

## 4. Subir as listas (linhas)
Em cada setor há listas (por exemplo, classificação de risco, retorno em 24 h, dor torácica, AVE, sepse, óbitos, queixas, transferências, quadro de pessoal).
1. Abra a lista e baixe o **modelo CSV**.
2. Preencha com o protocolo, datas, horas (ou minutos) e a categoria. Nada de nome ou documento.
3. Envie o arquivo. O sistema confere linha a linha e mostra o que foi recusado e por quê. Se o arquivo tiver **coluna com cara de dado pessoal, ele inteiro é recusado**.
4. Também dá para **adicionar uma linha** à mão ou **limpar a lista** (só as linhas digitadas ou enviadas por arquivo).

Linhas vindas da integração com o MV chegam como **lote pendente**. O gestor vê o lote em Resumo e escolhe **Confirmar** ou **Descartar**. Só o que foi confirmado entra no cálculo.

## 5. Conferir e enviar (só o gestor)
Aba **Conferir e enviar**:
- **Ainda não dá para enviar**: lista o que falta (ficha não pronta, lote pendente...).
- **O que o sistema conferiu**: avisos (por exemplo, valor digitado difere mais de 10% do calculado pelas linhas; lista de transferências menor que o BID; gasto com pessoal acima de 80%). **Não impedem** o envio.
- **Indicadores como serão enviados**: valor, de onde veio (digitado, contagens ou linhas) e pontos.
- Clique em **Gerar o PDF e enviar para a CTAI**. Confirme.

O envio fica registrado e **não pode ser alterado**. O PDF aparece para baixar: é ele que segue o trâmite normal no SEI (anexar e assinar pelo seu próprio acesso ao SEI).

No rodapé de cada página do PDF está escrito **Versão vN · código de integridade** e os **12 primeiros caracteres** do código. É por ele que a CTAI confere se o documento que está no SEI é a versão que chegou ao sistema.

### Os dois caminhos andam juntos (enquanto não há API do SEI)
1. **Dados no sistema** (o que você acabou de enviar): a CTAI usa para recalcular.
2. **PDF assinado no SEI**: é o documento oficial.

Depois de anexar e assinar no SEI, **registre o número do documento no sistema**: aba **Envios**, na versão que foi ao processo, campo **Número do documento no SEI**, botão **Registrar**. Assim a CTAI sabe qual versão foi ao processo.
- Só o **gestor da unidade** registra. Responsável de setor vê, mas não registra.
- O número tem **só dígitos, de 6 a 12** (sem ponto, traço ou letra). Campo vazio não é aceito.
- Errou o número? **Corrigir o número**, com o motivo. O registro antigo **não é apagado**: fica no histórico e na trilha.
- Cada versão tem o seu documento no SEI. O mesmo número não vale para duas versões.
- Na aba **Envios**, cada versão mostra **Enviado ao sistema** (ainda sem número) ou **Registrado no SEI**.
- O sistema **não impede** o envio se você não registrar o número. Ele só **avisa**, no Resumo e em Envios, quando uma versão não tem registro ou quando você enviou uma versão nova depois de registrar o SEI da anterior.

### Prazos e documentos obrigatórios

- **Prazos:** o relatório vai ao **SEI até o dia 20** e ao **SIMAS até o dia 25** do mês seguinte. Cada mês mostra os dois prazos, com aviso quando faltam 5 dias ou menos e quando o prazo venceu. O aviso nunca bloqueia o envio.
- **SEI:** vale o dia em que você registrou o número do documento aqui.
- **SIMAS:** o gestor clica em **Informar o envio ao SIMAS** e coloca a data. Para corrigir a data, explique o motivo.
- **Documentos obrigatórios:** na ficha da **Qualidade**, informe o **Relatório da Comissão de Óbitos** (item 2.10). Na ficha da **Ouvidoria**, informe as **informações da publicação de transparência** (item 2.13): endereço da página, data e o que foi publicado. Sem isso o sistema avisa antes do envio e a CTAI marca o item como incompleto.
- O relatório em PDF traz a seção **Documentos obrigatórios do mês**, que mostra o que está completo, incompleto ou não informado.

## 6. Corrigir depois de enviar
Faça a correção nas fichas ou listas e volte em **Conferir e enviar**. O sistema gera uma **nova versão** e exige o **motivo da correção**. A versão antiga continua guardada. Aba **Envios** lista todas, com o PDF de cada. **Cada versão nova tem o seu próprio documento no SEI**: anexe, assine e registre o novo número.

## 7. Regras e integração
- **Regras de pontuação**: mostra as faixas de cada indicador, para a unidade saber como será avaliada.
- **Integração**: mostra o estado da ligação com o sistema da unidade (MV) e permite ver uma prévia (não grava) ou buscar (grava como lote pendente), se o administrador tiver ativado.

## 7b. Equipe da unidade (só o gestor da unidade)

Menu **Equipe da unidade**. A CTAI cria a unidade e o gestor; **a equipe é cuidada por você**:
- **Cadastrar** uma pessoa (login em letras minúsculas, nome) e marcar **quais fichas ela preenche** (assistência, qualidade, ouvidoria, educação, BID, RH). Uma pessoa pode ter mais de uma ficha. Ela entra com a senha temporária e troca no primeiro acesso.
- **Editar** nome e fichas, **definir senha temporária** (encerra as sessões abertas) e **ativar ou desativar**.
- **Responsável por ficha**: escolha quem passa a ser o responsável; quem era deixa de preencher aquela ficha.
- Você só vê e altera **a sua unidade**. Outras unidades e as pessoas da CTAI ficam fora do seu alcance. Tudo fica registrado na trilha, com o seu nome.

## 8. Celular
O portal funciona no celular e pode ser instalado na tela inicial (PWA). Preencher ficha funciona bem; subir CSV é mais fácil no computador.

## Se algo der errado
- "Você só pode preencher a ficha do seu setor": seu usuário é de outro setor. Peça ao gestor.
- Arquivo recusado: leia a mensagem; ela diz a coluna e o motivo.
- Esqueceu a senha: peça ao administrador para redefinir (volta à senha temporária).
