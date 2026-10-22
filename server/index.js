'use strict';
const config = require('./config');
const { abrir, envolver } = require('./db');
const seed = require('./seed');
const { criarApp } = require('./app');

const db = envolver(abrir(config.arquivoBanco));
if (config.semear && seed.semear(db)) {
  console.log('Carga inicial feita. Usuários de teste: admin, nathalia, cleuton, colega1, colega2, gestor.olinda, gestor.demo.');
  console.log('Senha temporária (trocar no primeiro acesso): ' + config.senhaTemporaria);
}
// Recuperação de acesso: CTAI_REDEFINIR_SENHA_DE=admin,acleutonev devolve a esses usuários a senha temporária a cada partida.
// Depois de entrar e trocar a senha, APAGUE a variável no Render (senão a troca é desfeita a cada reinício).
const redefinir = config.env('CTAI_REDEFINIR_SENHA_DE', '').split(',').map((x) => x.trim()).filter(Boolean);
if (redefinir.length) {
  const auth = require('./auth');
  const trilha = require('./trilha');
  for (const login of redefinir) {
    const u = db.get('SELECT usuario_id, login FROM usuarios WHERE login = ?', login);
    if (!u) { console.log('Redefinição: usuário não encontrado: ' + login); continue; }
    db.run('UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, tentativas = 0, bloqueado_ate = NULL, ativo = 1 WHERE usuario_id = ?', auth.gerarHash(config.senhaTemporaria), u.usuario_id);
    trilha.registrar(db, { usuario: 'sistema', tabela: 'usuarios', registro: u.login, campo: 'senha', valor_novo: 'redefinida na partida (CTAI_REDEFINIR_SENHA_DE)' });
    console.log('Redefinição: senha de ' + login + ' voltou à temporária (troca obrigatória no próximo acesso).');
  }
}
const app = criarApp(db);
const servidor = app.listen(config.porta, () => {
  console.log('Sistema CTAI em http://localhost:' + config.porta + '  (Portal da Unidade: /unidade · Console da CTAI: /ctai)');
});
for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => { servidor.close(() => { db.fechar(); process.exit(0); }); });
