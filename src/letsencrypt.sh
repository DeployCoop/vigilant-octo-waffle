#!/usr/bin/env bash
THIS_THING=letsencrypt
source src/common.sh

set -eu
initializer "init/certmanager-LE"
sleep 2
kubectl describe clusterissuer letsencrypt-staging
kubectl describe clusterissuer letsencrypt-production
