#!/usr/bin/env bash
THIS_THING=nextjs-docker
source ./src/common.sh

main () {
  argoRunner "${THIS_THING}"
}

time main
