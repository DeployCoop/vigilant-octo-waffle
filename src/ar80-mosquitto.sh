#!/usr/bin/env bash
THIS_THING=ar80-mosquitto
source src/common.sh

main () {
  set -eu
  #initializer "${this_cwd}/init/pre-${THIS_THING}"
  argoRunner "${THIS_THING}"
  initializer "${this_cwd}/init/${THIS_THING}"
  w8_pod "${THIS_NAMESPACE}" "ar80-mosquitto-${THIS_NAME}"
}
time main
