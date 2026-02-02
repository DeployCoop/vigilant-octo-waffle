#!/usr/bin/env bash
set -eux
. src/util.bash

curl -L https://istio.io/downloadIstioctl | sh -
if [[ -f ${HOME}/.zshrc ]]; then
 echo 'Attempting to add the binary to your PATH using export PATH=$HOME/.istioctl/bin:$PATH'
 linerrr 'export PATH=$HOME/.istioctl/bin:$PATH' ${HOME}/.zshrc
else
  echo add the binary to your PATH using export PATH=$HOME/.istioctl/bin:$PATH
fi
