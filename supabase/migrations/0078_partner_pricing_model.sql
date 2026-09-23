-- 0078 — Cómo gana dinero cada tour center: comisión o neto. Declarado.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EL RIESGO ES ECONÓMICO, NO DE DATOS
--
-- Hay dos formas de trabajar con un canal externo, y el sistema soporta las dos
-- por separado sin saber que son excluyentes:
--
--   COMISIÓN — el tour center vende al precio de tarifa y la operadora le
--              reconoce un porcentaje. Lo hace `commission-engine`.
--   NETO     — el tour center COMPRA a un precio rebajado y revende al precio
--              que quiera. Su margen ya está dentro del neto. Lo hace el motor
--              de precios con una regla para ese socio.
--
-- `generateCommissionsForBooking` empuja un beneficiario de tipo socio en
-- CUANTO la reserva tiene socio, sin preguntar nada más. Así que un socio con
-- tarifa neta cobra su margen dos veces: una en el precio y otra en la
-- liquidación. Y no se ve el día de la venta —las dos cifras son correctas por
-- separado— sino un mes después, cuando alguien compara la liquidación con el
-- contrato.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ EN LA RELACIÓN Y NO EN LA ORGANIZACIÓN
--
-- Porque es del CONTRATO: la misma agencia puede trabajar a comisión con una
-- operadora y a neto con otra. Mismo sitio y mismo motivo que las condiciones
-- aceptadas de 0073.
alter table organization_relationships
  add column if not exists pricing_model text not null default 'commission'
    check (pricing_model in ('commission','net'));

comment on column organization_relationships.pricing_model is
  'Cómo gana el socio (0078). `commission`: vende a tarifa y se le liquida un '
  'porcentaje. `net`: compra rebajado y su margen ya está en el precio, así '
  'que NO devenga comisión — con las dos cosas cobraría dos veces.';

-- El valor por defecto es `commission` y no `net` a propósito: es lo que hace
-- hoy el sistema con todos los socios existentes. Nacer en `net` les quitaría
-- la comisión a todos de golpe en el despliegue, que es el mismo apagón
-- silencioso que evita la siembra de 0077, con el signo cambiado.
--
-- Las filas que ya existen toman el valor por defecto sin tocarlas, así que no
-- hace falta relleno. Se deja dicho para que no se busque.
