# Status (20/10/2026)

Primeira versão para teste. Funciona de ponta a ponta com **dados fictícios**. Antes de usar com dados reais, leia a seção "Antes de usar de verdade".

## Pronto e testado

| Parte | O que faz | Como foi testado |
|---|---|---|
| Portal da unidade | fichas por setor, listas por CSV ou digitação, recusa de dado pessoal, conferência antes do envio, **PDF** do relatório, envios imutáveis, correção com motivo | testes automáticos + E2E no navegador |
| Recebimento da CTAI | recálculo independente a partir das linhas, divergências, alertas, evidências | testes automáticos + E2E |
| Parecer e mesa | minuta, ajuste de pontos com justificativa, congelar versão, 8 itens (um deles é o do SEI), reparo, superintendente confere e autoriza, registro do SEI, PDF da minuta | testes automáticos (15 de fluxo) + E2E com colega1, colega2 e superintendente |
| Vínculo com o SEI (dois canais) | gestor da unidade registra o número do documento no SEI por versão; correção com motivo (histórico e trilha); rodapé do PDF com versão e 12 caracteres do código; CTAI vê os dois canais lado a lado e 3 alertas; item obrigatório na mesa com dados de apoio; comparação opcional com o PDF do SEI; **nunca bloqueia o envio** | testes automáticos (`test/sei.test.js`, 10 testes) + E2E (unidade registra, número inválido recusado, CTAI compara, reenvio gera alerta) |
| Segurança | login, bloqueio por tentativas, CSRF, CSP, perfis, trilha com cadeia, imutabilidade por gatilho | testes automáticos |
| Analista (encaixe) | regras locais + provedores de IA desligados sem chave; mascaramento; anti-invenção | testes automáticos (sem IA real) |
| Rack do MV | configuração só com nome de variável, prévia, lote pendente, mapeamento, simulador | testes automáticos contra o simulador |
| Dados de demonstração | contrato fictício, recriar e apagar | testes + E2E |

Números: `npm test` = **50 testes, 0 falhas**. `npm run e2e` = fluxo completo no Chromium (unidade envia, PDF válido, CTAI recalcula, minuta, congelar, três pessoas conferem, superintendente autoriza, SEI do parecer registrado, trilha íntegra, número do SEI do relatório registrado pela unidade, dois canais e alerta de nova versão, sem erro de JavaScript nas telas percorridas). Capturas em `docs/capturas/`.

## Vagas (encaixes) deixadas prontas

1. **Analista existente (o DNA)**: contrato e pontos de encaixe em `docs/DNA-ANALISTA.md`. Não tive o código dele; nada foi inventado.
2. **API do MV**: rack pronto; falta o acesso e o dicionário de campos. `docs/INTEGRACAO-MV.md`.
3. **Regras de contrato de outras unidades**: `regras/igq_v1.json` serve de modelo; cada contrato aponta para uma regra.

## Não testado (por falta de acesso ou de ambiente)

- **API real do MV** (nem o segundo sistema, "Pixeon"). Só o simulador.
- **Provedores de IA reais** (Gemini, Groq, Kimi, DeepSeek, OpenRouter, Ollama): sem chave aqui. Os modelos e as URLs são configuráveis e podem precisar de ajuste.
- **O Analista real** (não estava disponível).
- **Docker**: o `Dockerfile` e o `docker-compose.yml` foram escritos mas não construídos (sem Docker em execução aqui).
- **Com dados reais de linhas**: não existem no repositório; a demonstração é sintética.
- **Anexar no SEI**: é manual, por desenho. O sistema só gera o PDF e registra o número.
- **Integração real com o SEI**: não existe (sem API do SEI GOV). Só o vínculo manual por número de documento.
- **Comparação do PDF do SEI** (upload): testada com o próprio PDF e com uma versão alterada; **não** testada com um PDF que passou de verdade pelo SEI (não tive acesso).
- Leitor de tela, contraste formal (WCAG), carga com muitos usuários, impressão do PDF em papel.
- Android/iOS reais (testei largura de celular no Chromium).

## Limites conhecidos

- **Sem a API do SEI, o vínculo entre o dado no sistema e o PDF no SEI depende do registro manual do número pela unidade.** Se a unidade não registrar, o sistema só alerta; não há como saber sozinho o que está no SEI. O número é validado só no formato (dígitos, 6 a 12): o sistema não confirma que o documento existe nem que é o PDF certo. Quem confere é a mesa, olhando o código no rodapé.
- Versões da minuta congeladas **antes** do vínculo com o SEI não têm os dados de apoio e ficam com o item novo da mesa pendente.

- Um processo, um arquivo SQLite: serve bem a uma comissão; não para dezenas de usuários simultâneos.
- Sem e-mail (avisos, recuperação de senha): quem redefine a senha é o admin.
- Sem segundo fator de autenticação.
- O valor do **desconto adotado** só aparece quando a dúvida 1 (10% fixo × faixas) estiver decidida; antes disso a tela mostra os dois cenários.
- Meses carregados da carga (sem envio pelo portal) aparecem na minuta como somente leitura.
- PDFs não são PDF/A e não têm assinatura digital: a assinatura é feita no SEI.

## Antes de usar de verdade

1. Defina `CTAI_SENHA_TEMPORARIA` no `.env` (e troque a dos usuários de teste ou desative-os).
2. Hospede atrás de **HTTPS** e ponha `CTAI_COOKIE_SEGURO=sim`.
3. Faça **backup** da pasta `data/` (banco e PDFs). A trilha só prova integridade; não recupera dado perdido.
4. Decida as **8 dúvidas de regra** (`docs/DECISOES.md`).
5. Confirme com a chefia e a CTAI antes de abrir para os colegas (combinado em `docs/lista-de-pedidos.md`).
6. Revisão de **LGPD** pelo encarregado: o sistema foi desenhado para não ter dado de paciente, mas a conferência humana continua necessária.
7. Apague a demonstração (Administração) quando não precisar mais.
