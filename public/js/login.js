(function () {
  'use strict';
  const { api } = window.CTAI;
  const destino = (p) => (['gestor_unidade', 'setor_unidade'].includes(p) ? '/unidade' : '/ctai');
  const naUnidade = new URLSearchParams(location.search).get('entrar') === 'unidade';
  const ehUnidade = (p) => ['gestor_unidade', 'setor_unidade'].includes(p);
  const aviso = (txt) => {
    const erro = document.getElementById('erro'); erro.textContent = '';
    erro.append(txt + ' ');
    const ir = document.createElement('a'); ir.href = '/ctai'; ir.textContent = 'Ir ao Console da CTAI'; erro.append(ir, ' · ');
    const sair = document.createElement('a'); sair.href = '#'; sair.textContent = 'Sair'; sair.addEventListener('click', async (e) => { e.preventDefault(); await api('POST', '/api/auth/logout', {}).catch(() => {}); location.reload(); }); erro.append(sair);
  };
  if (naUnidade) {
    document.title = 'Portal da Unidade · Entrar';
    document.getElementById('titulo').textContent = 'Portal da Unidade';
    document.getElementById('subtitulo').textContent = 'Envio dos dados do Contrato de Gestão à CTAI: cada setor preenche a sua ficha e o administrador da unidade confere e envia.';
    const sobre = document.getElementById('sobre'); if (sobre) sobre.remove();
  }
  api('GET', '/api/auth/me').then((r) => {
    if (naUnidade && !ehUnidade(r.usuario.perfil) && r.usuario.perfil !== 'admin') { aviso('Você entrou como equipe da CTAI. Esta é a entrada das unidades.'); return; }
    location.href = naUnidade && r.usuario.perfil === 'admin' ? '/unidade' : destino(r.usuario.perfil);
  }).catch(() => {});
  document.getElementById('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const erro = document.getElementById('erro'); erro.textContent = '';
    try {
      const r = await api('POST', '/api/auth/login', { login: document.getElementById('login').value, senha: document.getElementById('senha').value });
      if (naUnidade && !ehUnidade(r.usuario.perfil) && r.usuario.perfil !== 'admin') { aviso('Este usuário é da equipe da CTAI. Esta é a entrada das unidades.'); return; }
      location.href = naUnidade && r.usuario.perfil === 'admin' ? '/unidade' : (r.usuario.perfil === 'admin' ? '/ctai' : destino(r.usuario.perfil));
    } catch (err) { erro.textContent = err.message; }
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
