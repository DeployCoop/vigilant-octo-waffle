#!/bin/bash
source ./.env
source ./src/w8.bash
source ./src/initializer.bash
this_cwd=$(pwd)

main () {
  set -eu
  ./secrets.sh
  kind create cluster --config=./src/kind-config.yaml
  #kubectl apply -f https://kind.sigs.k8s.io/examples/ingress/deploy-ingress-nginx.yaml
  cd $this_cwd/src
  ./nginx.sh
  ./openebs.sh
  ./certmanager.sh
  ./argocd.sh
  ./kubegres.sh
  set +e
  w8_pod kubegres-system kubegres-controller-manager
  w8_pod openebs openebs-localpv-provisioner
  w8_pod openebs openebs-lvm-localpv-controller
  w8_pod openebs openebs-lvm-localpv-node
  kubectl_native_wait kubegres-system $(kubectl get po -n kubegres-system|grep kubegres-controller-manager|cut -f1 -d ' ')
  set -e
  echo "Deploying DeployCoop components:"
  initializer $this_cwd/src/cluster_init

  #sleep 3
  #set +e
  w8_ingress argocd argocd-server-ingress 
  set -x
  sleep 5

  cd $this_cwd
  ./src/argocd-init-pass.sh

  ./src/part2.sh
}

time main
