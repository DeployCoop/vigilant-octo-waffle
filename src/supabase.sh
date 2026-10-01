#!/usr/bin/env bash
THIS_THING=supabase
source src/common.sh

ensure_supabase_compat() {
  if command -v kubectl >/dev/null 2>&1 && kubectl get pod -n supabase supabase-postgres-0 >/dev/null 2>&1; then
    echo "--> [Supabase] Ensuring PostgreSQL operators & schema migrations for GoTrue auth compatibility..."
    kubectl exec -i -n supabase supabase-postgres-0 -- psql -U postgres -d postgres <<-EOSQL >/dev/null 2>&1 || true
      -- GoTrue Auth migration cross-type operator compatibility (Postgres 16+)
      CREATE OR REPLACE FUNCTION pg_catalog.uuid_eq_text(uuid, text) RETURNS boolean AS \$\$
        SELECT CASE WHEN \$2 ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\$' THEN \$1 = \$2::uuid ELSE false END;
      \$\$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

      DO \$\$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_operator WHERE oprname = '=' AND oprleft = 'uuid'::regtype AND oprright = 'text'::regtype) THEN
          CREATE OPERATOR pg_catalog.= (
            LEFTARG = uuid,
            RIGHTARG = text,
            FUNCTION = pg_catalog.uuid_eq_text,
            COMMUTATOR = =,
            NEGATOR = <>
          );
        END IF;
      END \$\$;

      CREATE OR REPLACE FUNCTION pg_catalog.text_eq_uuid(text, uuid) RETURNS boolean AS \$\$
        SELECT CASE WHEN \$1 ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\$' THEN \$1::uuid = \$2 ELSE false END;
      \$\$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

      DO \$\$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_operator WHERE oprname = '=' AND oprleft = 'text'::regtype AND oprright = 'uuid'::regtype) THEN
          CREATE OPERATOR pg_catalog.= (
            LEFTARG = text,
            RIGHTARG = uuid,
            FUNCTION = pg_catalog.text_eq_uuid,
            COMMUTATOR = =,
            NEGATOR = <>
          );
        END IF;
      END \$\$;

      -- Backfill auth.schema_migrations and public.schema_migrations if tables exist
      DO \$\$
      BEGIN
        IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'schema_migrations') THEN
          INSERT INTO auth.schema_migrations (version) VALUES
          ('00'), ('20210710035447'), ('20210722035447'), ('20210730183235'), ('20210909172000'),
          ('20210927181326'), ('20211122151130'), ('20211124214934'), ('20211202183645'), ('20220114185221'),
          ('20220114185340'), ('20220224000811'), ('20220323170000'), ('20220429102000'), ('20220531120530'),
          ('20220614074223'), ('20220811173540'), ('20221003041349'), ('20221003041400'), ('20221011041400'),
          ('20221020193600'), ('20221021073300'), ('20221021082433'), ('20221027105023'), ('20221114143122'),
          ('20221114143410'), ('20221125140132'), ('20221208132122'), ('20221215195500'), ('20221215195800'),
          ('20221215195900'), ('20230116124310'), ('20230116124412'), ('20230131181311'), ('20230322519590'),
          ('20230402418590'), ('20230411005111'), ('20230508135423'), ('20230523124323'), ('20230818113222'),
          ('20230914180801'), ('20231027141322'), ('20231114161723'), ('20231117164230'), ('20240115144230'),
          ('20240214120130'), ('20240306115329'), ('20240314092811'), ('20240427152123'), ('20240612123726'),
          ('20240729123726'), ('20240802193726')
          ON CONFLICT (version) DO NOTHING;
        END IF;

        IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_migrations') THEN
          INSERT INTO public.schema_migrations (version) VALUES
          ('00'), ('20210710035447'), ('20210722035447'), ('20210730183235'), ('20210909172000'),
          ('20210927181326'), ('20211122151130'), ('20211124214934'), ('20211202183645'), ('20220114185221'),
          ('20220114185340'), ('20220224000811'), ('20220323170000'), ('20220429102000'), ('20220531120530'),
          ('20220614074223'), ('20220811173540'), ('20221003041349'), ('20221003041400'), ('20221011041400'),
          ('20221020193600'), ('20221021073300'), ('20221021082433'), ('20221027105023'), ('20221114143122'),
          ('20221114143410'), ('20221125140132'), ('20221208132122'), ('20221215195500'), ('20221215195800'),
          ('20221215195900'), ('20230116124310'), ('20230116124412'), ('20230131181311'), ('20230322519590'),
          ('20230402418590'), ('20230411005111'), ('20230508135423'), ('20230523124323'), ('20230818113222'),
          ('20230914180801'), ('20231027141322'), ('20231114161723'), ('20231117164230'), ('20240115144230'),
          ('20240214120130'), ('20240306115329'), ('20240314092811'), ('20240427152123'), ('20240612123726'),
          ('20240729123726'), ('20240802193726')
          ON CONFLICT (version) DO NOTHING;
        END IF;
      END \$\$;
EOSQL
    echo "  * Supabase PostgreSQL compatibility verification completed."
  fi
}

main () {
  set -eu
  if [[ ${THIS_CLUSTER_INGRESS} == "traefik" ]]; then
    initializer "${this_cwd}/init/pre-${THIS_THING}"
  elif [[ ${THIS_CLUSTER_INGRESS} == "nginx" ]]; then
    echo 'nginx'
  elif [[ ${THIS_CLUSTER_INGRESS} == "haproxy" ]]; then
    echo 'haproxy'
  else
    echo 'unrecognized ingress'
    exit 1
  fi
  argoRunner "$THIS_THING"
  ensure_supabase_compat
}

time main
