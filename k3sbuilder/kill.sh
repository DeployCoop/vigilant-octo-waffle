#!/usr/bin/env bash
TMP=$(mktemp)
trap "rm ${TMP}" EXIT
TARGETS=$(shuf targets)
set -eu

echo 'killing all hosts in parallel'

echo /usr/local/bin/k3s-uninstall.sh > $TMP
for TARGET in ${TARGETS}; do
  export TARGET=${TARGET}
  envsubst '${TARGET}' < killr.tpl >> $TMP
done
cat $TMP
#exit 0
parallel -j 99 -- < ${TMP}
