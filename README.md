# Sistema CTAI

Sistema de acompanhamento do Contrato de Gestão: a **unidade** preenche os formulários e envia o relatório (com PDF), a **CTAI** recebe, recalcula de forma independente, aponta divergências, monta o parecer, e a **mesa de conferência** (colegas e superintendente) confere antes do SEI.

Fluxo (página 6 do documento): unidade envia → analista consolida → colega confere e a equipe anexa no SEI → superintendente confere de novo → assinatura e envio.

> **Estado:** primeira versão para teste. Dados de demonstração **fictícios** (marcados na tela e no PDF). Leia `docs/STATUS.md` para saber o que está pronto, o que é encaixe e o que ainda não foi testado de verdade.

## Como rodar em 3 passos

Precisa de **Node 22.5 ou mais novo**.

```bash
npm install          # 1. instala as dependências (express e pdfkit)
cp .env.example .env # 2. (opcional) ajuste a porta, a senha temporária etc.
npm start            # 3. sobe em http://localhost:3000
```

- Portal da Unidade: `http://localhost:3000/unidade`
- Console da CTAI: `http://localhost:3000/ctai` (menu **Analista CTAI**: veja `docs/ANALISTA-CTAI.md`; menu **Gestão CTAI** para a superintendente: veja `docs/MANUAL-CTAI.md`)
- Exposição por túnel (só o Portal da Unidade): `docs/EXPOSICAO.md`
- Entrada comum: `http://localhost:3000/` (cada perfil vai para o seu lado)

Com Docker: `docker compose up --build` (usa a pasta `data/` para o banco e os PDFs).

### Usuários de teste (senha temporária `Trocar@123`, troca obrigatória no primeiro acesso)

| Usuário | Perfil | Faz o quê |
|---|---|---|
| `admin` | Administrador | usuários, demonstração, integrações; **não** entra na mesa |
| `cleuton` | Criador do parecer | monta e congela a minuta, registra o SEI |
| `colega1`, `colega2` | Colega conferente | confere item a item |
| `nathalia` | Superintendente | confere de novo e autoriza |
| `gestor.demo` | Gestor da unidade (demonstração) | revisa tudo e envia o relatório |
| `assistencia.demo`, `ouvidoria.demo` | Responsável de setor | preenche só a ficha do seu setor |
| `gestor.olinda` | Gestor da UPA Olinda (dados reais da carga) | — |

Troque `CTAI_SENHA_TEMPORARIA` no `.env` antes de dar acesso a outras pessoas.

## Comandos

| Comando | O que faz |
|---|---|
| `npm start` | sobe o sistema |
| `npm test` | testes automáticos (regras, linhas, Analista, fluxo completo, MV) |
| `npm run e2e` | teste de ponta a ponta com navegador (Chromium) e capturas em `docs/capturas/` |
| `npm run mock-mv` | simulador da API do MV na porta 4010 (token `token-de-teste`) |
| `node scripts/gerar-doc-formularios.js` | regenera `docs/FORMULARIOS.md` a partir do código |

## Mapa da pasta

```
server/        servidor (Express), banco, autenticação, trilha, envios, minuta, PDFs, rotas
core/          regras do IGQ, recálculo da CTAI, formulários, validação de linhas, dados sintéticos
modules/analista/  ENCAIXE do Analista (regras locais + provedores de IA desligados sem chave)
adapters/      entrada de dados: manual, CSV e o RACK da API do MV (com simulador)
public/        telas (PWA, sem build): Portal da Unidade e console da CTAI
regras/        regra de pontuação versionada (igq_v1.json)
carga/         dados reais já levantados (UPA Olinda) que alimentam o início do banco
templates/     modelo do relatório em PDF
docs/          documentação (comece por STATUS.md e DECISOES.md)
test/          testes automáticos e E2E
```

## Documentação

- `docs/STATUS.md` — o que está pronto, o que é encaixe, o que não foi testado.
- `docs/DECISOES.md` — decisões que tomei sem perguntar e as **dúvidas de regra** que mudam o resultado.
- `docs/MANUAL-UNIDADE.md` e `docs/MANUAL-CTAI.md` — passo a passo para quem usa.
- `docs/FORMULARIOS.md` — todos os campos e listas que a unidade preenche.
- `docs/ARQUITETURA.md` e `docs/esquema-banco.md` — como é por dentro.
- `docs/DNA-ANALISTA.md` — como juntar o Analista que já existe.
- `docs/INTEGRACAO-MV.md` — como ligar a API do sistema da unidade.
- `docs/lista-de-pedidos.md` — o que pedir aos colegas.

## Segurança em uma linha cada

- O sistema **nunca guarda senha ou credencial do SEI**. O PDF sai daqui; quem anexa e assina é a pessoa, no SEI.
- **Dois canais enquanto não há API do SEI**: os dados vão ao sistema (a CTAI recalcula) e o PDF assinado vai pelo SEI (documento oficial). O elo é o número do documento no SEI, que o gestor da unidade registra por versão (aba Envios). O sistema só avisa quando falta; nunca bloqueia o envio.
- **Sem dado de paciente**: só protocolo, datas, horas, minutos e categorias. Colunas e textos com cara de nome, CPF, prontuário ou nascimento são recusados.
- Segredos só no `.env` (que não vai para o repositório). O banco guarda apenas o **nome** das variáveis.
- Provedores de IA em nuvem: desligados sem chave e sem `ANALISTA_ENVIAR_NUVEM=sim`; só vai texto mascarado.
- Envios, trilha e conferências são **imutáveis** (gatilhos no banco) e a trilha tem cadeia de códigos; o botão "Verificar" prova que nada foi alterado.
- O "OK" da mesa é **controle interno**, não assinatura. Ninguém confere nem autoriza o próprio trabalho.
