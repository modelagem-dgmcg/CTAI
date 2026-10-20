(function () {
  'use strict';
  // Gestão CTAI: painel da superintendente, produção, carteira, usuários e IA. Só superintendente e administrador.
  const { h, api, fmt, toast, janela, confirmar, selo, aviso, tabela, montar } = window.CTAI;
  const ABAS = [['', 'Painel'], ['producao', 'Produção'], ['carteira', 'Carteira'], ['usuarios', 'Usuários'], ['ia', 'IA']];
  const kpi = (r, v, nota, tom) => h('div', { class: 'kpi' + (tom ? ' ' + tom : '') }, h('div', { class: 'r' }, r), h('div', { class: 'num-grande' }, String(v)), nota ? h('div', { class: 'r' }, nota) : null);
  const F = { trimestre: '', contrato: '', usuario_id: '' }; // filtros lembrados enquanto a página está aberta
  const qs = (o) => { const p = new URLSearchParams(); for (const k of Object.keys(o)) if (o[k]) p.set(k, o[k]); const s = p.toString(); return s ? '?' + s : ''; };
  const dataBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
  const n1 = (v) => (v === null || v === undefined ? '—' : String(v).replace('.', ','));

  const tomPrazo = (s) => (['vencido', 'entregue com atraso'].includes(s) ? 'alta' : (s === 'a vencer' ? 'atencao' : (s === 'entregue no prazo' ? 'ok' : '')));
  const seloPz = (rot, p) => (p ? h('span', { class: 'selo ' + tomPrazo(p.situacao), title: 'Prazo ' + dataBr(p.prazo) + (p.entregue_em ? ' · entregue em ' + dataBr(p.entregue_em) : '') }, rot + ' ' + p.situacao + (['vencido', 'entregue com atraso', 'a vencer'].includes(p.situacao) ? ' (' + p.dias + ' d)' : '')) : '—');
  const tomEnvio = { recebido: 'ok', incompleto: 'atencao', pendente: 'alta' };

  function cabecalho(aba) {
    return [h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Gestão CTAI'), h('p', null, 'Equipe, carteira de unidades, IA e acompanhamento da superintendência. Só a superintendente e o administrador veem esta área.'))),
      h('div', { class: 'abas' }, ABAS.map(([k, r]) => h('a', { href: '#/gestao' + (k ? '/' + k : ''), class: aba === k ? 'ativo' : '' }, r)))];
  }
  const seletor = (id, rotulo, opcoes, valor, aoMudar) => h('div', { class: 'campo filtro' }, h('label', { for: id }, rotulo),
    h('select', { id, onchange: (e) => aoMudar(e.target.value) }, opcoes.map(([v, t]) => h('option', Object.assign({ value: v }, String(v) === String(valor) ? { selected: true } : {}), t))));

  // ---------- Painel ----------
  async function painel() {
    const [p, c] = await Promise.all([api('GET', '/api/gestao/painel' + qs(F)), api('GET', '/api/gestao/carteira')]);
    F.trimestre = p.trimestre;
    const k = p.cartoes;
    const refazer = () => aba();
    const filtros = h('div', { class: 'filtros cartao' },
      seletor('gp-tri', 'Trimestre', p.trimestres.map((t) => [t, t]), p.trimestre, (v) => { F.trimestre = v; refazer(); }),
      seletor('gp-un', 'Unidade', [['', 'Todas']].concat(c.unidades.map((u) => [u.contrato_id, u.unidade])), F.contrato, (v) => { F.contrato = v; refazer(); }),
      seletor('gp-func', 'Funcionário', [['', 'Todos']].concat(c.funcionarios.map((f) => [f.usuario_id, f.nome])), F.usuario_id, (v) => { F.usuario_id = v; refazer(); }),
      h('a', { class: 'btn', id: 'gp-pdf', href: '/api/gestao/painel/pdf' + qs(F), target: '_blank', rel: 'noopener' }, 'Exportar PDF'));
    const prz = k.prazos;
    const linhaAlertas = p.alertas.length ? h('ul', { class: 'alertas' }, p.alertas.slice(0, 14).map((a) => h('li', { class: a.nivel }, h('span', { class: 'selo ' + (a.nivel === 'alta' ? 'alta' : (a.nivel === 'atencao' ? 'atencao' : '')) }, a.tipo), ' ', h('strong', null, a.unidade), ' · ', a.texto)))
      : h('p', { class: 'mudo' }, 'Nenhum alerta no momento.');
    const maxRec = Math.max(1, ...p.recorrentes.map((r) => r.divergencias));
    montar(cabecalho(''), filtros,
      h('div', { class: 'kpis' },
        kpi('Unidades', k.unidades, k.competencias + ' competência(s) em ' + p.trimestre),
        kpi('Envios recebidos', k.recebidos, 'completos'), kpi('Incompletos', k.incompletos, 'itens pendentes', k.incompletos ? 'atencao' : ''), kpi('Pendentes', k.pendentes, 'sem envio recebido', k.pendentes ? 'atencao' : ''),
        kpi('Prazos vencidos', prz.vencido, prz.a_vencer + ' a vencer · ' + prz.atraso + ' com atraso', prz.vencido ? 'alta' : ''),
        kpi('Achados abertos', k.achados_abertos, k.achados_vencidos + ' vencido(s)', k.achados_vencidos ? 'alta' : ''),
        kpi('Pareceres', k.pareceres_rascunho + ' / ' + k.pareceres_congelados, 'rascunho / congelados'),
        kpi('Sem carteira', k.sem_carteira, 'unidades', k.sem_carteira ? 'atencao' : '')),
      h('div', { class: 'cartao' }, h('h2', { style: 'margin-top:0' }, 'Alertas'), linhaAlertas),
      p.sem_carteira.length ? h('div', { class: 'cartao' }, h('h2', { style: 'margin-top:0' }, 'Unidades sem carteira'),
        h('p', { class: 'mudo peq' }, 'O envio dessas unidades não tem funcionário responsável. Escolha quem acompanha:'),
        p.sem_carteira.map((u) => {
          const sel = h('select', { 'aria-label': 'Funcionário para ' + u.unidade, id: 'sc-' + u.contrato_id }, c.funcionarios.filter((f) => f.ativo).map((f) => h('option', { value: f.usuario_id }, f.nome)));
          return h('div', { class: 'linha sem-carteira' }, h('strong', null, u.unidade), u.demo ? selo('demonstração', 'demo') : null, sel,
            h('button', { class: 'sec', onclick: async () => { try { await api('POST', '/api/gestao/carteira/atribuir', { usuario_id: Number(sel.value), contrato_id: u.contrato_id, motivo: 'Distribuição pelo painel' }); toast('Unidade atribuída.'); refazer(); } catch (e) { toast(e.message, true); } } }, 'Atribuir'));
        })) : null,
      h('div', { class: 'unidades-grid' }, p.unidades.length ? p.unidades.map((u) => cartaoUnidade(u, p)) : h('div', { class: 'cartao' }, h('p', { class: 'mudo' }, 'Nenhuma unidade para esse filtro.'))),
      h('div', { class: 'cartao' }, h('h2', { style: 'margin-top:0' }, 'Divergências recorrentes por indicador'),
        h('p', { class: 'mudo peq' }, 'Itens do IGQ que voltam a divergir em mais de uma competência são candidatos a orientação direta à unidade.'),
        p.recorrentes.length ? tabela([{ t: 'Item' }, { t: 'Indicador' }, { t: 'Competências', n: true }, { t: 'Divergências' }, { t: 'Abertas', n: true }, { t: '' }],
          p.recorrentes.map((r) => [r.indicador_id, r.nome || '—', r.competencias, h('div', { class: 'barra-rot' }, h('div', { class: 'barra' }, h('i', { style: 'width:' + Math.round((r.divergencias / maxRec) * 100) + '%' })), h('span', null, r.divergencias)), r.abertas, r.recorrente ? selo('recorrente', 'atencao') : '']))
          : h('p', { class: 'mudo' }, 'Nenhuma divergência registrada para esse filtro.')),
      h('p', { class: 'mudo peq' }, 'Situação em ' + dataBr(p.hoje) + ' · comparação com ' + p.trimestre_anterior + ' · trilha ' + (p.trilha.ok ? 'íntegra' : 'COM FALHAS') + ' (' + p.trilha.eventos + ' eventos).'));
  }

  function cartaoUnidade(u, p) {
    const delta = u.igq_delta;
    const igqTxt = u.igq ? n1(u.igq.medio) + ' de ' + u.igq.soma_maxima : '—';
    const larg = u.igq ? Math.max(0, Math.min(100, (u.igq.medio / u.igq.soma_maxima) * 100)) : 0;
    return h('div', { class: 'cartao un-card', 'data-un': u.contrato_id },
      h('div', { class: 'linha espaco' }, h('h3', { style: 'margin:0' }, u.unidade), h('span', { class: 'selo ' + (u.fase.startsWith('Anexado') ? 'ok' : '') }, u.fase)),
      h('p', { class: 'mudo peq' }, u.oss + ' · ', u.demo ? selo('demonstração', 'demo') : null, ' ', u.sem_carteira ? selo('sem carteira', 'atencao') : ('Responsável: ' + u.responsaveis.map((r) => r.nome).join(', '))),
      tabela([{ t: 'Mês' }, { t: 'Envio' }, { t: 'SEI · dia 20' }, { t: 'SIMAS · dia 25' }, { t: 'Div.', n: true }, { t: 'IGQ', n: true }],
        u.competencias.map((k) => [fmt.comp(k.competencia_id) + (k.mes_implantacao ? ' (impl.)' : ''), selo(k.envio.estado + (k.envio.versao ? ' v' + k.envio.versao : ''), tomEnvio[k.envio.estado] || ''), seloPz('', k.prazos && k.prazos.sei), seloPz('', k.prazos && k.prazos.simas), k.divergencias_abertas, k.igq ? n1(k.igq.igq) : '—']), { vazio: 'Sem competências neste trimestre.' }),
      h('div', { class: 'un-rodape' },
        h('div', null, h('div', { class: 'r' }, 'IGQ médio · ' + p.trimestre), h('div', { class: 'num-medio' }, igqTxt), h('div', { class: 'barra' }, h('i', { style: 'width:' + larg + '%' })),
          h('div', { class: 'r' }, u.igq ? ('pago em média ' + n1(u.igq.pct_pago_medio) + '% da parcela') : 'ainda sem envio recebido')),
        h('div', null, h('div', { class: 'r' }, 'Antes · ' + p.trimestre_anterior), h('div', { class: 'num-medio' }, u.igq_anterior ? n1(u.igq_anterior.medio) : '—'),
          delta === null ? h('div', { class: 'r' }, 'sem comparação') : h('div', { class: 'delta ' + (delta < 0 ? 'baixou' : (delta > 0 ? 'subiu' : '')) }, (delta > 0 ? '▲ +' : (delta < 0 ? '▼ ' : '= ')) + n1(delta) + ' ponto(s)')),
        h('div', null, h('div', { class: 'r' }, 'Achados'), h('div', { class: 'num-medio' }, u.achados.abertos), h('div', { class: 'r' }, u.achados.vencidos ? u.achados.vencidos + ' vencido(s)' : 'nenhum vencido')),
        h('div', null, h('div', { class: 'r' }, 'Parecer'), h('div', { class: 'num-medio' }, u.parecer ? (u.parecer.congelado ? 'v' + u.parecer.versao : 'rascunho') : '—'), h('div', { class: 'r' }, u.parecer ? (u.parecer.congelado ? u.parecer.versao_status : 'em elaboração') : 'não iniciado'))));
  }

  // ---------- Produção ----------
  async function producao() {
    const c = await api('GET', '/api/gestao/carteira');
    const tri = F.trimestre;
    const p = await api('GET', '/api/gestao/producao' + qs({ trimestre: F.prodTri, contrato: F.contrato, usuario_id: F.usuario_id }));
    const t = p.totais;
    const triOpc = [['', 'Todo o período']].concat((F.lista || []).map((x) => [x, x]));
    montar(cabecalho('producao'),
      h('div', { class: 'filtros cartao' },
        seletor('gpr-tri', 'Período', triOpc, F.prodTri || '', (v) => { F.prodTri = v; aba(); }),
        seletor('gpr-un', 'Unidade', [['', 'Todas']].concat(c.unidades.map((u) => [u.contrato_id, u.unidade])), F.contrato, (v) => { F.contrato = v; aba(); }),
        seletor('gpr-func', 'Funcionário', [['', 'Todos']].concat(c.funcionarios.map((f) => [f.usuario_id, f.nome])), F.usuario_id, (v) => { F.usuario_id = v; aba(); })),
      aviso('info', h('strong', null, 'O que isto mede. '), p.nota),
      h('div', { class: 'kpis' }, kpi('Itens conferidos', t.itens_conferidos), kpi('Divergências tratadas', t.divergencias_tratadas), kpi('Achados encaminhados', t.achados_encaminhados, t.achados_respondidos + ' já respondidos'),
        kpi('Minutas criadas', t.minutas_criadas, t.minutas_congeladas + ' congeladas')),
      h('div', { class: 'cartao' }, h('h2', { style: 'margin-top:0' }, 'Por funcionário'),
        tabela([{ t: 'Funcionário' }, { t: 'Itens', n: true }, { t: 'Diverg.', n: true }, { t: 'Achados enc./resp./desc.' }, { t: 'Minutas cri./cong.' }, { t: 'Receb. → conferido' }, { t: 'Carga atual' }],
          p.funcionarios.map((f) => [h('div', null, h('strong', null, f.nome), h('div', { class: 'r mudo peq' }, f.perfil)), f.itens_conferidos, f.divergencias_tratadas,
            f.achados.encaminhados + ' / ' + f.achados.respondidos + ' / ' + f.achados.descartados, f.minutas.criadas + ' / ' + f.minutas.congeladas,
            f.tempo_medio ? n1(f.tempo_medio.dias) + ' d (' + f.tempo_medio.amostra + ')' : '—',
            h('div', { class: 'peq carga' }, f.carga.unidades + ' unid. · ' + f.carga.divergencias_abertas + ' diverg. · ' + f.carga.achados_abertos + ' achados · ' + f.carga.minutas_abertas + ' minuta(s) · ' + f.carga.conferencias_pendentes + ' a conferir')]))));
  }

  // ---------- Carteira ----------
  async function carteira() {
    const c = await api('GET', '/api/gestao/carteira');
    const hist = await api('GET', '/api/gestao/carteira/historico');
    const editar = async (f) => {
      const marcados = new Set(f.unidades);
      const caixas = c.unidades.map((u) => { const cb = h('input', Object.assign({ type: 'checkbox', id: 'ck-' + u.contrato_id, value: u.contrato_id }, marcados.has(u.contrato_id) ? { checked: true } : {})); return h('label', { class: 'ck', for: 'ck-' + u.contrato_id }, cb, ' ', u.unidade, u.demo ? ' (demonstração)' : ''); });
      const motivo = h('input', { type: 'text', id: 'ck-motivo', placeholder: 'Motivo (opcional)' });
      const r = await janela('Carteira de ' + f.nome, h('div', null, h('p', { class: 'mudo peq' }, 'Marque as unidades que esta pessoa acompanha. Quem tem carteira vê só essas unidades.'), caixas, h('div', { class: 'campo' }, h('label', { for: 'ck-motivo' }, 'Motivo'), motivo)), [{ rotulo: 'Cancelar', valor: null, sec: true }, { rotulo: 'Salvar carteira', valor: 'ok' }]);
      if (r !== 'ok') return;
      const sel = caixas.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
      try { await api('PUT', '/api/gestao/carteira/' + f.usuario_id, { unidades: sel, motivo: motivo.value }); toast('Carteira atualizada.'); carteira(); } catch (e) { toast(e.message, true); }
    };
    montar(cabecalho('carteira'),
      aviso('info', h('strong', null, 'Como funciona. '), c.regra),
      h('div', { class: 'cartao' }, h('div', { class: 'linha espaco' }, h('h2', { style: 'margin:0' }, 'Quem acompanha cada unidade'),
        h('label', { class: 'ck' }, h('input', Object.assign({ type: 'checkbox', id: 'cart-estrito', onchange: async (e) => { try { await api('PUT', '/api/gestao/carteira-modo', { estrita: e.target.checked }); toast(e.target.checked ? 'Modo estrito ligado.' : 'Modo estrito desligado.'); carteira(); } catch (x) { toast(x.message, true); } } }, c.estrita ? { checked: true } : {})), ' Modo estrito (sem carteira = não vê nada)')),
        tabela([{ t: 'Funcionário' }, { t: 'Perfil' }, { t: 'Unidades da carteira' }, { t: '' }], c.funcionarios.map((f) => [h('strong', null, f.nome), f.perfil, f.unidades.length ? f.unidades.map((id) => { const u = c.unidades.find((x) => x.contrato_id === id); return h('span', { class: 'selo', style: 'margin-right:4px' }, u ? u.unidade : id); }) : h('span', { class: 'mudo' }, f.ativo ? 'vê todas (sem carteira)' : 'desativado'), h('button', { class: 'sec', id: 'cart-ed-' + f.login, onclick: () => editar(f) }, 'Editar carteira')]))),
      h('div', { class: 'cartao' }, h('h3', null, 'Unidades'), tabela([{ t: 'Unidade' }, { t: 'Responsáveis' }], c.unidades.map((u) => [u.unidade + (u.demo ? ' (demonstração)' : ''), u.responsaveis.length ? u.responsaveis.map((r) => r.nome).join(', ') : selo('sem carteira', 'atencao')]))),
      h('div', { class: 'cartao' }, h('h3', null, 'Histórico de mudanças'), tabela([{ t: 'Funcionário' }, { t: 'Unidade' }, { t: 'Entrou' }, { t: 'Saiu' }, { t: 'Por' }],
        hist.historico.slice(0, 40).map((x) => [x.nome, x.unidade || x.contrato_id, fmt.data(x.desde), x.ate ? fmt.data(x.ate) : h('span', { class: 'selo ok' }, 'ativa'), x.ate ? (x.removido_por || '') : (x.atribuido_por || '')]), { vazio: 'Nenhuma atribuição ainda.' })));
  }

  // ---------- Usuários ----------
  async function usuarios() {
    const u = await api('GET', '/api/gestao/usuarios');
    const f = { login: h('input', { type: 'text', id: 'gu-l' }), nome: h('input', { type: 'text', id: 'gu-n' }),
      perfil: h('select', { id: 'gu-p' }, Object.entries(u.perfis).map(([k, r]) => h('option', { value: k }, r))),
      contrato: h('select', { id: 'gu-c' }, [h('option', { value: '' }, '— nenhum —')].concat(u.contratos.map((c) => h('option', { value: c.contrato_id }, c.unidade)))),
      setor: h('select', { id: 'gu-s' }, [h('option', { value: '' }, '— nenhum —')].concat(u.setores.map((x) => h('option', { value: x.id }, x.nome)))) };
    const editar = async (x) => {
      const nome = h('input', { type: 'text', id: 'eu-n', value: x.nome });
      const perfil = h('select', { id: 'eu-p' }, Object.entries(u.perfis).map(([k, r]) => h('option', Object.assign({ value: k }, k === x.perfil ? { selected: true } : {}), r)));
      const contrato = h('select', { id: 'eu-c' }, [h('option', { value: '' }, '— nenhum —')].concat(u.contratos.map((c) => h('option', Object.assign({ value: c.contrato_id }, c.contrato_id === x.contrato_id ? { selected: true } : {}), c.unidade))));
      const r = await janela('Editar ' + x.login, h('div', null, h('div', { class: 'campo' }, h('label', { for: 'eu-n' }, 'Nome'), nome), h('div', { class: 'campo' }, h('label', { for: 'eu-p' }, 'Perfil'), perfil), h('div', { class: 'campo' }, h('label', { for: 'eu-c' }, 'Unidade (usuários de unidade)'), contrato)), [{ rotulo: 'Cancelar', valor: null, sec: true }, { rotulo: 'Salvar', valor: 'ok' }]);
      if (r !== 'ok') return;
      try { await api('PATCH', '/api/gestao/usuarios/' + x.usuario_id, { nome: nome.value, perfil: perfil.value, contrato_id: contrato.value || null }); toast('Usuário atualizado.'); usuarios(); } catch (e) { toast(e.message, true); }
    };
    montar(cabecalho('usuarios'),
      h('div', { class: 'cartao' }, h('h2', { style: 'margin-top:0' }, 'Pessoas com acesso'),
        tabela([{ t: 'Login' }, { t: 'Nome' }, { t: 'Perfil' }, { t: 'Unidades' }, { t: 'Situação' }, { t: '' }], u.usuarios.map((x) => [x.login, x.nome, u.perfis[x.perfil], x.unidades ? (x.unidades.length ? x.unidades.length + ' unidade(s)' : 'sem carteira') : (x.contrato_id || '—'), x.ativo ? (x.trocar_senha ? selo('senha temporária', 'atencao') : selo('ativo', 'ok')) : selo('desativado', 'alta'),
          h('div', { class: 'linha' }, h('button', { class: 'leve', onclick: () => editar(x) }, 'Editar'),
            h('button', { class: 'leve', onclick: async () => { if (await confirmar('Definir senha temporária para ' + x.login + '?', 'A pessoa precisa trocar a senha no próximo acesso e as sessões abertas são encerradas.', 'Definir')) { try { const o = await api('POST', '/api/gestao/usuarios/' + x.usuario_id + '/senha', {}); toast('Senha temporária: ' + (o.senhaTemporaria || '(definida)')); usuarios(); } catch (e) { toast(e.message, true); } } } }, 'Trocar senha'),
            h('button', { class: 'leve', onclick: async () => { try { await api('POST', '/api/gestao/usuarios/' + x.usuario_id + '/ativo', { ativo: !x.ativo }); usuarios(); } catch (e) { toast(e.message, true); } } }, x.ativo ? 'Desativar' : 'Ativar'))]))),
      h('div', { class: 'cartao' }, h('h3', null, 'Novo usuário'),
        h('div', { class: 'duas' }, h('div', { class: 'campo' }, h('label', { for: 'gu-l' }, 'Login'), f.login), h('div', { class: 'campo' }, h('label', { for: 'gu-n' }, 'Nome'), f.nome), h('div', { class: 'campo' }, h('label', { for: 'gu-p' }, 'Perfil'), f.perfil),
          h('div', { class: 'campo' }, h('label', { for: 'gu-c' }, 'Unidade (usuários de unidade)'), f.contrato), h('div', { class: 'campo' }, h('label', { for: 'gu-s' }, 'Setor (responsável de setor)'), f.setor)),
        h('button', { id: 'gu-criar', onclick: async () => { try { const o = await api('POST', '/api/gestao/usuarios', { login: f.login.value, nome: f.nome.value, perfil: f.perfil.value, contrato_id: f.contrato.value || null, setor: f.setor.value || null }); toast('Usuário criado. Senha temporária: ' + (o.senhaTemporaria || '(definida)')); usuarios(); } catch (e) { toast(e.message, true); } } }, 'Criar usuário'),
        h('p', { class: 'mudo peq' }, 'Tudo fica registrado na trilha. O sistema nunca guarda senha do SEI.')));
  }

  // ---------- IA ----------
  async function ia() {
    const e = await api('GET', '/api/gestao/ia');
    const cartao = (p) => {
      const estadoSelo = p.ativoEfetivo ? selo('ligado', 'ok') : selo('desligado', '');
      return h('div', { class: 'cartao ia-card', 'data-prov': p.provedor },
        h('div', { class: 'linha espaco' }, h('h3', { style: 'margin:0;text-transform:capitalize' }, p.provedor), h('div', { class: 'linha' }, p.nuvem ? selo('nuvem', 'atencao') : selo('rede local', 'ok'), estadoSelo)),
        h('div', { class: 'ia-info' },
          h('div', null, h('div', { class: 'r' }, 'Chave'), p.configurada ? h('strong', null, p.precisaUrl && !p.final ? 'endereço configurado' : 'configurada · final ' + (p.final || '—')) : h('span', { class: 'mudo' }, 'não configurada'), p.origemChave ? h('div', { class: 'r' }, 'guardada em ' + (p.origemChave === 'painel' ? 'cofre do servidor (cifrada)' : '.env')) : null),
          h('div', null, h('div', { class: 'r' }, 'Modelo'), h('strong', null, p.modelo || p.modeloPadrao), p.modelo ? null : h('div', { class: 'r' }, 'padrão')),
          h('div', null, h('div', { class: 'r' }, 'Uso em ' + e.mes), h('strong', null, p.usoMes + ' chamada(s)'), h('div', { class: 'r' }, p.falhasMes + ' falha(s) · total ' + p.usoTotal)),
          p.nuvem ? h('div', null, h('div', { class: 'r' }, 'Jurídico'), p.juridico ? h('strong', null, 'aprovado por ' + p.juridico.por) : h('span', { class: 'mudo' }, 'sem aprovação registrada'), p.juridico ? h('div', { class: 'r' }, fmt.data(p.juridico.em)) : null) : null),
        h('div', { class: 'linha' },
          h('button', { class: 'sec', id: 'ia-conf-' + p.provedor, onclick: () => configurar(p) }, 'Configurar'),
          h('button', { class: 'sec', id: 'ia-testar-' + p.provedor, disabled: !p.ativoEfetivo, onclick: async (ev) => { ev.target.disabled = true; try { const t = await api('POST', '/api/gestao/ia/' + p.provedor + '/testar', {}); toast((t.ok ? 'Funcionou em ' + t.ms + ' ms.' : 'Falhou: ' + t.mensagem), !t.ok); } catch (x) { toast(x.message, true); } ia(); } }, 'Testar'),
          h('button', { class: p.ativo ? 'leve' : '', id: 'ia-lig-' + p.provedor, onclick: async () => { try { await api('PUT', '/api/gestao/ia/' + p.provedor, p.nuvem && !p.ativo && !p.juridico ? { ativo: true, juridico: await juridico() } : { ativo: !p.ativo }); ia(); } catch (x) { toast(x.message, true); } } }, p.ativo ? 'Desligar' : 'Ligar')));
    };
    const juridico = async () => (await confirmar('Aprovação do jurídico', e.avisoJuridico + ' Confirma que o uso deste provedor foi aprovado pelo jurídico?', 'Sim, aprovado')) === true;
    const configurar = async (p) => {
      const chave = h('input', { type: 'password', id: 'ia-chave', autocomplete: 'off', placeholder: p.configurada ? 'deixe vazio para manter a chave atual' : 'cole a chave aqui' });
      const modelo = h('input', { type: 'text', id: 'ia-modelo', value: p.modelo, placeholder: p.modeloPadrao });
      const url = h('input', { type: 'text', id: 'ia-url', value: p.url, placeholder: p.precisaUrl ? 'http://servidor-local:11434' : 'padrão do provedor' });
      const jur = h('input', Object.assign({ type: 'checkbox', id: 'ia-jur' }, p.juridico ? { checked: true } : {}));
      const lig = h('input', Object.assign({ type: 'checkbox', id: 'ia-ligar' }, p.ativo ? { checked: true } : {}));
      const corpo = h('div', null, aviso('atencao', e.avisoJuridico),
        e.segredoConfigurado ? null : aviso('erro', 'O servidor não tem CTAI_SEGREDO no .env. Sem ele não é possível guardar chaves. Defina e reinicie.'),
        p.precisaUrl ? null : h('div', { class: 'campo' }, h('label', { for: 'ia-chave' }, 'Chave (fica só no servidor, cifrada; nunca volta para a tela)'), chave),
        h('div', { class: 'campo' }, h('label', { for: 'ia-modelo' }, 'Modelo'), modelo),
        h('div', { class: 'campo' }, h('label', { for: 'ia-url' }, p.precisaUrl ? 'Endereço do servidor' : 'Endereço da API (opcional)'), url),
        p.nuvem ? h('label', { class: 'ck' }, jur, ' Confirmo que o uso deste provedor foi aprovado pelo jurídico') : null,
        h('label', { class: 'ck' }, lig, ' Ligado'),
        p.origemChave === 'painel' ? h('p', { class: 'peq' }, h('a', { href: '#', onclick: async (ev) => { ev.preventDefault(); if (await confirmar('Remover a chave?', 'A chave cifrada é apagada do servidor e o provedor deixa de funcionar.', 'Remover', true)) { try { await api('PUT', '/api/gestao/ia/' + p.provedor, { removerChave: true, ativo: false }); document.querySelector('dialog') && document.querySelector('dialog').close(); ia(); } catch (x) { toast(x.message, true); } } } }, 'Remover a chave guardada')) : null);
      const r = await janela('Configurar ' + p.provedor, corpo, [{ rotulo: 'Cancelar', valor: null, sec: true }, { rotulo: 'Salvar', valor: 'ok' }]);
      if (r !== 'ok') return;
      const dados = { ativo: lig.checked, modelo: modelo.value, url: url.value };
      if (chave.value.trim()) dados.chave = chave.value.trim();
      if (p.nuvem) dados.juridico = jur.checked;
      try { await api('PUT', '/api/gestao/ia/' + p.provedor, dados); toast('Configuração salva.'); } catch (x) { toast(x.message, true); }
      ia();
    };
    montar(cabecalho('ia'),
      aviso('atencao', h('strong', null, 'Atenção. '), e.avisoJuridico),
      e.segredoConfigurado ? null : aviso('erro', h('strong', null, 'Chaves não podem ser guardadas ainda. '), 'Defina CTAI_SEGREDO (mínimo de 16 caracteres) no .env do servidor e reinicie. Sem isso a tela só mostra o estado dos provedores.'),
      h('p', { class: 'mudo' }, 'Todos os provedores começam desligados. A análise por regras locais funciona sempre, sem internet e sem chave. Em nuvem, sai somente texto mascarado.'),
      e.provedores.map(cartao));
  }

  async function aba() {
    const h2 = location.hash.replace(/^#\/gestao\/?/, '');
    if (!F.lista) { try { F.lista = (await api('GET', '/api/gestao/painel?trimestre=' + (F.trimestre || ''))).trimestres; } catch (_) { F.lista = []; } }
    if (h2 === 'producao') return producao();
    if (h2 === 'carteira') return carteira();
    if (h2 === 'usuarios') return usuarios();
    if (h2 === 'ia') return ia();
    return painel();
  }

  window.CTAI_GESTAO = { rotas: [['/gestao', aba], ['/gestao/:aba', aba]] };
})();
