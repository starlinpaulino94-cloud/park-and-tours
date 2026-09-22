-- SEMBRADOR DEMO - TROZO 08 de 08. Ejecutar EN ORDEN, del 01 al 08.
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
  ('leads', (select count(*) from lead where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('tareas', (select count(*) from task where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('almacen', (select count(*) from inventory_item where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones')))
) as t(modulo, filas) order by modulo;
