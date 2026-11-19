# Bazar de Fábrica Lizie — Agendamento

Página pública de agendamento do bazar, com cadastro único por CPF, 30 vagas por
horário e gravação segura no Supabase.

- **Site publicado:** https://wagner-aick.github.io/agendamento-bazar-lizie/
- **Painel da equipe:** https://wagner-aick.github.io/agendamento-bazar-lizie/admin.html
- **Repositório:** https://github.com/wagner-aick/agendamento-bazar-lizie
- **Site:** HTML, CSS e JavaScript puros (sem build, sem dependências de CDN).
- **Banco:** Supabase (Postgres) com RLS e funções `SECURITY DEFINER`.
- **API:** Edge Function `bazar` — o navegador nunca recebe chave do Supabase.
- **Hospedagem:** GitHub Pages.

## Estrutura

```
index.html                      página de agendamento
admin.html                      painel da equipe (senha)
assets/css/styles.css           estilos do agendamento
assets/css/admin.css            estilos do painel
assets/js/app.js                máscaras, validação e integração com a API
assets/js/admin.js              login, filtros e exportação do painel
assets/fonts/                   Inter e Montagu Slab (self-hosted)
assets/img/hero.jpg             arte estática da capa
assets/img/fundo.png            fundo do site
supabase/migrations/            schema, funções e políticas
supabase/functions/bazar/       Edge Function do agendamento
supabase/functions/admin/       Edge Function do painel
.github/workflows/pages.yml     deploy do GitHub Pages
```

## Segurança

- **RLS ligado e sem políticas** nas tabelas: `anon` e `authenticated` não leem
  nem escrevem nada diretamente.
- **Uma única porta de escrita:** `public.bazar_agendar()`, executável apenas por
  `service_role` (usada pela Edge Function).
- **CPF não é armazenado em texto claro.** Guardamos HMAC-SHA256 com um pepper
  aleatório criado no Supabase Vault durante a migração, mais a máscara
  `***.***.***-XX`. O CPF serve para garantir o cadastro único.
- **Vagas sem overbooking:** a linha do horário é travada com `SELECT … FOR UPDATE`
  antes da contagem e da inserção.
- **Antiabuso:** limite de 8 tentativas por IP a cada 10 minutos (guardando só um
  hash SHA-256 do IP, apagado após 2 dias), honeypot invisível e validação de
  todos os campos no servidor.
- **Cabeçalhos:** CSP restritiva (sem inline, sem terceiros), `nosniff`,
  `Referrer-Policy` e `no-store` nas respostas de escrita.
- **Sem chaves no cliente:** a `service_role` existe apenas no runtime da Edge
  Function.

## Configuração do Supabase

Projeto: `molespouzrulyubcfxph` (região `sa-east-1`).

### 1. Migração

O SQL está em `supabase/migrations/20261119000100_bazar.sql`. Ele cria:

- `bazar_config` — data do evento, permanência e flag `aberto`.
- `bazar_horarios` — horários e vagas (30 por horário).
- `bazar_inscricoes` — inscrições (CPF como HMAC + máscara).
- `bazar_tentativas` — controle de tentativas por IP.
- Funções `bazar_cpf_valido`, `bazar_horarios_disponiveis` e `bazar_agendar`.

Para reaplicar em outro projeto, rode o arquivo no SQL Editor do Supabase ou:

```bash
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

### 2. Edge Function

```bash
supabase functions deploy bazar --no-verify-jwt
```

A função já está publicada em:

```
https://molespouzrulyubcfxph.supabase.co/functions/v1/bazar
```

Rotas:

- `GET  /horarios` — data do evento, horários e vagas restantes (sem dado pessoal).
- `POST /agendar` — cria a inscrição.

### 3. Variáveis do site

A URL da API fica no topo de `assets/js/app.js`:

```js
var API_BASE = "https://molespouzrulyubcfxph.supabase.co/functions/v1/bazar";
```

Se o projeto Supabase mudar, troque essa linha e o `connect-src` da CSP em
`index.html`.

## Operação do bazar

### Painel da equipe

- URL: https://wagner-aick.github.io/agendamento-bazar-lizie/admin.html
- Login por senha; a senha é conferida no banco com bcrypt.
- A senha fica apenas no `sessionStorage` (por aba, some ao fechar o navegador).
- Limite de 10 tentativas **erradas** por IP a cada 10 minutos; acertar a senha
  zera o contador.
- A página tem `noindex, nofollow` e não mostra nenhum dado sem a senha.

O painel é uma lista enxuta, pensada para a portaria:

- busca por nome, CPF ou telefone;
- chips por horário com a contagem;
- pessoas agrupadas por horário, com nome, CPF mascarado e telefone clicável;
- atualização automática a cada 15 segundos (e ao voltar para a aba);
- exportação CSV discreta no topo.

Sem KPIs, gráficos ou métricas.

#### Definir ou trocar a senha

```sql
insert into public.bazar_admin (id, senha_hash)
values (1, extensions.crypt('NOVA_SENHA', extensions.gen_salt('bf', 12)))
on conflict (id) do update
  set senha_hash = excluded.senha_hash,
      atualizado_em = now();
```

#### Edge Function do painel

```bash
supabase functions deploy admin --no-verify-jwt
```

Rota: `POST /admin/dados` com `{ "senha": "..." }`. A função usa `service_role`
apenas no servidor e chama a RPC `bazar_admin_dados`.

### Ver inscrições

Use o SQL Editor do Supabase (a tabela não é exposta publicamente):

```sql
select
  i.criado_em,
  i.nome,
  i.cpf_mascarado,
  i.email,
  i.celular,
  to_char(h.hora, 'HH24:MI') as horario,
  i.como_soube,
  i.aceita_novidades
from public.bazar_inscricoes i
join public.bazar_horarios h on h.id = i.horario_id
order by h.hora, i.nome;
```

Para exportar em CSV, use o botão **Export** do SQL Editor.

### Fechar as inscrições

As inscrições param automaticamente à 00:00 do dia do evento
(`America/Sao_Paulo`). A página pública passa a mostrar **“Agendamento
encerrado”** e a API recusa novas inscrições com `INSCRICOES_ENCERRADAS`.

Para encerrar antes:

```sql
update public.bazar_config set aberto = false where id = 1;
```

### Mudar data, horários ou vagas

```sql
update public.bazar_config set evento_data = date '2026-12-01' where id = 1;
update public.bazar_horarios set vagas_max = 30;            -- limite por horário
update public.bazar_horarios set ativo = false where hora = '16:00';
```

> O limite `vagas_max` aceita no máximo 30 por causa do `CHECK` da tabela.

## Trocar a arte da capa

Substitua `assets/img/hero.jpg` mantendo a proporção **2000 × 1138**. A capa é
uma imagem estática: data, horário, endereço e faixa vermelha já fazem parte da
arte.

## Rodar localmente

```bash
python -m http.server 4173
# ou
npx serve .
```

Abra `http://localhost:4173`.

## Deploy

O workflow `.github/workflows/pages.yml` publica a raiz do repositório no GitHub
Pages a cada push na branch `main`.

1. Em **Settings → Pages**, selecione **GitHub Actions** como source.
2. Faça push na `main`.
3. O site fica em `https://USUARIO.github.io/REPOSITORIO/`.

## LGPD

- CPF: guardado apenas como HMAC (não reversível sem o pepper do Vault) + máscara.
- E-mail e celular: usados para organizar o bazar e, se autorizado, para
  novidades. Não são compartilhados.
- IP: apenas hash, por 2 dias, para conter abuso.
- O consentimento de novidades é opcional e registrado separadamente do aceite
  obrigatório sobre defeitos das peças.

## Legado

O projeto Supabase já tinha tabelas vazias de uma tentativa anterior
(`cadastros`, `agendamentos`, `calendario_vagas`, `aux_dias_semana`, `teste`).
Elas foram mantidas e tiveram o acesso revogado; o sistema atual usa apenas as
tabelas `bazar_*`. Se não forem mais necessárias, podem ser removidas com
segurança depois de uma conferência.
