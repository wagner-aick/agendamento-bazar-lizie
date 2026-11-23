-- =============================================================================
-- Painel: chegada do cliente e exclusão da inscrição
-- =============================================================================

alter table public.bazar_inscricoes
  add column if not exists chegou_em timestamptz;

create table if not exists public.bazar_admin_auditoria (
  id bigint generated always as identity primary key,
  token_hash text not null,
  acao text not null,
  inscricao_id uuid,
  nome text,
  horario text,
  criado_em timestamptz not null default now()
);

create index if not exists bazar_admin_auditoria_data_idx
  on public.bazar_admin_auditoria (criado_em desc);

create or replace function public.bazar_admin_presencas(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_lista jsonb;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'erro', 'SESSAO_EXPIRADA');
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  if not exists (
    select 1 from public.bazar_admin_sessoes
    where token_hash = v_hash and expira_em > now()
  ) then
    return jsonb_build_object('ok', false, 'erro', 'SESSAO_EXPIRADA');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'chegou_em', i.chegou_em
  )), '[]'::jsonb)
  into v_lista
  from public.bazar_inscricoes i;

  return jsonb_build_object('ok', true, 'presencas', v_lista);
end;
$$;

create or replace function public.bazar_admin_presenca(p_token text, p_id uuid, p_chegou boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_nome text;
  v_horario text;
  v_chegou timestamptz;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'erro', 'SESSAO_EXPIRADA');
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  if not exists (
    select 1 from public.bazar_admin_sessoes
    where token_hash = v_hash and expira_em > now()
  ) then
    return jsonb_build_object('ok', false, 'erro', 'SESSAO_EXPIRADA');
  end if;

  select i.nome, to_char(h.hora, 'HH24:MI')
    into v_nome, v_horario
  from public.bazar_inscricoes i
  join public.bazar_horarios h on h.id = i.horario_id
  where i.id = p_id;

  if not found then
    return jsonb_build_object('ok', false, 'erro', 'NAO_ENCONTRADO');
  end if;

  update public.bazar_inscricoes
  set chegou_em = case
    when p_chegou then coalesce(chegou_em, now())
    else null
  end
  where id = p_id
  returning chegou_em into v_chegou;

  insert into public.bazar_admin_auditoria (token_hash, acao, inscricao_id, nome, horario)
  values (
    v_hash,
    case when p_chegou then 'chegada' else 'saida' end,
    p_id, v_nome, v_horario
  );

  return jsonb_build_object('ok', true, 'chegou_em', v_chegou);
end;
$$;

create or replace function public.bazar_admin_excluir(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_nome text;
  v_horario text;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'erro', 'SESSAO_EXPIRADA');
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  if not exists (
    select 1 from public.bazar_admin_sessoes
    where token_hash = v_hash and expira_em > now()
  ) then
    return jsonb_build_object('ok', false, 'erro', 'SESSAO_EXPIRADA');
  end if;

  select i.nome, to_char(h.hora, 'HH24:MI')
    into v_nome, v_horario
  from public.bazar_inscricoes i
  join public.bazar_horarios h on h.id = i.horario_id
  where i.id = p_id;

  if not found then
    return jsonb_build_object('ok', false, 'erro', 'NAO_ENCONTRADO');
  end if;

  delete from public.bazar_inscricoes where id = p_id;

  insert into public.bazar_admin_auditoria (token_hash, acao, inscricao_id, nome, horario)
  values (v_hash, 'excluir', p_id, v_nome, v_horario);

  return jsonb_build_object('ok', true, 'removidos', 1);
end;
$$;

alter table public.bazar_admin_auditoria enable row level security;
revoke all on public.bazar_admin_auditoria from anon, authenticated;
revoke all on function public.bazar_admin_presencas(text) from public, anon, authenticated;
revoke all on function public.bazar_admin_presenca(text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.bazar_admin_excluir(text, uuid) from public, anon, authenticated;
grant execute on function public.bazar_admin_presencas(text) to service_role;
grant execute on function public.bazar_admin_presenca(text, uuid, boolean) to service_role;
grant execute on function public.bazar_admin_excluir(text, uuid) to service_role;
