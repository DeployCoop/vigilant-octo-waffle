#!/usr/bin/env bash
TARGET=$1
source src/sourceror.bash
envsubst < src/hosts|awk '{print $2}'|cut -f1 -d.|sed "s/$/\t\t14400\tIN\tA\t$TARGET/"
