#!/usr/bin/env bash
YQ_INSTALL_TMP=$(mktemp -d)
trap 'rmdir ${YQ_INSTALL_TMP}' EXIT
# Set your platform variables (adjust as needed)
VERSION=v4.50.1
PLATFORM=linux_amd64

# Download compressed binary
wget https://github.com/mikefarah/yq/releases/download/${VERSION}/yq_${PLATFORM}.tar.gz -O - |\
  tar xz && sudo mv yq_${PLATFORM} /usr/local/bin/yq
rm yq.1
rm install-man-page.sh
