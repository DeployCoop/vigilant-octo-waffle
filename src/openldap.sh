#!/usr/bin/env bash
THIS_THING=openldap
source src/common.sh

main () {
  #set -eux
  set -eu
  argoRunner "$THIS_THING"
}

time main
