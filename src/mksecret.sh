#!/usr/bin/env bash
source src/sourceror.bash
: "${THIS_SECRET_KEY:=username}"

if [[ $# -eq 2 ]]; then
MK_NEW_SECRET_NAME=$1
MK_NEW_SECRET_CONTENT=$2
else
    echo "wrong number of args $#"
    exit 1
fi

kubectl create secret generic "${MK_NEW_SECRET_NAME}" \
    -n "${THIS_NAMESPACE}" \
    --from-literal="${THIS_SECRET_KEY}"="${MK_NEW_SECRET_CONTENT}"
