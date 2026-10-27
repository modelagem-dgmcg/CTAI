# Contratos e TAs (Drive): como ligar

O CTAI lê a pasta "CONTRATOS E TAs - OSS SES" (que a diretoria atualiza todo dia 20) por um **Apps Script de só leitura**. Contratos e termos aditivos são documentos públicos (LAI): a chave é **opcional**.

## Passo a passo (quem é dono da pasta)
1. Abra script.google.com, crie (ou abra) o projeto do script da pasta e **substitua o código** pelo bloco abaixo. A pasta é a do ID `ID_PASTA_CONTRATOS` (confira no começo do código).
2. (Opcional) Para exigir chave: Configurações do projeto > Propriedades do script > crie `API_CHAVE` com um texto longo. Sem essa propriedade, o script é aberto (só lê Google Docs, PDF e Word da pasta; planilhas ficam de fora).
3. Implantar > Gerenciar implantações > lápis (Editar) > Versão: **Nova versão** > Implantar. O endereço (termina em `/exec`) continua o mesmo.
4. No CTAI: Console > Integrações > **Contratos e TAs (Drive)**: cole o endereço (e a chave, se criou) > Guardar > Testar.

Se um endereço antigo, sem proteção e que listava a pasta, já circulou fora da equipe, trate-o como exposto: crie uma nova implantação (novo endereço) e desative a antiga.

## O que o script responde
- `?acao=listar&termo=upae palmares` → arquivos cujo nome ou caminho de pastas contém todas as palavras (id, nome, pasta, caminho, tipo, tamanho_kb, atualizado_em, url_visualizacao).
- `?acao=ler&id=ID` → texto de um Google Doc da pasta (até 400 mil caracteres).

## Código do script (Code.gs)
```javascript
/**
 * API DE CONSULTA - CONTRATOS E TAs - OSS SES (somente leitura)
 *
 * Duas ações (chave opcional):
 *   ?acao=listar&termo=palmares   -> lista os documentos (nome, pasta, tipo, data, link)
 *   ?acao=ler&id=ID_DO_ARQUIVO    -> devolve o TEXTO de um Google Doc
 * Só aparecem Google Docs, PDF e Word. Planilhas e outros arquivos da pasta não são listados.
 */
const TIPOS_PERMITIDOS = ['application/vnd.google-apps.document', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

const ID_PASTA_CONTRATOS = '1nYIdSAphgSFrZXCqPaGotnPBr0uzbOSH';
const MAX_CARACTERES = 400000;   // limite de texto devolvido por documento
const MAX_ARQUIVOS = 2000;       // trava de segurança na varredura

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    // Chave é OPCIONAL: se a propriedade API_CHAVE não existir, a consulta é aberta (documentos públicos, LAI).
    // Se um dia quiser fechar, basta criar a propriedade API_CHAVE (e a mesma chave na tela do Analista CTAI).
    const chaveCerta = PropertiesService.getScriptProperties().getProperty('API_CHAVE');
    if (chaveCerta && String(p.chave || '') !== String(chaveCerta)) return saida({ ok: false, erro: 'Chave inválida.' });

    const acao = String(p.acao || 'listar').toLowerCase();
    if (acao === 'listar') return listar(p);
    if (acao === 'ler') return ler(p);
    return saida({ ok: false, erro: 'Ação desconhecida.' });
  } catch (err) {
    return saida({ ok: false, erro: err.message });
  }
}

function saida(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function normalizar(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

function listar(p) {
  const termo = normalizar(p.termo || p.unidade || p.oss || '');
  const palavras = termo ? termo.split(' ') : [];
  const raiz = DriveApp.getFolderById(ID_PASTA_CONTRATOS);
  const lista = [];
  varrer(raiz, raiz.getName(), palavras, lista);
  lista.sort(function (a, b) { return a.caminho.localeCompare(b.caminho) || a.nome.localeCompare(b.nome); });
  return saida({ ok: true, termo_pesquisado: termo || 'todos', total_encontrados: lista.length, arquivos: lista, gerado_em: new Date().toISOString() });
}

// Procura cada palavra do termo no nome do arquivo OU no caminho das pastas (ex.: "UPAE/Palmares/1º Termo Aditivo").
function varrer(pasta, caminho, palavras, lista) {
  const arquivos = pasta.getFiles();
  while (arquivos.hasNext() && lista.length < MAX_ARQUIVOS) {
    const arq = arquivos.next();
    if (arq.isTrashed() || TIPOS_PERMITIDOS.indexOf(arq.getMimeType()) < 0) continue;
    const alvo = normalizar(caminho + ' ' + arq.getName());
    if (palavras.every(function (w) { return alvo.indexOf(w) >= 0; })) {
      lista.push({
        id: arq.getId(),
        nome: arq.getName(),
        pasta: pasta.getName(),
        caminho: caminho,
        tipo: arq.getMimeType(),
        tamanho_kb: Math.round(arq.getSize() / 1024),
        atualizado_em: arq.getLastUpdated().toISOString(),
        url_visualizacao: arq.getUrl()
      });
    }
  }
  const subs = pasta.getFolders();
  while (subs.hasNext() && lista.length < MAX_ARQUIVOS) {
    const sub = subs.next();
    varrer(sub, caminho + ' / ' + sub.getName(), palavras, lista);
  }
}

// Só Google Docs (os contratos e termos transcritos). Dentro da pasta de contratos, nada mais é lido.
function ler(p) {
  const id = String(p.id || '');
  if (!id) return saida({ ok: false, erro: 'Informe o id.' });
  const arq = DriveApp.getFileById(id);
  if (!estaNaPasta(arq, ID_PASTA_CONTRATOS)) return saida({ ok: false, erro: 'Arquivo fora da pasta de contratos.' });
  if (arq.getMimeType() !== 'application/vnd.google-apps.document') {
    return saida({ ok: false, erro: 'Só Google Docs são lidos (este arquivo é ' + arq.getMimeType() + ').', tipo: arq.getMimeType() });
  }
  let texto = DocumentApp.openById(id).getBody().getText();
  const truncado = texto.length > MAX_CARACTERES;
  if (truncado) texto = texto.substring(0, MAX_CARACTERES);
  return saida({
    ok: true, id: id, nome: arq.getName(), atualizado_em: arq.getLastUpdated().toISOString(),
    url_visualizacao: arq.getUrl(), caracteres: texto.length, truncado: truncado, texto: texto
  });
}

function estaNaPasta(arq, idRaiz) {
  const fila = [];
  const pais = arq.getParents();
  while (pais.hasNext()) fila.push(pais.next());
  let voltas = 0;
  while (fila.length && voltas < 200) {
    const f = fila.shift(); voltas++;
    if (f.getId() === idRaiz) return true;
    const ps = f.getParents();
    while (ps.hasNext()) fila.push(ps.next());
  }
  return false;
}

// Para testar dentro do editor (botão Executar): lista até 5 arquivos da pasta, sem chave.
function testarNoEditor() {
  const lista = [];
  varrer(DriveApp.getFolderById(ID_PASTA_CONTRATOS), 'raiz', [], lista);
  Logger.log('Arquivos encontrados: ' + lista.length);
  lista.slice(0, 5).forEach(function (a) { Logger.log(a.caminho + ' | ' + a.nome + ' | ' + a.tipo); });
}
```

## Como o CTAI usa
Veja o item "Contrato e atualizações" em docs/MANUAL-CTAI.md. Variáveis opcionais do servidor: `CONTRATOS_DRIVE_URL` e `CONTRATOS_DRIVE_CHAVE` (valem mais do que o digitado na tela).
