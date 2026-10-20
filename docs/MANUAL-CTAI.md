# Manual da CTAI (passo a passo)

Endereço: `/ctai`. Perfis: **criador** (monta o parecer), **colega** (confere), **superintendente** (confere de novo e autoriza), **administrador** (usuários, demonstração, integrações; **não** confere nem autoriza na mesa).

## Menu
**Painel · Pareceres · Analista · Regras e decisões · Integrações · Trilha · Administração** (só admin).

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
