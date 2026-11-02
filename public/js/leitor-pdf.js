// Leitura de PDF NA MÁQUINA DA ANALISTA (PDF.js, local em /vendor, sem CDN). Devolve o texto página a página; o PDF não sai daqui
// enquanto houver texto. Um arquivo por vez, memória liberada ao fim (destroy), com limite de tempo e mensagens claras.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica(require('./texto-comum'), require('./guarda-comum')); else raiz.CTAI_LEITOR_PDF = fabrica(raiz.CTAI_TEXTO, raiz.CTAI_GUARDA);
})(typeof self !== 'undefined' ? self : this, function (T, GU) {
  'use strict';
  const G = typeof self !== 'undefined' ? self : globalThis;

  const LIGADURAS = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
  const limpar = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[ﬀ-ﬆ]/g, (c) => LIGADURAS[c] || c);

  // Transforma os itens de texto de UMA página (como o PDF.js entrega) em linhas de texto.
  // Segue a ORDEM DE LEITURA do próprio PDF e junta só os pedaços seguidos que estão na mesma linha (mesma coordenada Y, X crescendo):
  // assim uma linha de tabela do Anexo I sai inteira ("jul/26  Médicas  4.324  3.170  1.872  43,29%"), na mesma ordem em que o sistema já lia
  // o quadro, e o extrator de números continua achando as colunas. Distância em X: pequena = junta; média = um espaço; grande = tabulação (coluna).
  function montarLinhas(items) {
    const linhas = []; let atual = null; let ant = null; let espaco = false;
    for (const i of items || []) {
      if (!i || typeof i.str !== 'string' || !i.str.length) continue;
      // O PDF.js insere itens de espaço "falsos" entre colunas; a distância de verdade é medida entre os pedaços com texto.
      if (!i.str.trim()) { espaco = true; continue; }
      const t = i.transform || [1, 0, 0, 1, 0, 0];
      const it = { s: limpar(i.str), x: t[4], y: t[5], w: Number(i.width) || 0, z: Math.abs(t[3]) || Number(i.height) || 8 };
      const mesmaLinha = atual && ant && Math.abs(ant.y - it.y) <= Math.max(1, 0.4 * it.z) && it.x >= ant.x - 1;
      if (mesmaLinha) {
        const folga = it.x - (ant.x + ant.w);
        if (folga > 0.9 * it.z) atual.s += '\t';
        else if ((folga > 0.15 * it.z || espaco) && !/\s$/.test(atual.s) && !/^\s/.test(it.s)) atual.s += ' ';
        atual.s += it.s;
      } else { atual = { s: it.s }; linhas.push(atual); }
      ant = it; espaco = false;
    }
    return linhas.map((l) => l.s.replace(/[ \t]+$/, '')).filter((s) => s.trim().length).join('\n');
  }

  // PDF.js e leitor de ZIP ficam no próprio sistema (public/vendor). Só são carregados quando precisam.
  let promessa = null;
  function carregarPdfJs() {
    if (G.pdfjsLib) return Promise.resolve(G.pdfjsLib);
    if (!promessa) promessa = new Promise((ok, falha) => {
      const s = document.createElement('script'); s.src = '/vendor/pdf.min.js';
      s.onload = () => {
        if (!G.pdfjsLib) { promessa = null; return falha(new Error('PDF.js não carregou.')); }
        G.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
        ok(G.pdfjsLib);
      };
      s.onerror = () => { promessa = null; falha(new Error('Não consegui carregar o leitor de PDF.')); };
      document.head.appendChild(s);
    });
    return promessa;
  }

  // Guarda: o que o PDF carrega por dentro (anexos, JavaScript, camadas desligadas). Falha de um item nunca derruba a leitura.
  async function guardaDoDocumento(doc, achados, corrida) {
    try { const a = doc.getAttachments ? await corrida(doc.getAttachments()) : null; if (a && Object.keys(a).length) achados.push(GU.achado(GU.ALTA, 'pdf:anexo-embutido', 'PDF', 'O PDF carrega ' + Object.keys(a).length + ' arquivo(s) dentro dele.', Object.keys(a).join(', '))); } catch (_) { /* sem anexos */ }
    try { const j = doc.getJSActions ? await corrida(doc.getJSActions()) : null; if (j && Object.keys(j).length) achados.push(GU.achado(GU.ALTA, 'pdf:javascript', 'PDF', 'O PDF tem JavaScript.', Object.keys(j).join(', '))); } catch (_) { /* sem js */ }
    try {
      const cfg = doc.getOptionalContentConfig ? await corrida(doc.getOptionalContentConfig()) : null; let off = 0;
      if (cfg && typeof cfg[Symbol.iterator] === 'function') for (const par of cfg) { const g = Array.isArray(par) ? par[1] : par; if (g && g.visible === false) off++; }
      if (off) achados.push(GU.achado(GU.MEDIA, 'pdf:camada-oculta', 'PDF', 'O PDF tem ' + off + ' camada(s) desligada(s): pode haver conteúdo que ninguém vê.', ''));
    } catch (_) { /* sem camadas */ }
  }
  // Guarda: texto branco/minúsculo/invisível/fora da página e anotações de UMA página.
  async function guardaDaPagina(lib, pag, conteudo, n, achados, corrida) {
    try {
      if (lib.OPS) {
        const ops = await corrida(pag.getOperatorList());
        achados.push(...GU.julgarPaginaPdf(n, GU.varrerOperadores(lib.OPS, ops, { view: pag.view }), GU.textoForaDaPagina(conteudo.items, pag.view)));
      }
    } catch (e) { if (e && e.codigo === 'tempo') throw e; /* página que não abre por dentro: a guarda do servidor confere o texto */ }
    try { achados.push(...GU.julgarAnotacoes(n, await corrida(pag.getAnnotations()))); } catch (e) { if (e && e.codigo === 'tempo') throw e; /* sem anotações */ }
  }

  const erroCodigo = (codigo, msg) => { const e = new Error(msg); e.codigo = codigo; return e; };

  // Lê o PDF (File ou Blob). opc.aoPagina(n, total) avisa o andamento; opc.limiteMs é o tempo máximo do arquivo (padrão 3 minutos).
  // Devolve { texto, paginas, paginasSemTexto, caracteres, suficiente }. "suficiente" = tem texto de verdade (não é só imagem).
  async function lerPdf(arquivo, opc) {
    opc = Object.assign({ limiteMs: 180000, aoPagina: null }, opc);
    const lib = await carregarPdfJs();
    const t0 = Date.now();
    const corrida = (p) => new Promise((ok, falha) => {
      const resta = opc.limiteMs - (Date.now() - t0);
      let f = null;
      if (resta <= 0) falha(erroCodigo('tempo', 'A leitura passou do tempo limite.'));
      else f = setTimeout(() => falha(erroCodigo('tempo', 'A leitura passou do tempo limite.')), resta);
      p.then((v) => { clearTimeout(f); ok(v); }, (e) => { clearTimeout(f); falha(e); }); // (sempre ligado à promessa, para o erro tardio de um leitor encerrado não ficar solto)
    });
    let tarefa = null; let doc = null; const achados = [];
    try {
      let dados = new Uint8Array(await arquivo.arrayBuffer());
      // GUARDA DE DOCUMENTOS (primeira leitura): sinais nos bytes do PDF, antes de o PDF.js receber a memória.
      if (GU) { try { achados.push(...GU.examinarPdfBytes(new TextDecoder('latin1').decode(dados), { onde: 'PDF' })); } catch (_) { /* a guarda do servidor também confere */ } }
      tarefa = lib.getDocument({ data: dados, disableFontFace: true, isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
      dados = null; // o PDF.js recebe a memória; aqui não fica cópia
      doc = await corrida(tarefa.promise);
      if (GU) await guardaDoDocumento(doc, achados, corrida);
      const total = doc.numPages; const partes = []; const semTexto = [];
      for (let n = 1; n <= total; n++) {
        const pag = await corrida(doc.getPage(n));
        const c = await corrida(pag.getTextContent({ normalizeWhitespace: false }));
        const txt = montarLinhas(c.items);
        if (txt.replace(/\s+/g, '').length < T.MIN_CHARS_PAGINA) semTexto.push(n);
        partes.push(T.montarPagina(n, txt));
        if (GU) await guardaDaPagina(lib, pag, c, n, achados, corrida);
        try { pag.cleanup(); } catch (_) { /* já liberada */ }
        if (opc.aoPagina) opc.aoPagina(n, total);
        if (n % 20 === 0) await new Promise((ok) => setTimeout(ok, 0)); // deixa a tela respirar em computador antigo
      }
      const texto = partes.join('\n');
      const caracteres = texto.replace(/\s+/g, '').length;
      const guarda = GU ? { achados: achados.slice(0, GU.MAX_ACHADOS).map((a) => ({ g: a.g, codigo: a.codigo, onde: a.onde, msg: a.msg, trecho: a.trecho })) } : null;
      return { guarda, texto, paginas: total, paginasSemTexto: semTexto, caracteres, suficiente: caracteres >= T.MIN_CHARS_ARQUIVO && semTexto.length < total * 0.8 };
    } catch (e) {
      if (e && e.codigo) throw e;
      throw erroCodigo('erro', (e && e.name === 'PasswordException') ? 'O PDF tem senha.' : 'Não consegui ler o PDF (' + String((e && e.message) || e).slice(0, 80) + ').');
    } finally {
      try { if (doc) await doc.destroy(); else if (tarefa) await tarefa.destroy(); } catch (_) { /* já liberado */ }
    }
  }

  return { montarLinhas, lerPdf, carregarPdfJs };
});
