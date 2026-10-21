# Melhorias possíveis do Sistema CTAI

Lista levantada a partir do que já foi criado (`docs/STATUS.md`). Cada item diz o que falta e por que importa. A ordem é a sugerida.

## 1. Para a conferência ficar mais completa

1. **Comparar o relatório novo com os de trimestres anteriores da mesma unidade.** Hoje a comparação com o trimestre anterior existe só no painel da superintendente (IGQ). O Analista ainda não cruza os números e textos com o que a unidade já enviou. Ajuda a achar saltos e valores que mudam sem explicação.
2. **Ligar os leitores de IA e as regras do Analista da diretoria.** A lógica de achados, normas e registro já veio, mas os leitores de IA e as regras do `Achados.gs` ainda não foram trazidos (`docs/DNA-ANALISTA.md`). Falta testar com chave real.
3. **Colar as normas reais da UPA Olinda.** As que estão no sistema são exemplos. Sem elas, a sugestão de norma por achado fica pobre.
4. **Conferir com o SIMAS e com o banco real.** Hoje só existe o modo de demonstração e um arquivo JSON. Falta saber quem alimenta o SIMAS e se ele entrega linhas ou só totais.

## 2. Para a unidade enviar com menos trabalho

5. **API do sistema da unidade (MV).** O encaixe está pronto; falta o acesso e a lista de campos. Se a API não sair, a unidade segue lançando no sistema.
6. **Formulário padrão definitivo.** Hoje segue a UPA Olinda. Ajusta quando chegar a lista de dados que toda UPA deve enviar. O que não estiver nela não fica no sistema.
7. **Regras de outros contratos.** O `regras/igq_v1.json` serve de modelo para cada contrato apontar a sua regra.

## 3. Para o dia a dia da equipe

8. **Avisos por e-mail e recuperação de senha.** Hoje só o administrador redefine a senha, e não há aviso por e-mail.
9. **Calendário de feriados nos prazos do dia 20 e do dia 25.** Hoje valem como dia corrido.
10. **Fila e caixa de entrada mais enxutas.** Mostrar primeiro o que está vencido ou parado.
11. **Word e Excel**, só se a CTAI pedir. Hoje a saída é só PDF, por decisão.

## 4. Para ficar seguro e estável

12. **Segundo fator de autenticação.**
13. **Banco para mais usuários.** Um arquivo SQLite serve a uma comissão, não a dezenas de pessoas ao mesmo tempo.
14. **Backup da pasta `data/`, HTTPS e senha temporária trocada** antes de qualquer uso real.
15. **Hospedagem institucional (ATI)**, quando chegar a hora de envolver a TI. Por ora, só teste e observação.
16. **Revisão de LGPD** pelo encarregado antes de abrir a todos.
17. **Teste do Render real**, com o passo 5 do `docs/GUIA-RENDER.md`, antes de divulgar.

## 5. Para qualquer pessoa conseguir usar

18. **Acessibilidade.** Falta testar com leitor de tela, conferir o contraste (WCAG) e testar em celular de verdade.
19. **Textos de ajuda em linguagem simples**, como o "O que é o Analista CTAI?" da tela de entrada.
20. **Treinamento curto** para a unidade e para a equipe, com um passo a passo de uma página.

## 6. Decisões que dependem da CTAI

21. **As 8 dúvidas de regra** (`docs/DECISOES.md`), em especial desconto de 10% fixo ou por faixas.
22. **Integração com o SEI.** Hoje o vínculo é manual, pelo número do documento. Se o SEI 5.0 trouxer API, vale rever.
