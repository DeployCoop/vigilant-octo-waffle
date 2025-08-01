#!/usr/bin/env bash
source src/sourceror.bash

mkblock () {
  TARGET=$1
  envsubst < src/hosts|tail -n +2|awk '{print $2}'|cut -f1 -d.|sed "s/$/\t\t14400\tIN\tA\t$TARGET/"
}

for i in $@; do 
  mkblock $i
done
