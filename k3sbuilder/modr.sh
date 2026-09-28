#!/usr/bin/env bash
THIS_CWD=$(pwd)
TMP=$(mktemp)
trap "rm ${TMP}" EXIT
TARGETS=$(shuf targets)
export MODS='nvme_tcp nvme_fabrics nvme_auth nvme_keyring nvme_tcp nvme_core'
set -eu

echo '' > ${TMP}
for TARGET in ${TARGETS}; do
  export TARGET=${TARGET}
  export THIS_CWD=${THIS_CWD}
  export MODS=${MODS}
  envsubst '${MODS} ${THIS_CWD} ${TARGET}' < kmodr.tpl >> $TMP
done
cat $TMP
parallel -j 99 -- < ${TMP}

echo '' > ${TMP}
for TARGET in ${TARGETS}; do
  export TARGET=${TARGET}
  export THIS_CWD=${THIS_CWD}
  export MODS=${MODS}
  envsubst '${MODS} ${THIS_CWD} ${TARGET}' < modr.tpl >> $TMP
done
cat $TMP
parallel -j 99 -- < ${TMP}
