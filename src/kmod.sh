#!/usr/bin/env bash
if [[ $# -eq 1 ]]; then
TARGET=$1
else
  echo "wrong number of args: $#"
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
