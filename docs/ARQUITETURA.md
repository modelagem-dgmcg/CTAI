# Arquitetura

## Visão geral

```
 Unidade (navegador/PWA)          CTAI (navegador/PWA)
        │                                 │
        ▼                                 ▼
  /api/unidade/*                    /api/ctai/*  /api/analista/*  /api/integracoes/*  /api/admin/*  /api/gestao/*
        └───────────────┬───────────────────┘
                   Express 5 (server/app.js)
   auth (sessão, CSRF) · cabeçalhos de segurança · trilha com cadeia
        │
   ┌────┴─────────────────────────────────────────────┐
   │ server/unidade-calculo.js   lado da UNIDADE      │  separados de propósito:
   │ core/recalculo.js           lado da CTAI         │  quem lança não confere o próprio trabalho
   └────┬─────────────────────────────────────────────┘
   SQLite (node:sqlite) · PDFs em data/ (pdfkit)
        │
   adapters/ (manual, csv, mv-api) → lotes PENDENTES → gestor confirma → entram no cálculo
   modules/analista/ (encaixe) → achados → fixados na mesa
```

## Escolhas

- **Node 22 + `node:sqlite`**: sem banco para instalar; um arquivo só (`data/ctai.sqlite`). Rodar com `--no-warnings`.
- **Express 5 + pdfkit**: só duas dependências. Fontes TTF (IBM Plex Sans, Source Serif 4) ficam no repositório, então o PDF não depende de internet.
- **Front-end sem build**: JS puro, PWA, fontes locais. Abre em celular. O service worker guarda só arquivos estáticos, nunca `/api`.
- **Duas contas de cálculo**: a unidade calcula para o gestor ver os valores reunidos e gerar o PDF (`server/unidade-calculo.js`). A CTAI recalcula do zero a partir das **linhas** (`core/recalculo.js`) e compara com o declarado. A diferença vira *divergência*.

## Fluxo de dados

1. **Fichas e listas** (rascunho): cada setor preenche a sua ficha; linhas entram por CSV, digitação ou integração (lote pendente).
2. **Conferir e enviar**: o sistema bloqueia se houver ficha que não está "pronta" ou lote da API pendente. O PDF é gerado **antes** da transação; depois, numa só transação, grava `envios` (imutável, com SHA-256 do PDF), `linhas_brutas`, `indicadores_oss`, evidências e trilha.
2b. **Vínculo com o SEI** (`server/sei.js`, tabela `envio_sei`): enquanto não há API do SEI, o relatório segue por **dois canais**: os dados no sistema (a CTAI recalcula) e o PDF assinado no SEI (documento oficial). O elo é o **número do documento no SEI**, registrado à mão pelo gestor da unidade, por versão de envio. A tabela só recebe linhas novas (registro ou correção, com motivo); a vigente é a mais recente da versão. Cada registro entra na trilha. `canais(db, cid)` calcula a situação por versão e os três alertas (`sem_registro_sei`, `sei_versao_antiga`, `nova_versao_depois_sei`), usando a hora do **primeiro** registro. **Nada bloqueia o envio**; o sistema só avisa. O código curto é `hash_snapshot.slice(0, 12)`, o mesmo do rodapé do PDF.
3. **Recebimento** (automático): recalcula, sincroniza as divergências (`origem` = recálculo), muda a competência para "recebida" e roda o Analista sobre o texto do envio.
4. **Minuta**: o criador escolhe competências do trimestre; o sistema reúne indicadores (declarado × recalculado × adotado), divergências, alertas, cenários de desconto e achados fixados. Pontos adotados começam iguais ao recálculo; mudar exige origem e justificativa.
5. **Congelar** → versão imutável com hash do conteúdo. Mudou algo depois? O sistema avisa e exige nova versão **com motivo**.
6. **Mesa**: 8 itens (o item *Documento no SEI confere com a versão recebida* leva versão, código curto e número do SEI congelados no conteúdo; se a unidade mudar o registro depois, a minuta aparece como alterada e pede nova versão) conferidos por colega (OK ou reparo com comentário). Reparo derruba o estado para "com reparo". A superintendente dá OK em todos os itens e autoriza.
7. **SEI**: o criador baixa o PDF autorizado, anexa e assina **no SEI**, e registra o número aqui. A competência passa a "parecer emitido" e o texto trava.

## Imutabilidade e trilha

- Gatilhos do SQLite bloqueiam UPDATE em `trilha_auditoria`, `envios`, `envio_sei`, `linhas_brutas`, `versoes_minuta` e `conferencias`, e DELETE nelas **exceto** quando o contrato é de demonstração (o gatilho confere a marca `demo` do contrato). A própria trilha nunca pode ser apagada; apagar a demonstração fica registrado nela.
- `trilha_auditoria`: cada evento guarda o hash do anterior (`hash_anterior`, `hash`). `/api/ctai/trilha/verificar` refaz a cadeia.
- Correção de envio = **nova versão** do envio, com motivo obrigatório.

## Segurança

- Senhas com scrypt; sessão em cookie `ctai_sid` (httpOnly, SameSite=Lax; `Secure` com `CTAI_COOKIE_SEGURO=sim`).
- Bloqueio de 10 min após 5 falhas de senha.
- CSRF: toda requisição que muda dado precisa do cabeçalho `x-ctai: 1` (navegador de outro site não consegue enviar sem pré-voo).
- CSP restritiva, `X-Content-Type-Options`, `Referrer-Policy`, sem scripts externos.
- Perfis: `admin`, `criador`, `colega`, `superintendente`, `gestor_unidade`, `setor_unidade`. Perfis da unidade só veem o próprio contrato; responsável de setor só edita o próprio setor.
- Linhas: validação recusa colunas e valores com cara de dado pessoal (nome, CPF, CNS, prontuário, nascimento, e-mail, telefone).

## Regras como dado

`regras/igq_v1.json` descreve os 16 indicadores (soma 100), as faixas de pontuação, as faixas de pagamento e a base do desconto. Cada contrato aponta para uma regra (`regras` no banco). Dúvidas de interpretação ficam em `decisoes_regra` (8 perguntas), decididas por quem pode, **com justificativa**; o recálculo e o desconto passam a usar a decisão. Enquanto não decidido, usa a ficha do contrato e **avisa**.

## Pontos de extensão

- **Analista**: `modules/analista/` (contrato em `docs/DNA-ANALISTA.md`).
- **MV**: `adapters/mv/` (veja `docs/INTEGRACAO-MV.md`). Outros sistemas: copie `adapters/csv.js` ou o adaptador do MV e troque o mapeamento.
- **Modelo do relatório**: `templates/relatorio-v1.json` define as seções do PDF.
- **Novo contrato**: inclua em `carga/contratos.csv` (ou crie pela rotina de seed) e cadastre a regra.


## Gestão CTAI (módulo da superintendência)

Rotas em `server/routes/gestao.js` (`/api/gestao/*`, só superintendente e admin). Peças:

| Arquivo | Papel |
|---|---|
| `server/carteira.js` | carteira de unidades por funcionário, com histórico (`carteira`: `desde`/`ate`); regra de visibilidade (`permitidos`); barreira `guarda(db)` aplicada nos routers `/api/ctai` e `/api/analista`: confere a unidade de qualquer recurso citado na URL, no corpo ou na consulta (competência, envio, parecer, versão, achado, divergência, contrato) e filtra as listas |
| `server/ia-config.js` | provedores de IA: chave cifrada com AES-256-GCM (chave derivada de `CTAI_SEGREDO` por scrypt), nunca devolvida; `ia_config`, `ia_uso` (contagem por provedor e mês); `instalar(db)` liga o módulo do Analista a esta configuração |
| `modules/analista/providers/index.js` | o módulo não conhece o banco: recebe um *resolvedor* (configuração cadastrada) e um *contador* de uso por `usar()`. `.env` continua valendo como base; o que foi cadastrado manda por cima, inclusive para desligar |
| `server/gestao.js` | produção (consultas à trilha e às tabelas do fluxo, sem telemetria de uso) e painel (prazos, envios, fase, IGQ, comparação com o trimestre anterior, recorrência, alertas) |
| `server/pdf/painel.js` | PDF do painel, pelo mesmo renderizador dos outros PDFs |
| `public/js/gestao.js` | telas (carregado antes de `ctai.js`; o menu e as rotas só existem para superintendente e admin) |

Tabelas novas (criadas por `CREATE IF NOT EXISTS`, sem alterar as existentes): `carteira`, `gestao_config`, `ia_config`, `ia_uso`.

Decisões: (1) criador/colega **sem carteira** continuam vendo tudo, para não quebrar quem já usa; o modo estrito (`gestao_config.carteira_estrita`) inverte isso. (2) A produção só conta ações já gravadas. (3) Segredo e chaves nunca vão para o repositório, a tela, a trilha ou o log.
