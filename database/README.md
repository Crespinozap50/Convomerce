# Base de datos local

Este directorio contiene el esquema PostgreSQL ejecutable, su provisionamiento
local, semillas completamente ficticias y pruebas SQL automatizadas. PostgreSQL
es la fuente de verdad; no se usa un ORM para administrar estas migraciones.

## Requisitos

- Docker con el complemento Docker Compose.
- Puerto `54329` disponible. Puede cambiarse, por ejemplo, con
  `POSTGRES_PORT=54330 make db-up`.

La contraseña incluida en `docker-compose.yml` es deliberadamente local y
desechable. No corresponde a ningún entorno compartido ni debe reutilizarse.
Los roles de aplicación locales son grupos `NOLOGIN`: todavía no existen
credenciales de NestJS porque el backend está fuera del alcance actual.

## Recorrido recomendado

```bash
make db-up
make db-migrate
make db-seed
make db-test
```

1. `db-up` crea el volumen y espera a que PostgreSQL esté saludable.
2. `db-migrate` crea los roles locales y aplica `database/sql/001...` en orden.
   `app.schema_migrations` guarda nombre, versión, SHA-256 y fecha. Si cambia un
   archivo ya aplicado, el proceso se detiene en vez de ocultar la divergencia.
3. `db-seed` ejecuta en orden todos los archivos de `database/seeds/`, carga
   los dos tenants ficticios y completa el restaurante demo con un escenario
   realista de una taquería en Robledo. Es seguro de repetir.
4. `db-test` ejecuta cada caso dentro de una transacción y termina con
   `ROLLBACK`, por lo que no deja basura de prueba.

## Operación cotidiana

```bash
make db-stop       # detener sin perder el volumen
make db-up         # volver a iniciar
make db-restart    # reiniciar y esperar salud
make db-down       # quitar contenedor/red, conservar datos
make db-psql       # abrir una consola psql
```

`make db-reset` elimina el volumen local, crea una base limpia, migra y carga
semillas. Es destructivo únicamente para los datos locales de este Compose.

## Respaldos

```bash
make db-backup                          # crea database/backups/whatsapp_commerce_<fecha>.dump
make db-restore FILE=database/backups/whatsapp_commerce_20260902_143000.dump
```

`db-backup` usa `pg_dump` en formato comprimido (`-Fc`) y conserva los 10
respaldos más recientes (los más viejos se eliminan solos). `database/backups/`
está en `.gitignore` — nunca se versiona un respaldo con datos reales.

`db-restore` **reemplaza por completo** el contenido de la base con lo que
haya en el archivo indicado; pide confirmación escrita salvo que se agregue
`-y`/`--yes` al final del comando de `restore.sh` directamente.

**Corre `make db-backup` antes de cualquier operación destructiva que vayas a
probar** (una purga masiva, una migración riesgosa, un `db-reset` con datos
que quieras conservar). Esta disciplina nace de un incidente real: una purga
de mensajes se probó una vez directo contra datos compartidos sin respaldo
previo y borró para siempre 46 mensajes reales (ver `docs/decisions.md`, D-060).

## Organización

- `sql/000_roles.template.sql`: contrato de roles para infraestructura; no se
  ejecuta automáticamente y no contiene credenciales.
- `local/000_local_roles.sql`: provisionamiento idempotente solo para Docker.
- `sql/001_initial_schema.sql`: esquema, tablas, restricciones e índices.
- `sql/002_rls_policies.sql`: habilitación y forzado de RLS.
- `sql/003_runtime_grants.sql`: matriz de privilegios mínimos.
- `sql/004...006`: resolución segura y no ambigua del canal de WhatsApp.
- `sql/007`: confirmación controlada y única del identificador de envío externo.
- `seeds/001_demo_tenants.sql`: restaurante y comercio tecnológico ficticios.
- `seeds/002_santos_tacos_robledo.sql`: perfil, capacidades, bot, menú, precios
  y respuestas frecuentes ficticias de Santos Tacos Robledo.
- `tests/001_schema_security_test.sql`: pruebas automatizadas de seguridad e
  integridad.
- `scripts/`: ejecutores pequeños usados por el `Makefile`.

## Qué verifican las pruebas

- RLS no expone filas de otro tenant.
- Sin `app.tenant_id`, las lecturas retornan cero filas y las escrituras fallan.
- Las FK compuestas rechazan relaciones entre tenants.
- Solo hay una conversación no cerrada por contacto y canal.
- Mensajes externos y webhooks son idempotentes.
- Una reversión elimina conjuntamente el cambio de negocio y su evento outbox.
- La marca de consumidor evita aplicar dos veces el mismo evento.
- Runtime, readonly y outbox conservan exactamente los permisos previstos.
- Solo runtime puede invocar el resolver de canal y cada `phone_number_id`
  corresponde como máximo a un canal.

Los datos de semillas usan UUID con bits de versión 7, direcciones y referencias
inventadas. No contienen personas, comercios, teléfonos ni secretos reales.

Consulta [physical-schema.md](physical-schema.md) para el diseño y
[migration-strategy.md](migration-strategy.md) para las reglas de evolución.
