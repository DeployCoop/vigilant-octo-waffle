#!/usr/bin/env bash

prober () {
  if [[ $# -eq 1 ]]; then
  TARGET=$1
  else
    echo "wrong number of args: $#"
    echo "useage: $0 kernel_mod"
    echo "e.g. $0 nvme_tcp"
    exit 1
  fi
  lsmod | grep $TARGET
  if [[ $? -eq 0 ]]; then
    echo 'module found'
    exit 0
  else
    sudo modprobe $TARGET
    echo $TARGET | sudo tee -a /etc/modules-load.d/$TARGET.conf
  fi
}

for arg in "$@"; do
  prober "${arg}"
done
