-- D-194 (docs/decisions.md): reemplaza la mesa fija de domicilio por un
-- patrón de nombre — el negocio real ahora mantiene un pool de mesas
-- ("Bot Convomerce 1", "Bot Convomerce 2", ...) y el sistema elige en vivo
-- la primera libre en cada pedido (LoggroOrderSyncService.resolveAvailableTable).
-- Reemplazo limpio, no un flag de compatibilidad: home_delivery_table_id
-- apuntaba a una mesa fija que el dueño del proyecto ya eliminó en Loggro,
-- y solo existe una fila real (Santos Tacos, piloto).
set role commerce_owner;

alter table app.pos_connections drop column home_delivery_table_id;
alter table app.pos_connections add column table_name_pattern text;

reset role;
