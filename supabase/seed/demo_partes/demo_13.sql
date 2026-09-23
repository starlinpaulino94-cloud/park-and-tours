-- SEMBRADOR DEMO - TROZO 13 de 13. Ejecutar EN ORDEN del 01 al 13.
-- Pegar entero (Ctrl+A, Run). Requiere la migracion 0067 aplicada.

select modulo, filas from (values
  ('productos', (select count(*) from product where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('clientes', (select count(*) from customer where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('salidas', (select count(*) from departure where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('reservas', (select count(*) from booking where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('pagos', (select count(*) from payment where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('facturas', (select count(*) from invoice where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('comisiones', (select count(*) from commission where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('encuestas', (select count(*) from guest_survey where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('tickets', (select count(*) from access_ticket where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('membresias', (select count(*) from membership where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('metas', (select count(*) from seller_goal where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('bonos', (select count(*) from seller_bonus where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('liquidaciones', (select count(*) from settlement where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('nomina_lineas', (select count(*) from payroll_line where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('ordenes_trabajo', (select count(*) from work_order where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('incidentes', (select count(*) from incident where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('leads', (select count(*) from lead where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('almacen', (select count(*) from inventory_item where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones')))
) as t(modulo, filas) order by modulo;
