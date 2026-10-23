(function () {
  'use strict';
  // Formulário único de "Novo usuário": primeiro escolhe CTAI ou Unidade, depois mostra só o que cabe a cada um.
  // Usado na Administração e na Gestão.
  const { h, api, toast } = window.CTAI;
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // Lista de unidades com busca. multi = marcar várias (carteira); senão escolhe uma só.
  function seletorUnidades({ contratos, multi, aoMudar }) {
    const sel = new Set();
    let filtro = '';
    const caixa = h('div', { class: 'lista-un', role: 'group', 'aria-label': 'Unidades' });
    const contador = h('span', { class: 'mudo peq' });
    const visiveis = () => contratos.filter((c) => !filtro || norm(c.unidade + ' ' + (c.municipio || '')).includes(filtro));
    const atualizar = () => { contador.textContent = multi ? (sel.size ? sel.size + ' unidade(s) marcada(s)' : 'nenhuma marcada') : ''; aoMudar([...sel]); };
    function linhas() {
      const lista = visiveis();
      caixa.replaceChildren(...lista.map((c) => {
        const i = h('input', { type: multi ? 'checkbox' : 'radio', name: 'nu-un', value: c.contrato_id });
        i.checked = sel.has(c.contrato_id);
        i.onchange = () => { if (multi) { if (i.checked) sel.add(c.contrato_id); else sel.delete(c.contrato_id); } else { sel.clear(); sel.add(c.contrato_id); } atualizar(); };
        return h('label', { class: 'ck' }, i, ' ', c.unidade, c.municipio ? h('span', { class: 'mudo' }, ' · ' + c.municipio) : null, c.demo ? h('span', { class: 'selo demo', style: 'margin-left:6px' }, 'demonstração') : null);
      }));
      if (!lista.length) caixa.appendChild(h('p', { class: 'mudo peq', style: 'padding:6px' }, 'Nenhuma unidade encontrada.'));
    }
    const busca = h('input', { type: 'search', id: 'nu-busca', placeholder: 'Buscar unidade ou município…', 'aria-label': 'Buscar unidade', oninput: (e) => { filtro = norm(e.target.value); linhas(); } });
    const marcar = (todas) => { for (const c of visiveis()) { if (todas) sel.add(c.contrato_id); else sel.delete(c.contrato_id); } linhas(); atualizar(); };
    linhas(); contador.textContent = multi ? 'nenhuma marcada' : '';
    return h('div', { class: 'seletor-un' }, busca,
      multi ? h('div', { class: 'linha espaco', style: 'margin:6px 0' }, contador, h('span', null, h('button', { type: 'button', class: 'leve', onclick: () => marcar(true) }, 'Marcar as listadas'), h('button', { type: 'button', class: 'leve', onclick: () => marcar(false) }, 'Desmarcar as listadas'))) : null,
      caixa);
  }

  function chips(opcoes, valor, aoEscolher) {
    return h('div', { class: 'seg', role: 'radiogroup' }, opcoes.map(([v, r]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === valor), class: 'sec' + (v === valor ? ' ativo' : ''), onclick: () => aoEscolher(v) }, r)));
  }

  // opcoes: { perfis, contratos, setores, endpoint, aoCriar }
  function formulario(opcoes) {
    const eu = window.__eu || {};
    const E = { modo: 'ctai', perfil: 'criador', unidades: [], contrato: '', setor: '' };
    // Os seletores são criados uma vez por modo, para a busca e as marcas não se perderem ao trocar de perfil ou de setor.
    let pickCarteira = null, pickUnidade = null;
    const login = h('input', { type: 'text', id: 'nu-l', autocomplete: 'off', placeholder: 'ex.: maria.silva' });
    const nome = h('input', { type: 'text', id: 'nu-n', autocomplete: 'off', placeholder: 'Nome completo' });
    const zona = h('div');
    const rotulo = (k) => opcoes.perfis[k] || k;
    const perfisCtai = ['criador', 'colega', 'superintendente'].concat(eu.perfil === 'admin' ? ['admin'] : []);
    const perfisUnidade = ['gestor_unidade', 'setor_unidade'];
    const btn = h('button', { type: 'button', id: 'nu-criar', onclick: criar }, 'Criar usuário');

    function valido() {
      if (!/^[a-z0-9._-]{3,40}$/.test(login.value.trim().toLowerCase()) || !nome.value.trim()) return false;
      if (E.modo === 'unidade') return !!E.contrato && (E.perfil !== 'setor_unidade' || !!E.setor);
      return true;
    }
    const conferir = () => { btn.disabled = !valido(); };
    login.oninput = conferir; nome.oninput = conferir;

    function desenhar() {
      const unidade = E.modo === 'unidade';
      const partes = [];
      partes.push(h('div', { class: 'campo' }, h('label', null, 'Perfil'), chips((unidade ? perfisUnidade : perfisCtai).map((k) => [k, rotulo(k)]), E.perfil, (v) => { E.perfil = v; if (v !== 'setor_unidade') E.setor = ''; desenhar(); })));
      if (!unidade) {
        if (['criador', 'colega'].includes(E.perfil)) {
          partes.push(h('div', { class: 'campo' }, h('label', null, 'Unidades que acompanha (carteira)'),
            pickCarteira || (pickCarteira = seletorUnidades({ contratos: opcoes.contratos, multi: true, aoMudar: (l) => { E.unidades = l; } })),
            h('div', { class: 'ajuda' }, 'Sem nenhuma marcada, a pessoa vê todas as unidades. Dá para ajustar depois em Gestão > Carteira.')));
        } else {
          partes.push(h('p', { class: 'mudo peq' }, 'Este perfil enxerga todas as unidades; não precisa de carteira.'));
        }
      } else {
        partes.push(h('div', { class: 'campo' }, h('label', null, 'Unidade'),
          pickUnidade || (pickUnidade = seletorUnidades({ contratos: opcoes.contratos, multi: false, aoMudar: (l) => { E.contrato = l[0] || ''; conferir(); } }))));
        if (E.perfil === 'setor_unidade') partes.push(h('div', { class: 'campo' }, h('label', null, 'Setor (ficha pela qual responde)'), chips(opcoes.setores.map((s) => [s.id, s.nome]), E.setor, (v) => { E.setor = v; desenhar(); })));
      }
      zona.replaceChildren(...partes);
      conferir();
    }
    const modos = h('div', { class: 'seg grande' });
    function desenharModos() {
      modos.replaceChildren(...[['ctai', 'Equipe da CTAI'], ['unidade', 'Unidade (OSS)']].map(([k, r]) => h('button', { type: 'button', class: 'sec' + (E.modo === k ? ' ativo' : ''), 'aria-pressed': String(E.modo === k), onclick: () => { if (E.modo === k) return; E.modo = k; E.perfil = k === 'ctai' ? 'criador' : 'gestor_unidade'; E.unidades = []; E.contrato = ''; E.setor = ''; pickCarteira = null; pickUnidade = null; desenharModos(); desenhar(); } }, r)));
    }
    async function criar() {
      btn.disabled = true;
      try {
        const corpo = { login: login.value.trim().toLowerCase(), nome: nome.value.trim(), perfil: E.perfil };
        if (E.modo === 'unidade') { corpo.contrato_id = E.contrato; if (E.perfil === 'setor_unidade') corpo.setor = E.setor; }
        else if (['criador', 'colega'].includes(E.perfil)) corpo.unidades = E.unidades;
        const o = await api('POST', opcoes.endpoint, corpo);
        toast('Usuário ' + corpo.login + ' criado. Senha: ' + (o.senhaTemporaria || '(definida)'));
        opcoes.aoCriar();
      } catch (e) { toast(e.message, true); conferir(); }
    }
    desenharModos(); desenhar();
    return h('div', { class: 'cartao', id: 'novo-usuario' }, h('h3', null, 'Novo usuário'),
      h('div', { class: 'campo' }, h('label', null, 'Para quem?'), modos),
      h('div', { class: 'duas' }, h('div', { class: 'campo' }, h('label', { for: 'nu-l' }, 'Login'), login), h('div', { class: 'campo' }, h('label', { for: 'nu-n' }, 'Nome'), nome)),
      zona, btn);
  }
  window.CTAI_USUARIO_FORM = formulario;
})();
