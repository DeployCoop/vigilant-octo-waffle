#!/usr/bin/env bash
if [[ ! $# -eq 1 ]]; then
  echo "useage: "
  echo "$0 appName"
  exit 1
fi
THIS_THING=$1
source src/sourceror.bash

cp -av src/argo_example "argo/${THIS_THING}"
sed -i "s/REPLACEME_THING_REPLACEME/${THIS_THING}/g" "argo/${THIS_THING}/argocd.yaml"
cp -av src/example.sh "src/${THIS_THING}.sh"
sed -i "s/REPLACEME_THING_REPLACEME/${THIS_THING}/g" "src/${THIS_THING}.sh"
line=$(printf '127.0.0.1 %s.${THIS_DOMAIN}\n' "${THIS_THING}")
linerrr "$line" "src/hosts"
sorterrr "src/hosts"
varname=$(echo -n "${THIS_THING}_ENABLED" | tr '[:lower:]' '[:upper:]' | tr '-' '_' )
line="$varname=true"
linerrr "$line" "src/example.env.enabler"
line="src/${THIS_THING}.sh"
linerrr "$line" "src/big_list"
sorterrr "src/big_list"

exit 0
