'use strict';
// Servidor falso que imita o Apps Script da pasta "CONTRATOS E TAs - OSS SES" (?acao=listar&termo=&chave= e ?acao=ler&id=&chave=). Dados fictícios.
const http = require('node:http');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const DOC = 'application/vnd.google-apps.document', PDF = 'application/pdf';
const RAIZ = 'CONTRATOS E TAs - OSS SES';

function arquivosPadrao() {
  return [
    { id: 'doc-contrato-palmares', nome: 'Contrato de Gestão 011/2023 - UPAE Palmares', caminho: RAIZ + ' / UPAE / Palmares', tipo: DOC, atualizado_em: '2026-09-20T12:00:00.000Z',
      texto: 'CONTRATO DE GESTÃO Nº 011/2023. Objeto: gerenciamento, operacionalização e execução das ações e serviços de saúde da UPAE Palmares. Vigência: 12 (doze) meses, de 01/03/2023 a 28/02/2024. Valor global: R$ 12.000.000,00. Repasse mensal de R$ 1.000.000,00, sendo 70% fixo e 30% variável. Meta: 3.000 consultas médicas por mês. O desconto por descumprimento seguirá o art. 15-A. Representante legal CPF 123.456.789-09.' },
    { id: 'doc-ta1-palmares', nome: '1º Termo Aditivo - UPAE Palmares', caminho: RAIZ + ' / UPAE / Palmares / Termos Aditivos', tipo: DOC, atualizado_em: '2026-09-20T12:05:00.000Z',
      texto: 'PRIMEIRO TERMO ADITIVO ao Contrato de Gestão nº 011/2023. Prorroga a vigência até 28/02/2025. O repasse mensal passa a ser de R$ 1.100.000,00. Meta: 3.200 consultas médicas por mês.' },
    { id: 'doc-ta2-palmares', nome: '2º Termo Aditivo - UPAE Palmares', caminho: RAIZ + ' / UPAE / Palmares / Termos Aditivos', tipo: DOC, atualizado_em: '2026-09-20T12:10:00.000Z',
      texto: 'SEGUNDO TERMO ADITIVO ao Contrato de Gestão nº 011/2023. Prorroga a vigência até 28/02/2026. Revoga a meta de 3.200 consultas médicas por mês e fixa 3.500 consultas médicas por mês.' },
    { id: 'pdf-ta3-palmares', nome: '3º Termo Aditivo - UPAE Palmares.pdf', caminho: RAIZ + ' / UPAE / Palmares / Termos Aditivos', tipo: PDF, atualizado_em: '2026-09-20T12:15:00.000Z', texto: '' },
    { id: 'planilha-palmares', nome: 'Controle UPAE Palmares', caminho: RAIZ + ' / UPAE / Palmares', tipo: 'application/vnd.google-apps.spreadsheet', atualizado_em: '2026-09-20T12:16:00.000Z', texto: '' },
    { id: 'doc-contrato-caruaru', nome: 'Contrato de Gestão 020/2022 - UPA Caruaru', caminho: RAIZ + ' / UPA / Caruaru', tipo: DOC, atualizado_em: '2026-08-20T12:00:00.000Z', texto: 'CONTRATO DE GESTÃO Nº 020/2022. UPA Caruaru. Valor global R$ 5.000.000,00.' },
  ];
}

// opc.chave: se informada, o script só responde com ?chave= igual (senão, é aberto, como a pasta pública).
async function iniciar(opc) {
  const o = opc || {};
  const estado = { arquivos: arquivosPadrao(), chamadas: [], chave: o.chave || null };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const p = u.searchParams;
    estado.chamadas.push({ acao: p.get('acao'), termo: p.get('termo'), id: p.get('id'), chave: p.get('chave') });
    res.setHeader('content-type', 'application/json');
    if (estado.chave && p.get('chave') !== estado.chave) return res.end(JSON.stringify({ ok: false, erro: 'Chave inválida.' }));
    if (p.get('acao') === 'listar') {
      const palavras = norm(p.get('termo')).split(' ').filter(Boolean);
      const lista = estado.arquivos.filter((a) => a.tipo !== 'application/vnd.google-apps.spreadsheet').filter((a) => palavras.every((w) => norm(a.caminho + ' ' + a.nome).includes(w)))
        .map((a) => ({ id: a.id, nome: a.nome, pasta: a.caminho.split(' / ').pop(), caminho: a.caminho, tipo: a.tipo, tamanho_kb: 12, atualizado_em: a.atualizado_em, url_visualizacao: 'https://docs.google.com/document/d/' + a.id + '/edit' }));
      return res.end(JSON.stringify({ ok: true, termo_pesquisado: norm(p.get('termo')) || 'todos', total_encontrados: lista.length, arquivos: lista, gerado_em: new Date().toISOString() }));
    }
    if (p.get('acao') === 'ler') {
      const a = estado.arquivos.find((x) => x.id === p.get('id'));
      if (!a) return res.end(JSON.stringify({ ok: false, erro: 'Arquivo não encontrado.' }));
      if (a.tipo !== DOC) return res.end(JSON.stringify({ ok: false, erro: 'Só Google Docs são lidos.' }));
      return res.end(JSON.stringify({ ok: true, id: a.id, nome: a.nome, atualizado_em: a.atualizado_em, url_visualizacao: 'https://docs.google.com/document/d/' + a.id + '/edit', caracteres: a.texto.length, truncado: false, texto: a.texto }));
    }
    res.end(JSON.stringify({ ok: false, erro: 'Ação desconhecida.' }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { estado, url: 'http://127.0.0.1:' + srv.address().port + '/exec', fechar: () => new Promise((r) => srv.close(r)),
    adicionar: (a) => estado.arquivos.push(Object.assign({ tipo: DOC, texto: '', atualizado_em: new Date().toISOString() }, a)),
    alterar: (id, parte) => Object.assign(estado.arquivos.find((x) => x.id === id), parte) };
}

module.exports = { iniciar, DOC, PDF, RAIZ };
