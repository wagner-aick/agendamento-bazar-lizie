-- =============================================================================
-- Celular passa a ser opcional.
--   - coluna aceita NULL
--   - CHECK só valida quando há número
--   - bazar_agendar aceita vazio e grava NULL
-- =============================================================================

alter table public.bazar_inscricoes
  alter column celular drop not null;

alter table public.bazar_inscricoes
  drop constraint if exists bazar_inscricoes_celular_check;

alter table public.bazar_inscricoes
  add constraint bazar_inscricoes_celular_check
  check (celular is null or celular ~ '^[0-9]{10,11}$') not valid;

alter table public.bazar_inscricoes
  validate constraint bazar_inscricoes_celular_check;

create or replace function public.bazar_agendar(
  p_nome             text,
  p_email            text,
  p_cpf              text,
  p_celular          text,
  p_horario_id       smallint,
  p_como_soube       text,
  p_aceita_novidades boolean,
  p_aceita_termos    boolean,
  p_ip_hash          text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome      text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_email     text := lower(btrim(coalesce(p_email, '')));
  v_cpf       text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_celular   text := regexp_replace(coalesce(p_celular, ''), '\D', '', 'g');
  v_pepper    text;
  v_hash      text;
  v_horario   public.bazar_horarios;
  v_ocupadas  integer;
  v_recentes  integer;
  v_id        uuid;
  v_restantes integer;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{32,128}$' then
    raise exception 'REQUISICAO_INVALIDA';
  end if;

  select count(*) into v_recentes
  from public.bazar_tentativas
  where ip_hash = p_ip_hash
    and criado_em > now() - interval '10 minutes';

  if v_recentes >= 8 then
    raise exception 'MUITAS_TENTATIVAS';
  end if;

  insert into public.bazar_tentativas (ip_hash) values (p_ip_hash);

  delete from public.bazar_tentativas
  where criado_em < now() - interval '2 days';

  -- Ainda não abriu: responde 403 sem criar inscrição.
  if exists (
    select 1
    from public.bazar_config
    where id = 1
      and aberto
      and abre_em is not null
      and now() < abre_em
  ) then
    raise exception 'AGENDAMENTO_NAO_ABERTO';
  end if;

  -- Encerra à 00:00 do dia do evento, no fuso de São Paulo.
  if not exists (
    select 1
    from public.bazar_config
    where id = 1
      and aberto
      and (abre_em is null or now() >= abre_em)
      and (now() at time zone 'America/Sao_Paulo')::date < evento_data
  ) then
    raise exception 'INSCRICOES_ENCERRADAS';
  end if;

  if char_length(v_nome) < 3 then
    raise exception 'NOME_INVALIDO';
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then
    raise exception 'EMAIL_INVALIDO';
  end if;

  if not public.bazar_cpf_valido(v_cpf) then
    raise exception 'CPF_INVALIDO';
  end if;

  -- Celular opcional: valida apenas quando informado.
  if v_celular <> '' and v_celular !~ '^[0-9]{10,11}$' then
    raise exception 'CELULAR_INVALIDO';
  end if;

  if coalesce(p_como_soube, '') not in (
    'Indicação de Amigos',
    'Instagram',
    'Facebook',
    'WhatsApp',
    'Passando na rua',
    'Outro'
  ) then
    raise exception 'ORIGEM_INVALIDA';
  end if;

  if p_aceita_termos is not true then
    raise exception 'TERMOS_OBRIGATORIOS';
  end if;

  select * into v_horario
  from public.bazar_horarios
  where id = p_horario_id and ativo;

  if not found then
    raise exception 'HORARIO_INVALIDO';
  end if;

  select decrypted_secret into v_pepper
  from vault.decrypted_secrets
  where name = 'bazar_cpf_pepper'
  limit 1;

  if v_pepper is null then
    raise exception 'CONFIGURACAO_AUSENTE';
  end if;

  v_hash := encode(
    extensions.hmac(
      convert_to(v_cpf, 'UTF8'),
      convert_to(v_pepper, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  if exists (select 1 from public.bazar_inscricoes where cpf_hash = v_hash) then
    raise exception 'CPF_JA_CADASTRADO';
  end if;

  perform 1
  from public.bazar_horarios
  where id = v_horario.id
  for update;

  select count(*) into v_ocupadas
  from public.bazar_inscricoes
  where horario_id = v_horario.id;

  if v_ocupadas >= v_horario.vagas_max then
    raise exception 'HORARIO_ESGOTADO';
  end if;

  insert into public.bazar_inscricoes (
    nome, cpf_hash, cpf_mascarado, email, celular,
    horario_id, como_soube, aceita_novidades, aceita_termos
  ) values (
    v_nome,
    v_hash,
    '***.***.***-' || right(v_cpf, 2),
    v_email,
    nullif(v_celular, ''),
    v_horario.id,
    p_como_soube,
    coalesce(p_aceita_novidades, false),
    true
  )
  returning id into v_id;

  v_restantes := greatest(v_horario.vagas_max - v_ocupadas - 1, 0);

  return jsonb_build_object(
    'ok', true,
    'protocolo', v_id,
    'horario', to_char(v_horario.hora, 'HH24:MI'),
    'vagas_restantes', v_restantes
  );
exception
  when unique_violation then
    raise exception 'CPF_JA_CADASTRADO';
end;
$$;

revoke all on function public.bazar_agendar(text, text, text, text, smallint, text, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.bazar_agendar(text, text, text, text, smallint, text, boolean, boolean, text) to service_role;
