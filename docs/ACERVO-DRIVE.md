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
