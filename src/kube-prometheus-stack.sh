#!/usr/bin/env bash
THIS_THING=kube-prometheus-stack
source ./src/common.sh


main () {
  set -eu

  argoRunner "$THIS_THING"
}

time main
