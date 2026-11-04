# Acervo CTAI no Google Drive

Quando o número do SEI é registrado (no Editor de Documentos ou no parecer do trimestre), o sistema guarda o **texto do documento, sem dados de paciente**, numa pasta do Drive da CTAI:

`Acervo / <Unidade> / <Trimestre> / <Título> - SEI <número>.txt`

O original não é guardado. O banco do CTAI continua sendo a base de trabalho. Se o Drive falhar, ninguém é atrapalhado: o item fica **pendente** e a administração usa **Reenviar os pendentes** (tela Relatórios anteriores).

## Como ligar (uma vez só, sem programar)

1. Entrar em console.cloud.google.com com a conta da CTAI, criar um projeto (ex.: "CTAI") e ativar a **Google Drive API**.
2. **IAM e administrador → Contas de serviço → Criar conta de serviço** (nome: ctai-acervo). Em **Chaves → Adicionar chave → JSON**: baixa um arquivo. Guarde bem.
3. No Drive da CTAI, crie a pasta **Acervo CTAI**. **Compartilhe** com o e-mail da conta de serviço (termina em `iam.gserviceaccount.com`) como **Editor**.
4. O id da pasta é o final do endereço dela (`drive.google.com/drive/folders/ESTE_TEXTO`).
5. No Render (Environment) crie duas variáveis:
   - `CTAI_DRIVE_CHAVE` = o conteúdo inteiro do arquivo JSON (ou ele convertido em base64)
   - `CTAI_ACERVO_PASTA` = o id da pasta
6. Reinicie. Em **Relatórios anteriores** a administração vê "Acervo CTAI no Google Drive" com a contagem.

Nunca coloque a chave no GitHub. Quem tem a chave escreve na pasta compartilhada com ela, e só nela.

## Carga de todos os pareceres desde o começo

Cada relatório ou parecer anterior que a analista **confirma** em *Enviar documentos* / *Relatórios anteriores* também vai para o Acervo (o texto, já sem dados de paciente, é guardado até o Drive aceitar). Nome: `Parecer <número> [código].txt`, na pasta Unidade / Trimestre. O mesmo documento nunca é guardado duas vezes.
Por isso a carga inicial é: cada analista envia o ZIP do SEI da sua carteira, confere e confirma. Ao terminar, a administração confere o cartão do Acervo (arquivados e pendentes).

## Quem lê: os sistemas, por chave

Pessoas não leem o Acervo por aqui. Quem lê são os sistemas (Raio-X, Analista da diretoria etc.), cada um com **uma chave de leitura própria**.

- Criar e revogar: tela *Relatórios anteriores* → cartão "Acervo CTAI no Google Drive" → **Criar chave** / **Revogar chave** (administração e superintendência). A chave aparece uma única vez; guarde só no sistema que vai usá-la.
- Uso (só leitura, cabeçalho `Authorization: Bearer <chave>`):
  - `GET /api/acervo-api/documentos?unidade=&trimestre=&tipo=&q=&limite=` lista o que existe (sem o texto);
  - `GET /api/acervo-api/documentos/<id>` devolve o texto.
- Qualquer escrita é recusada. Cada chave tem o uso contado e pode ser revogada a qualquer momento.
