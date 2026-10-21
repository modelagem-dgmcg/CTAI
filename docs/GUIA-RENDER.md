# Guia: colocar o CTAI no ar no Render

Para quem não programa. Tempo: cerca de 40 minutos na primeira vez. Use **somente dados de demonstração** até a hospedagem ser aprovada.

## O desenho

```
Unidade (Olinda)  ──https──┐
                           ├──> https://ctai.onrender.com ──> Render ──> Portal da Unidade (só ele)
Comissão (na SES) ──https──┘                                              Console, Analista CTAI, Gestão CTAI
                                                                          (só se o IP for o da SES)
```

Todo mundo entra pelo **mesmo endereço**. O sistema olha o **IP de quem chegou**: se for o IP da SES, abre o console da comissão; qualquer outro IP só enxerga o Portal da Unidade (o resto responde "não existe", erro 404). Usuários da comissão (admin, superintendente, criador, colega) **não conseguem nem fazer login** de fora da SES.

## Antes de começar

Anote o **IP público da SES** (a internet de lá sai por um IP só). Para descobrir: num computador da SES, abra https://www.google.com e pesquise **"meu ip"**. Aparece algo como `200.123.45.67`. Pergunte ao pessoal de TI da SES se esse IP é **fixo**: se mudar, o console deixa de abrir e será preciso atualizar a variável (passo 4). Se houver mais de um IP, anote todos.

## Passo 1: criar a conta

1. Entre em https://render.com e clique em **Get Started**.
2. Cadastre-se **com o GitHub** (é o mais simples) e confirme o e-mail.
3. Adicione um **cartão de crédito** em **Account Settings > Billing**. O disco do sistema exige plano pago.

## Passo 2: conectar o GitHub

No Render: **Account Settings > Git providers (GitHub)** e autorize o acesso ao repositório **modelagem-dgmcg/CTAI** (pode ser só a esse repositório).

## Passo 3: criar o serviço pelo Blueprint

1. No painel, clique em **New > Blueprint**.
2. Escolha o repositório **modelagem-dgmcg/CTAI** e a branch **main**. O Render lê o arquivo `render.yaml` e mostra o serviço **ctai** (plano Starter, disco de 1 GB).
3. Ele pede as três variáveis marcadas como segredo. Preencha:

| Variável | O que colocar |
|---|---|
| `CTAI_SENHA_TEMPORARIA` | uma senha provisória sua, ex.: `Provisoria#2026` (todos os usuários de teste começam com ela e **trocam no primeiro acesso**) |
| `CTAI_SEGREDO` | uma frase longa sua, **no mínimo 16 caracteres**, ex.: `minha-frase-secreta-da-ctai-2026`. Guarde em local seguro: ela cifra as chaves de IA |
| `CTAI_IPS_INTERNOS` | o **IP público da SES** do passo "Antes de começar" (vários separados por vírgula; aceita faixa, como `200.123.45.0/24`) |

4. Clique em **Apply** (ou **Create**). O Render monta o sistema e sobe o serviço.

> Não coloque essas senhas em e-mail, chat ou no GitHub. Elas ficam só no painel do Render.

## Passo 4: aguardar e achar o endereço

O primeiro deploy leva de 5 a 10 minutos (aba **Logs**). Quando aparecer **Live** (verde), o endereço fica no topo da página do serviço, no formato `https://ctai-xxxx.onrender.com`.

Se um dia precisar mudar uma variável (por exemplo, o IP da SES): **serviço > Environment > Edit**, salve, e o Render reinicia sozinho.

## Passo 5: teste de segurança (faça antes de divulgar)

1. **Pelo celular, em 4G** (desligue o Wi-Fi): abra `https://SEU-ENDERECO.onrender.com/unidade`. O **Portal da Unidade deve abrir**.
2. Ainda no celular, abra `https://SEU-ENDERECO.onrender.com/ctai`. Deve aparecer **"Not found" (404)**. Se abrir, **pare e me avise**.
3. No celular, tente entrar com `admin` na tela de login. Deve dizer **"Usuário ou senha incorretos"**, mesmo com a senha certa.
4. **Num computador da SES**, abra `https://SEU-ENDERECO.onrender.com/ctai`. O **console deve abrir** e o login do admin deve funcionar.
5. Em qualquer lugar, abra `https://SEU-ENDERECO.onrender.com/api/origem`. A página mostra o IP que o sistema enxerga (`seuIp`) e a classe (`interna` ou `externa`). **Na SES deve mostrar o IP da SES e `interna`; no 4G, outro IP e `externa`.**

**Se na SES o `/api/origem` mostrar `externa` ou um IP diferente do esperado:** o Render pode estar acrescentando mais (ou menos) endereços no cabeçalho do que o previsto. Mande uma captura da página `/api/origem` aberta na SES; o ajuste é trocar a variável `CTAI_PROXY_SALTOS` (de `2` para `1` ou `3`) ou usar `CTAI_IP_CABECALHO`. Enquanto não estiver certo, o sistema falha para o lado seguro: **ninguém vê o console** (só o portal).

## Passo 6: primeiro acesso do admin

1. Na SES, abra `https://SEU-ENDERECO.onrender.com/` e entre com **`admin`** e a senha de `CTAI_SENHA_TEMPORARIA`.
2. O sistema obriga a **trocar a senha**. Escolha uma forte (8 ou mais caracteres, com letras e números).
3. Em **Gestão CTAI > Usuários**, crie a unidade e o gestor; o gestor cadastra a equipe no Portal da Unidade.
4. Os demais usuários de teste (`nathalia`, `cleuton`, `colega1`, `colega2`, `gestor.demo`, `gestor.olinda`) também começam com a senha provisória. **Desative os que não for usar** (Gestão CTAI > Usuários).

## Passo 7: endereço próprio (depois)

Quando quiser `ctai.dgmcg.com.br`:
1. No Render: **serviço > Settings > Custom Domains > Add Custom Domain** e digite `ctai.dgmcg.com.br`.
2. O Render mostra um valor para criar um registro **CNAME**. Peça a quem cuida do domínio `dgmcg.com.br` que crie: **nome** `ctai`, **tipo** `CNAME`, **valor** o que o Render mostrou (algo como `ctai-xxxx.onrender.com`).
3. Volte ao Render e clique em **Verify**. O https é emitido sozinho (pode levar alguns minutos).
4. O endereço `*.onrender.com` continua funcionando. Os testes do passo 5 valem também para o domínio novo.

## Atualizações

O `render.yaml` liga a **atualização automática**: a cada mudança enviada à branch **main** do GitHub, o Render refaz o sistema e troca a versão sozinho (alguns minutos, com uma breve indisponibilidade). Os dados ficam no disco e **não se perdem** nas atualizações. Para pausar as atualizações: **serviço > Settings > Auto-Deploy > Off**.

## Backup

Os dados (banco, PDFs gerados) ficam no **disco persistente** `/dados`.

- **Cópia do banco, quando quiser:** na SES, entre como admin, abra **Administração > Backup do banco > Baixar backup do banco**. Baixa um arquivo `.sqlite` (usuários, envios, pareceres, trilha). Guarde em local seguro, com a data no nome.
- **Snapshots do disco (Render):** o Render tira cópias automáticas do disco (diariamente, mantidas por alguns dias) e permite restaurar em **serviço > Disks**. Confirme o prazo exato na tela do disco. Restaurar volta o disco inteiro ao estado daquele dia.
- **Importante:** sem disco, tudo se perde a cada atualização; por isso o plano pago é obrigatório. Nunca apague o disco.

## Custo (confirmar na tela do Render, os valores mudam)

- Plano **Starter**: cerca de **US$ 7 por mês**.
- Disco: cerca de **US$ 0,25 por GB por mês** (1 GB = US$ 0,25).
- Total aproximado: **US$ 7,25 por mês**, cobrado no cartão. Não há plano gratuito com disco.

## Limites e cuidados

- **Instância única:** o sistema usa um banco de arquivo; não aumente para mais de uma instância.
- **Reinícios e atualizações** deixam o sistema fora do ar por instantes.
- **A restrição por IP depende do que o Render informa.** O sistema lê o IP do cliente pelo cabeçalho `X-Forwarded-For` contando do fim (a premissa é que o Render acrescenta o IP de quem chegou). Isso não foi testado em um Render real; **o passo 5 é obrigatório** para conferir. O IP da SES pode ser compartilhado por muitos computadores (todos viram "internos") e muda se a SES trocar de provedor.
- **Nada de dados reais** até aprovação (LGPD e jurídico). O sistema sobe com dados de **demonstração**.
- **Segurança em camadas:** a restrição por IP não substitui senha forte e a troca da senha provisória.

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| Deploy falhou (vermelho) | Abra **Logs** e me envie as últimas 30 linhas |
| Console não abre na SES | Abra `/api/origem` na SES e me envie a captura; confira `CTAI_IPS_INTERNOS` |
| "Not found" no portal | Veja se o serviço está **Live**; teste `/api/saude` (deve mostrar `{"ok":true}`) |
| Esqueci a senha do admin | Peça a outro administrador (Gestão CTAI > Usuários > Trocar senha) |
| Perdi a `CTAI_SEGREDO` | Cadastre as chaves de IA de novo em Gestão CTAI > IA (as chaves antigas ficam ilegíveis) |
