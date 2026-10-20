# Juntando o Analista que já existe (o "DNA")

Eu **não tinha o código do Analista atual** nesta sessão e **não inventei** nada dele. O que está em `modules/analista/` é um **encaixe** com um contrato bem definido, mais um conjunto pequeno de regras locais e provedores de IA (desligados sem chave) para o sistema funcionar e ser testado hoje. A ideia é você trazer o DNA e encaixar.

## O contrato (não muda)

Entrada: `{ texto, tabelas?, tipo?, contexto? }`
- `contexto`: `{ competencia:'2026-06', unidade, mesImplantacao, valores:{verde,amarelo,vermelho}, transparencia, outrosTextos:[{id,texto}], observacoes }`

Saída: `{ achados:[{ gravidade:'ALTA|MÉDIA|BAIXA', tipo, trecho, risco, sugestao, setor_sugerido }], provedor, tentativas:[{provedor, ok, erro?}], mascarados }`

O sistema grava os achados; o módulo **não toca o banco**.

## O que trazer do Analista atual (e onde encaixa)

| Traga | Encaixa em | Observação |
|---|---|---|
| `Code.gs` (ponto de entrada, orquestração) | `modules/analista/index.js` (função `analisar`) | mantenha a assinatura; troque o miolo |
| `Raiox.gs` (extração do texto e das tabelas do documento) | `server/envios.js` (`textoDoEnvio`, `lerPdf`) e `modules/analista/index.js` | hoje lê o texto do PDF do envio; o Raiox pode trazer tabelas estruturadas (`tabelas`) |
| `Docs*.gs` (ler Google Docs/Drive) | adaptador novo em `adapters/` | só se o texto vier de Docs; o resto do sistema não muda |
| `Achados.gs` (regras que geram achados) | `modules/analista/regras-locais.js` | cada regra vira uma função `(texto, contexto) → achados[]` |
| Prompts | `modules/analista/prompts/sistema.md` e `usuario.md` | o motor usa estes dois arquivos |
| Cascata de modelos (Gemini → Groq → …) | `modules/analista/providers/index.js` e `ANALISTA_ORDEM` | ordem por variável de ambiente |
| Mascaramento de dado pessoal | `modules/analista/mascara.js` | já mascara CPF, CNS, e-mail, telefone, nascimento, prontuário e nomes após rótulo; **mantenha o que for mais forte** |

## Duas formas de encaixar

1. **Como regras e prompts** (mais simples): copie as regras de `Achados.gs` para `regras-locais.js` e os prompts para `prompts/`. O motor, a cascata, o mascaramento e a gravação continuam do sistema.
2. **Como provedor próprio**: em `modules/analista/providers/index.js`, acrescente uma entrada em `PROVEDORES` com o formato `{ nome:'dna', nuvem:false, ativo: () => <tem como rodar?>, async chamar({ sistema, usuario }) { ...; return '<texto com o array JSON de achados>'; } }` (é o mesmo formato dos outros; `chamar` devolve **texto** com o array JSON do contrato, e o motor extrai, normaliza e descarta o que não estiver no texto). Ponha `dna` em `ANALISTA_ORDEM`. Se o DNA rodar em outro servidor, `providers/http.js` (`postarJson`) mostra como chamar por HTTP. Marque `nuvem:true` se o texto sair da rede da casa: aí só vai mascarado e com `ANALISTA_ENVIAR_NUVEM=sim`.

## Regras que o encaixe já cumpre (mantenha ao juntar)

- Texto que vai à nuvem é **mascarado antes** e só com `ANALISTA_ENVIAR_NUVEM=sim`.
- Achado com `trecho` que **não aparece no texto** é descartado.
- Gravidade normalizada para ALTA, MÉDIA ou BAIXA.
- Regras locais **sempre** rodam (não dependem de rede nem de chave).
- Nenhum segredo no código: chaves só no `.env`.

## O que as regras locais já fazem (para você comparar com o DNA)

Extenso × numérico (ex.: "vinte" ≠ 22); percentual que não bate com a conta; soma de tabela que não fecha; mês citado diferente da competência; valor de outra cor citado como vermelho; nível de transparência diferente da ficha; trecho repetido no mesmo documento; trecho copiado de outro documento do mesmo envio.

## Como testar a junção

`npm test` roda `test/analista.test.js` (contrato, mascaramento, anti-invenção, extenso). Depois de encaixar, adicione um caso com um texto real **sem dado de paciente** e rode `npm run e2e` para ver os achados chegarem na mesa.
