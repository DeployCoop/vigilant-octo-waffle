#!/usr/bin/env bash
: ${KUBECONFIG:=$HOME/.kube/config}
: ${VERBOSITY:=100}
source ./src/squawk.bash

kubectl_native_wait () {
  if [[ $# -eq 2 ]]; then
    TARGET_NAMESPACE=$1
    TARGET_POD=$2
    kubectl wait \
      --namespace $TARGET_NAMESPACE \
      --for=condition=ready pod $TARGET_POD \
      --timeout=120s
  else
    echo 'ERROR: wrong number of arguments!'
    echo "$0 NAMESPACE POD"
  fi
}

w8_kubedns () {
  squawk 3 "wait on Kube-DNS to become available" -n
  sleep 1

  # while loop
  kubedns_countone=1
  # timeout for 15 minutes
  while [[ $kubedns_countone -lt 151 ]]
  do
    squawk 1 '.' -n
    RESULT=$(kubectl --kubeconfig=$KUBECONFIG get po --namespace kube-system |grep kube-dns|grep Running)
    if [[ "$RESULT" ]]; then
        sleep 3
        squawk 1 '.' -n
        squawk 3 "$RESULT"
        break
    fi
    ((++kubedns_countone))
    sleep 3
  done

  echo "Kube-DNS is now up and running"
  sleep 1
}

w8_kubectl () {
  squawk 3 "Wait on the K8S cluster to become available" -n
  squawk 3 "Errors on the first few tries are normal give it a few minutes to spin up" -n
  sleep 15
  # while loop
  countone_w8_kubectl=1
  countlimit_w8_kubectl=151
  # timeout for 15 minutes
  while [[ "$countone_w8_kubectl" -lt "$countlimit_w8_kubectl" ]]; do
    squawk 1 '.' -n
    if [[ "$VERBOSITY" -gt "11" ]] ; then
      squawk 105 "kubectl --kubeconfig=$KUBECONFIG get pods -n kube-system | grep kube-apiserver"
      kubectl --kubeconfig=$KUBECONFIG get pods -n kube-system | grep kube-apiserver
    fi
    result=$(kubectl --kubeconfig=$KUBECONFIG get pods -n kube-system 2>/dev/null | grep kube-apiserver |grep Running)
    squawk 3 "Result is $result"
    if [[ "$result" ]]; then
      squawk 5 "Result nailed $result"
      ((++countone_w8_kubectl))
      break
    fi
    ((++countone_w8_kubectl))
    squawk 209 "$countone_w8_kubectl"
    if [[ "$countone_w8_kubectl" -ge "$countlimit_w8_kubectl"  ]]; then
      croak 3  'Master is not coming up, investigate, breaking'
    fi
    sleep 5
  done
  squawk 3  "."
  squawk 1 "kubectl commands are now able to interact with the kubernetes cluster"
}

w8_node () {
  node_name=$1
  squawk 3 "Wait on the K8S node $node_name to become available"
  sleep 5
  # while loop
  countone_w8_node=1
  countlimit_w8_node=151
  # timeout for 15 minutes
  set +e
  while [[ "$countone_w8_node" -lt "$countlimit_w8_node" ]]; do
    squawk 1 '.' -n
    if [[ "$VERBOSITY" -gt "11" ]] ; then
      squawk 105  "kubectl --kubeconfig=$KUBECONFIG get node $node_name"
      kubectl --kubeconfig=$KUBECONFIG get node $node_name
    fi
    result=$(kubectl --kubeconfig=$KUBECONFIG get node $node_name | grep -v NotReady | grep Ready)
    squawk 133 "Result is $result"
    if [[ "$result" ]]; then
      squawk 5 "Result nailed $result"
      ((++countone_w8_node))
      break
    fi
    ((++countone_w8_node))
    squawk 209 "$countone_w8_node"
    sleep 3
  done
  set -e
  squawk 3  "."
  squawk 3  "kubectl commands are now able to interact with the kubernetes node"
}

w8_ingress () {
  if [[ ! $# -eq 2 ]]; then
    echo 'ERROR: wrong number of arguments!'
    echo "$0 NAMESPACE INGRESS"
    exit 1
  fi
  TARGET_NAMESPACE=$1
  ingress_name=$2
  squawk 3 "Wait on the K8S ingress $ingress_name to become available in the $TARGET_NAMESPACE namespace"
  # while loop
  countone_w8_ingress=1
  countlimit_w8_ingress=151
  # timeout for 15 minutes
  set +e
  while [[ "$countone_w8_ingress" -lt "$countlimit_w8_ingress" ]]; do
    squawk 1 '.' -n
    if [[ "$VERBOSITY" -gt "11" ]] ; then
      squawk 105  "kubectl --kubeconfig=$KUBECONFIG get ingress -n $TARGET_NAMESPACE $ingress_name"
      kubectl --kubeconfig=$KUBECONFIG get ingress -n $TARGET_NAMESPACE $ingress_name
    fi
    result=$(kubectl --kubeconfig=$KUBECONFIG get ingress -n $TARGET_NAMESPACE $ingress_name)
    squawk 133 "Result is $result"
    if [[ "$result" ]]; then
      squawk 5 "Result nailed $result"
      ((++countone_w8_ingress))
      break
    fi
    ((++countone_w8_ingress))
    squawk 209 "$countone_w8_ingress"
    sleep 3
  done
  set -e
  squawk 3  "."
  squawk 3  "kubernetes ingress $ingress_name is up in the $TARGET_NAMESPACE namespace"
}

while_loop_wait () {
  # while loop
  countone=1
  # timeout for 15 minutes
  while [ $countone -lt 151 ]
  do
    echo -n '.'
    set +e
    RESULT=$(kubectl get po --namespace=$TARGET_NAMESPACE | grep $TARGET_POD | grep Running)
    set -e
    if [ "$RESULT" ]; then
        echo '.'
        echo "$RESULT"
        break
    fi
    countone=`expr $countone + 1`
    sleep 3
  done
}

w8_pod () {
  if [ $# -ne 2 ]; then
    # Print usage
    echo -n 'Error! wrong number of arguments'
    echo " [$#]"
    echo 'usage:'
    echo "$0 what-to-wait-for in-what-namespace"
    exit 1
  fi
  TARGET_NAMESPACE=$1
  TARGET_POD=$2
  : ${VERBOSITY:=0}

  echo -n "wait on $TARGET_POD to become available"
  sleep 2
  while_loop_wait
  sleep 2
  echo "$TARGET_POD is now up and running"
}
