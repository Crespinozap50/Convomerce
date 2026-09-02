# ORM recommendation

## Decision

Do not introduce a full ORM as the authority for the PostgreSQL schema or migrations.

PostgreSQL is intentionally part of the security and consistency architecture: forced Row-Level Security, tenant context, composite tenant foreign keys, security-definer functions, partial indexes, transactional outbox constraints, and database roles are not incidental persistence details. Keeping reviewed SQL migrations as the source of truth makes these guarantees explicit and testable.

## Application access

The NestJS application should continue using parameterized SQL through the existing database service for security-sensitive transactions and functions. If query volume later makes mapping repetitive, a typed query layer may be introduced for compile-time assistance, provided that it:

- does not generate or own migrations;
- does not bypass tenant transactions or RLS;
- supports raw SQL and PostgreSQL-specific features;
- preserves composite tenant keys;
- does not hide transaction boundaries.

Kysely or generated types from the live schema would be preferable to a stateful ORM in this architecture. Prisma or TypeORM should not become the schema authority. A narrowly scoped ORM could still be used for isolated read models, but mixing two migration systems is prohibited.

## Revisit criteria

Reconsider a typed query builder when repetitive row mapping becomes a measurable maintenance problem, after the domain and migrations stabilize. Do not add it preemptively merely to reduce a small amount of SQL.
