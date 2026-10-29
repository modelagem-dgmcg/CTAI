(function () {
  'use strict';
  // "Alimentar o Analista": soltar vários arquivos (ou o ZIP do SEI de uma unidade), acompanhar a leitura, conferir e liberar o menu completo.
  // O ZIP é aberto AQUI, no navegador: cada arquivo útil segue separadamente, um por vez, em segundo plano, com nova tentativa se a rede cair.
  // PDF e HTML do SEI também são lidos AQUI: o navegador tira o texto, mascara os dados pessoais e envia SÓ O TEXTO. O PDF inteiro só vai
  // ao servidor como último recurso (PDF só imagem, ou o navegador não conseguiu ler).
  const { h, api, toast, confirmar, aviso, montar } = window.CTAI;
  const ANO = new Date().getFullYear();
  const TRIS = []; for (let a = ANO; a >= ANO - 4; a--) for (let t = 4; t >= 1; t--) TRIS.push(a + '-T' + t);
  const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const MESES = []; { const d = new Date(); for (let i = 0; i < 24; i++) { const a = d.getFullYear(), m = d.getMonth() + 1; MESES.push({ v: a + '-' + String(m).padStart(2, '0'), r: NOMES_MES[m - 1][0].toUpperCase() + NOMES_MES[m - 1].slice(1) + '/' + a }); d.setMonth(d.getMonth() - 1); } }
  const ROTULO = {
    espera: 'Aguardando o envio', fila: 'Na fila', lendo: 'Lendo e mascarando dados pessoais', montando: 'Montando o rascunho', lido: 'Lido e guardado na gaveta do mês',
    pronto: 'Conferido pelo sistema, aguarda sua aprovação', aprovado: 'Aprovado', duplicado: 'Já importado antes', problema: 'Com problema', precisa_dados: 'Precisa da unidade e do período',
  };
  const OCUPADO = ['espera', 'fila', 'lendo', 'montando'];
  const resumoMasc = (m) => Object.entries(m || {}).map(([k, v]) => v + ' ' + k).join(', ');
  const num = (n) => Number(n || 0).toLocaleString('pt-BR');
  const dorme = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const ACEITOS = /\.(pdf|docx|xlsx|csv|txt|html?)$/i;
  const IGNORADOS = /\.(png|jpe?g|gif|bmp|tiff?|webp|svg|ico|db|ini|lnk|tmp|bak)$|(^|\/)(thumbs\.db|desktop\.ini|\.ds_store)$/i;
  const LIMITE_MB = 60;
  const TEXTO_MAX = 3000000; // mesmo limite de texto do servidor
  // replaceChildren escreve "null" na tela se receber null: este ajudante descarta o que for vazio.
  const trocarFilhos = (el, ...cs) => el.replaceChildren(...cs.flat().filter((c) => c !== null && c !== undefined && c !== false));
  const bonito = (n) => String(n || '').replace(/^\s*\[\d+\]-\d+_/, '').replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();

  // JSZip fica no próprio sistema (public/vendor), sem CDN. Só é carregado quando alguém solta um ZIP.
  let promessaZip = null;
  function carregarJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (!promessaZip) promessaZip = new Promise((ok, falha) => {
      const s = document.createElement('script'); s.src = '/vendor/jszip.min.js';
      s.onload = () => (window.JSZip ? ok(window.JSZip) : falha(new Error('JSZip não carregou.'))); s.onerror = () => { promessaZip = null; falha(new Error('Não consegui carregar o leitor de ZIP.')); };
      document.head.appendChild(s);
    });
    return promessaZip;
  }

  // Envia um arquivo cru. Tenta de novo (1s, 2s, 4s... até 30s) se a rede cair ou o servidor responder erro; erro "de verdade" (4xx) não se repete.
  async function enviarArquivo(id, nome, corpo, aoTentar, origem) {
    const cab = { 'content-type': 'application/octet-stream', 'x-ctai': '1', 'x-nome-arquivo': encodeURIComponent(nome), 'x-fila-id': String(id) };
    if (origem) cab['x-origem'] = origem;
    return postarComNovaTentativa('/api/alimentar/arquivo', cab, corpo, nome, aoTentar);
  }
  // Só o texto (JSON pequeno, enviado como text/plain para passar direto pelo leitor de até 8 MB do servidor): o PDF não sai da máquina.
  async function enviarTexto(id, nome, carga, aoTentar) {
    return postarComNovaTentativa('/api/alimentar/texto', { 'content-type': 'text/plain; charset=utf-8', 'x-ctai': '1', 'x-fila-id': String(id) }, JSON.stringify(carga), nome, aoTentar);
  }
  async function postarComNovaTentativa(url, cab, corpo, nome, aoTentar) {
    let ultimo = null;
    for (let t = 0; t < 9; t++) {
      try {
        if (navigator.onLine === false) { aoTentar && aoTentar('Sem internet. Esperando a conexão voltar...'); await new Promise((ok) => { const f = () => { window.removeEventListener('online', f); ok(); }; window.addEventListener('online', f); setTimeout(f, 20000); }); }
        const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: cab, body: corpo });
        let j = null; try { j = await r.json(); } catch (_) { /* sem corpo */ }
        if (r.status === 401) { const e = new Error('Sua sessão terminou. Entre de novo e solte o ZIP outra vez.'); e.fatal = true; throw e; }
        if (r.ok) return j;
        if (r.status >= 400 && r.status < 500) { const e = new Error((j && j.erro) || 'O servidor recusou ' + nome + ' (' + r.status + ').'); e.fatal = true; throw e; }
        ultimo = new Error('O servidor não respondeu direito (' + r.status + ').');
      } catch (e) { if (e.fatal) throw e; ultimo = e; }
      aoTentar && aoTentar('A conexão falhou. Tentando de novo (' + (t + 1) + ')...');
      await dorme(Math.min(30000, 1000 * Math.pow(2, t)));
    }
    throw ultimo || new Error('Não consegui enviar ' + nome + '.');
  }

  // Lê o PDF (ou o HTML do SEI) na máquina da analista e mascara ANTES de o texto sair dela. Devolve { carga } (o que vai ao servidor) ou { fallback }.
  async function lerLocal(nome, ext, blob, aoPagina) {
    let texto, paginas = null, semTexto = [];
    try {
      if (ext === 'pdf') {
        const r = await window.CTAI_LEITOR_PDF.lerPdf(blob, { aoPagina });
        if (!r.suficiente) return { fallback: 'fallback-sem-texto' };
        texto = r.texto; paginas = r.paginas; semTexto = r.paginasSemTexto;
      } else {
        texto = window.CTAI_TEXTO.htmlDeBytes(new Uint8Array(await blob.arrayBuffer()));
      }
    } catch (e) { try { console.warn('Leitura no navegador falhou:', nome, e && e.message); } catch (_) { /* sem console */ } return { fallback: e && e.codigo === 'tempo' ? 'fallback-tempo' : 'fallback-erro' }; }
    let cortado = false;
    if (texto.length > TEXTO_MAX) { texto = texto.slice(0, TEXTO_MAX); cortado = true; }
    const m = window.CTAI_MASCARA.mascarar(texto); // mascara ANTES de sair da máquina
    return { carga: { texto: m.texto, hash: await sha256Hex(m.texto), paginas, paginasSemTexto: semTexto, mascarados: m.mascarados, cortado } };
  }
  async function sha256Hex(txt) {
    try { if (!window.crypto || !window.crypto.subtle) return null; const b = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)); return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join(''); } catch (_) { return null; }
  }

  async function tela() {
    let est = null, assinaturaBase = '', assinaturaTopo = '', timer = null;
    let enviandoId = null, mensagemEnvio = '', trabalhando = false, parar = false, aguardando = [];
    let fase = ''; // o que está acontecendo com o arquivo da vez: lendo na máquina, enviando texto...
    const marcados = new Set(); const escolhas = new Map();
    const status = h('p', { class: 'al-status', id: 'al-andamento', role: 'status', 'aria-live': 'polite', hidden: true });
    const raiz = h('div', { id: 'al-raiz' });
    const topo = h('div', { id: 'al-topo' });
    const hostPainel = h('div', { id: 'al-painel-host' });
    const hostConferir = h('div', { id: 'al-conferir-host' });
    const base = h('div', { id: 'al-base' });
    raiz.append(topo, status, hostPainel, hostConferir, base);
    const entrada = h('input', { type: 'file', id: 'al-arquivos', multiple: true, accept: '.zip,.pdf,.docx,.xlsx,.csv,.txt,.html,.htm', style: 'display:none' });

    // ---------- soltar arquivos ----------
    let cadeia = Promise.resolve();
    function receber(lista) {
      const arqs = Array.from(lista || []); if (!arqs.length) return;
      cadeia = cadeia.then(() => processarSoltura(arqs)).catch((e) => { toast(e.message, true); });
      entrada.value = '';
    }
    window.onbeforeunload = () => (trabalhando ? 'Ainda estou enviando os arquivos. Se sair agora, o envio para.' : undefined);

    async function processarSoltura(arqs) {
      trabalhando = true; parar = false;
      try {
        for (const arq of arqs) {
          if (parar) break;
          if (/\.zip$/i.test(arq.name)) await soltarZip(arq); else await soltarSimples(arq);
        }
      } finally { trabalhando = false; enviandoId = null; mensagemEnvio = ''; window.onbeforeunload = null; await atualizar(); desenharStatus(); desenharBase(true); desenharPainel(); }
    }
    function dizer(txt) { mensagemEnvio = txt || ''; desenharStatus(); }

    async function soltarSimples(arq) {
      const itens = [{ nome: arq.name, tamanho: arq.size, pegar: async () => arq }];
      await registrarEEnviar(null, itens);
    }

    async function soltarZip(arq) {
      dizer('Abrindo ' + arq.name + '...');
      let z, entradas = [], ignorados = 0;
      try {
        const JSZip = await carregarJSZip();
        z = await JSZip.loadAsync(arq);
      } catch (e) {
        // ZIP que o navegador não abre: se for pequeno, o servidor tenta (caminho antigo)
        if (arq.size <= 40 * 1024 * 1024) { dizer('Enviando ' + arq.name + '...'); try { await api2(arq); } catch (er) { toast(er.message, true); } return; }
        toast('Não consegui abrir o ZIP ' + arq.name + '. Baixe de novo do SEI e solte outra vez.', true); return;
      }
      for (const f of Object.values(z.files)) {
        if (f.dir) continue;
        if (/(^|\/)(\.|__MACOSX)/.test(f.name) || IGNORADOS.test(f.name)) { ignorados++; continue; }
        const nome = f.name.split('/').pop();
        const tam = (f._data && Number(f._data.uncompressedSize)) || 0;
        entradas.push({ nome, tamanho: tam, pegar: () => f.async('blob') });
      }
      entradas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
      if (!entradas.length) { toast('O ZIP ' + arq.name + ' não tem arquivos que eu consiga ler.', true); return; }
      if (ignorados) toast(ignorados + ' arquivo(s) sem interesse (imagens soltas, bancos de dados) ficaram de fora.');
      await registrarEEnviar(arq.name, entradas);
    }
    async function api2(arq) {
      const r = await fetch('/api/alimentar/arquivo', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream', 'x-ctai': '1', 'x-nome-arquivo': encodeURIComponent(arq.name) }, body: arq });
      let j = null; try { j = await r.json(); } catch (_) { /* sem corpo */ }
      if (!r.ok) throw new Error((j && j.erro) || 'Não consegui enviar ' + arq.name + ' (' + r.status + ').');
    }

    // Lê o PDF (ou o HTML do SEI) na máquina, mascara aqui mesmo e envia só o texto. Devolve { enviado } ou { enviado: false, fallback }.
    async function lerNoNavegador(id, nome, ext, blob, rotulo) {
      fase = 'Lendo na sua máquina'; dizer('Lendo ' + rotulo + ' na sua máquina...'); desenharPainel();
      let ult = 0;
      const r = await lerLocal(nome, ext, blob, (n, t) => { const agora = Date.now(); if (agora - ult < 250 && n < t) return; ult = agora; fase = 'Lendo na sua máquina (página ' + n + ' de ' + t + ')'; desenharPainel(); });
      if (!r.carga) return { enviado: false, fallback: r.fallback };
      fase = 'Enviando texto'; dizer('Enviando o texto de ' + rotulo + '...'); desenharPainel();
      try { await enviarTexto(id, nome, r.carga, dizer); return { enviado: true }; }
      catch (e) { if (e.fatal && !/sessão/.test(e.message)) return { enviado: false, fallback: 'fallback-erro' }; throw e; } // o servidor recusou o texto: tenta o arquivo inteiro
    }
    async function registrarEEnviar(zip, itens) {
      dizer('Preparando a leitura...');
      let reg;
      try { reg = await api('POST', '/api/alimentar/lote', { zip, arquivos: itens.map((i) => ({ nome: i.nome, tamanho: i.tamanho })) }); }
      catch (e) { toast(e.message, true); return; }
      await atualizar(); desenharBase(true); desenharPainel();
      try { P.raiz.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); } catch (_) { /* sem rolagem */ }
      aguardando = reg.itens.filter((x) => x.estado === 'espera').map((x) => x.id);
      for (let k = 0; k < itens.length; k++) {
        const reg1 = reg.itens[k];
        if (reg1.estado !== 'espera') continue;
        if (parar) break;
        enviandoId = reg1.id; fase = ''; const nomeBonito = bonito(itens[k].nome); const posicao = ' (' + (k + 1) + ' de ' + itens.length + ')';
        dizer('Abrindo ' + nomeBonito + posicao + '...');
        let corpo;
        try { corpo = await itens[k].pegar(); } catch (e) { corpo = null; }
        try {
          if (!corpo) { await api('DELETE', '/api/alimentar/' + reg1.id).catch(() => {}); toast('Não consegui abrir ' + itens[k].nome + ' dentro do ZIP.', true); }
          else {
            // PDF e HTML: lê na máquina e manda só o texto. Se não der, cai para o arquivo inteiro (origem diz por quê).
            const ext = (itens[k].nome.split('.').pop() || '').toLowerCase();
            let origem = null, enviado = false;
            if (['pdf', 'html', 'htm'].includes(ext)) {
              const r = await lerNoNavegador(reg1.id, itens[k].nome, ext, corpo, nomeBonito + posicao);
              enviado = r.enviado; origem = r.fallback || null;
            }
            if (!enviado) {
              if (corpo.size > LIMITE_MB * 1024 * 1024) { await api('DELETE', '/api/alimentar/' + reg1.id).catch(() => {}); toast(itens[k].nome + ' é grande demais (' + Math.round(corpo.size / 1048576) + ' MB; o limite é ' + LIMITE_MB + ' MB).', true); }
              else { fase = origem ? 'Enviando o arquivo inteiro' : 'Enviando'; dizer((origem ? 'Enviando o arquivo inteiro de ' : 'Enviando ') + nomeBonito + posicao + '...'); await enviarArquivo(reg1.id, itens[k].nome, corpo, dizer, origem); }
            }
          }
        } catch (e) {
          toast(e.message, true);
          if (e.fatal && /sessão/.test(e.message)) { parar = true; break; }
          if (!e.fatal) { parar = true; dizer('A conexão não voltou. O que já foi lido está guardado. Solte o ZIP de novo para continuar.'); }
        }
        corpo = null; // libera o arquivo da memória do navegador antes do próximo
        enviandoId = null; fase = ''; aguardando = aguardando.filter((x) => x !== reg1.id);
        await atualizar(); desenharBase(false); desenharPainel();
      }
      if (parar) {
        // o que não foi enviado sai da fila, para não ficar "aguardando" para sempre
        for (const id of aguardando) await api('DELETE', '/api/alimentar/' + id).catch(() => {});
        aguardando = [];
        toast('Envio interrompido. O que já foi lido está guardado.', true);
      }
    }

    const zona = h('div', { class: 'cartao al-zona', id: 'al-zona', tabindex: '0', role: 'button', 'aria-label': 'Soltar arquivos aqui ou escolher no computador',
      ondragover: (ev) => { ev.preventDefault(); zona.classList.add('sobre'); }, ondragleave: () => zona.classList.remove('sobre'),
      ondrop: (ev) => { ev.preventDefault(); zona.classList.remove('sobre'); receber(ev.dataTransfer.files); },
      onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); entrada.click(); } } },
      h('h3', null, 'Solte aqui o ZIP do SEI ou os arquivos da unidade'),
      h('p', { class: 'al-dica' }, 'Pode soltar o ZIP inteiro (mesmo com mais de 100 MB) ou vários arquivos de uma vez: PDF, Word, Excel, CSV, TXT ou HTML, até ' + LIMITE_MB + ' MB cada. O PDF é lido na sua máquina: só o texto, já sem dados pessoais, vai para o sistema. PDF escaneado, só imagem, não é lido.'),
      h('button', { class: 'sec', onclick: () => entrada.click() }, 'Escolher arquivos no computador'));
    entrada.addEventListener('change', () => receber(entrada.files));

    // ---------- o painel de andamento (criado uma vez; só os textos e as classes mudam, para a animação ser suave) ----------
    const P = (() => {
      const c = 2 * Math.PI * 44;
      const anel = h('span', { class: 'al-anel', html: '<svg viewBox="0 0 100 100" width="104" height="104" aria-hidden="true"><circle class="al-anel-fundo" cx="50" cy="50" r="44"/><circle class="al-anel-barra" cx="50" cy="50" r="44" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + c.toFixed(1) + '"/></svg>' });
      const pct = h('span', { class: 'al-anel-pct', id: 'al-pct' }, '0%'); anel.appendChild(pct);
      const titulo = h('h2', { class: 'al-un', id: 'al-un' }, 'Arquivos recebidos');
      const sub = h('p', { class: 'al-sub', id: 'al-sub' }, '');
      const chip = h('span', { class: 'al-chip', id: 'al-chip' }, '');
      const t1 = h('div', { class: 'al-tile' }, h('strong', { id: 'al-n-docs' }, '0 de 0'), h('span', { id: 'al-r-docs' }, 'documentos lidos'));
      const t2 = h('div', { class: 'al-tile' }, h('strong', { id: 'al-n-pag' }, '0'), h('span', null, 'páginas lidas'));
      const t3 = h('div', { class: 'al-tile' }, h('strong', { id: 'al-n-prot' }, '0'), h('span', null, 'dados protegidos'));
      const barra = h('div', { class: 'al-barra', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Andamento da leitura' }, h('i', { id: 'al-barra-i' }));
      const lista = h('ul', { class: 'al-lista', id: 'al-lista' });
      const fim = h('div', { class: 'al-fim', id: 'al-fim', hidden: true });
      const parada = h('button', { class: 'leve', id: 'al-parar', onclick: () => { parar = true; dizer('Parando depois deste arquivo...'); } }, 'Parar o envio');
      const raizP = h('section', { class: 'cartao al-painel', id: 'al-painel', hidden: true, 'aria-label': 'Andamento da leitura' },
        h('div', { class: 'al-cab' }, anel, h('div', { class: 'al-cab-txt' }, titulo, sub, h('div', { class: 'linha' }, chip, parada))),
        h('div', { class: 'al-tiles' }, t1, t2, t3), barra, lista, fim);
      return { raiz: raizP, c, anel, pct, titulo, sub, chip, barra, lista, fim, parada, itens: new Map(), chaveLista: '' };
    })();
    hostPainel.appendChild(P.raiz);

    const q = (id) => P.raiz.querySelector('#' + id);
    const ICONE_OK = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path class="al-tick" d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const ICONE_X = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 6v7M12 17.5v.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
    const ROTULO_ITEM = { espera: 'Aguardando', aguardando: 'Aguardando', lendo: 'Lendo agora', lido: 'Lido', falta: 'Faltou', problema: 'Com problema', atencao: 'Precisa de você' };

    function estadoItem(it) {
      let e = it.estado;
      if (e === 'espera' && it.ids && it.ids.includes(enviandoId)) e = 'lendo';
      return e;
    }
    function desenharStatus() {
      const t = mensagemEnvio || (est && est.resumo.pendentes ? est.resumo.pendentes + ' em andamento...' : '');
      status.textContent = t; status.hidden = !t;
    }

    function desenharPainel() {
      const p = est && est.painel;
      P.raiz.hidden = !p;
      if (!p) return;
      const a = p.arquivos;
      const total = a.total || 0, feitos = a.feitos || 0;
      const pct = total ? Math.round((feitos / total) * 100) : 0;
      P.raiz.setAttribute('data-estado', p.ativo || trabalhando ? 'lendo' : 'pronto');
      P.pct.textContent = pct + '%';
      P.anel.querySelector('.al-anel-barra').setAttribute('stroke-dashoffset', (P.c * (1 - pct / 100)).toFixed(1));
      P.barra.setAttribute('aria-valuenow', String(pct)); P.barra.firstChild.style.width = pct + '%';
      P.titulo.textContent = p.unidade || (p.zip ? p.zip : 'Arquivos recebidos');
      const quando = [p.mesRotulo, p.catalogo ? 'UPAE' : (p.tipo || null)].filter(Boolean).join(' · ');
      P.sub.textContent = quando || (p.zip && p.unidade ? p.zip : 'Identificando a unidade e o mês...');
      const emAndamento = p.ativo || trabalhando;
      P.chip.textContent = emAndamento ? 'Lendo os documentos' : (a.problemas || a.atencao || p.faltam.length ? 'Pronto, com pontos de atenção' : 'Tudo lido');
      P.chip.className = 'al-chip ' + (emAndamento ? 'lendo' : (a.problemas || a.atencao || p.faltam.length ? 'atencao' : 'ok'));
      P.parada.hidden = !(trabalhando && !parar);
      const lidosCat = p.catalogo ? p.itens.filter((i) => i.estado === 'lido').length : a.lidos + a.duplicados;
      const totalCat = p.catalogo ? p.itens.length : total;
      q('al-n-docs').textContent = lidosCat + ' de ' + totalCat; q('al-r-docs').textContent = p.catalogo ? 'documentos do mês lidos' : 'arquivos lidos';
      q('al-n-pag').textContent = num(p.paginas); q('al-n-prot').textContent = num(p.protegidos);

      // lista (cinza -> lendo -> lido): reaproveita as linhas existentes para a troca de estado ser suave
      const chave = p.itens.map((i) => (i.codigo || i.nome) + '|' + (i.ids || []).join(',')).join(';');
      if (chave !== P.chaveLista) {
        P.chaveLista = chave; P.itens.clear(); P.lista.replaceChildren();
        for (const it of p.itens) {
          const ic = h('span', { class: 'al-ic', 'aria-hidden': 'true' });
          const nome = h('span', { class: 'al-nm' }, p.catalogo ? it.nome : bonito(it.nome));
          const est1 = h('span', { class: 'al-et' });
          const mot = h('span', { class: 'al-mt' });
          const li = h('li', { class: 'al-item', 'data-estado': 'espera' }, ic, h('span', { class: 'al-tx' }, nome, est1, mot));
          P.itens.set((it.codigo || it.nome) + '|' + (it.ids || []).join(','), { li, ic, est1, mot });
          P.lista.appendChild(li);
        }
      }
      for (const it of p.itens) {
        const r = P.itens.get((it.codigo || it.nome) + '|' + (it.ids || []).join(',')); if (!r) continue;
        const e = estadoItem(it);
        if (r.li.getAttribute('data-estado') !== e) { r.li.setAttribute('data-estado', e); r.ic.innerHTML = e === 'lido' ? ICONE_OK : (e === 'falta' || e === 'problema' || e === 'atencao') ? ICONE_X : ''; }
        const ro = (e === 'lendo' && fase && it.ids && it.ids.includes(enviandoId)) ? fase : (ROTULO_ITEM[e] || e);
        if (r.est1.textContent !== ro) r.est1.textContent = ro;
        const mt = (e === 'problema' || e === 'atencao' || e === 'falta') ? (it.motivo || (e === 'falta' && !it.obrigatorio ? 'Opcional' : (e === 'falta' ? 'Não veio neste envio' : ''))) : '';
        if (r.mot.textContent !== mt) r.mot.textContent = mt;
      }
      // fecho: resumo
      P.fim.hidden = !(p.concluido && !trabalhando);
      if (!P.fim.hidden) {
        const sig = JSON.stringify([p.resumo, p.avisoTrimestre, p.faltam, p.paginasImagem, p.fallback, a]);
        if (P.fim.getAttribute('data-sig') !== sig) {
          P.fim.setAttribute('data-sig', sig);
          const pgImg = (p.paginasImagem || []);
          trocarFilhos(P.fim, 
            h('p', { class: 'al-resumo', id: 'al-resumo-mes' }, p.resumo || ''),
            p.avisoTrimestre ? h('p', { class: 'al-trim', id: 'al-aviso-tri' }, 'Trimestre: ' + p.avisoTrimestre) : null,
            (p.fallback || []).length ? aviso('atencao', h('strong', null, 'PDF enviado inteiro: '), p.fallback.map((x) => bonito(x.arquivo)).join('; ') + '. O navegador não conseguiu tirar o texto na sua máquina (PDF só imagem, com senha ou com erro), então o arquivo foi enviado para o sistema tentar ler. Ele não é guardado.') : null,
            pgImg.length ? aviso('atencao', h('strong', null, 'Páginas que parecem só imagem: '), pgImg.map((x) => x.arquivo + ' (pág. ' + x.paginas.slice(0, 8).join(', ') + (x.paginas.length > 8 ? '...' : '') + ')').join('; ') + '. O texto dessas páginas pode não ter sido lido.') : null,
            p.catalogo && p.contrato_id && p.mes ? h('div', { class: 'linha' }, h('button', { id: 'al-abrir-conf', onclick: () => abrirConferencia(p.contrato_id, p.mes) }, 'Conferir os números de ' + (p.mesNome || 'o mês')), h('span', { class: 'peq mudo' }, 'A leitura só propõe os números. Você confere e confirma.')) : null);
        }
      }
    }

    // ---------- conferir os números do mês e ver o trimestre ----------
    async function abrirConferencia(contratoId, mes) {
      try {
        const [m, t] = await Promise.all([api('GET', '/api/gaveta/unidade/' + contratoId + '/mes/' + mes), api('GET', '/api/gaveta/unidade/' + contratoId + '/trimestre/' + mesParaTri(mes))]);
        trocarFilhos(hostConferir, cartaoConferir(m, t));
        hostConferir.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { toast(e.message, true); }
    }
    const mesParaTri = (mes) => mes.slice(0, 4) + '-T' + (Math.floor((Number(mes.slice(5)) - 1) / 3) + 1);
    function cartaoConferir(m, t) {
      const campos = ['meta', 'ofertado', 'regulado', 'realizado', 'pct'];
      const rotCampo = { meta: 'Meta', ofertado: 'Ofertado', regulado: 'Regulado', realizado: 'Realizado', pct: '% da meta' };
      const edits = new Map();
      const fonteNome = { anexo_I: 'Relatório Mensal (Anexo I)', oficio_justificativa: 'Ofício de justificativa', despacho: 'Despacho' };
      const grupos = ['anexo_I', 'oficio_justificativa', 'despacho'].map((f) => ({ f, lista: m.numeros.filter((n) => n.fonte === f) })).filter((g) => g.lista.length);
      const val = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
      const tabela = (g) => h('div', { class: 'rolagem' }, h('table', { class: 'al-conf' },
        h('caption', null, fonteNome[g.f]),
        h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Indicador'), campos.map((c) => h('th', { class: 'n' }, rotCampo[c])), h('th', null, 'De onde veio'))),
        h('tbody', null, g.lista.map((n) => {
          const ed = {}; edits.set(n.id, ed);
          const conf = n.estado === 'confirmado';
          return h('tr', { 'data-estado': n.estado },
            h('td', null, conf ? h('span', { class: 'selo ok' }, 'Confirmado') : h('input', { type: 'checkbox', 'data-num': n.id, 'aria-label': 'Confirmar ' + n.rotulo, checked: true })),
            h('td', null, h('strong', null, n.rotulo)),
            campos.map((c) => h('td', { class: 'n' }, conf ? val(n[c]) || '—' : h('input', { type: 'text', inputmode: 'decimal', value: val(n[c]), 'aria-label': rotCampo[c] + ' de ' + n.rotulo, class: 'al-num', oninput: (ev) => { ed[c] = ev.target.value; } }))),
            h('td', { class: 'peq mudo' }, n.trecho || '—'));
        }))));
      const marcas = () => Array.from(hostConferir.querySelectorAll('input[data-num]:checked')).map((x) => Number(x.getAttribute('data-num')));
      const confirmarSel = async () => {
        const ids = marcas(); if (!ids.length) { toast('Marque ao menos um número.', true); return; }
        const edicoes = {}; for (const id of ids) { const e = edits.get(id) || {}; if (Object.keys(e).length) edicoes[id] = e; }
        try { const o = await api('POST', '/api/gaveta/numeros/confirmar', { ids, edicoes }); toast(o.confirmados + ' número(s) confirmado(s).'); await abrirConferencia(m.contrato.contrato_id, m.mes); } catch (e) { toast(e.message, true); }
      };
      const pend = m.numeros.filter((n) => n.estado !== 'confirmado').length;
      return h('section', { class: 'cartao', id: 'al-conferir' },
        h('div', { class: 'linha espaco' }, h('h3', null, 'Conferir os números de ' + m.rotulo), h('button', { class: 'leve', onclick: () => hostConferir.replaceChildren() }, 'Fechar')),
        m.divergencias.length ? aviso('atencao', h('strong', null, 'Ofício e Relatório Mensal não batem: '), h('ul', null, m.divergencias.map((d) => h('li', null, d.texto)))) : (m.numeros.some((n) => n.fonte !== 'anexo_I') && m.numeros.some((n) => n.fonte === 'anexo_I') ? aviso('ok', 'Ofício e Relatório Mensal batem nos números lidos.') : null),
        grupos.length ? grupos.map(tabela) : h('p', { class: 'mudo' }, 'Não encontrei números no padrão esperado neste mês. Nada foi inventado: o texto completo está guardado e você pode consultar o documento.'),
        pend ? h('div', { class: 'linha' }, h('button', { id: 'al-confirmar-nums', onclick: confirmarSel }, 'Confirmar os marcados'), h('span', { class: 'peq mudo' }, 'Pode corrigir qualquer valor antes de confirmar.')) : null,
        h('h3', { style: 'margin-top:18px' }, t.rotulo + ' (calculado com os 3 meses)'),
        h('div', { class: 'al-meses' }, t.meses.map((x) => h('div', { class: 'al-mes ' + (x.chegou ? (x.faltam.length ? 'parcial' : 'ok') : 'vazio') }, h('strong', null, x.nome), h('span', null, x.chegou ? (x.faltam.length ? 'Faltam ' + x.faltam.length : 'Completo') : 'Não chegou')))),
        h('p', { class: 'al-trim', id: 'al-aviso-tri2' }, t.aviso),
        t.producao.length ? h('div', { class: 'rolagem' }, h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Indicador'), t.meses.map((x) => h('th', { class: 'n' }, x.nome + ': realizado / meta')), h('th', { class: 'n' }, 'Total confirmado'))),
          h('tbody', null, t.producao.map((p) => h('tr', null, h('td', null, p.rotulo),
            t.meses.map((x) => { const v = p.por_mes[x.mes]; return h('td', { class: 'n' }, v ? [num(v.realizado) + ' / ' + num(v.meta), v.estado !== 'confirmado' ? h('span', { class: 'peq mudo' }, ' (a confirmar)') : null] : '—'); }),
            h('td', { class: 'n' }, p.total.meses_confirmados ? num(p.total.realizado) + ' / ' + num(p.total.meta) + (p.total.pct_realizado !== null ? ' = ' + String(p.total.pct_realizado).replace('.', ',') + '%' : '') + (p.total.meses_confirmados < t.meses.filter((x) => x.chegou).length ? ' (' + p.total.meses_confirmados + ' mês confirmado)' : '') : '—')))))) : null);
    }

    // ---------- tabela de arquivos e fechamento ----------
    function linha(i) {
      const ocup = OCUPADO.includes(i.estado);
      const ident = i.estado === 'precisa_dados' ? (() => {
        const e = escolhas.get(i.id) || { contrato_id: i.contrato_id || (est.unidades.length === 1 ? est.unidades[0].contrato_id : ''), trimestre: i.trimestre || '', mes: i.mes || '' };
        escolhas.set(i.id, e);
        const redesenha = () => desenharBase(true);
        const su = h('select', { 'aria-label': 'Unidade', onchange: (ev) => { e.contrato_id = ev.target.value; redesenha(); } }, h('option', { value: '' }, 'Unidade...'), est.unidades.map((u) => h('option', { value: u.contrato_id, selected: u.contrato_id === e.contrato_id }, u.unidade)));
        const un = est.unidades.find((u) => u.contrato_id === e.contrato_id);
        const porMes = un ? un.fluxo === 'gaveta' : (i.documento_tipo === 'gaveta');
        const st = porMes
          ? h('select', { 'aria-label': 'Mês', onchange: (ev) => { e.mes = ev.target.value; } }, h('option', { value: '' }, 'Mês...'), MESES.map((m) => h('option', { value: m.v, selected: m.v === e.mes }, m.r)))
          : h('select', { 'aria-label': 'Trimestre', onchange: (ev) => { e.trimestre = ev.target.value; } }, h('option', { value: '' }, 'Trimestre...'), TRIS.map((t) => h('option', { value: t, selected: t === e.trimestre }, t)));
        return h('div', { class: 'linha' }, su, st, h('button', { class: 'leve', onclick: async () => {
          if (!e.contrato_id || !(porMes ? e.mes : e.trimestre)) { toast(porMes ? 'Escolha a unidade e o mês.' : 'Escolha a unidade e o trimestre.', true); return; }
          try { await api('POST', '/api/alimentar/' + i.id + '/identificar', e); await atualizar(); desenharBase(true); desenharPainel(); } catch (er) { toast(er.message, true); } } }, 'Continuar'));
      })() : null;
      const marca = i.estado === 'pronto' ? h('input', { type: 'checkbox', checked: marcados.has(i.id), 'aria-label': 'Selecionar ' + i.nome, onchange: (ev) => { if (ev.target.checked) marcados.add(i.id); else marcados.delete(i.id); } }) : null;
      return h('tr', { 'data-estado': i.estado },
        h('td', null, marca),
        h('td', null, h('strong', null, i.nome), i.unidade || i.trimestre || i.mesRotulo ? h('div', { class: 'peq mudo' }, [i.unidade, i.mesRotulo || i.trimestre].filter(Boolean).join(' · ')) : null),
        h('td', null, (ocup ? '⏳ ' : i.estado === 'problema' ? '⚠ ' : (i.estado === 'aprovado' || i.estado === 'lido') ? '✓ ' : '') + (ROTULO[i.estado] || i.estado), i.motivo ? h('div', { class: 'peq mudo' }, i.motivo) : null, ident),
        h('td', { class: 'peq' }, resumoMasc(i.mascarados) || '—'),
        h('td', { class: 'peq' }, (i.divergencias || []).length ? h('ul', { style: 'margin:0;padding-left:16px' }, i.divergencias.map((d) => h('li', null, d))) : '—'),
        h('td', null, i.hist_id && ['pronto', 'aprovado', 'duplicado'].includes(i.estado) ? h('a', { href: '#/historico/r/' + i.hist_id }, 'Abrir') : null,
          !ocup && i.estado !== 'aprovado' ? h('button', { class: 'leve', title: 'Apaga este arquivo e o texto lido. Você pode enviar de novo.', onclick: async () => { if (!(await confirmar('Excluir este arquivo?', i.nome + ': o texto lido será apagado do sistema. Você pode enviar o arquivo de novo depois.', 'Excluir'))) return; try { await api('DELETE', '/api/alimentar/' + i.id); await atualizar(); desenharBase(true); desenharPainel(); } catch (er) { toast(er.message, true); } } }, 'Excluir') : null));
    }

    function desenharTopo() {
      const sig = JSON.stringify([est.trava, est.ia.pronta]);
      if (sig === assinaturaTopo) return; assinaturaTopo = sig;
      trocarFilhos(topo, 
        h('h2', null, 'Alimentar o Analista'),
        est.trava ? aviso('info', 'Para começar, envie o ZIP do SEI de uma unidade da sua carteira (ou os relatórios e pareceres que ela já tem). O sistema lê tudo, guarda o texto já protegido, confere o que chegou e diz o que falta. O menu completo abre quando o envio terminar.')
          : aviso('ok', 'Seu acesso está liberado. Você pode continuar enviando arquivos por aqui.'),
        aviso('atencao', h('strong', null, 'Antes de enviar: '), 'remova dados de paciente (nome, CPF, telefone, endereço, prontuário) quando for fácil. O sistema mascara esses dados antes de guardar e antes de qualquer envio à IA, e não guarda o arquivo original, mas a máscara não é perfeita.'),
        est.ia.pronta ? null : aviso('atencao', h('strong', null, 'Leitura por IA desligada. '), est.ia.mensagem),
        zona, entrada);
    }

    function desenharBase(forcar) {
      if (!est) return;
      const sig = JSON.stringify([est.itens, est.trava, est.podeLiberar, [...escolhas.entries()]]);
      if (!forcar && sig === assinaturaBase) return; assinaturaBase = sig;
      const r = est.resumo;
      const prontos = est.itens.filter((i) => i.estado === 'pronto');
      const zipsMap = new Map();
      for (const i of est.itens) { const k = i.zip_nome || i.lote; if (!k) continue; const z = zipsMap.get(k) || { nome: i.zip_nome || 'Envio de ' + String(i.lote).slice(0, 16).replace('T', ' '), qtd: 0, meses: [], chave: i.zip_nome ? { zip_nome: i.zip_nome } : { lote: i.lote } }; z.qtd++; if (i.mesRotulo && !z.meses.includes(i.mesRotulo)) z.meses.push(i.mesRotulo); zipsMap.set(k, z); }
      const zips = [...zipsMap.values()];
      const limpos = prontos.filter((i) => !(i.divergencias || []).length);
      trocarFilhos(base, 
        est.itens.length ? h('div', { class: 'cartao' },
          h('h3', null, 'Arquivos'),
          h('p', { class: 'peq', id: 'al-resumo' }, r.lidos + ' lidos, ' + r.problemas + ' com problema' + (r.precisaDados ? ', ' + r.precisaDados + ' esperando você' : '') + (r.aprovados ? ', ' + r.aprovados + ' aprovados' : '') + '.'),
          zips.length ? h('div', { class: 'al-zips' }, h('strong', null, 'Enviou o ZIP errado? Exclua o ZIP inteiro de uma vez:'),
            zips.map((z) => h('div', { class: 'linha espaco al-zip' }, h('span', null, h('strong', null, z.nome), ' · ' + z.qtd + ' arquivo(s)' + (z.meses.length ? ' · ' + z.meses.join(', ') : '')),
              h('button', { class: 'leve', title: 'Apaga todos os arquivos deste ZIP e o texto lido deles', onclick: async () => {
                if (!(await confirmar('Excluir o ZIP inteiro?', z.nome + ': ' + z.qtd + ' arquivo(s) e o texto lido deles serão apagados do sistema. Os já aprovados ficam. Você pode enviar de novo depois.', 'Excluir tudo'))) return;
                try { const o = await api('POST', '/api/alimentar/descartar-lote', z.chave); toast(o.excluidos + ' arquivo(s) excluído(s)' + (o.mantidos ? ', ' + o.mantidos + ' mantido(s) (já aprovados ou em leitura)' : '') + '.'); await atualizar(); desenharBase(true); desenharPainel(); } catch (er) { toast(er.message, true); } } }, 'Excluir este ZIP')))) : null,
          h('details', { class: 'al-expl', open: true }, h('summary', null, 'Como o sistema conferiu cada arquivo'),
            h('p', null, 'Esta é a primeira leitura, só documental. O sistema compara o que a IA extraiu com o texto do próprio arquivo (cada item precisa ter um trecho que o comprove), soma as notas dos indicadores, procura a nota total e verifica se já existe outro relatório da mesma unidade e trimestre. Ele ainda não cruza com SIMAS, planilha de monitoramento, Relatórios Mensais nem contrato: isso acontece quando você abre a unidade e vai produzir o parecer, com uma nova leitura de tudo o que estiver guardado.'),
            h('p', null, h('strong', null, 'Divergências'), ' são avisos para você olhar, não erros definitivos. ', h('strong', null, 'Excluir'), ' apaga o arquivo e o texto lido; o documento original já não fica guardado. Você pode enviar de novo quando quiser. Arquivos já aprovados não podem ser excluídos.')),
          h('div', { class: 'rolagem' }, h('table', { class: 'al-arq' },
            h('thead', null, h('tr', null, ['', 'Arquivo', 'Andamento', 'Dados mascarados', 'Divergências', ''].map((t) => h('th', null, t)))),
            h('tbody', null, est.itens.map(linha)))),
          prontos.length ? h('div', { class: 'linha', id: 'al-lote' },
            h('button', { id: 'al-aprovar-sel', onclick: () => aprovar(Array.from(marcados)) }, 'Aprovar selecionados'),
            limpos.length ? h('button', { class: 'sec', id: 'al-aprovar-limpos', onclick: () => aprovar(limpos.map((i) => i.id)) }, 'Aprovar todos sem divergência (' + limpos.length + ')') : null,
            h('span', { class: 'peq mudo' }, 'Só o que for aprovado entra nos cruzamentos. Rascunho em branco precisa ser aberto e preenchido antes.')) : null,
          r.problemas || r.precisaDados ? h('div', { class: 'linha' }, r.precisaDados ? h('button', { class: 'sec', id: 'al-reavaliar', title: 'Lê de novo, com as regras atuais, os arquivos que esperam você. Não precisa enviar outra vez.', onclick: reavaliar }, 'Reavaliar os que esperam você') : null, h('button', { class: 'leve', id: 'al-pular', onclick: pular }, 'Pular os que deram problema')) : null) : null,
        est.trava ? h('div', { class: 'cartao' },
          h('h3', null, 'Terminou?'),
          h('p', { class: 'peq' }, est.podeLiberar ? 'Tudo foi lido. Você pode abrir o menu completo e continuar a conferência depois, pelo Histórico.' : r.pendentes ? 'Aguarde o fim da leitura.' : r.precisaDados ? 'Indique a unidade e o período dos arquivos que esperam, ou use "Pular os que deram problema".' : 'Envie ao menos um arquivo. Se não tiver nenhum agora, peça à administração para liberar o seu acesso.'),
          h('button', { id: 'al-liberar', disabled: !est.podeLiberar, onclick: liberar }, 'Concluir e abrir o menu completo')) : null);
    }

    async function aprovar(ids) {
      if (!ids.length) { toast('Marque ao menos um arquivo.', true); return; }
      try {
        const o = await api('POST', '/api/alimentar/aprovar', { ids });
        ids.forEach((id) => marcados.delete(id));
        toast(o.aprovados + ' aprovado(s)' + (o.falhas.length ? ', ' + o.falhas.length + ' não puderam ser aprovados: ' + o.falhas[0].motivo : '') + '.', !!o.falhas.length && !o.aprovados);
        await atualizar(); desenharBase(true);
      } catch (e) { toast(e.message, true); }
    }
    async function reavaliar() {
      try { const o = await api('POST', '/api/alimentar/reavaliar', {}); toast(o.resolvidos + ' resolvido(s) sozinho(s)' + (o.restantes ? ', ' + o.restantes + ' ainda precisam da sua escolha' : '') + '.'); await atualizar(); desenharBase(true); desenharPainel(); } catch (e) { toast(e.message, true); }
    }
    async function pular() {
      try { const o = await api('POST', '/api/alimentar/pular-problemas', {}); toast(o.puladas + ' arquivo(s) pulados.'); await atualizar(); desenharBase(true); desenharPainel(); } catch (e) { toast(e.message, true); }
    }
    async function liberar() {
      if (!(await confirmar('Abrir o menu completo?', 'Os arquivos ainda não aprovados ficam como rascunho no Histórico, para você conferir depois.', 'Abrir'))) return;
      try { await api('POST', '/api/alimentar/liberar', {}); location.hash = '#/'; location.reload(); } catch (e) { toast(e.message, true); }
    }
    async function atualizar() { est = await api('GET', '/api/alimentar/estado'); desenharTopo(); }

    await atualizar(); montar(raiz); desenharStatus(); desenharBase(true); desenharPainel();
    clearInterval(window.__alTimer);
    timer = window.__alTimer = setInterval(async () => {
      if (!document.getElementById('al-raiz')) { clearInterval(timer); window.onbeforeunload = null; return; }
      try { await atualizar(); desenharStatus(); desenharBase(false); desenharPainel(); } catch (_) { /* tenta de novo */ }
    }, 1200);
  }

  // Peças que a página da unidade (Importar Arquivos) reaproveita: ZIP aberto no navegador, PDF lido na máquina, só texto sobe.
  const base = { carregarJSZip, lerLocal, enviarArquivo, enviarTexto, bonito, IGNORADOS, LIMITE_MB, num, dorme };
  window.CTAI_ALIMENTAR = { rotas: [['/alimentar', tela]], tela, base };
})();
