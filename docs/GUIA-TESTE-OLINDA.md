# Guia: teste com a UPA Olinda a partir de um computador da SES

> **Hospedagem na nuvem:** para o teste sem depender de um computador ligado na SES, use o **Render**: `docs/GUIA-RENDER.md` (todos entram pelo mesmo endereço; só o IP da SES vê o console). A restrição de acesso está em `docs/EXPOSICAO.md`.

Para quem vai montar o teste (sem precisar programar). Tempo: de 30 a 60 minutos.
Use **somente dados de demonstração**. Nada real de paciente, escala ou CPF.

## O que você vai ter no fim

| Quem | Onde acessa | O que vê |
|---|---|---|
| Comissão (CTAI) | `http://IP-DA-MAQUINA:3000` (rede interna) | Console CTAI, Analista CTAI, Gestão CTAI |
| Unidade (Olinda) | endereço público do túnel | só o **Portal da Unidade** |

O computador fica ligado e guarda os dados. Os colegas e a unidade só abrem o navegador.

## Parte 1: subir o sistema

**Antes de começar, instale (uma vez):**
1. **Docker Desktop**: https://www.docker.com/products/docker-desktop/ (aceite as opções padrão; reinicie se pedir).
2. **Git**: https://git-scm.com/download/win (opções padrão).

**Depois, abra o PowerShell (menu Iniciar, digite PowerShell) e rode, um de cada vez:**

```
git clone https://github.com/modelagem-dgmcg/CTAI.git
cd CTAI
copy .env.example .env
notepad .env
```

No Bloco de Notas que abrir, ajuste estas linhas (salve e feche):

```
CTAI_SENHA_TEMPORARIA=ESCOLHA-UMA-SENHA-TEMPORARIA
CTAI_SEGREDO=ESCREVA-UMA-FRASE-LONGA-COM-MAIS-DE-16-CARACTERES
CTAI_EXPOSICAO=restrita
```

Suba o sistema:

```
docker compose up -d --build
```

Espere terminar (a primeira vez demora alguns minutos). Abra no navegador do próprio computador: **http://localhost:3000**.

**Conferir:** aparece a tela de entrada do CTAI. Entre com `admin` e a senha temporária que você escolheu (o sistema pede para trocar).

> Os dados ficam na pasta `data` dentro de `CTAI`. **Copie essa pasta de vez em quando** (é o seu backup).

## Parte 2: colegas da SES acessarem

1. No PowerShell: `ipconfig`. Anote o **Endereço IPv4** (ex.: 10.20.30.40).
2. Libere a porta 3000 só para a rede interna, no PowerShell **como administrador**:

```
New-NetFirewallRule -DisplayName "CTAI 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private,Domain
```

3. Os colegas abrem `http://SEU-IPV4:3000` no navegador.

**Se não abrir:** a rede da SES pode isolar as máquinas. Peça à TI para liberar o seu IP na porta 3000 e fixar o IP da máquina.

## Parte 3: deixar o computador sempre ligado

1. Configurações > Sistema > Energia: "Suspender" = **Nunca**; tela pode apagar.
2. Docker Desktop > Settings > General: marque **Start Docker Desktop when you sign in**.
3. O contêiner já tem `restart: unless-stopped`, então volta sozinho após reiniciar.
4. Atualizações do Windows: defina o horário ativo para o expediente.

## Parte 4: túnel para a unidade (Cloudflare Tunnel)

1. Instale o `cloudflared`: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ (versão Windows). Ou, no PowerShell: `winget install Cloudflare.cloudflared`.
2. **Teste rápido (endereço temporário, sem conta):**

```
cloudflared tunnel --url http://localhost:3000
```

Ele mostra um endereço do tipo `https://algo-aleatorio.trycloudflare.com`. **Esse é o link da unidade.**
Mantenha a janela aberta. O endereço **muda** toda vez que o túnel reinicia.

3. **Teste de segurança (importante), de um celular no 4G, sem Wi-Fi:**
   - `https://SEU-ENDERECO/` deve abrir a entrada.
   - `https://SEU-ENDERECO/ctai` deve dar **"não encontrado"**.
   - Login com `admin` por esse endereço deve ser **recusado**.
   Se qualquer um desses falhar, **feche o túnel** e me avise.

4. **Endereço fixo (depois):** com conta gratuita no Cloudflare e o domínio gerenciado lá (ou um CNAME criado por quem cuida do DNS de `dgmcg.com.br`), crie um túnel nomeado, por exemplo `ctai.dgmcg.com.br`, apontando para `http://localhost:3000`. Coloque o endereço em `CTAI_HOSTS_PUBLICOS` no `.env` e reinicie com `docker compose up -d`. Instale como serviço (`cloudflared service install`) para subir com o Windows.

**Sobre `CTAI_COOKIE_SEGURO`:** mantenha `nao` no teste. Com `sim`, o login pela rede interna (http) deixa de funcionar. O trecho entre a unidade e a Cloudflare já é criptografado (https).

## Parte 5: preparar a Olinda e a CTAI

1. Entre como **admin**, crie as pessoas da CTAI em **Gestão CTAI > Usuários** (superintendente, criador, colegas).
2. Em **Gestão CTAI > Carteira**, atribua a Olinda a quem vai acompanhá-la.
3. Cadastre a unidade e o **gestor da unidade**. Passe a ele o endereço do túnel e a senha temporária.
4. O gestor entra, troca a senha, e em **Equipe da unidade** cadastra os responsáveis de cada ficha (assistência, qualidade, ouvidoria, educação, BID, RH).
5. Os responsáveis preenchem as fichas. O gestor revisa, junta, gera o PDF e envia.
6. A CTAI recebe no Console, confere na mesa, e acompanha os acessos em **Gestão CTAI > Acessos**.

## Roteiro de teste sugerido

- [ ] Gestor entra e troca a senha.
- [ ] Gestor cadastra 2 responsáveis.
- [ ] Cada responsável preenche a sua ficha (dados fictícios; planilhas só com colunas permitidas).
- [ ] O sistema avisa quando falta o relatório da Comissão de Óbitos (2.10) e as informações de transparência (2.13).
- [ ] Gestor informa o número do documento no SEI e a data do SIMAS; os prazos (dia 20 e dia 25) aparecem.
- [ ] CTAI vê o envio, a mesa de conferência e o checklist de recebimento.
- [ ] Analista CTAI mostra os achados; a CTAI encaminha um à unidade; a unidade responde em "Esclarecimentos".
- [ ] CTAI monta o relatório trimestral, edita o texto, congela e baixa o PDF.
- [ ] Superintendente vê o painel e a aba **Acessos** (origem externa para a Olinda).

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| Página não abre no `localhost:3000` | `docker compose logs ctai` e me enviar as últimas linhas |
| Colega não abre pelo IP | firewall (Parte 2) ou rede da SES isolando máquinas: falar com a TI |
| Túnel não conecta | a rede pode bloquear o `cloudflared`: falar com a TI |
| `/ctai` abre pelo endereço público | **feche o túnel** e me avise; confira `CTAI_EXPOSICAO=restrita` |
| Esqueci a senha do admin | me avisar, para eu preparar a redefinição |

## Parar, atualizar, backup

- Parar: `docker compose down`
- Atualizar (eu aviso quando houver versão nova): `git pull` e depois `docker compose up -d --build`
- Backup: copie a pasta `data`.
