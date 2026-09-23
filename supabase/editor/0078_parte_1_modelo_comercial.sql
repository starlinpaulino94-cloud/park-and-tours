-- 0078 · PARTE 1 — cómo gana dinero cada tour center: comisión o neto.
--
-- Pegar entero y ejecutar. Re-ejecutable.
--
-- Hay dos formas de trabajar con un canal externo y son EXCLUYENTES:
--
--   COMISIÓN — vende al precio de tarifa y se le liquida un porcentaje.
--   NETO     — COMPRA a un precio rebajado y revende al que quiera. Su margen
--              ya está dentro del neto.
--
-- El motor de comisiones empujaba un beneficiario de tipo socio en cuanto la
-- reserva tenía socio, sin preguntar. Un socio con tarifa neta cobraba su
-- margen dos veces: una en el precio y otra en la liquidación. No se ve el día
-- de la venta —las dos cifras son correctas por separado— sino un mes después.
--
-- El valor por defecto es `commission` a propósito: es lo que hace hoy el
-- sistema con todos los socios. Nacer en `net` les quitaría la comisión a todos
-- de golpe en el despliegue. Las filas existentes lo toman sin tocarlas, así
-- que no hace falta relleno.
alter table organization_relationships
  add column if not exists pricing_model text not null default 'commission'
    check (pricing_model in ('commission','net'));

comment on column organization_relationships.pricing_model is
  'Cómo gana el socio (0078). `commission`: vende a tarifa y se le liquida un '
  'porcentaje. `net`: compra rebajado y su margen ya está en el precio, así '
  'que NO devenga comisión — con las dos cosas cobraría dos veces.';
