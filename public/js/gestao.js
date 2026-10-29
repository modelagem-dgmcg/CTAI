(function () {
  'use strict';
  // Gestão: painel da superintendente, produção, carteira, usuários e IA. Só superintendente e administrador.
  const { h, api, fmt, toast, janela, confirmar, selo, aviso, tabela, montar } = window.CTAI;
  const ABAS = [['', 'Painel'], ['producao', 'Produção'], ['carteira', 'Carteira'], ['entregas', 'Entregas por carteira'], ['completude', 'Completude'], ['importar', 'Importar'], ['contratos', 'Contratos e TAs'], ['usuarios', 'Usuários'], ['acessos', 'Acessos'], ['ia', 'IA']];
  const kpi = (r, v, nota, tom) => h('div', { class: 'kpi' + (tom ? ' ' + tom : '') }, h('div', { class: 'r' }, r), h('div', { class: 'num-grande' }, String(v)), nota ? h('div', { class: 'r' }, nota) : null);
  const F = { trimestre: '', contrato: '', usuario_id: '' }; // filtros lembrados enquanto a página está aberta
  const qs = (o) => { const p = new URLSearchParams(); for (const k of Object.keys(o)) if (o[k]) p.set(k, o[k]); const s = p.toString(); return s ? '?' + s : ''; };
  const dataBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
  const n1 = (v) => (v === null || v === undefined ? '—' : String(v).replace('.', ','));

  const tomPrazo = (s) => (['vencido', 'entregue com atraso'].includes(s) ? 'alta' : (s === 'a vencer' ? 'atencao' : (s === 'entregue no prazo' ? 'ok' : '')));
  const seloPz = (rot, p) => (p ? h('span', { class: 'selo ' + tomPrazo(p.situacao), title: 'Prazo ' + dataBr(p.prazo) + (p.entregue_em ? ' · entregue em ' + dataBr(p.entregue_em) : '') }, rot + ' ' + p.situacao + (['vencido', 'entregue com atraso', 'a vencer'].includes(p.situacao) ? ' (' + p.dias + ' d)' : '')) : '—');
  const tomEnvio = { recebido: 'ok', incompleto: 'atencao', pendente: 'alta' };

  function cabecalho(aba) {
    return [h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Gestão'), h('p', null, 'Equipe, carteira de unidades, IA e acompanhamento da superintendência. Só a superintendente e o administrador veem esta área.'))),
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
    const linhaAlertas = p.alertas.length ? h('ul', { class: 'alertas' }, p.alertas.filter((a) => a.tipo !== 'sem gestor').slice(0, 14).map((a) => h('li', { class: a.nivel }, h('span', { class: 'selo ' + (a.nivel === 'alta' ? 'alta' : (a.nivel === 'atencao' ? 'atencao' : '')) }, a.tipo), ' ', h('strong', null, a.unidade), ' · ', a.texto)))
      : h('p', { class: 'mudo' }, 'Nenhum alerta no momento.');
    const maxRec = Math.max(1, ...p.recorrentes.map((r) => r.divergencias));
    montar(cabecalho(''), filtros,
      h('div', { class: 'kpis' },
        kpi('Unidades', k.unidades, k.competencias + ' competência(s) em ' + p.trimestre),
        kpi('Envios recebidos', k.recebidos, 'completos'), kpi('Incompletos', k.incompletos, 'itens pendentes', k.incompletos ? 'atencao' : ''), kpi('Pendentes', k.pendentes, 'sem envio recebido', k.pendentes ? 'atencao' : ''),
        kpi('Prazos vencidos', prz.vencido, prz.a_vencer + ' a vencer · ' + prz.atraso + ' com atraso', prz.vencido ? 'alta' : ''),
        kpi('Achados abertos', k.achados_abertos, k.achados_vencidos + ' vencido(s)', k.achados_vencidos ? 'alta' : ''),
        kpi('Pareceres', k.pareceres_rascunho + ' / ' + k.pareceres_congelados, 'rascunho / congelados'),
        kpi('Sem carteira', k.sem_carteira, 'unidades', k.sem_carteira ? 'atencao' : ''),
        kpi('Perguntas de contrato', (p.perguntas_contrato || {}).abertas || 0, 'abertas de ' + ((p.perguntas_contrato || {}).total || 0), ((p.perguntas_contrato || {}).abertas || 0) ? 'atencao' : '')),
      h('div', { class: 'cartao' }, h('h2', { style: 'margin-top:0' }, 'Alertas'), linhaAlertas),
      (p.perguntas_contrato && p.perguntas_contrato.total) ? h('div', { class: 'cartao', id: 'painel-perguntas' }, h('h2', { style: 'margin-top:0' }, 'Perguntas de contrato por analista'),
        h('p', { class: 'mudo peq' }, 'Dúvidas sobre valor, instrumento vigente e documentos que cada analista responde ao entrar na unidade.'),
        tabela([{ t: 'Analista' }, { t: 'Abertas', n: true }, { t: 'Total', n: true }], p.perguntas_contrato.porAnalista.map((a) => [a.nome, a.abertas ? selo(String(a.abertas), 'atencao') : selo('0', 'ok'), a.total]))) : null,
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
        tabela([{ t: 'Funcionário' }, { t: 'Itens', n: true }, { t: 'Diverg.', n: true }, { t: 'Achados enc./resp./desc.' }, { t: 'Minutas cri./cong.' }, { t: 'Receb. → conferido' }, { t: 'Até 1ª leitura' }, { t: 'Até tratar' }, { t: 'Carga atual' }],
          p.funcionarios.map((f) => [h('div', null, h('strong', null, f.nome), h('div', { class: 'r mudo peq' }, f.perfil)), f.itens_conferidos, f.divergencias_tratadas,
            f.achados.encaminhados + ' / ' + f.achados.respondidos + ' / ' + f.achados.descartados, f.minutas.criadas + ' / ' + f.minutas.congeladas,
            f.tempo_medio ? n1(f.tempo_medio.dias) + ' d (' + f.tempo_medio.amostra + ')' : '—',
            f.caixa && f.caixa.horas_ate_leitura !== null ? n1(f.caixa.horas_ate_leitura) + ' h (' + f.caixa.lidos + ')' : '—', f.caixa && f.caixa.horas_ate_tratamento !== null ? n1(f.caixa.horas_ate_tratamento) + ' h (' + f.caixa.tratados_por_mim + ')' : '—',
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
      h('p', null, h('a', { href: '#/gestao/importar', class: 'btn sec', id: 'ir-importar' }, 'Importar unidades e carteira de um arquivo CSV')),
      h('div', { class: 'cartao' }, h('div', { class: 'linha espaco' }, h('h2', { style: 'margin:0' }, 'Quem acompanha cada unidade'),
        h('label', { class: 'ck' }, h('input', Object.assign({ type: 'checkbox', id: 'cart-estrito', onchange: async (e) => { try { await api('PUT', '/api/gestao/carteira-modo', { estrita: e.target.checked }); toast(e.target.checked ? 'Modo estrito ligado.' : 'Modo estrito desligado.'); carteira(); } catch (x) { toast(x.message, true); } } }, c.estrita ? { checked: true } : {})), ' Modo estrito (sem carteira = não vê nada)')),
        tabela([{ t: 'Funcionário' }, { t: 'Perfil' }, { t: 'Unidades da carteira' }, { t: '' }], c.funcionarios.map((f) => [h('strong', null, f.nome), f.perfil, f.unidades.length ? f.unidades.map((id) => { const u = c.unidades.find((x) => x.contrato_id === id); return h('span', { class: 'selo', style: 'margin-right:4px' }, u ? u.unidade : id); }) : h('span', { class: 'mudo' }, f.ativo ? 'vê todas (sem carteira)' : 'desativado'), h('button', { class: 'sec', id: 'cart-ed-' + f.login, onclick: () => editar(f) }, 'Editar carteira')]))),
      h('div', { class: 'cartao' }, h('h3', null, 'Unidades'), tabela([{ t: 'Unidade' }, { t: 'Responsáveis' }, { t: 'Situação' }], c.unidades.map((u) => [u.unidade + (u.municipio ? ' · ' + u.municipio : '') + (u.demo ? ' (demonstração)' : ''), u.responsaveis.length ? u.responsaveis.map((r) => r.nome).join(', ') : selo('sem carteira', 'atencao'), null]))),
      h('div', { class: 'cartao' }, h('h3', null, 'Histórico de mudanças'), tabela([{ t: 'Funcionário' }, { t: 'Unidade' }, { t: 'Entrou' }, { t: 'Saiu' }, { t: 'Por' }],
        hist.historico.slice(0, 40).map((x) => [x.nome, x.unidade || x.contrato_id, fmt.data(x.desde), x.ate ? fmt.data(x.ate) : h('span', { class: 'selo ok' }, 'ativa'), x.ate ? (x.removido_por || '') : (x.atribuido_por || '')]), { vazio: 'Nenhuma atribuição ainda.' })));
  }

  // ---------- Usuários ----------
  async function usuarios() {
    const u = await api('GET', '/api/gestao/usuarios');
    const editar = async (x) => {
      const nome = h('input', { type: 'text', id: 'eu-n', value: x.nome });
      const perfil = h('select', { id: 'eu-p' }, Object.entries(u.perfis).map(([k, r]) => h('option', Object.assign({ value: k }, k === x.perfil ? { selected: true } : {}), r)));
      const funcao = h('select', { id: 'eu-f' }, [['', '— nenhuma —'], ['Coordenador(a)', 'Coordenador(a)']].map(([v, r]) => h('option', Object.assign({ value: v }, v === (x.funcao || '') ? { selected: true } : {}), r)));
      const contrato = h('select', { id: 'eu-c' }, [h('option', { value: '' }, '— nenhum —')].concat(u.contratos.map((c) => h('option', Object.assign({ value: c.contrato_id }, c.contrato_id === x.contrato_id ? { selected: true } : {}), c.unidade))));
      const r = await janela('Editar ' + x.login, h('div', null, h('div', { class: 'campo' }, h('label', { for: 'eu-n' }, 'Nome'), nome), h('div', { class: 'campo' }, h('label', { for: 'eu-p' }, 'Perfil'), perfil), h('div', { class: 'campo' }, h('label', { for: 'eu-f' }, 'Função (só Superintendente; mesmas permissões)'), funcao), h('div', { class: 'campo' }, h('label', { for: 'eu-c' }, 'Unidade (usuários de unidade)'), contrato)), [{ rotulo: 'Cancelar', valor: null, sec: true }, { rotulo: 'Salvar', valor: 'ok' }]);
      if (r !== 'ok') return;
      try { await api('PATCH', '/api/gestao/usuarios/' + x.usuario_id, { nome: nome.value, perfil: perfil.value, funcao: perfil.value === 'superintendente' ? funcao.value : '', contrato_id: contrato.value || null }); toast('Usuário atualizado.'); usuarios(); } catch (e) { toast(e.message, true); }
    };
    montar(cabecalho('usuarios'),
      h('div', { class: 'cartao' }, h('h2', { style: 'margin-top:0' }, 'Pessoas com acesso'),
        tabela([{ t: 'Login' }, { t: 'Nome' }, { t: 'Perfil' }, { t: 'Unidades' }, { t: 'Situação' }, { t: '' }], u.usuarios.map((x) => [x.login, x.nome, u.perfis[x.perfil], x.unidades ? (x.unidades.length ? x.unidades.length + ' unidade(s)' : 'sem carteira') : (x.contrato_id || '—'), x.ativo ? (x.trocar_senha ? selo('senha temporária', 'atencao') : selo('ativo', 'ok')) : selo('desativado', 'alta'),
          h('div', { class: 'linha' }, h('button', { class: 'leve', onclick: () => editar(x) }, 'Editar'),
            h('button', { class: 'leve', onclick: async () => { if (await confirmar('Definir senha temporária para ' + x.login + '?', 'A pessoa precisa trocar a senha no próximo acesso e as sessões abertas são encerradas.', 'Definir')) { try { const o = await api('POST', '/api/gestao/usuarios/' + x.usuario_id + '/senha', {}); toast('Senha temporária: ' + (o.senhaTemporaria || '(definida)')); usuarios(); } catch (e) { toast(e.message, true); } } } }, 'Trocar senha'),
            h('button', { class: 'leve', onclick: async () => { try { await api('POST', '/api/gestao/usuarios/' + x.usuario_id + '/ativo', { ativo: !x.ativo }); usuarios(); } catch (e) { toast(e.message, true); } } }, x.ativo ? 'Desativar' : 'Ativar'))]))),
      window.CTAI_USUARIO_FORM({ perfis: u.perfis, contratos: u.contratos, setores: u.setores, endpoint: '/api/gestao/usuarios', aoCriar: usuarios }),
      h('p', { class: 'mudo peq' }, 'Tudo fica registrado na trilha. O sistema nunca guarda senha do SEI.'));
  }

  // ---------- Acessos (somente leitura) ----------
  const EV_TOM = { entrada: 'ok', saida: '', falha: 'atencao', bloqueio: 'alta', cadastro: '' };
  const EV_ROT = { entrada: 'entrada', saida: 'saída', falha: 'falha', bloqueio: 'bloqueio', cadastro: 'cadastro (gestor)' };
  async function acessos() {
    F.ac = F.ac || { de: '', ate: '', contrato: '', usuario: '', evento: '', origem: '' };
    const r = await api('GET', '/api/gestao/acessos' + qs(F.ac));
    const c = r.contagens;
    const campo = (id, rot, tipo, chave) => h('div', { class: 'campo filtro' }, h('label', { for: id }, rot), h('input', { type: tipo, id, value: F.ac[chave], onchange: (e) => { F.ac[chave] = e.target.value; acessos(); } }));
    montar(cabecalho('acessos'),
      aviso('info', h('strong', null, 'Registro somente de leitura. '), 'Cada linha aponta para um evento da trilha encadeada e não pode ser alterada nem apagada. O IP aparece com o último trecho oculto. Trilha: ' + (r.trilha.ok ? 'íntegra.' : 'COM FALHAS.')),
      h('div', { class: 'filtros cartao' },
        campo('ga-de', 'De', 'date', 'de'), campo('ga-ate', 'Até', 'date', 'ate'),
        seletor('ga-un', 'Unidade', [['', 'Todas']].concat(r.contratos.map((u) => [u.contrato_id, u.unidade])), F.ac.contrato, (v) => { F.ac.contrato = v; acessos(); }),
        campo('ga-us', 'Usuário', 'text', 'usuario'),
        seletor('ga-ev', 'Evento', [['', 'Todos']].concat(r.eventos.map((v) => [v, EV_ROT[v]])), F.ac.evento, (v) => { F.ac.evento = v; acessos(); }),
        seletor('ga-or', 'Origem', [['', 'Todas'], ['interna', 'Rede interna'], ['externa', 'Externa']], F.ac.origem, (v) => { F.ac.origem = v; acessos(); }),
        h('div', { class: 'linha', style: 'margin-left:auto' }, h('a', { class: 'btn sec', id: 'ga-csv', href: '/api/gestao/acessos.csv' + qs(F.ac) }, 'Exportar CSV'), h('a', { class: 'btn', id: 'ga-pdf', href: '/api/gestao/acessos.pdf' + qs(F.ac), target: '_blank', rel: 'noopener' }, 'Exportar PDF'))),
      h('div', { class: 'kpis' }, kpi('Entradas', c.entrada), kpi('Tentativas falhas', c.falha, 'senha errada ou usuário inexistente', c.falha ? 'atencao' : ''), kpi('Bloqueios', c.bloqueio, '5 erros = 10 minutos', c.bloqueio ? 'alta' : ''),
        kpi('Saídas', c.saida), kpi('Cadastros por gestores', c.cadastro, 'equipe das unidades'), kpi('Origem externa', c.externas, 'pelo túnel / host público', c.externas ? 'atencao' : '')),
      r.falhasPorLogin.length ? h('p', { class: 'mudo peq' }, 'Mais falhas: ' + r.falhasPorLogin.map((x) => (x.login || '—') + ' (' + x.n + ')').join(' · ')) : null,
      h('div', { class: 'cartao' }, tabela([{ t: 'Quando' }, { t: 'Evento' }, { t: 'Usuário' }, { t: 'Perfil' }, { t: 'Unidade' }, { t: 'Origem' }, { t: 'Detalhe' }],
        r.linhas.map((l) => [new Date(l.data_hora).toLocaleString('pt-BR', { timeZone: 'America/Recife' }), selo(EV_ROT[l.evento] || l.evento, EV_TOM[l.evento] || ''), l.login || '—', l.perfil ? ((window.__PERFIS && window.__PERFIS[l.perfil]) || l.perfil) : '—', l.unidade || '—',
          h('span', { title: l.agente || '' }, selo(l.origem || '—', l.origem === 'externa' ? 'atencao' : ''), l.ip ? ' ' + l.ip : ''), l.detalhe || '']), { vazio: 'Nenhum registro para esse filtro.' }),
        r.linhas.length >= 200 ? h('p', { class: 'mudo peq' }, 'Mostrando os 200 mais recentes. O CSV traz até 5.000.') : null));
  }

  // ---------- IA ----------
  // O rack de chaves é o mesmo da Administração (public/js/rack-ia.js).
  async function ia() {
    montar(cabecalho('ia'), window.CTAI_RACK_IA());
  }

  // ---------- Perguntas de contrato para as analistas (CSV com prévia) ----------
  const PQ = { csv: '', nome: '', previa: null, ultimo: null, dados: null };
  const pqSlot = h('div', { id: 'pq-slot' });
  async function pqCarregar() { try { PQ.dados = await api('GET', '/api/gestao/perguntas-contrato'); } catch (_) { PQ.dados = { contagem: { total: 0, abertas: 0, porAnalista: [] }, perguntas: [] }; } pqDesenhar(); }
  function pqDesenhar() {
    const p = PQ.previa, d = PQ.dados || { contagem: { total: 0, abertas: 0, porAnalista: [] }, perguntas: [] }; const b = [];
    const arq = h('input', { type: 'file', id: 'pq-arquivo', accept: '.csv,text/csv,text/plain', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; PQ.csv = await f.text(); PQ.nome = f.name; PQ.ultimo = null;
      try { PQ.previa = await api('POST', '/api/gestao/perguntas-contrato/previa', { csv: PQ.csv }); } catch (er) { PQ.previa = null; toast(er.message, true); } pqDesenhar(); } });
    b.push(h('div', { class: 'campo' }, h('label', { for: 'pq-arquivo' }, 'Arquivo CSV de perguntas'), arq, PQ.nome ? h('span', { class: 'mudo peq' }, PQ.nome) : null));
    if (PQ.ultimo) b.push(aviso('ok', h('strong', null, 'Gravado. '), PQ.ultimo.novas + ' pergunta(s) nova(s), ' + PQ.ultimo.atualizadas + ' atualizada(s). As respostas já dadas foram mantidas.'));
    if (p) {
      const r = p.resumo;
      b.push(h('div', { class: 'kpis' }, kpi('Perguntas', r.linhas, 'de ' + r.unidades + ' unidade(s)'), kpi('Novas', r.novas, ''), kpi('Já existem', r.atualizadas, r.comResposta + ' com resposta (mantidas)')));
      if (p.naoCasadas.length) b.push(aviso('atencao', h('strong', null, 'Unidade fora do sistema (ignoradas): '), p.naoCasadas.map((x) => x.nome + ' (' + x.linhas + ')').join('; ') + '.'));
      if (p.analistasInexistentes.length) b.push(aviso('atencao', h('strong', null, 'Analista não encontrada: '), p.analistasInexistentes.join(', ') + '. As perguntas entram, mas sem dona.'));
      if (p.invalidas.length) b.push(aviso('atencao', h('strong', null, 'Linhas ignoradas: '), p.invalidas.map((x) => x.unidade + ' (' + x.motivo + ')').join('; ') + '.'));
      b.push(tabela([{ t: 'Analista' }, { t: 'Perguntas', n: true }], p.porAnalista.map((a) => [a.login, a.perguntas])));
      b.push(h('div', { class: 'linha' }, h('button', { id: 'pq-gravar', disabled: !p.podeGravar, onclick: async () => { try { PQ.ultimo = await api('POST', '/api/gestao/perguntas-contrato/gravar', { csv: PQ.csv }); PQ.csv = ''; PQ.nome = ''; PQ.previa = null; toast('Perguntas gravadas.'); pqCarregar(); } catch (er) { toast(er.message, true); } } }, 'Gravar perguntas'), h('span', { class: 'mudo peq' }, 'Nada é gravado antes deste clique. Respostas já dadas não são apagadas.')));
    }
    if (d.contagem.total) {
      b.push(h('h4', { style: 'margin:14px 0 4px' }, 'Abertas por analista'));
      b.push(tabela([{ t: 'Analista' }, { t: 'Abertas', n: true }, { t: 'Total', n: true }], d.contagem.porAnalista.map((a) => [a.nome, a.abertas, a.total])));
      const resp = d.perguntas.filter((x) => (x.tipo === 'decisao' && x.resposta) || (x.tipo === 'documento' && x.anexo_ok));
      b.push(h('details', { style: 'margin-top:10px' }, h('summary', null, 'Respostas recebidas (' + resp.length + ')'),
        resp.length ? tabela([{ t: 'Unidade' }, { t: 'Pergunta' }, { t: 'Resposta' }, { t: 'Quem' }], resp.map((x) => [x.unidade, x.pergunta, (x.tipo === 'decisao' ? x.resposta : 'Documento anexado') + (x.observacao ? ' · ' + x.observacao : ''), x.respondida_por || '—'])) : h('p', { class: 'mudo peq' }, 'Ainda não há respostas.')));
    }
    pqSlot.replaceChildren(h('div', { class: 'cartao' }, h('h3', { style: 'margin-top:0' }, 'Perguntas de contrato para as analistas'),
      h('p', { class: 'mudo peq' }, 'Cada analista vê, na página da unidade da sua carteira, o cartão "Antes do parecer: confirme o contrato". A resposta só registra a decisão; não muda regra nem valor sozinha.'), b));
  }
  function perguntasContrato() { pqCarregar(); return pqSlot; }

  // ---------- Contratos e termos aditivos (CSV da planilha da DGMCG) ----------
  const CT = { csv: '', nome: '', previa: null, ultimo: null };
  async function contratosTas() {
    const lista = await api('GET', '/api/gestao/registro-contratos').catch(() => ({ unidades: [] }));
    const ref = async () => { if (!CT.csv) { CT.previa = null; return desenhar(); } try { CT.previa = await api('POST', '/api/gestao/registro-contratos/previa', { csv: CT.csv }); } catch (e) { CT.previa = null; toast(e.message, true); } desenhar(); };
    const arquivo = h('input', { type: 'file', id: 'ct-arquivo', accept: '.csv,text/csv,text/plain', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; CT.csv = await f.text(); CT.nome = f.name; CT.ultimo = null; ref(); } });
    const gravar = async () => { try { CT.ultimo = await api('POST', '/api/gestao/registro-contratos/gravar', { csv: CT.csv }); CT.csv = ''; CT.previa = null; toast('Registro gravado.'); contratosTas(); } catch (e) { toast(e.message, true); } };
    function desenhar() {
      const p = CT.previa; const blocos = [];
      if (CT.ultimo) blocos.push(aviso('ok', h('strong', null, 'Gravado. '), CT.ultimo.novos + ' nova(s), ' + CT.ultimo.atualizados + ' atualizada(s), ' + CT.ultimo.mantidos + ' já conferida(s) mantida(s).'));
      if (p) {
        const r = p.resumo;
        blocos.push(h('div', { class: 'kpis' }, kpi('Linhas', r.linhas, 'de ' + r.unidades + ' unidade(s)'), kpi('Novas', r.novos, ''), kpi('Atualizam', r.atualizados, ''), kpi('Conferidas (mantidas)', r.mantidos, 'não são alteradas')));
        if (p.naoCasadas.length) blocos.push(aviso('atencao', h('strong', null, 'Fora do sistema (ignoradas): '), p.naoCasadas.map((x) => x.nome + ' (' + x.linhas + ')').join('; ') + '.'));
        blocos.push(h('div', { class: 'cartao' }, h('h3', null, 'Unidades do arquivo'), tabela([{ t: 'Unidade' }, { t: 'Contratos', n: true }, { t: 'Aditivos', n: true }, { t: 'Apostilamentos', n: true }, { t: 'Novas', n: true }, { t: 'Atualizam', n: true }, { t: 'Mantidas', n: true }], p.unidades.map((u) => [u.unidade, u.contratos, u.aditivos, u.apostilamentos, u.novos, u.atualizados, u.mantidos]))));
        blocos.push(h('div', { class: 'linha' }, h('button', { id: 'ct-gravar', onclick: gravar, disabled: !p.podeGravar }, 'Gravar registro'), h('span', { class: 'mudo peq' }, 'Tudo é gravado de uma vez. O que a analista já conferiu não é alterado.')));
      }
      blocos.push(h('div', { class: 'cartao' }, h('h3', null, 'Como está hoje'), tabela([{ t: 'Unidade' }, { t: 'Contrato' }, { t: 'Aditivos', n: true }, { t: 'Vigência até' }, { t: 'Situação' }],
        lista.unidades.map((u) => [u.unidade, u.registro ? u.registro.contrato.numero + (u.registro.contrato.oss ? ' · ' + u.registro.contrato.oss : '') : '—', u.registro ? u.registro.contagem.aditivos : '—', u.registro && u.registro.vigencia_fim ? u.registro.vigencia_fim.split('-').reverse().join('/') : '—', u.registro ? (u.registro.conferido ? selo('conferido', 'ok') : selo('a conferir', 'atencao')) : selo('sem registro', '')]))));
      blocos.push(perguntasContrato());
      montar(cabecalho('contratos'), aviso('info', h('strong', null, 'Contratos e termos aditivos. '), 'Carregue o CSV gerado a partir da planilha "CONTRATOS E T.A.s OSS". Ele traz o contrato vigente, aditivos, apostilamentos e a vigência de cada unidade. Não traz metas nem valores. Nada é gravado antes de você conferir a prévia.'),
        h('div', { class: 'cartao' }, h('div', { class: 'campo' }, h('label', { for: 'ct-arquivo' }, 'Arquivo CSV'), arquivo, CT.nome ? h('span', { class: 'mudo peq' }, CT.nome) : null)), blocos);
    }
    desenhar();
  }

  // ---------- Importar unidades e carteira (CSV) ----------
  const E = { csv: '', nomeArquivo: '', modo: 'acrescentar', ignorar: false, decisoes: { conflitos: {}, analistas: {} }, previa: null, ultimo: null };
  const ROT_TIPO = { UPA: 'UPA', UPAE: 'UPAE', HOSPITAL: 'Hospital' };
  async function importar() {
    const ref = async () => {
      if (!E.csv) { E.previa = null; return desenhar(); }
      try { E.previa = await api('POST', '/api/gestao/carteira/importar/previa', { csv: E.csv, modo: E.modo, ignorarErros: E.ignorar, decisoes: E.decisoes }); } catch (e) { E.previa = null; toast(e.message, true); }
      desenhar();
    };
    const hist = await api('GET', '/api/gestao/carteira/importar/historico').catch(() => ({ importacoes: [] }));
    const arquivo = h('input', { type: 'file', id: 'imp-arquivo', accept: '.csv,text/csv,text/plain', onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      E.csv = await f.text(); E.nomeArquivo = f.name; E.decisoes = { conflitos: {}, analistas: {} }; E.ultimo = null; ref();
    } });
    function desenhar() {
      const p = E.previa;
      const modo = h('select', { id: 'imp-modo', onchange: (e) => { E.modo = e.target.value; ref(); } },
        [['acrescentar', 'Acrescentar às carteiras'], ['substituir', 'Substituir a carteira de quem está no arquivo']].map(([v, t]) => h('option', Object.assign({ value: v }, E.modo === v ? { selected: true } : {}), t)));
      const ign = h('input', Object.assign({ type: 'checkbox', id: 'imp-ignorar', onchange: (e) => { E.ignorar = e.target.checked; ref(); } }, E.ignorar ? { checked: true } : {}));
      const blocos = [];
      if (p) {
        const r = p.resumo;
        blocos.push(h('div', { class: 'kpis' }, kpi('Linhas', r.linhas, r.vazias + ' em branco'), kpi('Unidades', r.unidades, r.novas + ' nova(s) · ' + r.jaExistiam + ' já cadastrada(s)'),
          kpi('Entram na carteira', r.entradas, r.saidas + ' saem'), kpi('Com erro', r.comErro, E.ignorar ? 'serão ignoradas' : 'impedem gravar', r.comErro ? 'alta' : ''), kpi('Sem analista', r.semAnalista, 'ficam sem carteira', r.semAnalista ? 'atencao' : '')));
        blocos.push(h('div', { class: 'cartao' }, h('h3', null, 'Por tipo e por analista'),
          h('p', null, ['UPA', 'UPAE', 'HOSPITAL'].map((t) => h('span', { class: 'selo', style: 'margin-right:6px' }, ROT_TIPO[t] + ': ' + p.porTipo[t]))),
          tabela([{ t: 'Analista' }, { t: 'UPA', n: true }, { t: 'UPAE', n: true }, { t: 'Hospital', n: true }, { t: 'Total', n: true }, { t: '' }], p.porAnalista.map((a) => [a.nome, a.UPA, a.UPAE, a.HOSPITAL, h('strong', null, a.total), a.novo ? selo('novo usuário', 'atencao') : '']), { vazio: 'Nenhuma atribuição.' })));
        if (p.analistas.some((a) => a.situacao !== 'existe')) {
          blocos.push(h('div', { class: 'cartao', id: 'imp-analistas' }, h('h3', null, 'Analistas que não puderam ser encontrados'),
            p.analistas.filter((a) => a.situacao !== 'existe').map((a) => a.situacao === 'nao_existe'
              ? h('div', { class: 'linha' }, h('strong', null, a.valor), h('span', { class: 'mudo peq' }, 'não existe · login proposto ' + a.loginProposto), h('select', { 'aria-label': 'Decisão para ' + a.valor, class: 'imp-dec-analista', onchange: (e) => { E.decisoes.analistas[a.valor] = e.target.value; ref(); } },
                [['', 'Decidir…'], ['criar', 'Criar usuário (criador, senha temporária)'], ['pular', 'Pular este analista']].map(([v, t]) => h('option', Object.assign({ value: v }, (a.decisao || '') === v ? { selected: true } : {}), t))))
              : h('div', { class: 'linha' }, h('strong', null, a.valor), selo(a.problema, 'alta')))));
        }
        if (p.conflitos.length) {
          blocos.push(h('div', { class: 'cartao', id: 'imp-conflitos' }, h('h3', null, 'Unidade em mais de uma carteira'),
            h('p', { class: 'mudo peq' }, 'Escolha entre dividir (todos ficam como responsáveis) ou manter só um responsável.'),
            p.conflitos.map((c) => h('div', { class: 'linha' }, h('strong', null, c.unidade), h('span', { class: 'mudo peq' }, 'hoje/arquivo: ' + [...new Set(c.atuais.concat(c.novos))].join(', ')),
              h('select', { 'aria-label': 'Decisão para ' + c.unidade, class: 'imp-dec-conflito', onchange: (e) => { E.decisoes.conflitos[c.key] = e.target.value; ref(); } },
                [['', 'Decidir…']].concat(c.opcoes.map((o) => [o, o === 'dividir' ? 'Dividir (co-responsáveis)' : 'Manter só ' + o])).map(([v, t]) => h('option', Object.assign({ value: v }, (c.decisao || '') === v ? { selected: true } : {}), t)))))));
        }
        if (p.erros.length || p.avisos.length) {
          blocos.push(h('div', { class: 'cartao' }, h('h3', null, 'Relatório de problemas'),
            p.erros.length ? tabela([{ t: 'Linha', n: true }, { t: 'Erro' }], p.erros.map((e) => [e.linha, e.motivo])) : null,
            p.avisos.length ? tabela([{ t: 'Linha', n: true }, { t: 'Aviso' }], p.avisos.map((e) => [e.linha, e.motivo])) : null));
        }
        blocos.push(h('div', { class: 'cartao' }, h('h3', null, 'Unidades do arquivo'),
          tabela([{ t: 'Unidade' }, { t: 'Município' }, { t: 'Situação' }, { t: 'Responsáveis' }], p.unidades.map((u) => [u.unidade, u.municipio || '—', u.existente ? selo('já cadastrada', 'ok') : selo('nova', 'atencao'), u.conflito ? selo('decidir', 'alta') : (u.analistas.join(', ') || '—')]))));
        const pend = p.pendencias.filter((x) => !x.bloqueia).length;
        blocos.push(h('div', { class: 'linha' }, h('button', Object.assign({ id: 'imp-gravar', onclick: gravar }, p.podeGravar ? {} : { disabled: true }), 'Gravar importação'),
          h('span', { class: 'mudo peq' }, p.podeGravar ? 'Tudo será gravado de uma vez (ou nada).' : (p.pendencias.some((x) => x.bloqueia) ? 'Corrija os analistas indicados no arquivo.' : (pend ? 'Faltam ' + pend + ' decisão(ões).' : (p.resumo.comErro ? 'Corrija as linhas com erro ou marque "ignorar linhas com erro".' : 'Nada para gravar.'))))));
      }
      if (E.ultimo) {
        const u = E.ultimo;
        blocos.unshift(aviso('ok', h('strong', null, 'Importação #' + u.importacao_id + ' gravada. '), u.unidades_novas + ' unidade(s) criada(s), ' + u.entradas + ' entrada(s) e ' + u.saidas + ' saída(s) de carteira' + (u.analistas_criados ? ', ' + u.analistas_criados + ' usuário(s) criado(s) com a senha temporária ' + u.senhaTemporaria : '') + '.'));
      }
      montar(cabecalho('importar'),
        aviso('info', h('strong', null, 'Como funciona. '), 'Carregue um CSV (UTF-8, separado por ; ou ,) com as colunas tipo (UPA, UPAE ou Hospital), unidade, municipio (opcional) e analista (login ou nome; vários separados por |). A unidade é identificada por tipo + nome + município. Nada é gravado antes de você conferir a prévia.'),
        h('div', { class: 'cartao' },
          h('div', { class: 'linha' }, h('a', { href: '/api/gestao/carteira/importar/modelo.csv', download: 'modelo-importacao-carteira.csv', class: 'btn sec', id: 'imp-modelo' }, 'Baixar modelo em branco'), h('a', { href: '/api/gestao/carteira/importar/atual.csv', download: 'carteira-atual.csv', class: 'btn sec', id: 'imp-atual', style: 'margin-left:8px' }, 'Baixar a carteira de hoje')),
          h('div', { class: 'campo' }, h('label', { for: 'imp-arquivo' }, 'Arquivo CSV'), arquivo, E.nomeArquivo ? h('span', { class: 'mudo peq' }, E.nomeArquivo) : null),
          h('div', { class: 'campo' }, h('label', { for: 'imp-modo' }, 'Modo'), modo),
          h('label', { class: 'ck' }, ign, ' Ignorar linhas com erro (grava só as boas)')),
        blocos,
        h('div', { class: 'cartao' }, h('h3', null, 'Importações anteriores'), tabela([{ t: 'Nº', n: true }, { t: 'Quando' }, { t: 'Por' }, { t: 'Modo' }, { t: 'Resultado' }],
          hist.importacoes.map((i) => [i.importacao_id, fmt.data(i.em), i.quem, i.modo, i.resumo ? (i.resumo.unidades_novas + ' nova(s), ' + i.resumo.entradas + ' entrada(s), ' + i.resumo.saidas + ' saída(s)') : '—']), { vazio: 'Nenhuma importação ainda.' })));
      const el = document.getElementById('imp-arquivo'); void el;
    }
    async function gravar() {
      try {
        const u = await api('POST', '/api/gestao/carteira/importar/gravar', { csv: E.csv, modo: E.modo, ignorarErros: E.ignorar, decisoes: E.decisoes });
        E.ultimo = u; E.csv = ''; E.nomeArquivo = ''; E.previa = null; E.decisoes = { conflitos: {}, analistas: {} };
        toast('Importação gravada.'); importar();
      } catch (e) { toast(e.message, true); }
    }
    desenhar();
  }

  // ---------- Entregas por carteira ----------
  async function entregas() {
    const d = await api('GET', '/api/gestao/entregas' + qs({ contrato: F.contrato, usuario_id: F.usuario_id }));
    const c = await api('GET', '/api/gestao/carteira');
    const linha = (e) => [e.unidade, (e.competencia_id || '').split('-').reverse().join('/') + ' v' + e.versao, fmt.data(e.recebido_em),
      e.caixa.length ? e.caixa.map((x) => x.nome + (x.em_substituicao_de ? ' (em substituição de ' + x.em_substituicao_de + ')' : '')).join(', ') : h('span', { class: 'mudo' }, 'sem registro na caixa'),
      e.lido ? fmt.data(e.lido_em) : (e.destaque ? selo('não lido há ' + e.pendente_dias + ' d', 'alta') : selo('não lido', 'atencao')),
      e.tratado ? e.tratado_por + ' · ' + fmt.data(e.tratado_em) : (e.pendente_dias === null ? '—' : selo('pendente há ' + e.pendente_dias + ' d', e.pendente_dias >= d.dias_nao_lido ? 'atencao' : ''))];
    const cab = [{ t: 'Unidade' }, { t: 'Competência' }, { t: 'Chegou' }, { t: 'Caiu na caixa de' }, { t: 'Lido' }, { t: 'Tratado' }];
    const dias = h('input', { type: 'number', id: 'en-dias', min: 1, max: 60, value: d.dias_nao_lido, style: 'width:80px' });
    montar(cabecalho('entregas'),
      h('div', { class: 'filtros cartao' },
        seletor('en-un', 'Unidade', [['', 'Todas']].concat(c.unidades.map((u) => [u.contrato_id, u.unidade])), F.contrato, (v) => { F.contrato = v; entregas(); }),
        seletor('en-func', 'Analista', [['', 'Todos']].concat(c.funcionarios.map((f) => [f.usuario_id, f.nome])), F.usuario_id, (v) => { F.usuario_id = v; entregas(); }),
        h('div', { class: 'campo filtro' }, h('label', { for: 'en-dias' }, 'Destacar não lidos há (dias)'), dias),
        h('button', { class: 'sec', id: 'en-dias-ok', onclick: async () => { try { await api('PUT', '/api/gestao/caixa-config', { dias_nao_lido: Number(dias.value) }); toast('Limite salvo.'); entregas(); } catch (e) { toast(e.message, true); } } }, 'Salvar limite'),
        h('a', { class: 'btn sec', id: 'en-pdf', href: '/api/gestao/entregas.pdf' + qs({ contrato: F.contrato, usuario_id: F.usuario_id }), target: '_blank', rel: 'noopener' }, 'Exportar PDF')),
      h('div', { class: 'kpis' }, kpi('Entregas', d.total.entregas), kpi('Não lidas', d.total.nao_lidas, '', d.total.nao_lidas ? 'atencao' : ''), kpi('Pendentes', d.total.pendentes), kpi('Não lidas há ' + d.dias_nao_lido + ' d ou mais', d.total.destacadas, '', d.total.destacadas ? 'alta' : ''),
        kpi('Sem responsável', d.sem_responsavel.length, 'unidades', d.sem_responsavel.length ? 'atencao' : '')),
      d.analistas.map((a) => h('div', { class: 'cartao', 'data-analista': a.login }, h('div', { class: 'linha espaco' }, h('h2', { style: 'margin:0' }, a.nome), h('span', { class: 'mudo peq' }, a.resumo.entregas + ' entrega(s) · ' + a.resumo.nao_lidas + ' não lida(s) · ' + a.resumo.pendentes + ' pendente(s)' + (a.resumo.destacadas ? ' · ' + a.resumo.destacadas + ' em destaque' : ''))),
        tabela(cab, a.unidades.flatMap((u) => u.entregas.map(linha))))),
      d.analistas.length ? null : h('div', { class: 'cartao' }, h('p', { class: 'mudo' }, 'Nenhuma entrega registrada na caixa ainda.')),
      h('div', { class: 'cartao', id: 'en-sem-resp' }, h('h2', { style: 'margin-top:0' }, 'Unidades sem responsável (caixa da superintendente)'),
        d.sem_responsavel.length ? tabela(cab, d.sem_responsavel.flatMap((u) => (u.entregas.length ? u.entregas.map(linha) : [[u.unidade, '—', '—', selo('sem carteira', 'atencao'), '—', '—']]))) : h('p', { class: 'mudo' }, 'Todas as unidades têm responsável.')));
  }

  // ---------- Completude por carteira ----------
  // Para cada unidade: trimestres do histórico (confirmado / rascunho / falta) e se o contrato com os termos aditivos já foi lido e confirmado.
  async function completude() {
    const d = await api('GET', '/api/gestao/completude');
    const rotTri = (t) => t.replace(/^(\d{4})-T(\d)$/, '$2º tri/$1');
    const celula = (e) => (e === 'confirmado' ? selo('confirmado', 'ok') : (e === 'rascunho' ? selo('rascunho', 'atencao') : selo('falta', 'alta')));
    const contrato = (c) => h('div', null, c.situacao === 'confirmado' ? selo('contrato lido', 'ok') : (c.situacao === 'rascunho' ? selo('contrato: conferir', 'atencao') : selo('contrato não lido', 'alta')),
      h('div', { class: 'peq mudo' }, c.aditivos_confirmados + ' aditivo(s) confirmado(s)' + (c.rascunhos ? ' · ' + c.rascunhos + ' por conferir' : '') + (c.pasta_consultada ? '' : ' · pasta ainda não consultada')));
    const cab = [{ t: 'Unidade' }].concat(d.trimestres.map((t) => ({ t: rotTri(t) }))).concat([{ t: 'Contrato e aditivos' }, { t: '' }]);
    const linha = (u) => [h('strong', null, u.unidade), ...d.trimestres.map((t) => celula(u.trimestres[t])), contrato(u.contrato), u.completo ? selo('completa', 'ok') : ''];
    montar(...cabecalho('completude'),
      h('div', { class: 'cartao' }, h('p', { class: 'mudo peq', style: 'margin:0' }, d.resumo.completas + ' de ' + d.resumo.unidades + ' unidade(s) completas · ' + d.resumo.contratos_lidos + ' com o contrato lido e confirmado. Completa = os 4 últimos trimestres encerrados confirmados no Histórico e o contrato confirmado, sem rascunho pendente.')),
      d.funcionarios.map((f) => h('div', { class: 'cartao' }, h('h3', null, f.nome), f.unidades.length ? tabela(cab, f.unidades.map(linha)) : h('p', { class: 'mudo' }, 'Sem unidades na carteira.'))),
      d.sem_carteira.length ? h('div', { class: 'cartao' }, h('h3', null, 'Unidades sem carteira'), tabela(cab, d.sem_carteira.map(linha))) : null);
  }

  async function aba() {
    const h2 = location.hash.replace(/^#\/gestao\/?/, '');
    if (!F.lista) { try { F.lista = (await api('GET', '/api/gestao/painel?trimestre=' + (F.trimestre || ''))).trimestres; } catch (_) { F.lista = []; } }
    if (h2 === 'producao') return producao();
    if (h2 === 'carteira') return carteira();
    if (h2 === 'importar') return importar();
    if (h2 === 'contratos') return contratosTas();
    if (h2 === 'entregas') return entregas();
    if (h2 === 'completude') return completude();
    if (h2 === 'usuarios') return usuarios();
    if (h2 === 'acessos') return acessos();
    if (h2 === 'ia') return ia();
    return painel();
  }

  window.CTAI_GESTAO = { rotas: [['/gestao', aba], ['/gestao/:aba', aba]] };
})();
