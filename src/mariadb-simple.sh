#!/usr/bin/env bash
THIS_THING=mariadb-simple
source src/common.sh

main () {
  set -eu
  src/mksecret.sh "${THIS_MARIADB_ROOT_SECRET}" "${THIS_MARIADB_ROOT_KEY}" "${THIS_MARIADB_ROOT_PASSWORD}"
  src/mksecret.sh "${THIS_MARIADB_DB_SECRET}" "${THIS_MARIADB_DB_KEY}" "${THIS_MARIADB_DB_PASSWORD}"
  initializer "${this_cwd}/init/${THIS_THING}"
}
time main
