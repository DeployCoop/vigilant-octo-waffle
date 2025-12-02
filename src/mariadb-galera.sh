#!/usr/bin/env bash
THIS_THING=mariadb-galera
source src/common.sh

main () {
  set -eu
  src/mksecret.sh "${THIS_MARIADB_ROOT_SECRET}" "${THIS_MARIADB_ROOT_KEY}" "${THIS_MARIADB_ROOT_PASSWORD}"
  initializer "${this_cwd}/init/${THIS_THING}"
}
time main
