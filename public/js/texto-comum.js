// Pedaços de leitura de texto que rodam IGUAIS no navegador e no servidor: HTML do SEI para texto e conta de páginas sem texto.
// Assim o navegador e o servidor devolvem o mesmo texto para o mesmo arquivo (e os testes comparam os dois).
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica(); else raiz.CTAI_TEXTO = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Página de PDF com menos que isto de texto (sem contar espaços) parece ser só imagem: foto, planilha colada como figura.
  const MIN_CHARS_PAGINA = 40;
  // O arquivo todo precisa ter ao menos isto de texto para valer a leitura.
  const MIN_CHARS_ARQUIVO = 80;

  const NOMEADAS = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ordm: 'º', ordf: 'ª', deg: '°', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', bull: '•', sect: '§', middot: '·', times: '×', iexcl: '¡', iquest: '¿', copy: '©', ccedil: 'ç', Ccedil: 'Ç', ntilde: 'ñ', Ntilde: 'Ñ' };
  const ACENTOS = { acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈' };
  function entidade(nome) {
    if (NOMEADAS[nome] !== undefined) return NOMEADAS[nome];
    const m = /^([aeiouAEIOU])(acute|grave|circ|tilde|uml)$/.exec(nome);
    return m ? (m[1] + ACENTOS[m[2]]).normalize('NFC') : null;
  }

  // Texto de um HTML já decodificado em string: tira marcação, mantém o texto e as quebras de linha.
  function htmlParaTexto(bruto) {
    const t = String(bruto || '').replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h\d|li|table|ul|ol)>/gi, '\n').replace(/<\/t[dh]>/gi, ' ').replace(/<[^>]+>/g, ' ')
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&([A-Za-z]+);/g, (a, n) => { const e = entidade(n); return e === null ? a : e; });
    return t.replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
  }
  // Bytes de um HTML do SEI: a codificação vem do próprio arquivo (normalmente iso-8859-1).
  function htmlDeBytes(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const cab = new TextDecoder('latin1').decode(u8.subarray(0, 4000));
    const cs = (/charset\s*=\s*["']?([\w-]+)/i.exec(cab) || [])[1] || 'utf-8';
    let bruto;
    try { bruto = new TextDecoder(cs).decode(u8); } catch (_) { bruto = new TextDecoder('utf-8').decode(u8); }
    return htmlParaTexto(bruto);
  }

  // Texto de PDF no formato "--- página N ---\n...": devolve as páginas com pouco texto (provável imagem) e quantas páginas há.
  function paginasDoTexto(texto) {
    const partes = String(texto || '').split(/^--- página (\d+) ---$/m);
    const imagem = []; let total = 0;
    for (let i = 1; i < partes.length; i += 2) {
      total = Math.max(total, Number(partes[i]));
      if (String(partes[i + 1] || '').replace(/\s+/g, '').length < MIN_CHARS_PAGINA) imagem.push(Number(partes[i]));
    }
    return { total, imagem };
  }
  const montarPagina = (n, texto) => '--- página ' + n + ' ---\n' + texto;

  return { MIN_CHARS_PAGINA, MIN_CHARS_ARQUIVO, htmlParaTexto, htmlDeBytes, paginasDoTexto, montarPagina, entidade };
});
