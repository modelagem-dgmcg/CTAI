# Guia: CTAI no servidor da Oracle Cloud (Always Free)

Para quem vai montar o teste sem programar. Tempo: de 1 a 2 horas, na primeira vez.
Use **somente dados de demonstração**.

## O desenho

```
Unidade (Olinda) ──https──> túnel Cloudflare ──> servidor Oracle ──> Portal da Unidade (só ele)
Comissão (SES)   ──http──> IP do servidor, porta 3000, liberada só para o IP da SES ──> Console, Analista CTAI, Gestão CTAI
```

- O servidor na Oracle guarda tudo.
- A **unidade** chega pelo túnel (endereço https). O sistema só deixa ela ver o Portal da Unidade.
- A **comissão** chega pelo IP do servidor, e a Oracle só aceita conexões vindas do IP público da SES.

## Parte 1: conta na Oracle

1. Entre em https://www.oracle.com/br/cloud/free/ e crie a conta (Always Free). Pede cartão só para verificar a identidade.
2. Na **região inicial (Home Region)**, escolha **Brasil (São Paulo ou Vinhedo)**. **Não dá para mudar depois.**
3. Aguarde o e-mail de ativação.

## Parte 2: criar o servidor

No painel da Oracle: **Compute > Instances > Create instance**.

| Campo | Valor |
|---|---|
| Nome | `ctai-teste` |
| Imagem | **Ubuntu 22.04** (ou 24.04) |
| Shape | **Ampere (VM.Standard.A1.Flex)**, **1 OCPU e 6 GB** de memória |
| Rede | padrão; marque **Assign a public IPv4 address** |
| Chave SSH | **Generate a key pair** e **baixe as duas chaves** (guarde bem a privada) |
| Disco | 50 GB |

Clique em **Create**. Quando ficar **Running**, anote o **IP público**.

> Se aparecer "Out of capacity" (sem capacidade), tente de novo em outra hora ou escolha outro domínio de disponibilidade. Se não resolver, me avise: há plano B no Render.

## Parte 3: liberar a porta 3000 só para a SES

1. Descubra o **IP público da SES**: de um computador da SES, abra https://www.whatismyip.com e anote o número.
2. Na Oracle: **Networking > Virtual Cloud Networks > (sua rede) > Security Lists > Default**.
3. **Add Ingress Rules**: Source CIDR `IP-DA-SES/32`, Protocol TCP, Destination Port `3000`.

Importante: **não** abra a porta 3000 para `0.0.0.0/0`.

## Parte 4: instalar o sistema

Conecte no servidor. No PowerShell do seu computador (a chave privada baixada é o arquivo `.key`):

```
ssh -i "C:\caminho\da\chave.key" ubuntu@IP-DO-SERVIDOR
```

Dentro do servidor, rode um de cada vez:

```
sudo apt-get update && sudo apt-get install -y git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
```

Saia (`exit`), entre de novo pelo `ssh` e continue:

```
git clone https://github.com/modelagem-dgmcg/CTAI.git
cd CTAI
cp .env.example .env
nano .env
```

No `nano`, ajuste (Ctrl+O salva, Enter confirma, Ctrl+X sai):

```
CTAI_SENHA_TEMPORARIA=ESCOLHA-UMA-SENHA-TEMPORARIA
CTAI_SEGREDO=ESCREVA-UMA-FRASE-LONGA-COM-MAIS-DE-16-CARACTERES
CTAI_EXPOSICAO=restrita
```

Suba o sistema:

```
docker compose up -d --build
```

### Firewall do próprio servidor (as imagens da Oracle bloqueiam por padrão)

```
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -s IP-DA-SES -j ACCEPT
sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save
```

**Conferir:** de um computador da SES, abra `http://IP-DO-SERVIDOR:3000`. Deve aparecer a entrada do CTAI. De um celular em 4G, a mesma página **não deve abrir**.

## Parte 5: túnel para a unidade

No servidor:

```
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
chmod +x cloudflared
./cloudflared tunnel --url http://localhost:3000
```

Ele mostra um endereço `https://algo.trycloudflare.com`: **é o link da unidade**. O endereço muda se o túnel reiniciar. Para um endereço fixo e para o túnel subir sozinho, será preciso conta no Cloudflare e o domínio (veja `docs/GUIA-TESTE-OLINDA.md`, Parte 4).

**Teste de segurança, de um celular em 4G:**
- `https://SEU-ENDERECO/` abre a entrada.
- `https://SEU-ENDERECO/ctai` dá **"não encontrado"**.
- Login com `admin` por esse endereço é **recusado**.

Se algo falhar, **feche o túnel** (Ctrl+C) e me avise.

## Parte 6: depois

Siga a **Parte 5** do `docs/GUIA-TESTE-OLINDA.md` (cadastrar usuários, carteira, gestor da unidade, equipe) e o roteiro de teste.

## Manter, atualizar, backup

- Atualizar: `cd CTAI && git pull && docker compose up -d --build`
- Parar: `docker compose down`
- Backup: copie a pasta `CTAI/data` do servidor (`scp` ou o painel da Oracle).
- O servidor gratuito pode ser recolhido pela Oracle se ficar muito tempo sem uso. Entre de vez em quando.

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| "Out of capacity" ao criar o servidor | tentar outro horário ou outro domínio de disponibilidade; senão, plano B (Render) |
| `ssh` não conecta | conferir o IP, o usuário `ubuntu` e o caminho da chave |
| Página não abre da SES | conferir a regra da Oracle (Parte 3) e o `iptables` (Parte 4) |
| `docker` pede permissão | sair e entrar no servidor de novo (passo do `usermod`) |
| Erros ao subir o sistema | `docker compose logs ctai` e me enviar as últimas linhas |
