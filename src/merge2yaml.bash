#!/usr/bin/env bash

merge2yaml () {
  if [[ $# -eq 2 ]]; then
  OVERRIDE_YAML=$1
  ORIG_YAML=$2
  else
    echo "error: wrong number of args $#" >2
    echo "useage $0 OVERRIDE_YAML ORIG_YAML"
    exit 1
  fi
  yq e ". *+ load($OVERRIDE_YAML)" $ORIG_YAML
}
