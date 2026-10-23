# Sala guiada (conferência de áudio com apontador)

Quem conduz cria uma sala e recebe um código de 5 letras. Quem acompanha entra com o código, ouve a conversa e vê, na própria tela, uma bolinha com o nome de quem conduz se movendo, com um anel a cada clique. Funciona só dentro do nosso sistema (não aparece sobre o SEI nem sobre outras janelas).

- Áudio direto entre os navegadores (WebRTC). Nada é gravado e nenhum áudio passa pelo servidor.
- Limite de 10 pessoas por sala (muda com `CTAI_SALA_MAX`, no máximo 16). Acima disso seria preciso um servidor de mídia na ATI.
- Todos entram com o microfone mudo; quem conduz pode silenciar todos. Sem microfone, a pessoa só ouve.
- A bolinha se prende ao elemento da tela (não ao pixel), então cai no lugar certo em monitores de tamanhos diferentes.
- A sala fecha sozinha em 4 horas ou quando quem conduz sai. Tudo fica só na memória do servidor.

## Arquivos (já no caminho certo do projeto)
- `server/sala-guiada.js` (servidor)
- `public/js/sala-guiada.js` (tela e áudio; cria o próprio botão "Sala guiada" no canto inferior direito)
- `public/css/sala-guiada.css`
- `test/sala-guiada.test.js` (6 testes)

## Como agregar (4 passos)
1. `server/app.js`: depois da linha do mensageiro, acrescente
   `app.use('/api/sala', require('./sala-guiada')(db));`
2. `public/ctai.html` (e `public/unidade.html`, se as unidades participarem):
   - no `<head>`, depois do `app.css`: `<link rel="stylesheet" href="/css/sala-guiada.css">`
   - antes de `</body>`, depois dos outros scripts: `<script src="/js/sala-guiada.js"></script>`
3. `public/sw.js`: aumentar o número da versão do cache (hoje `ctai-v26`, passar para `ctai-v27`), para os navegadores buscarem as telas novas.
4. Só se as unidades forem entrar de FORA da rede interna: em `server/exposicao.js`, na lista `ABERTOS_EXTERNOS`, acrescentar `/^\/api\/sala(\/|$)/` e trocar `core|login|unidade` por `core|login|unidade|sala-guiada` no padrão dos scripts.

Depois: `npm test` (deve ficar tudo verde) e Manual Deploy no Render.

## Variáveis opcionais (Render)
- `CTAI_SALA_MAX`: limite de pessoas (padrão 10).
- `CTAI_SALA_CONDUTORES`: logins extras que podem criar sala, separados por vírgula (a equipe da CTAI já pode). Útil para um usuário de unidade de teste conduzir no Portal da Unidade.
- `CTAI_SALA_ICE`: servidores TURN/STUN da ATI em JSON, se a rede bloquear o áudio. Padrão: STUN público do Google.

## Quem conduz e quem acompanha
- Só a equipe da CTAI (e os logins de `CTAI_SALA_CONDUTORES`) cria sala. Qualquer pessoa logada entra com o código.
- A bolinha só aparece se as duas pessoas estiverem na mesma tela. Se quem conduz mudar de tela, quem acompanha vê o aviso "Quem conduz está em outra tela" com o botão "Ir para lá" (ou marca "Acompanhar a tela de quem conduz" para ir junto dentro da mesma área).
- O console da CTAI (`/ctai`) e o Portal da Unidade (`/unidade`) são páginas diferentes. Para treinar unidades no Portal, quem conduz precisa estar no Portal (login de teste em `CTAI_SALA_CONDUTORES`).

## No dia (MacBook de quem conduz)
- Use Chrome ou Safari atualizados. Quando o navegador pedir, permita o microfone.
- Fone Bluetooth: ao usar o microfone dele, o som costuma piorar (modo chamada). Para quem conduz, vale o microfone do Mac ou um fone com fio. O painel tem "Microfone e fone" para escolher.
- Use fone de ouvido para não dar eco.
- Se o áudio não ligar na rede da SES, abra o console do navegador e digite `SalaGuiada.diagnostico()`: mostra se cada ligação está "connected" ou "failed". "failed" em todas indica bloqueio de rede; peça à ATI a liberação do tráfego UDP ou um servidor TURN (`CTAI_SALA_ICE`).

## O que foi testado
- Servidor: 6 testes novos; a suíte completa do CTAI ficou em 154 testes, todos passando.
- Navegador real (Chromium com microfone simulado, três usuários): áudio ligado entre os três, lista de quem está com microfone aberto, bolinha na posição certa nas duas telas, anel no clique, aviso de tela diferente e encerramento da sala para todos.
- Não testado: rede da SES, fone Bluetooth e Safari no MacBook. Vale uma conferência de teste com 2 ou 3 pessoas antes do treinamento.
