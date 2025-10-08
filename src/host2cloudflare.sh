#!/usr/bin/env bash
set -a && source ./src/default.env && set +a
# source src/sourceror.bash
if [[ $# -lt 1 ]]; then
  echo 'useage:'
  echo "$0 1.2.3.4 1.2.3.5"
  exit 1
fi

mkblock () {
  TARGET=$1
  envsubst < src/hosts|tail -n +2|awk '{print $2}'|cut -f1 -d.|sed "s/$/\t1\tIN\tA\t$TARGET ; cf_tags=cf-proxied:false/"
}

for i in $@; do 
  mkblock $i
done
