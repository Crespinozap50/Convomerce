\set ON_ERROR_STOP on

begin;
set local role commerce_owner;

-- D-153 (docs/decisions.md): live finding — "¿Tienen tacos de birria?" fell
-- to the generic fallback even though "Tacos de birria" is a real, active
-- catalog item (D-099). Root cause: a plain question about a specific
-- product is deliberately ceded to the knowledge capability (D-078), which
-- can only answer from curated FAQ entries — it has no live connection to
-- the catalog, and writing one static FAQ per menu item doesn't scale. The
-- project owner chose to enable `consultative_recommendations` for Santos
-- Tacos, the same AI-assisted capability CrediCel already uses, instead of
-- hand-writing per-product FAQs. Verified live afterward (see D-153): the
-- exact same question now gets "Sí, tenemos Tacos de birria: ..." with two
-- real alternatives. Applied first via the real KnowledgeService.
-- saveCapabilities() (not hand SQL) — this just persists that state so a
-- reprovisioned database doesn't regress to the old behavior.
select set_config('app.tenant_id','0194f000-0000-7000-8000-000000000001',true);

insert into app.tenant_capabilities(tenant_id,capability,enabled)
values ('0194f000-0000-7000-8000-000000000001','consultative_recommendations',true)
on conflict(tenant_id,capability) do update set enabled=excluded.enabled,updated_at=now();

commit;
