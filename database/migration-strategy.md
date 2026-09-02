# Estrategia inicial de migraciones

## Objetivo

Mantener cambios PostgreSQL explícitos, revisables y ejecutables sin depender del ORM elegido por NestJS.

## Principios

- SQL versionado es la fuente de verdad del esquema.
- Una migración aplicada nunca se edita; se agrega una nueva.
- Cada migración tiene una operación `up`. Los rollbacks destructivos no se automatizan en producción.
- Los cambios siguen expandir, migrar y contraer cuando puedan afectar datos existentes.
- Las migraciones no contienen secretos, contraseñas ni datos reales de tenants.
- El rol migrator no se usa para atender solicitudes de aplicación.

## Secuencia propuesta

1. `000_roles.template.sql`: plantilla de roles y grants para infraestructura; no se ejecuta automáticamente. Docker usa `local/000_local_roles.sql`.
2. `001_initial_schema.sql`: esquema `app`, función de contexto, tablas, restricciones e índices.
3. `002_rls_policies.sql`: habilitación, forzado y políticas uniformes RLS.
4. `003_runtime_grants.sql`: privilegios mínimos para runtime, outbox y readonly.
5. `004...006`: rol y función mínima para resolver canales autenticados de
   WhatsApp, corrección explícita de ownership y unicidad del identificador.
6. `007`: función estrecha para confirmar un envío sin otorgar actualización
   general sobre `external_message_id`.
7. Migraciones posteriores numeradas, pequeñas y con descripción inmutable.
8. `047`: política, reservas y contadores de presupuesto para redacción con IA por tenant.
9. `048`: privilegio mínimo de lectura de `id` y `timezone` del tenant para interpretar fechas durante conversaciones.

Separar RLS y grants facilita revisar el modelo, pero las tres migraciones 001–003 constituyen una sola entrega de seguridad: la aplicación no puede desplegarse entre ellas.

## Tabla de control

El ejecutor local mantiene `app.schema_migrations` con `version`, `name`,
`checksum` y `applied_at`, y verifica SHA-256 antes de omitir una migración. Una
herramienta futura podrá reemplazar el script, pero debe conservar SQL plano y la
verificación de checksums.

## Flujo por entorno

1. Crear base y roles mediante infraestructura segura.
2. Ejecutar migraciones con `commerce_migrator` bajo bloqueo de migración; cada archivo adopta temporalmente `commerce_owner` mediante `SET ROLE`.
3. Verificar checksums y versión esperada.
4. Ejecutar pruebas de restricciones, RLS y privilegios.
5. Habilitar la nueva versión de NestJS.

## Pruebas obligatorias de base

- Un tenant no lee, inserta ni modifica filas de otro.
- Sin `app.tenant_id`, el rol runtime falla cerrado.
- Una FK compuesta rechaza un padre de otro tenant.
- Solo existe una conversación activa por contacto y canal.
- Mensajes y eventos externos duplicados no producen dos registros lógicos.
- Solo existe un resultado final vigente por conversación.
- El runtime no actualiza ni elimina auditoría.
- El publicador outbox no accede a tablas de negocio.
- Dos publicadores pueden reclamar lotes sin procesar el mismo lease simultáneamente.
- Un consumidor duplicado aplica su efecto una sola vez.

## Cambios incompatibles

Para renombrar o eliminar columnas:

1. Agregar la representación nueva y mantener compatibilidad.
2. Desplegar código que escriba ambas o migre lecturas.
3. Migrar datos por lotes con trazabilidad.
4. Verificar que ningún proceso use la representación antigua.
5. Eliminarla en una migración posterior y una ventana acordada.

## Rollback

El rollback preferido es desplegar una versión compatible hacia adelante. Antes de operaciones destructivas se requiere respaldo verificado y plan explícito. No se incluyen archivos `down.sql` que puedan borrar datos automáticamente.

## Estado actual

Los SQL iniciales se ejecutaron y probaron en PostgreSQL 16 mediante Docker. El
flujo local está documentado en `database/README.md`. No se ha seleccionado ORM
ni se han creado credenciales de aplicación.
