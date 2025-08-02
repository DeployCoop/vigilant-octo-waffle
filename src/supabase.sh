#!/usr/bin/env bash
THIS_THING=supabase
source src/common.sh

main () {
  #set -eux
  set -eu
  initializer "${this_cwd}/init/pre-${THIS_THING}"
  argoRunner "$THIS_THING"
  #initializer "${this_cwd}/init/${THIS_THING}"
}

time main
