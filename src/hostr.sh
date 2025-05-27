#!/usr/bin/env bash
: "${DEBUG:=0}"
set -eu
if [[ -f ./.env ]]; then
set -a && source ./.env && set +a
else
  echo 'no env'
  exit 1
fi
TMP=$(mktemp -d)
trap 'rm -Rf $TMP' EXIT
envsubst < "src/hosts" > "$TMP/hosts"
touched=0

linerrr () {
  if [[ ! $# -eq 1 ]]; then
    echo "wrong args $#"
    exit 1
  fi
  line_to_add=$1
  if ! grep -q "$line_to_add" /etc/hosts; then
    touched=1
    echo "$line_to_add" | sudo tee -a /etc/hosts > /dev/null
    echo "$line_to_add added to /etc/hosts"
  else
    if [[ ${DEBUG} -eq 1 ]]; then
      echo "$line_to_add already exists in /etc/hosts"
    fi
  fi
}

while read -r line
do
  linerrr "$line"
done < "$TMP/hosts"

if [[ ${touched} -eq 1 ]]; then
  echo '/etc/hosts file has been updated'
else
  echo 'no changes were necessary /etc/hosts file up to date'
fi

