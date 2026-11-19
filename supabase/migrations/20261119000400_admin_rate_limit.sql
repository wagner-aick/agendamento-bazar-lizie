-- =============================================================================
-- Limite de tentativas do painel: conta apenas falhas e zera ao acertar.
-- Assim um login correto nunca deixa a equipe bloqueada.
-- =============================================================================

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
    return jsonb_build_object('ok', false, 'erro', 'REQUISICAO_INVALIDA');
  end if;

  select count(*) into v_recentes
  from public.bazar_admin_tentativas
  where ip_hash = p_ip_hash
    and criado_em > now() - interval '10 minutes';

  if v_recentes >= 10 then
    return jsonb_build_object('ok', false, 'erro', 'MUITAS_TENTATIVAS');
  end if;

  insert into public.bazar_admin_tentativas (ip_hash) values (p_ip_hash);
  delete from public.bazar_admin_tentativas where criado_em < now() - interval '2 days';

  select senha_hash into v_hash from public.bazar_admin where id = 1;
  if v_hash is null then
    return jsonb_build_object('ok', false, 'erro', 'ADMIN_NAO_CONFIGURADO');
  end if;

  if extensions.crypt(coalesce(p_senha, ''), v_hash) <> v_hash then
    return jsonb_build_object('ok', false, 'erro', 'SENHA_INVALIDA');
  end if;

  -- Login correto zera o contador deste IP.
  delete from public.bazar_admin_tentativas where ip_hash = p_ip_hash;

  select jsonb_build_object(
    'total', (select count(*) from public.bazar_inscricoes),
    'gerado_em', now(),
    'evento', (
      select jsonb_build_object('nome', evento_nome, 'data', evento_data)
      from public.bazar_config where id = 1
    ),
    'horarios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id,
        'hora', to_char(h.hora, 'HH24:MI'),
        'vagas_max', h.vagas_max,
        'ocupadas', (select count(*) from public.bazar_inscricoes i where i.horario_id = h.id)
      ) order by h.hora)
      from public.bazar_horarios h where h.ativo
    ), '[]'::jsonb),
    'inscricoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'protocolo', i.id,
        'nome', i.nome,
        'cpf', i.cpf_mascarado,
        'email', i.email,
        'celular', i.celular,
        'horario', to_char(h.hora, 'HH24:MI'),
        'como_soube', i.como_soube,
        'novidades', i.aceita_novidades,
        'criado_em', i.criado_em
      ) order by h.hora, i.nome)
      from public.bazar_inscricoes i
      join public.bazar_horarios h on h.id = i.horario_id
    ), '[]'::jsonb)
  ) into v_resultado;

  return jsonb_build_object('ok', true, 'dados', v_resultado);
end;
$$;

revoke all on function public.bazar_admin_dados(text, text) from public, anon, authenticated;
grant execute on function public.bazar_admin_dados(text, text) to service_role;
