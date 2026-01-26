#!/usr/bin/env bash

new_method () {
curl -fL "https://get.k3ai.in" -o k3ai.tar.gz
tar -xvzf k3ai.tar.gz \
&& chmod +x ./k3ai \
&& sudo mv ./k3ai /usr/local/bin
}

old_method () {
  #Set a variable to grab latest version
  Version=$(curl -s "https://api.github.com/repos/kf5i/k3ai-core/releases/latest" | awk -F '"' '/tag_name/{print $4}' | cut -c 2-6) 
  # get the binaries
  wget https://github.com/kf5i/k3ai-core/releases/download/v$Version/k3ai-core_${Version}_linux_amd64.tar.gz
  tar zxvf k3ai-core_${Version}_linux_amd64.tar.gz
  chmod +x ./k3ai
  sudo mv ./k3ai /usr/local/bin
}

main () {
  THIS_CWD=$(pwd)
  INSTALL_K3AI_TMP=$(mktemp -d)
  trap 'rm -rf ${INSTALL_K3AI_TMP}' EXIT
  cd ${INSTALL_K3AI_TMP}
  set -eux
  
  old_method
  #new_method
  
  cd ${THIS_CWD}
  exit 0
}

main $@
