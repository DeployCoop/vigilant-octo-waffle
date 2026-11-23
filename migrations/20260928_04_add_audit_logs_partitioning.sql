-- 20260928_04_add_audit_logs_partitioning
-- Audit log as a range-partitioned table on created_at, so old
-- partitions can be detached and dropped without locking the live
-- table. The first partition covers 2026 Q4; later partitions are
-- added by follow-up migrations.
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants (id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS audit_logs_2026_q4
  PARTITION OF audit_logs
  FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
