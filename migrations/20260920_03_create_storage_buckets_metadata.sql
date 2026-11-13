-- 20260920_03_create_storage_buckets_metadata
-- Metadata for the MinIO-backed storage buckets (objects themselves
-- live in MinIO; this table is the registry the dashboard reads).
CREATE TABLE IF NOT EXISTS storage_buckets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  bucket_name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_storage_buckets_tenant_id ON storage_buckets (tenant_id);
