#!/usr/bin/env bash
THIS_CWD=$(pwd)
TMP=$(mktemp)
trap "rm ${TMP}" EXIT
TARGETS=$(shuf targets)
set -eu

echo '' > ${TMP}
for TARGET in ${TARGETS}; do
  export THIS_CWD=${THIS_CWD}
  export TARGET=${TARGET}
  envsubst '${THIS_CWD} ${TARGET}' < filecopierrr.tpl >> $TMP
done
cat $TMP
parallel -j 99 -- < ${TMP}

echo '' > ${TMP}
for TARGET in ${TARGETS}; do
  export THIS_CWD=${THIS_CWD}
  export TARGET=${TARGET}
  envsubst '${THIS_CWD} ${TARGET}' < filerunnerrr.tpl >> $TMP
done
cat $TMP
parallel -j 99 -- < ${TMP}
