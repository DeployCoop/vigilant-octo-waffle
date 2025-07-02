#!/usr/bin/env bash
THIS_THING=bao
source ./src/common.sh


main () {
  set -eu

  initializer "${this_cwd}/init/bao"
  argoRunner "$THIS_THING"
}

time main
