# Rack da API do sistema da unidade (MV)

Estado: **pronto para receber a API, sem a API real**. Tudo foi testado contra um **simulador** com campos e dados **fictícios** (`adapters/mv/mock-server.js`). Quando o acesso sair, o trabalho é trocar o mapeamento de campos, não o sistema.

> Rodapés de documentos da unidade citam "Pixeon". Pode haver um **segundo sistema** (prontuário/imagem) ao lado do MV. O rack aceita mais de uma integração por contrato; cada uma com o seu mapeamento.

## Como funciona

```
Integrações (tela, admin)  ──►  adapters/mv/sync.js
  1. cliente.js busca (GET, só leitura) cada fonte, paginando
  2. transformar.js lê SÓ os campos mapeados (nome, CPF etc. nem entram na memória)
  3. core/linhas.js valida com as mesmas regras do CSV (recusa dado pessoal)
  4. grava como LOTE PENDENTE (linhas_rascunho.confirmada = 0, origem 'api_mv')
  5. o GESTOR DA UNIDADE confirma o lote  ──►  só então entra no cálculo e no envio
```

- **Prévia (dry-run)**: mostra quantas linhas viriam, quantas seriam recusadas e algumas amostras, **sem gravar nada**.
- **Segurança**: a credencial **nunca** está no banco nem no código. A configuração guarda só o **nome** da variável do `.env` (`tokenEnv`, `usuarioEnv`/`senhaEnv`, `chaveEnv`).
- Tipos de acesso: `bearer`, `basic`, `apikey` (cabeçalho configurável) e `nenhuma`.
- Cada chamada fica no **registro** (quando, endereço, status, tempo, quantidade, erro) e a sincronização vai para a trilha.

## Passo a passo quando o acesso sair

1. No `.env`: `MV_API_BASE_URL`, `MV_API_TOKEN` (ou `MV_API_USUARIO` e `MV_API_SENHA`).
2. Em **Integrações** (admin): endereço da API, tipo de acesso e o **nome** da variável. Salve e **Testar a conexão**.
3. Abra `adapters/mv/mapeamento.json`. Cada fonte tem `endpoint`, `parametros` (`{inicio}` e `{fim}` do mês), `listaEm` (onde está a lista na resposta), `paginacao` e `campos`. Em cada campo troque `"de"` pelo **nome real** do campo da API. Conversões em `"como"`:
   - `data`, `hora` (de um carimbo de data e hora, no `fusoHorario` do arquivo)
   - `numero`
   - `segundos_para_minutos`
   - `sim_nao`
   - `mapa` (tabela de valores, por exemplo `"VERMELHO": "vermelho"`)
4. **Prévia** com uma competência. Veja o que foi recusado e por quê.
5. **Buscar agora** → o gestor da unidade confirma o lote na tela do mês.
6. Remova o `aviso` de "campos fictícios" do `mapeamento.json` e aumente a versão.

`adapters/mv/gerar-mapeamento-exemplo.js` regenera o arquivo de exemplo (com nomes fictícios).

## Fontes que o sistema espera

Uma por lista de linhas (veja `docs/FORMULARIOS.md`): classificação de risco, retorno em 24 h, dor torácica, IAMCSST, AVE, sepse, óbitos, queixas, capacitações, transferências, quadro de pessoal. **Cada fonte é opcional**: o que a API não entregar continua entrando por CSV ou digitação.

Colunas que **nunca** devem ser mapeadas: nome, CPF, CNS, prontuário, nascimento, telefone, e-mail, endereço. Se o mapeamento puxar algo assim, a validação recusa a fonte inteira.

## O que pedir à TI da unidade / ao MV

1. Documentação da API (OpenAPI/Swagger ou lista de endpoints) e o **dicionário de campos** das consultas de: classificação de risco (hora da classificação, hora do primeiro atendimento médico, cor), retornos em 24 h, protocolos (dor torácica, IAMCSST, AVE, sepse: horários de chegada, ECG, antibiótico, saída), óbitos (data/hora de entrada e do óbito), transferências, quadro de pessoal.
2. Forma de **autenticação** (token, usuário/senha, chave) e **validade**.
3. **Ambiente de teste** com dados fictícios, e os IPs que devem ser liberados (o servidor do CTAI).
4. **Paginação**, limites de chamadas, formato de data e fuso.
5. Garantia de que existe **identificador de atendimento** que não seja nome nem prontuário (será o "protocolo").
6. Se há **um segundo sistema** (Pixeon) e como ele se relaciona com o MV.
7. Base legal e responsável pela liberação (LGPD): o sistema só lê protocolo, datas, horas, minutos e categorias.

## Testar sem o MV

```bash
npm run mock-mv                       # porta 4010, token "token-de-teste"
MV_API_TOKEN=token-de-teste npm start # em outro terminal
```
Em Integrações: a integração do contrato `UPA-OLINDA` vem **inativa** e sem endereço; a do contrato de demonstração ("API de teste") já aponta para o simulador. `npm test` (`test/mv.test.js`) cobre: configuração só com **nome** de variável, teste de conexão e registro da chamada, prévia sem gravar, lote pendente que só vale depois da confirmação do gestor, campos não mapeados (nome, CPF) que nunca chegam ao banco, falha da API e token errado. A recusa de colunas com cara de dado pessoal está em `test/linhas.test.js`.
