-- =============================================================================
-- Painel da equipe — autenticação por senha e leitura das inscrições
--
-- A senha NÃO é gravada por esta migração. Configure depois com:
--
--   insert into public.bazar_admin (id, senha_hash)
--   values (1, extensions.crypt('SUA_SENHA', extensions.gen_salt('bf', 12)))
--   on conflict (id) do update
--     set senha_hash = excluded.senha_hash,
--         atualizado_em = now();
--
-- Guardamos apenas o hash bcrypt. A função é SECURITY DEFINER, exige a senha
-- correta e devolve todas as inscrições para a Edge Function "admin".
-- =============================================================================

create table if not exists public.bazar_admin (
  id smallint primary key default 1 check (id = 1),
  senha_hash text not null,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.bazar_admin_tentativas (
  id bigint generated always as identity primary key,
  ip_hash text not null check (char_length(ip_hash) between 32 and 128),
  criado_em timestamptz not null default now()
);

create index if not exists bazar_admin_tentativas_ip_idx
  on public.bazar_admin_tentativas (ip_hash, criado_em desc);
create index if not exists bazar_admin_tentativas_data_idx
  on public.bazar_admin_tentativas (criado_em);

create or replace function public.bazar_admin_dados(p_senha text, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_recentes integer;
  v_resultado jsonb;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{32,128}$' then
    raise exception 'REQUISICAO_INVALIDA';
  end if;

  -- 10 tentativas por IP a cada 10 minutos (guarda só o hash do IP).
  select count(*) into v_recentes
  from public.bazar_admin_tentativas
  where ip_hash = p_ip_hash
    and criado_em > now() - interval '10 minutes';

  if v_recentes >= 10 then
    raise exception 'MUITAS_TENTATIVAS';
  end if;

  insert into public.bazar_admin_tentativas (ip_hash) values (p_ip_hash);

  delete from public.bazar_admin_tentativas
  where criado_em < now() - interval '2 days';

  select senha_hash into v_hash
  from public.bazar_admin
  where id = 1;

  if v_hash is null then
    raise exception 'ADMIN_NAO_CONFIGURADO';
  end if;

  if extensions.crypt(coalesce(p_senha, ''), v_hash) <> v_hash then
    raise exception 'SENHA_INVALIDA';
  end if;

  select jsonb_build_object(
    'total', (select count(*) from public.bazar_inscricoes),
    'gerado_em', now(),
    'evento', (
      select jsonb_build_object('nome', evento_nome, 'data', evento_data)
      from public.bazar_config
      where id = 1
    ),
    'horarios', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', h.id,
          'hora', to_char(h.hora, 'HH24:MI'),
          'vagas_max', h.vagas_max,
          'ocupadas', (
            select count(*) from public.bazar_inscricoes i where i.horario_id = h.id
          )
        )
        order by h.hora
      )
      from public.bazar_horarios h
      where h.ativo
    ), '[]'::jsonb),
    'inscricoes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'protocolo', i.id,
          'nome', i.nome,
          'cpf', i.cpf_mascarado,
          'email', i.email,
          'celular', i.celular,
          'horario', to_char(h.hora, 'HH24:MI'),
          'como_soube', i.como_soube,
          'novidades', i.aceita_novidades,
          'criado_em', i.criado_em
        )
        order by h.hora, i.nome
      )
      from public.bazar_inscricoes i
      join public.bazar_horarios h on h.id = i.horario_id
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

alter table public.bazar_admin enable row level security;
alter table public.bazar_admin_tentativas enable row level security;

revoke all on public.bazar_admin from anon, authenticated;
revoke all on public.bazar_admin_tentativas from anon, authenticated;
revoke all on sequence public.bazar_admin_tentativas_id_seq from anon, authenticated;
revoke all on function public.bazar_admin_dados(text, text) from public, anon, authenticated;
grant execute on function public.bazar_admin_dados(text, text) to service_role;

comment on function public.bazar_admin_dados is
  'Retorna todas as inscricoes do bazar após validar a senha do painel (bcrypt).';
