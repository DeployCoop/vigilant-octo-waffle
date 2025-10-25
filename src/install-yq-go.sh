#!/usr/bin/env bash
# Set your platform variables (adjust as needed)
VERSION=v4.2.0
PLATFORM=linux_amd64

# Download compressed binary
wget https://github.com/mikefarah/yq/releases/download/${VERSION}/yq_${PLATFORM}.tar.gz -O - |\
  tar xz && sudo mv yq_${PLATFORM} /usr/local/bin/yq
