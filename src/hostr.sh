#!/usr/bin/env bash
source ./src/sourceror.bash

set -eu
if [[ -f ./.env ]]; then
set -a && source ./.env && set +a
else
  echo 'no env'
  exit 1
fi
TMP=$(mktemp -d hostr_tmp.XXXXXXX --suffix .tmp.d)
trap 'rm -Rf $TMP' EXIT
envsubst < "src/hosts" > "$TMP/hosts"
touched=0

while read -r line
do
  linerrr "$line" "/etc/hosts"
done < "$TMP/hosts"

if [[ ${touched} -eq 1 ]]; then
  echo '/etc/hosts file has been updated'
else
  echo 'no changes were necessary /etc/hosts file up to date'
fi

