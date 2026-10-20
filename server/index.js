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
const app = criarApp(db);
const servidor = app.listen(config.porta, () => {
  console.log('Sistema CTAI em http://localhost:' + config.porta + '  (Portal da Unidade: /unidade · Console da CTAI: /ctai)');
});
for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => { servidor.close(() => { db.fechar(); process.exit(0); }); });
