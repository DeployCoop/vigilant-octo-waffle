#!/usr/bin/env bash
set -e 
set -a && source ./.env && set +a
source ./src/w8.bash
source ./src/initializer.bash
this_cwd=$(pwd)

main () {
  #set -eux
  set -eu

  echo 'sometimes github.com fails to resolve if these creates hit too quick'
  echo 'still investigating as to what is causing it'
  echo "run this script ($0) again after a slight rest if this fails"
  sleep 5


  echo 'w8 argocd'
  w8_ingress argocd argocd-server-ingress 
  sleep 15
  echo 'init argo pass'
  cd $this_cwd
  ./src/argocd-init-pass.sh

  set -u
  ${this_cwd}/src/harbor.sh
  ${this_cwd}/src/kube-prometheus-stack.sh
  ${this_cwd}/src/openldap.sh
  ${this_cwd}/src/openproject.sh
  ${this_cwd}/src/nextcloud.sh
  ${this_cwd}/src/supabase.sh
  ${this_cwd}/src/bao.sh
  initializer "${this_cwd}/init/bao"
  ${this_cwd}/src/nextjs-docker.sh
}

time main
