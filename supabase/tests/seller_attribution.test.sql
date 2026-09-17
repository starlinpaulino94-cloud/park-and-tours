-- ============================================================================
-- 0058 — Atribución comercial: el histórico es de verdad un histórico.
--
-- Lo que se comprueba aquí no se puede comprobar desde TypeScript, porque la
-- promesa la sostiene la base: que una fila del embudo NO se pueda editar ni
-- borrar. Esa es la diferencia entre un comentario que dice «inmutable» y un
-- dato con el que se puede pagar dinero seis semanas después.
--
-- Se comprueba además lo que un enlace impreso en un QR necesita: que su slug
-- sea único en TODO el sistema (dos inquilinos no pueden repetirlo, o el
-- visitante acabaría en la operadora equivocada), y que el disparador de
-- aislamiento siga rechazando referencias cruzadas entre empresas.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f supabase/tests/seller_attribution.test.sql
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

\set org   '22222222-2222-2222-2222-222222222222'
\set other '88888888-8888-8888-8888-888888888888'

insert into organizations (id, name, kind, currency) values
  (:'org',   'Operadora de prueba', 'tenant', 'usd'),
  (:'other', 'Operadora ajena',     'tenant', 'usd');

insert into seller (id, organization_id, code, first_name) values
  ('11110000-0000-0000-0000-000000000001', :'org',   'RAF-001', 'Rafael'),
  ('11110000-0000-0000-0000-000000000002', :'other', 'AJE-001', 'Ajeno');

insert into customer (id, organization_id, first_name, last_name) values
  ('22220000-0000-0000-0000-000000000001', :'org',   'Ana',  'Cliente'),
  ('22220000-0000-0000-0000-000000000002', :'org',   'Luis', 'Cliente'),
  ('22220000-0000-0000-0000-000000000003', :'other', 'Otra', 'Empresa');

-- ─────────────────────────────────────────────────────────────────────────────
-- El enlace del vendedor
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org   uuid := '22222222-2222-2222-2222-222222222222';
  other uuid := '88888888-8888-8888-8888-888888888888';
begin
  insert into seller_link (id, organization_id, seller_id, slug, name, channel)
  values ('33330000-0000-0000-0000-000000000001', org,
          '11110000-0000-0000-0000-000000000001', 'RAF001', 'QR mostrador Bahía', 'qr');

  -- Un QR pegado en un mostrador resuelve la empresa él solo: el slug no puede
  -- repetirse ENTRE inquilinos o el visitante acabaría comprándole a otro.
  begin
    insert into seller_link (organization_id, seller_id, slug)
    values (other, '11110000-0000-0000-0000-000000000002', 'RAF001');
    raise exception 'se admitió el mismo slug en dos empresas distintas';
  exception when unique_violation then null;
  end;

  -- Y tampoco distinguiendo mayúsculas: un QR se teclea a mano cuando la
  -- cámara falla, y «raf001» tiene que ser el mismo enlace.
  begin
    insert into seller_link (organization_id, seller_id, slug)
    values (org, '11110000-0000-0000-0000-000000000001', 'raf001');
    raise exception 'se admitió el mismo slug cambiando solo las mayúsculas';
  exception when unique_violation then null;
  end;

  -- El canal declarado está acotado: un canal inventado rompería el embudo.
  begin
    insert into seller_link (organization_id, seller_id, slug, channel)
    values (org, '11110000-0000-0000-0000-000000000001', 'OTRO', 'telepatia');
    raise exception 'se admitió un canal inventado';
  exception when check_violation then null;
  end;

  -- Aislamiento: el enlace de esta empresa no puede colgar de un vendedor ajeno.
  begin
    insert into seller_link (organization_id, seller_id, slug)
    values (org, '11110000-0000-0000-0000-000000000002', 'CRUZADO');
    raise exception 'se admitió un enlace apuntando al vendedor de otra empresa';
  exception when others then
    if sqlerrm not like '%tenant%' and sqlerrm not like '%organization%' then raise; end if;
  end;

  raise notice 'seller_link: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- El embudo: se escribe una vez y no se toca más
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org uuid := '22222222-2222-2222-2222-222222222222';
  hecho uuid;
begin
  -- Una visita anónima: todavía no hay cliente, solo la cookie.
  insert into seller_attribution
    (organization_id, seller_id, link_id, visitor_id, stage, channel, landing)
  values (org, '11110000-0000-0000-0000-000000000001',
          '33330000-0000-0000-0000-000000000001', 'vis-abc', 'visit', 'qr', '/reservar/demo')
  returning id into hecho;

  if (select customer_id from seller_attribution where id = hecho) is not null then
    raise exception 'una visita anónima no debería nacer con cliente';
  end if;

  -- LA ÚNICA EDICIÓN PERMITIDA: enlazar la visita anónima con la ficha que
  -- nace después. Eso no reescribe el hecho, lo completa.
  update seller_attribution
     set customer_id = '22220000-0000-0000-0000-000000000001'
   where id = hecho;

  -- …y una sola vez. Cambiarle el cliente a un hecho ya escrito sería mover
  -- una comisión de un vendedor a otro sin dejar rastro.
  begin
    update seller_attribution
       set customer_id = '22220000-0000-0000-0000-000000000002'
     where id = hecho;
    raise exception 'se admitió cambiar el cliente de un hecho ya completado';
  exception when check_violation then null;
  end;

  -- Todo lo demás es inmutable. La etapa es lo primero que alguien intentaría
  -- «arreglar» para que le cuadre un embudo.
  begin
    update seller_attribution set stage = 'purchase' where id = hecho;
    raise exception 'se admitió cambiar la etapa de un hecho';
  exception when check_violation then null;
  end;

  begin
    update seller_attribution
       set seller_id = '11110000-0000-0000-0000-000000000001', created_at = now() - interval '1 day'
     where id = hecho;
    raise exception 'se admitió retrasar la fecha de un hecho';
  exception when check_violation then null;
  end;

  begin
    update seller_attribution set channel = 'whatsapp' where id = hecho;
    raise exception 'se admitió cambiar el canal de un hecho';
  exception when check_violation then null;
  end;

  -- Y no se borra. Borrar el hecho que sostiene una comisión pagada es la
  -- forma más limpia de que un descuadre no se pueda explicar.
  begin
    delete from seller_attribution where id = hecho;
    raise exception 'se admitió borrar un hecho del embudo';
  exception when check_violation then null;
  end;

  if (select count(*) from seller_attribution where id = hecho) <> 1 then
    raise exception 'el hecho desapareció pese al disparador';
  end if;

  -- La etapa está acotada: una etapa inventada no aparecería en ningún embudo
  -- y la fila sería invisible en vez de ruidosa.
  begin
    insert into seller_attribution (organization_id, seller_id, stage)
    values (org, '11110000-0000-0000-0000-000000000001', 'curioseo');
    raise exception 'se admitió una etapa inventada';
  exception when check_violation then null;
  end;

  -- Aislamiento: no se puede atribuirle a esta empresa un cliente de otra.
  begin
    insert into seller_attribution (organization_id, seller_id, customer_id, stage)
    values (org, '11110000-0000-0000-0000-000000000001',
            '22220000-0000-0000-0000-000000000003', 'signup');
    raise exception 'se admitió atribuir el cliente de otra empresa';
  exception when others then
    if sqlerrm not like '%tenant%' and sqlerrm not like '%organization%' then raise; end if;
  end;

  raise notice 'seller_attribution: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- La política de la empresa y su ventana
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org uuid := '22222222-2222-2222-2222-222222222222';
begin
  -- El defecto premia la captación: quien lo trajo.
  if (select attribution_policy from organizations where id = org) <> 'first' then
    raise exception 'el defecto de la política de atribución no es «first»';
  end if;
  if (select attribution_window_days from organizations where id = org) <> 30 then
    raise exception 'el defecto de la ventana de atribución no es 30 días';
  end if;

  update organizations set attribution_policy = 'last'    where id = org;
  update organizations set attribution_policy = 'booking' where id = org;

  begin
    update organizations set attribution_policy = 'la_que_sea' where id = org;
    raise exception 'se admitió una política de atribución inventada';
  exception when check_violation then null;
  end;

  -- Cero es válido a propósito: significa «no caduca nunca».
  update organizations set attribution_window_days = 0 where id = org;

  begin
    update organizations set attribution_window_days = -1 where id = org;
    raise exception 'se admitió una ventana de atribución negativa';
  exception when check_violation then null;
  end;

  raise notice 'politica de atribucion: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- El catálogo de tipos de vendedor
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org uuid := '22222222-2222-2222-2222-222222222222';
  tipo uuid;
begin
  insert into seller_type (organization_id, name) values (org, 'Hotel') returning id into tipo;

  -- Existe justamente para que «Hotel» sea un tipo y no dos: sin el catálogo,
  -- una regla de comisión por tipo dejaría de pagar por una mayúscula.
  begin
    insert into seller_type (organization_id, name) values (org, 'Hotel');
    raise exception 'se admitió el mismo tipo de vendedor dos veces';
  exception when unique_violation then null;
  end;

  update seller set seller_type_id = tipo where id = '11110000-0000-0000-0000-000000000001';

  -- Borrar el tipo no borra al vendedor ni le deja un puntero roto.
  delete from seller_type where id = tipo;
  if (select seller_type_id from seller where id = '11110000-0000-0000-0000-000000000001') is not null then
    raise exception 'al borrar el tipo quedó un puntero colgado en el vendedor';
  end if;

  raise notice 'seller_type: TODAS LAS ASERCIONES PASARON';
end $$;

rollback;
