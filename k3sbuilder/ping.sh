#!/usr/bin/env bash
TMP=$(mktemp)
trap "rm ${TMP}" EXIT
TARGETS=$(shuf targets)
set -eu

echo 'pinging all hosts in parallel'

for TARGET in ${TARGETS}; do
  export TARGET=${TARGET}
  envsubst '${TARGET}' < ping.tpl >> $TMP
done
cat $TMP
#exit 0
parallel -j 99 -- < ${TMP}
