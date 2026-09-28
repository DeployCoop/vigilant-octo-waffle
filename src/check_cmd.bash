#!/usr/bin/env bash

# Check if a command exists
check_cmd () {
  if [[ $# -eq 1 ]]; then
    if ! type "$1" > /dev/null; then
      echo "$1 was not found in your path!"
      echo "To proceed please install $1 to your path and try again!"
      exit 1
    fi
  else
    echo "ERROR: wrong number of args! ($#)"
    echo 1
  fi
}
#useage
# do_checks

do_cmd_checks () {
  check_cmd argocd
  check_cmd helm
  check_cmd jq
  check_cmd kubectl
  check_cmd openssl
  check_cmd parallel
  check_cmd pwgen
  check_cmd sed
  check_cmd sshuttle
  check_cmd tr
  check_cmd yq
  if [[ $THIS_K8S_TYPE == "kind" ]]; then
    check_cmd kind
    check_cmd docker
  elif [[ $THIS_K8S_TYPE == "k3d" ]]; then
    check_cmd k3d
    check_cmd docker
  elif [[ $THIS_K8S_TYPE == "k3s" ]]; then
    if command -v k3s >/dev/null 2>&1 || [[ -x /usr/local/bin/k3s ]]; then
      # k3s is installed
      :
    elif command -v kubectl >/dev/null 2>&1 && kubectl get nodes >/dev/null 2>&1; then
      # Remote K3s/Kubernetes cluster already connected
      :
    else
      echo "==> Note: k3s was not detected in PATH. K3s cluster bring-up will install/bootstrap it."
      export K3S_AUTO_INSTALL_REQUIRED=true
    fi
  fi
}
