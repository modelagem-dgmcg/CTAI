(function () {
  'use strict';
  // "Comece aqui": roteiro curto para quem está começando. Cada passo se marca sozinho quando a pessoa visita a tela correspondente.
  // Some quando todos os passos foram feitos ou quando a pessoa clica em "Não mostrar mais" (a escolha vale só neste navegador).
  const { h } = window.CTAI;
  const eu = () => window.__eu || {};
  const chave = (s) => 'ctai_comece_' + s + '_' + (eu().login || '');
  const ler = (k, padrao) => { try { const v = localStorage.getItem(k); return v === null ? padrao : JSON.parse(v); } catch (_) { return padrao; } };
  const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* sem armazenamento */ } };

  // Registra as telas visitadas (só o começo do caminho: /u, /c, /p, /v, /gestao, /regras).
  function registrar() {
    const m = /^#\/([a-z]+)/.exec(location.hash);
    if (!m || !eu().login) return;
    const vistas = ler(chave('vistas'), []);
    if (!vistas.includes(m[1])) { vistas.push(m[1]); gravar(chave('vistas'), vistas); }
  }
  window.addEventListener('hashchange', registrar);
  setTimeout(registrar, 800);

  const PASSOS = {
    analista: [
      { t: 'Abra uma unidade da sua carteira', d: 'Em Unidades, clique na unidade. Ela abre em uma aba própria, com todas as etapas em sequência.', v: 'u', link: '#/unidades', rot: 'Ver unidades' },
      { t: 'Confira o que a unidade enviou', d: 'Dentro da unidade, abra um mês para ver os envios, os prazos e as divergências.', v: 'c' },
      { t: 'Abra o documento do trimestre', d: 'Na etapa Produzir, comece o parecer. Ele abre numa janela própria, já com os dados e as regras ao lado.', v: 'p' },
      { t: 'Acompanhe a conferência e o registro no SEI', d: 'Depois de congelar a versão, a conferência e a autorização acontecem aqui. No fim, você cola o número do SEI.', v: 'v' },
    ],
    gestao: [
      { t: 'Cadastre a equipe e distribua as unidades', d: 'Em Gestão, use Usuários e Carteira.', v: 'gestao', link: '#/gestao', rot: 'Abrir Gestão' },
      { t: 'Confira as regras dos contratos', d: 'Em Regras e decisões, veja as unidades com regra a conferir.', v: 'regras', link: '#/regras', rot: 'Ver regras' },
      { t: 'Abra uma unidade', d: 'Em Unidades, clique na unidade para ver a linha de montagem dela.', v: 'u', link: '#/unidades', rot: 'Ver unidades' },
      { t: 'Autorize os documentos conferidos', d: 'A conferência dos colegas termina na sua autorização.', v: 'v' },
    ],
  };

  function cartao() {
    if (!eu().login || ler(chave('oculto'), false)) return null;
    const lista = PASSOS[['superintendente', 'admin'].includes(eu().perfil) ? 'gestao' : 'analista'];
    const vistas = ler(chave('vistas'), []);
    const feitos = lista.map((p) => vistas.includes(p.v));
    if (feitos.every(Boolean)) return null;
    const n = feitos.filter(Boolean).length;
    const caixa = h('div', { class: 'cartao comece' },
      h('div', { class: 'linha espaco' }, h('h2', { style: 'margin:0' }, 'Comece por aqui'), h('span', { class: 'mudo peq' }, n + ' de ' + lista.length + ' feitos')),
      h('div', { class: 'comece-barra', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(lista.length), 'aria-valuenow': String(n) }, h('span', { style: 'width:' + Math.round(100 * n / lista.length) + '%' })),
      h('ol', { class: 'comece-lista' }, lista.map((p, i) => h('li', { class: feitos[i] ? 'feito' : '' },
        h('span', { class: 'comece-marca', 'aria-hidden': 'true' }, feitos[i] ? '✔' : String(i + 1)),
        h('div', null, h('strong', null, p.t), h('div', { class: 'mudo peq' }, p.d)),
        p.link && !feitos[i] ? h('a', { class: 'btn sec', href: p.link }, p.rot) : null))),
      h('div', { class: 'linha', style: 'justify-content:flex-end' }, h('button', { type: 'button', class: 'leve', onclick: () => { gravar(chave('oculto'), true); caixa.remove(); } }, 'Não mostrar mais')));
    return caixa;
  }
  window.CTAI_COMECE = { cartao };
})();
