#!/usr/bin/env bash
source src/sourceror.bash
source src/util.bash

MK_NEW_SECRET_NAME=$1
MK_NEW_SECRET_CONTENT=$2

kubectl create secret generic "${MK_NEW_SECRET_NAME}" \
    -n "${THIS_NAMESPACE}" \
    --from-literal=username="${MK_NEW_SECRET_CONTENT}"
