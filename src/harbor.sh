#!/usr/bin/env bash
set -e 
source .env
source ./src/w8.bash
source ./src/initializer.bash
this_cwd=$(pwd)

main () {
  #set -eux
  set -eu

  envsubst < argo/goharbor/argocd.yaml | argocd app create --name supabase --grpc-web -f -
}

time main
