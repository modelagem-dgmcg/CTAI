(function () {
  'use strict';
  const { api } = window.CTAI;
  const destino = (p) => (['gestor_unidade', 'setor_unidade'].includes(p) ? '/unidade' : '/ctai');
  api('GET', '/api/auth/me').then((r) => { location.href = destino(r.usuario.perfil); }).catch(() => {});
  document.getElementById('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const erro = document.getElementById('erro'); erro.textContent = '';
    try {
      const r = await api('POST', '/api/auth/login', { login: document.getElementById('login').value, senha: document.getElementById('senha').value });
      location.href = r.usuario.perfil === 'admin' ? '/ctai' : destino(r.usuario.perfil);
    } catch (err) { erro.textContent = err.message; }
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
