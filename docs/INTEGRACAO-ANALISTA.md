# Ponte com o Analista da diretoria (contatos e mensagens)

Serve para a CTAI **consultar os contatos** do Analista e **trocar mensagens** com quem usa o Analista, mantendo a conversa igual dos dois lados. Cada lado continua com banco e usuários próprios.

## O que a CTAI precisa

| Valor | Onde está | É segredo? |
|---|---|---|
| `ANALISTA_API_URL` | já vem preenchida no `.env.example` (é o endereço da API do Analista, o mesmo do site dele) | não |
| `ANALISTA_SERVICO_CHAVE` | gerada por quem administra a planilha do Analista | **sim** |

Sem as duas, a ponte fica desligada e o resto do sistema segue normal.

## Como gerar a chave (uma vez, quem administra a planilha do Analista)

1. Abra a planilha do Analista e use o menu **SEI Analista → 8. Gerar chave de serviço da CTAI**.
2. Copie a chave que aparece (só aparece uma vez) e cole direto em `ANALISTA_SERVICO_CHAVE` no `.env` do CTAI (ou nas variáveis do Render).
3. Não envie por e-mail, WhatsApp, chat nem GitHub. Se perder ou vazar, gere outra (a antiga morre na hora) ou use **9. Desativar a chave de serviço da CTAI**.

Exige o `Code.gs` do Analista de 22/10/2026 12:00 ou mais novo (Implantar, Gerenciar implantações, lápis, **Nova versão**).

## O que a chave abre (e só isso)

- `servico/contatos`: nome, login e gerência de quem está ativo no Analista.
- `servico/mensagem-enviar`: manda mensagem a uma pessoa ativa. Aparece para ela como **CTAI** (com o nome de quem enviou, se informado). CPF, RG, e-mail e telefone no texto viram marcador.
- `servico/mensagens-listar`: lê a conversa entre a CTAI e a pessoa, nas duas pontas.

Não lê processos, documentos, achados nem outras conversas, e não fala em nome de nenhuma pessoa. Limite de 120 chamadas a cada 10 minutos; bloqueio de 15 minutos depois de várias chaves erradas. Tudo registrado no registro de atividades do Analista (sem o texto das mensagens).

## Como usar no código

```js
const { criar } = require('./adapters/analista');
const analista = criar();            // lê o .env
if (analista.ligada) {
  const contatos = await analista.contatos();                        // [{ nome, email, gerencia }]
  await analista.enviar({ para: 'ana@ses', texto: 'Oi', deQuem: 'Maria' });
  const conversa = await analista.conversa('ana@ses', '2026-10-22T00:00:00Z'); // só o que veio depois
}
```

Do lado do Analista, quem tem a ponte ativa vê o contato **CTAI** no Mensageiro e responde por lá; a resposta aparece em `conversa()`.

## Pontos de atenção

- O Apps Script demora (1 a 5 s por chamada). Para manter a conversa sincronizada, busque com `desde` a cada poucos minutos, não a cada segundo.
- O aviso de mensagem nova do lado do Analista ainda não existe: a pessoa vê a conversa ao abrir o Mensageiro.
- Anexos não passam por esta ponte (só texto).
