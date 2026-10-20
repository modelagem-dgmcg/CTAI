'use strict';
// Rack de fontes de dados. Toda fonte cumpre a mesma interface; o resto do sistema não sabe de onde o dado veio.
//   manual  : digitação no portal
//   csv     : arquivo enviado pela unidade
//   mv-api  : API do sistema da unidade (aguardando acesso e dicionário de campos)
// Para incluir outra fonte: crie adapters/<nome>.js com { tipo, nome, ... } e registre aqui.
const manual = require('./manual');
const csv = require('./csv');
const mv = require('./mv');

const FONTES = { manual, csv, 'mv-api': mv };

function descrever() {
  return [
    { tipo: 'manual', nome: manual.nome, estado: 'ativa', descricao: 'O gestor e os setores preenchem as fichas e as listas no portal.' },
    { tipo: 'csv', nome: csv.nome, estado: 'ativa', descricao: 'Envio de arquivo por fonte. Colunas de dado pessoal recusam o arquivo inteiro.' },
    { tipo: 'mv-api', nome: 'API do sistema da unidade (MV)', estado: 'pronta para configurar', descricao: 'Trazer as linhas direto do sistema. Fica aguardando acesso e o dicionário de campos.' },
  ];
}

module.exports = { FONTES, descrever, manual, csv, mv };
