#!/usr/bin/env bash
set -eu
echo "==> Installing FluxCD CLI"
curl -s https://fluxcd.io/install.sh | sudo bash
echo "==> Flux CLI installed successfully: $(flux --version)"
