-- 0087 · parte 5 de 5 — Contestar es UNA sola escritura.
--
-- Ejecuta las partes 1 a 4 ANTES que esta.
--
-- QUÉ HACE
--  · Crea la función que gasta el enlace y escribe la respuesta A LA VEZ. El
--    cliente HTTP de la aplicación no sabe abrir una transacción, y partirlo en
--    dos tiene dos formas de salir mal: marcar usado y fallar al escribir deja
--    al proveedor sin poder contestar y sin constar que contestó; escribir y
--    fallar al marcar usado deja el enlace vivo, y entonces no es de un solo
--    uso.
--  · Y solo la puede llamar el servidor: se revoca a todo el mundo y se concede
--    a `service_role`.
--
-- NO borra ni cambia ninguna fila.

create or replace function public.respond_to_supplier_service(
  p_token_hash   text,
  p_answer       text,
  p_note         text,
  p_confirmation text
) returns jsonb
  language plpgsql security definer set search_path = public, app
as $fn3$
declare
  v_role     text := coalesce(auth.jwt() ->> 'role', 'service_role');
  v_tok      record;
  v_estado   text;
  v_supplier uuid;
begin
  -- FALLA CERRADA: `security definer` se salta la RLS, y esta función acepta
  -- servicios en nombre de una empresa. Solo la llama el servidor.
  if v_role <> 'service_role' then
    raise exception 'Esta función solo la llama el servidor'
      using errcode = 'insufficient_privilege';
  end if;

  if p_answer not in ('accepted', 'rejected') then
    raise exception 'La respuesta solo puede ser aceptada o rechazada'
      using errcode = 'check_violation';
  end if;

  select * into v_tok
    from supplier_response_token
   where token_hash = p_token_hash
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- Revocado y gastado se distinguen. No es una fuga —quien pregunta ya tiene
  -- el enlace— y es la diferencia entre «esto ya lo contestaste» y «este
  -- servicio se le dio a otro», que son dos llamadas de teléfono distintas.
  if v_tok.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if v_tok.used_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;
  if v_tok.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  -- EL ESTADO DEL RECURSO SE MIRA ANTES DE GASTAR EL ENLACE. Si ya se contestó
  -- desde el portal, el enlace no se consume: el proveedor que lo abra después
  -- verá «ya contestado» y no «este enlace no sirve», y podrá volver a usarlo
  -- si alguien deshace la respuesta.
  execute format(
    'select acceptance, supplier_id from %I where id = $1 and organization_id = $2 for update',
    v_tok.resource_kind
  ) into v_estado, v_supplier using v_tok.resource_id, v_tok.organization_id;

  if v_estado is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- Y sigue siendo suyo. El disparador de reasignación revoca los enlaces,
  -- pero comprobarlo aquí también es lo que hace que esto no dependa de que
  -- aquel haya corrido.
  if v_supplier is distinct from v_tok.supplier_id then
    return jsonb_build_object('ok', false, 'reason', 'reassigned');
  end if;
  if v_estado <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_answered', 'state', v_estado);
  end if;

  execute format(
    'update %I set acceptance = $1, responded_at = now(), response_note = $2, '
    'responded_via = ''enlace'', confirmation_number = $3 where id = $4',
    v_tok.resource_kind
  ) using p_answer, p_note,
          case when p_answer = 'accepted' then p_confirmation else null end,
          v_tok.resource_id;

  update supplier_response_token set used_at = now() where id = v_tok.id;

  return jsonb_build_object(
    'ok', true,
    'resource_kind', v_tok.resource_kind,
    'resource_id', v_tok.resource_id,
    'answer', p_answer,
    'confirmation_number', case when p_answer = 'accepted' then p_confirmation else null end
  );
end;
$fn3$;

revoke execute on function public.respond_to_supplier_service(text, text, text, text)
  from anon, public, authenticated;
grant execute on function public.respond_to_supplier_service(text, text, text, text)
  to service_role;

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- Tiene que salir `security definer` y que NI anon NI authenticated puedan
-- ejecutarla: si pudieran, cualquiera aceptaría servicios de cualquier empresa.
select p.prosecdef as es_definer,
       has_function_privilege('anon', p.oid, 'execute') as la_puede_llamar_anon,
       has_function_privilege('authenticated', p.oid, 'execute') as la_puede_llamar_un_usuario,
       has_function_privilege('service_role', p.oid, 'execute') as la_puede_llamar_el_servidor
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'respond_to_supplier_service';
