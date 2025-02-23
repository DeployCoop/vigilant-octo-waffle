#!/usr/bin/env bash
main () {
  set -eux
  kind delete cluster --name=vigilant-octo-waffle
}
time main
