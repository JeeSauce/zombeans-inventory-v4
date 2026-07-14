-- Phase 8 production detail renders safe failure state, but production_orders uses an explicit
-- authenticated column allowlist from 0017_production_rls.sql. Keep actor and idempotency metadata
-- server-only while making only the two UI-required fields readable.
grant select (failed_at, failure_reason)
  on public.production_orders
  to authenticated;
