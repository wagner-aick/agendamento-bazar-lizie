-- =============================================================================
-- Auditoria de segurança — correções aplicadas
--   1. Rate limit público conta apenas falhas e não é desfeito por rollback.
--   2. IP confiável (cf-connecting-ip/x-real-ip) é resolvido na Edge Function.
--   3. Painel usa token de 12h; a senha nunca fica no navegador.
--   4. Políticas públicas e grants legados são removidos.
-- =============================================================================

create or replace function public.bazar_agendar(
  p_nome text, p_email text, p_cpf text, p_celular text, p_horario_id smallint,
  p_como_soube text, p_aceita_novidades boolean, p_aceita_termos boolean, p_ip_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_celular text := regexp_replace(coalesce(p_celular, ''), '\D', '', 'g');
  v_pepper text;
  v_hash text;
  v_horario public.bazar_horarios;
  v_ocupadas integer;
  v_recentes integer;
  v_id uuid;
  v_restantes integer;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{32,128}$' then
    return jsonb_build_object('ok', false, 'erro', 'REQUISICAO_INVALIDA');
  end if;

  select count(*) into v_recentes
  from public.bazar_tentativas
  where ip_hash = p_ip_hash and criado_em > now() - interval '10 minutes';

  if v_recentes >= 8 then
    return jsonb_build_object('ok', false, 'erro', 'MUITAS_TENTATIVAS');
  end if;

  insert into public.bazar_tentativas (ip_hash) values (p_ip_hash);
  delete from public.bazar_tentativas where criado_em < now() - interval '2 days';

  if not exists (
    select 1 from public.bazar_config
    where id = 1 and aberto
      and (now() at time zone 'America/Sao_Paulo')::date < evento_data
  ) then
    return jsonb_build_object('ok', false, 'erro', 'INSCRICOES_ENCERRADAS');
  end if;

  if char_length(v_nome) < 3 then return jsonb_build_object('ok', false, 'erro', 'NOME_INVALIDO'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then return jsonb_build_object('ok', false, 'erro', 'EMAIL_INVALIDO'); end if;
  if not public.bazar_cpf_valido(v_cpf) then return jsonb_build_object('ok', false, 'erro', 'CPF_INVALIDO'); end if;
  if v_celular !~ '^[0-9]{10,11}$' then return jsonb_build_object('ok', false, 'erro', 'CELULAR_INVALIDO'); end if;
  if coalesce(p_como_soube, '') not in ('Indicação de Amigos','Instagram','Facebook','WhatsApp','Passando na rua','Outro') then
    return jsonb_build_object('ok', false, 'erro', 'ORIGEM_INVALIDA');
  end if;
  if p_aceita_termos is not true then return jsonb_build_object('ok', false, 'erro', 'TERMOS_OBRIGATORIOS'); end if;

  select * into v_horario from public.bazar_horarios where id = p_horario_id and ativo;
  if not found then return jsonb_build_object('ok', false, 'erro', 'HORARIO_INVALIDO'); end if;

  select decrypted_secret into v_pepper
  from vault.decrypted_secrets where name = 'bazar_cpf_pepper' limit 1;

  if v_pepper is null then return jsonb_build_object('ok', false, 'erro', 'CONFIGURACAO_AUSENTE'); end if;

  v_hash := encode(
    extensions.hmac(convert_to(v_cpf,'UTF8'), convert_to(v_pepper,'UTF8'), 'sha256'),
    'hex'
  );

  if exists (select 1 from public.bazar_inscricoes where cpf_hash = v_hash) then
    return jsonb_build_object('ok', false, 'erro', 'CPF_JA_CADASTRADO');
  end if;

  perform 1 from public.bazar_horarios where id = v_horario.id for update;

  select count(*) into v_ocupadas from public.bazar_inscricoes where horario_id = v_horario.id;
  if v_ocupadas >= v_horario.vagas_max then
    return jsonb_build_object('ok', false, 'erro', 'HORARIO_ESGOTADO');
  end if;

  insert into public.bazar_inscricoes (
    nome, cpf_hash, cpf_mascarado, email, celular,
    horario_id, como_soube, aceita_novidades, aceita_termos
  ) values (
    v_nome, v_hash, '***.***.***-' || right(v_cpf, 2), v_email, v_celular,
    v_horario.id, p_como_soube, coalesce(p_aceita_novidades, false), true
  ) returning id into v_id;

  delete from public.bazar_tentativas where ip_hash = p_ip_hash;
  v_restantes := greatest(v_horario.vagas_max - v_ocupadas - 1, 0);

  return jsonb_build_object(
    'ok', true, 'protocolo', v_id,
    'horario', to_char(v_horario.hora, 'HH24:MI'),
    'vagas_restantes', v_restantes
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'erro', 'CPF_JA_CADASTRADO');
end;
$$;

create table if not exists public.bazar_admin_sessoes (
  token_hash text primary key,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null
);

create index if not exists bazar_admin_sessoes_expira_idx
  on public.bazar_admin_sessoes (expira_em);

create or replace function public.bazar_admin_login(p_senha text, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_recentes integer;
  v_token text;
  v_resultado jsonb;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{32,128}$' then
    return jsonb_build_object('ok', false, 'erro', 'REQUISICAO_INVALIDA');
  end if;

  select count(*) into v_recentes
  from public.bazar_admin_tentativas
  where ip_hash = p_ip_hash and criado_em > now() - interval '10 minutes';

  if v_recentes >= 10 then
    return jsonb_build_object('ok', false, 'erro', 'MUITAS_TENTATIVAS');
  end if;

  insert into public.bazar_admin_tentativas (ip_hash) values (p_ip_hash);
  delete from public.bazar_admin_tentativas where criado_em < now() - interval '2 days';

  select senha_hash into v_hash from public.bazar_admin where id = 1;
  if v_hash is null then return jsonb_build_object('ok', false, 'erro', 'ADMIN_NAO_CONFIGURADO'); end if;
  if extensions.crypt(coalesce(p_senha, ''), v_hash) <> v_hash then
    return jsonb_build_object('ok', false, 'erro', 'SENHA_INVALIDA');
  end if;

  delete from public.bazar_admin_tentativas where ip_hash = p_ip_hash;
  delete from public.bazar_admin_sessoes where expira_em < now();

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.bazar_admin_sessoes (token_hash, expira_em)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '12 hours');

  select jsonb_build_object(
    'total', (select count(*) from public.bazar_inscricoes),
    'gerado_em', now(),
    'evento', (select jsonb_build_object('nome', evento_nome, 'data', evento_data) from public.bazar_config where id = 1),
    'horarios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'hora', to_char(h.hora, 'HH24:MI'),
        'vagas_max', h.vagas_max,
        'ocupadas', (select count(*) from public.bazar_inscricoes i where i.horario_id = h.id)
      ) order by h.hora)
      from public.bazar_horarios h where h.ativo
    ), '[]'::jsonb),
    'inscricoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'protocolo', i.id, 'nome', i.nome, 'cpf', i.cpf_mascarado,
        'email', i.email, 'celular', i.celular,
        'horario', to_char(h.hora, 'HH24:MI'),
        'como_soube', i.como_soube, 'novidades', i.aceita_novidades,
        'criado_em', i.criado_em
      ) order by h.hora, i.nome)
      from public.bazar_inscricoes i
      join public.bazar_horarios h on h.id = i.horario_id
    ), '[]'::jsonb)
  ) into v_resultado;

  return jsonb_build_object('ok', true, 'token', v_token, 'dados', v_resultado);
end;
$$;

create or replace function public.bazar_admin_dados_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_resultado jsonb;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'erro', 'SESSAO_EXPIRADA');
  end if;

  if not exists (
    select 1 from public.bazar_admin_sessoes
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
      and expira_em > now()
  ) then
    return jsonb_build_object('ok', false, 'erro', 'SESSAO_EXPIRADA');
  end if;

  select jsonb_build_object(
    'total', (select count(*) from public.bazar_inscricoes),
    'gerado_em', now(),
    'evento', (select jsonb_build_object('nome', evento_nome, 'data', evento_data) from public.bazar_config where id = 1),
    'horarios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'hora', to_char(h.hora, 'HH24:MI'),
        'vagas_max', h.vagas_max,
        'ocupadas', (select count(*) from public.bazar_inscricoes i where i.horario_id = h.id)
      ) order by h.hora)
      from public.bazar_horarios h where h.ativo
    ), '[]'::jsonb),
    'inscricoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'protocolo', i.id, 'nome', i.nome, 'cpf', i.cpf_mascarado,
        'email', i.email, 'celular', i.celular,
        'horario', to_char(h.hora, 'HH24:MI'),
        'como_soube', i.como_soube, 'novidades', i.aceita_novidades,
        'criado_em', i.criado_em
      ) order by h.hora, i.nome)
      from public.bazar_inscricoes i
      join public.bazar_horarios h on h.id = i.horario_id
    ), '[]'::jsonb)
  ) into v_resultado;

  return jsonb_build_object('ok', true, 'dados', v_resultado);
end;
$$;

drop function if exists public.bazar_admin_dados(text, text);

alter table public.bazar_admin_sessoes enable row level security;
revoke all on public.bazar_admin_sessoes from anon, authenticated;
revoke all on function public.bazar_agendar(text, text, text, text, smallint, text, boolean, boolean, text) from public, anon, authenticated;
revoke all on function public.bazar_admin_login(text, text) from public, anon, authenticated;
revoke all on function public.bazar_admin_dados_token(text) from public, anon, authenticated;
grant execute on function public.bazar_agendar(text, text, text, text, smallint, text, boolean, boolean, text) to service_role;
grant execute on function public.bazar_admin_login(text, text) to service_role;
grant execute on function public.bazar_admin_dados_token(text) to service_role;

-- Legado: remove políticas públicas e fecha funções/sequences antigas.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('cadastros','agendamentos','calendario_vagas','aux_dias_semana','teste')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

revoke execute on function public.fn_cadastrar_cliente(character varying, character, character varying, character varying) from public, anon, authenticated;
revoke execute on procedure public.sp_agendar_vaga(integer, integer) from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
