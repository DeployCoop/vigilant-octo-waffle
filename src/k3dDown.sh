#!/usr/bin/env bash

main () {
  set -eu
  k3d cluster delete vigilant-octo-waffle
}

time main
