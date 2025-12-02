#!/usr/bin/env bash
source src/sourceror.bash

if [[ $# -eq 3 ]]; then
MK_NEW_SECRET_NAME=$1
MK_NEW_SECRET_KEY=$2
MK_NEW_SECRET_CONTENT=$3
else
    echo "wrong number of args $#"
    exit 1
fi

kubectl create secret generic "${MK_NEW_SECRET_NAME}" \
    -n "${THIS_NAMESPACE}" \
    --from-literal="${MK_NEW_SECRET_KEY}"="${MK_NEW_SECRET_CONTENT}"
