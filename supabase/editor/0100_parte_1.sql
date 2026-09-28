-- 0100 · parte 1 de 3 — el reclamo
--
-- Pégalo ENTERO en el editor SQL de Supabase (Ctrl+A, Run). Aguanta ejecutarse
-- dos veces. Las tres partes van EN ORDEN.
--
-- QUÉ ARREGLA. Medido: treinta ventas simultáneas de una plaza contra un cupo
-- garantizado de 10 dejaban `seats_used` en 2, y las treinta pasaban. No es que
-- se pasara del tope: el contador se PERDÍA, y la matriz de cupos enseñaba
-- hueco libre donde el socio ya había vendido tres veces.

-- ═══════════════════════════════════════════════════════════════════════════
-- 0100 — EL CUPO DEL SOCIO SE RECLAMA, NO SE RECALCULA (dimensión F)
--
-- ───────────────────────────────────────────────────────────────────────────
-- LO MEDIDO
--
-- Treinta ventas simultáneas de una plaza contra un cupo garantizado de 10,
-- por el camino que usa la aplicación: **`seats_used` acabó en 2**.
--
-- Las treinta pasaron. `assertAllotment` lee la fila al EMPEZAR la venta y
-- comprueba las plazas que quedan; las treinta leyeron `seats_used = 0` y las
-- treinta vieron sitio. `consumeAllotment` escribe al TERMINARLA
-- `seats_used = <lo que leyó> + pax` — un valor ABSOLUTO calculado sobre una
-- lectura vieja, no un incremento— y entre las dos pasa la venta entera:
-- precio, cupo de la salida, reservas, cobro, monedero.
--
-- Es peor que una sobreventa de plazas, y por un motivo concreto: allí el
-- contador al menos ENSEÑABA el exceso. Aquí el socio vendió 30 plazas de un
-- contrato de 10 y la matriz de cupos dice «2 usadas, 8 libres». El comercial
-- ve hueco donde ya no lo hay, y lo vuelve a vender.
--
-- Y no hace falta concurrencia para que se pierda: dos ventas seguidas que se
-- solapen aunque sea un instante ya pisan una a la otra, porque la segunda
-- escribe sobre lo que leyó antes de que la primera guardara.
--
-- ───────────────────────────────────────────────────────────────────────────
-- LO QUE SE HACE
--
-- El consumo deja de ser «escribe lo que leíste más uno» y pasa a ser una
-- RECLAMACIÓN: una sola sentencia que incrementa **si cabe** y dice si cupo.
-- Sin `select` previo, sin `for update`, sin ventana: el `update` con su
-- condición dentro es atómico por sí mismo, y dos que lleguen a la vez se
-- serializan sobre la misma fila.
--
-- El tope es el mismo que calcula `allotments.ts`, dicho una vez aquí:
--
--     seats - seats_used - seats_released
--
-- Las LIBERADAS restan porque ya no son suyas: volvieron a la venta libre, y
-- contarlas como disponibles sería prometer dos veces la misma plaza.
--
-- ───────────────────────────────────────────────────────────────────────────
-- QUÉ SE DEJA EN LA APLICACIÓN A PROPÓSITO
--
-- Qué tipos de cupo APARTAN plazas (`HOLDS_SEATS`) y cuáles venden contra la
-- capacidad general sigue decidiéndose en `allotments.ts`, que es puro y está
-- probado entero. Repetir esa regla aquí crearía un segundo sitio donde se
-- decide lo mismo, y el día que se separen la diferencia aparecería en el
-- contrato de un socio sin que nada la explique. Esta función solo cuenta.
--
-- Por eso tampoco mira `status` ni temporada: cuando se la llama, la
-- aplicación ya decidió que ESTE cupo aplica a ESTA venta. Lo único que aquí
-- no se puede saber desde fuera es si, en el instante de escribir, todavía
-- quedan plazas — y eso es exactamente lo que devuelve.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.claim_allotment_seats(
  p_allotment uuid,
  p_pax       integer
) returns boolean
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_ok boolean;
begin
  if p_allotment is null then
    raise exception 'Hay que decir de qué cupo se reclaman las plazas'
      using errcode = 'null_value_not_allowed';
  end if;
  -- Un reclamo de cero o negativo no es un reclamo: sería una devolución
  -- disfrazada, y las devoluciones tienen su propia función y su propio tope.
  if p_pax is null or p_pax <= 0 then
    raise exception 'Las plazas que se reclaman de un cupo tienen que ser más de cero'
      using errcode = 'check_violation';
  end if;

  -- LA RECLAMACIÓN, EN UNA SOLA SENTENCIA.
  --
  -- `coalesce` en las tres columnas aunque sean `not null`: si alguna dejara de
  -- serlo, un nulo silencioso convertiría la comparación en `null` —ni cierto
  -- ni falso— y el `update` no tocaría nada, que se leería como «no cabía».
  update allotment
     set seats_used = coalesce(seats_used, 0) + p_pax,
         updated_at = now()
   where id = p_allotment
     and coalesce(seats, 0) - coalesce(seats_used, 0) - coalesce(seats_released, 0) >= p_pax
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;
