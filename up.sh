#!/usr/bin/env bash
source ./src/check_cmd.bash
check_cmd kubectl
check_cmd argocd
set -a && source ./.env && set +a
source ./src/w8.bash
source ./src/initializer.bash
export this_cwd=$(pwd)

main () {
  set -e
  src/secrets.sh
  if [[ $THIS_K8S_TYPE == "kind" ]]; then
    src/kindDown.sh
    sleep 1
    if [[ ${THIS_REG_ENABLE} == "true" ]]; then
      src/localregistry_start.sh
    fi
    src/kindUp.sh
    if [[ ${THIS_REG_ENABLE} == "true" ]]; then
      #src/registry-proxy.sh
      src/localregistry_setupnodes.sh
    fi
  elif [[ $THIS_K8S_TYPE == "k3s" ]]; then
    kubectl get nodes
    if [[ $? == 0 ]]; then
      echo "kube cluster is installed, proceeding"
    else
      echo "kube cluster is not installed, exiting"
      exit 1
    fi
  else
    echo "THIS_K8S_TYPE is not set, aborting!"
    exit 1
  fi
  set -eu
  initializer "$this_cwd/init/cluster"
  kubectl apply -f ${THIS_SECRETS}.yaml
  #kubectl apply -f https://kind.sigs.k8s.io/examples/ingress/deploy-ingress-nginx.yaml
  if [[ $THIS_K8S_TYPE == "kind" ]]; then
    src/nginx.sh
  else
    echo 'k3s uses traefik'
  fi
  #openEBS
  src/openebs.sh
  # certmanager
  src/certmanager.sh
  # kubegres
  src/kubegres.sh
  initializer "$this_cwd/init/keycloak"
  ./src/part2.sh
}

time main
