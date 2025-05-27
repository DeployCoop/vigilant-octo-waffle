#!/usr/bin/env bash
THIS_THING=nextjs-docker
set -eu
set -a && source ./.env && set +a
source ./src/argoRunner.sh

main () {
  argoRunner "$THIS_THING"
}

time main
