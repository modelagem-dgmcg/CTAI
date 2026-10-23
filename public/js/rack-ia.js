(function () {
  'use strict';
  // Rack de chaves de IA: chaves ilimitadas, todas valem para todos os usuários; a ordem define a tentativa.
  // Usado na Administração e na Gestão > IA. A chave nunca volta para a tela: só os 4 últimos caracteres.
  const { h, api, fmt, toast, janela, confirmar, selo, aviso, tabela } = window.CTAI;

  function rack() {
    const raiz = h('div', { id: 'rack-ia' });
    let E = null;
    const nomeServico = (p) => (E.servicos[p] ? p : p);
    const seg = (ms) => (ms === null || ms === undefined ? '' : (ms / 1000).toFixed(1).replace('.', ',') + ' s');

    async function carregar() {
      try { E = await api('GET', '/api/gestao/ia'); desenhar(); } catch (e) { raiz.replaceChildren(aviso('erro', e.message)); }
    }

    async function formulario(k) {
      const edit = !!k;
      const proximaOrdem = Math.max(0, ...E.chaves.map((c) => c.ordem)) + 1;
      const serv = h('select', Object.assign({ id: 'ri-serv' }, edit ? { disabled: true } : {}), Object.keys(E.servicos).map((n) => h('option', Object.assign({ value: n }, k && k.provedor === n ? { selected: true } : {}), n + (E.servicos[n].nuvem ? ' (nuvem)' : ' (rede local)'))));
      const rot = h('input', { type: 'text', id: 'ri-rotulo', value: k ? (k.rotulo || '') : '', placeholder: 'Ex.: Gemini da GGPCG' });
      const chave = h('input', { type: 'password', id: 'ri-chave', autocomplete: 'off', placeholder: edit ? 'Deixe em branco para manter a atual (final ' + (k.final || '—') + ')' : 'Cole a chave do serviço' });
      const url = h('input', { type: 'text', id: 'ri-url', value: k ? k.url : '', placeholder: 'padrão do serviço' });
      const modelo = h('input', { type: 'text', id: 'ri-modelo', value: k ? k.modelo : '', placeholder: 'padrão do serviço' });
      const ordem = h('input', { type: 'number', id: 'ri-ordem', min: 1, max: 99, value: k ? k.ordem : proximaOrdem });
      const ativa = h('input', Object.assign({ type: 'checkbox', id: 'ri-ativa' }, !k || k.ativa ? { checked: true } : {}));
      const jur = h('input', Object.assign({ type: 'checkbox', id: 'ri-jur' }, k && k.juridico ? { checked: true } : {}));
      const blocoChave = h('div', { class: 'campo' }, h('label', { for: 'ri-chave' }, edit ? 'Trocar a chave (opcional)' : 'Chave'), chave, h('div', { class: 'ajuda' }, 'Fica cifrada no servidor. Depois de salva, só aparecem os 4 últimos caracteres.'));
      const rotUrl = h('label', { for: 'ri-url' }, 'Endereço da API (opcional)');
      const blocoJur = h('div', { class: 'campo' }, h('label', { class: 'ck' }, jur, ' Uso aprovado pelo jurídico'), h('div', { class: 'ajuda' }, E.avisoJuridico));
      if (!E.exigirJuridico) blocoJur.style.display = 'none';
      const ajustar = () => {
        const s = E.servicos[serv.value];
        blocoChave.style.display = s.semChave ? 'none' : '';
        blocoJur.style.display = s.nuvem && E.exigirJuridico ? '' : 'none';
        rotUrl.textContent = s.precisaUrl ? 'Endereço do servidor (obrigatório)' : 'Endereço da API (opcional)';
        url.placeholder = s.precisaUrl ? 'http://servidor-local:11434' : 'padrão do serviço';
        modelo.placeholder = s.modeloPadrao;
      };
      serv.addEventListener('change', ajustar); ajustar();
      const campo = (id, r, el) => h('div', { class: 'campo' }, h('label', { for: id }, r), el);
      const r = await janela(edit ? 'Editar chave' : 'Adicionar chave de IA', h('div', null,
        campo('ri-serv', 'Serviço', serv), campo('ri-rotulo', 'Nome para lembrar', rot), blocoChave,
        h('div', { class: 'campo' }, rotUrl, url), campo('ri-modelo', 'Modelo (opcional)', modelo),
        campo('ri-ordem', 'Ordem de tentativa (1 = primeira)', ordem),
        h('div', { class: 'campo' }, h('label', { class: 'ck' }, ativa, ' Ativa (desmarque para suspender sem apagar)')), blocoJur),
        [{ rotulo: 'Cancelar', valor: null, sec: true }, { rotulo: 'Gravar e testar', valor: 'testar', sec: true }, { rotulo: 'Salvar', valor: 'ok' }]);
      if (r !== 'ok' && r !== 'testar') return;
      const corpo = { rotulo: rot.value, url: url.value, modelo: modelo.value, ordem: Number(ordem.value), ativa: ativa.checked, juridico: E.servicos[serv.value].nuvem ? jur.checked : undefined };
      if (chave.value.trim()) corpo.chave = chave.value;
      try {
        let id;
        if (edit) { await api('PUT', '/api/gestao/ia/chaves/' + k.chave_id, corpo); id = k.chave_id; }
        else { const o = await api('POST', '/api/gestao/ia/chaves', Object.assign({ provedor: serv.value }, corpo)); id = o.chave_id; }
        toast('Chave salva.');
        await carregar();
        if (r === 'testar') await testar(id);
      } catch (e) { toast(e.message, true); }
    }

    async function testar(id) {
      const botao = raiz.querySelector('[data-testar="' + id + '"]'); if (botao) { botao.disabled = true; botao.textContent = 'Testando…'; }
      try {
        const t = await api('POST', '/api/gestao/ia/chaves/' + id + '/testar', {});
        toast(t.ok ? 'Conectou em ' + seg(t.ms) + '. ' + t.mensagem : 'Falhou: ' + t.mensagem, !t.ok);
      } catch (e) { toast(e.message, true); }
      await carregar();
    }

    async function alternar(k) {
      try { await api('PUT', '/api/gestao/ia/chaves/' + k.chave_id, { ativa: !k.ativa }); toast(k.ativa ? 'Chave suspensa.' : 'Chave ativada.'); } catch (e) { toast(e.message, true); }
      carregar();
    }
    async function apagar(k) {
      if (!(await confirmar('Apagar a chave "' + (k.rotulo || k.provedor) + '"?', 'Os usuários passam a usar as outras chaves do rack. Esta ação não pode ser desfeita.', 'Apagar', true))) return;
      try { await api('DELETE', '/api/gestao/ia/chaves/' + k.chave_id); toast('Chave apagada.'); } catch (e) { toast(e.message, true); }
      carregar();
    }

    function desenhar() {
      const linhas = E.chaves.map((k) => {
        const s = E.servicos[k.provedor];
        return [h('strong', null, String(k.ordem)),
          h('div', null, h('strong', null, k.provedor), h('div', { class: 'mudo peq' }, k.rotulo || '')),
          s.semChave ? h('span', { class: 'mudo' }, k.url || 'servidor local') : h('span', { style: 'font-family:monospace' }, '••••' + (k.final || '')),
          h('div', null, k.ativa ? selo('ativa', 'ok') : selo('suspensa', ''), ' ', s.nuvem ? selo(k.juridico ? 'nuvem · jurídico ok' : 'nuvem', k.juridico || !E.exigirJuridico ? '' : 'atencao') : selo('rede local', 'ok')),
          h('div', { class: 'peq' }, k.usoMes + ' uso(s) · ' + k.falhasMes + ' falha(s)'),
          k.teste ? h('div', { class: 'peq' }, selo(k.teste.ok ? 'respondeu' : 'falhou', k.teste.ok ? 'ok' : 'alta'), ' ', seg(k.teste.ms), h('div', { class: 'mudo' }, fmt.data(k.teste.em))) : h('span', { class: 'mudo peq' }, 'não testada'),
          h('div', { class: 'linha' },
            h('button', { class: 'sec', 'data-testar': k.chave_id, onclick: () => testar(k.chave_id) }, 'Testar'),
            h('button', { class: 'leve', 'data-editar': k.chave_id, onclick: () => formulario(k) }, 'Editar'),
            h('button', { class: 'leve', onclick: () => alternar(k) }, k.ativa ? 'Suspender' : 'Ativar'),
            h('button', { class: 'leve', onclick: () => apagar(k) }, 'Apagar'))];
      });
      raiz.replaceChildren(h('div', { class: 'cartao' },
        h('div', { class: 'linha espaco' }, h('h3', { style: 'margin:0' }, 'Chaves de IA'), h('button', { id: 'ri-nova', onclick: () => formulario(null) }, '+ Adicionar chave')),
        h('p', { class: 'mudo peq' }, 'Cada chave do rack vale para todos os usuários do Analista CTAI. Com mais de uma, o sistema tenta na ordem e passa para a próxima se uma falhar (limite de uso, chave vencida). As verificações locais continuam funcionando sempre, sem chave.'),
        E.exigirJuridico ? null : aviso('atencao', h('strong', null, 'Modo de teste. '), 'A aprovação do jurídico não está sendo exigida. Use somente dados fictícios (de demonstração). Para exigir, defina CTAI_EXIGIR_JURIDICO=sim no servidor.'),
        E.segredoConfigurado ? null : aviso('atencao', h('strong', null, 'Falta o CTAI_SEGREDO. '), 'Defina essa variável no servidor (mínimo de 16 caracteres) antes de cadastrar chaves.'),
        tabela([{ t: 'Ordem' }, { t: 'Serviço' }, { t: 'Chave' }, { t: 'Situação' }, { t: 'Uso no mês' }, { t: 'Último teste' }, { t: '' }], linhas, { vazio: 'Nenhuma chave cadastrada. Use "Adicionar chave".' }),
        E.doEnv.length ? h('p', { class: 'mudo peq' }, 'Também há chave definida no servidor (.env) para: ' + E.doEnv.map((x) => x.provedor + (x.final ? ' (••••' + x.final + ')' : '')).join(', ') + '. Ela só é usada depois das chaves do rack.') : null));
    }
    carregar();
    return raiz;
  }
  window.CTAI_RACK_IA = rack;
})();
