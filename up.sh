#!/usr/bin/env bash
source ./src/check_cmd.bash
check_cmd kubectl
check_cmd argocd
source ./.env
source ./src/w8.bash
source ./src/initializer.bash
this_cwd=$(pwd)

main () {
  set -e
  ./secrets.sh
  if [[ $K8S_TYPE == "kind" ]]; then
    ./kindDown.sh
    sleep 1
    ./kindUp.sh
  elif [[ $K8S_TYPE == "k3s" ]]; then
    kubectl get nodes
    if [[ $? == 0 ]]; then
      echo "kube cluster is installed, proceeding"
    else
      echo "kube cluster is not installed, exiting"
      exit 1
    fi
  else
    echo "K8S_TYPE is not set, aborting!"
    exit 1
  fi
  set -eu
  #kubectl apply -f https://kind.sigs.k8s.io/examples/ingress/deploy-ingress-nginx.yaml
  cd $this_cwd/src
  if [[ $K8S_TYPE == "kind" ]]; then
    ./nginx.sh
  else
    echo 'k3s uses traefik'
  fi
  ./openebs.sh
  ./certmanager.sh
  ./argocd.sh
  ./kubegres.sh

  # no stop error block for the w8s which might have errant errors as they wait
  set +e
  # kubegres
  w8_pod kubegres-system kubegres-controller-manager
  #openEBS
  w8_pod openebs openebs-localpv-provisioner
  w8_pod openebs openebs-lvm-localpv-controller
  w8_pod openebs openebs-lvm-localpv-node
  # wait on kubegres to settle
  kubectl_native_wait kubegres-system $(kubectl get po -n kubegres-system|grep kubegres-controller-manager|cut -f1 -d ' ')
  set -e
  echo "Deploying DeployCoop components:"
  cd $this_cwd
  initializer $this_cwd/src/cluster_init
  cd $this_cwd
  initializer $this_cwd/src/keycloak_init

  echo 'w8 argocd'
  w8_ingress argocd argocd-server-ingress 
  sleep 15
  echo 'init argo pass'
  cd $this_cwd
  ./src/argocd-init-pass.sh
  ./src/part2.sh
}

time main
