# Espelho do histórico no Google Drive da CTAI

O **banco do CTAI continua sendo a base de trabalho**. A planilha do Drive é uma **cópia** do histórico já **confirmado** (rascunho nunca vai para lá). Serve para consulta, para backup e para quem não usa o sistema. Se o banco for perdido, o histórico volta da planilha.

Enquanto `CTAI_ESPELHO_URL` estiver vazio, o espelho fica **desligado** e nada sai do servidor.

## Como ligar (sem programar)

1. Crie uma planilha em branco no Drive da CTAI. Dê a ela um nome, por exemplo **CTAI – Histórico dos relatórios**.
2. Na planilha: **Extensões → Apps Script**. Apague o que estiver lá e cole o código da seção "Código para colar" abaixo. Salve.
3. No Apps Script: **Configurações do projeto (engrenagem) → Propriedades do script → Adicionar propriedade**. Nome `CTAI_TOKEN`, valor: um código secreto longo (invente um, com 30 letras e números). Guarde esse código.
4. **Implantar → Nova implantação → Tipo: App da Web.** Executar como: **Eu**. Quem tem acesso: **Qualquer pessoa**. (O código secreto é o que protege; sem ele nada é lido nem gravado.) Autorize quando o Google pedir. Copie o endereço que termina em `/exec`.
5. No servidor (Render → Environment), crie duas variáveis:
   - `CTAI_ESPELHO_URL` = o endereço terminado em `/exec`
   - `CTAI_ESPELHO_TOKEN` = o código secreto do passo 3
6. Reinicie o serviço. Na tela **Histórico**, a administração vê o estado do espelho e o botão **Enviar agora**.

> Se a planilha mudar de dono ou o código secreto vazar, troque o `CTAI_TOKEN` no Apps Script e o `CTAI_ESPELHO_TOKEN` no Render e implante de novo.

## O que vai para a planilha

Uma **aba por tabela**, com as colunas sempre nesta ordem (o cabeçalho é a primeira linha). A cada envio, o conteúdo de cada aba é **substituído** pelo histórico confirmado atual. Não edite a planilha à mão: o que for alterado lá é sobrescrito no próximo envio.

| Aba | Chave da linha | Colunas |
|---|---|---|
| `hist_relatorios` | `hist_id` | hist_id, contrato_id, trimestre, documento_tipo, numero_parecer, nome_arquivo, hash, paginas, igq, desconto_pct, desconto_valor, estado, origem, observacao, criado_por, criado_em, confirmado_por, confirmado_em |
| `hist_indicadores` | `id` | id, hist_id, indicador_id, nome, valor, pontos, max, trecho, verificada |
| `hist_achados` | `id` | id, hist_id, tipo, descricao, gravidade, trecho, verificada |
| `hist_recomendacoes` | `id` | id, hist_id, texto, tema, situacao, trecho, verificada, situacao_por, situacao_em, situacao_nota |

- `hist_id` liga as abas filhas ao relatório (um relatório = um parecer ou relatório de um trimestre de uma unidade).
- `trimestre` no formato `2026-T2`. `documento_tipo`: `parecer`, `relatório da OSS` ou `outro`.
- `situacao` da recomendação: `aberta`, `atendida` ou `repetida`.
- `trecho` guarda a origem: a página e a frase do documento de onde o dado saiu.
- O texto completo do documento **não** vai para a planilha (nem fica no sistema depois de confirmado).

## Quando o envio acontece

- Automaticamente, a cada **confirmação** de relatório e a cada mudança de **situação de recomendação**.
- Manualmente: botão **Enviar agora** (administração e superintendência).
- Se a planilha estiver fora do ar, o sistema segue funcionando; a falha fica na trilha de auditoria (tabela `espelho_drive`) e o próximo envio recupera tudo (cada envio substitui o conteúdo inteiro).

## Restaurar

Só vale para um banco **sem nenhum histórico confirmado** (nunca sobrescreve o que existe). Administração ou superintendência chamam **Restaurar da planilha** na tela Histórico. As unidades (contratos) precisam existir no banco; linhas de unidade desconhecida são ignoradas.

## Código para colar (Apps Script)

```javascript
// CTAI – espelho do histórico. Cole em Extensões → Apps Script. Defina a propriedade do script CTAI_TOKEN.
function resposta_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function tokenOk_(t) {
  var certo = PropertiesService.getScriptProperties().getProperty('CTAI_TOKEN');
  return !!certo && t === certo;
}
var ABAS = ['hist_relatorios', 'hist_indicadores', 'hist_achados', 'hist_recomendacoes'];

function doPost(e) {
  try {
    var dados = JSON.parse(e.postData.contents);
    if (!tokenOk_(dados.token)) return resposta_({ ok: false, erro: 'código errado' });
    if (dados.acao !== 'substituir') return resposta_({ ok: false, erro: 'ação desconhecida' });
    var planilha = SpreadsheetApp.getActiveSpreadsheet(), total = 0;
    ABAS.forEach(function (nome) {
      var cols = (dados.colunas || {})[nome], linhas = (dados.abas || {})[nome] || [];
      if (!cols) return;
      var aba = planilha.getSheetByName(nome) || planilha.insertSheet(nome);
      aba.clearContents();
      var matriz = [cols].concat(linhas.map(function (l) {
        return cols.map(function (c) { var v = l[c]; return v === null || v === undefined ? '' : v; });
      }));
      aba.getRange(1, 1, matriz.length, cols.length).setValues(matriz);
      aba.setFrozenRows(1);
      total += linhas.length;
    });
    return resposta_({ ok: true, linhas: total });
  } catch (err) {
    return resposta_({ ok: false, erro: String(err) });
  }
}

function doGet(e) {
  try {
    if (!tokenOk_(e.parameter.token)) return resposta_({ ok: false, erro: 'código errado' });
    var planilha = SpreadsheetApp.getActiveSpreadsheet(), abas = {};
    ABAS.forEach(function (nome) {
      var aba = planilha.getSheetByName(nome);
      if (!aba || aba.getLastRow() < 2) { abas[nome] = []; return; }
      var v = aba.getDataRange().getValues(), cab = v[0];
      abas[nome] = v.slice(1).map(function (linha) {
        var o = {}; cab.forEach(function (c, i) { o[c] = linha[i]; }); return o;
      });
    });
    return resposta_({ ok: true, abas: abas });
  } catch (err) {
    return resposta_({ ok: false, erro: String(err) });
  }
}
```

## Cuidados

- O Apps Script grava datas e números como o Google entender; o sistema aceita de volta números e textos. Se o Google transformar uma coluna de texto em data, corrija o formato da coluna para **Texto simples** (Formatar → Número → Texto simples) antes de restaurar.
- A planilha traz nomes de unidades (códigos de contrato), notas e recomendações. **Não compartilhe** a planilha além de quem já acessa o CTAI.
- Não coloque nome de paciente nem dado pessoal nos campos do histórico.
