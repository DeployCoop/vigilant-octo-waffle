#!/usr/bin/env bash
set -eux
ARGOCD_VERSION=$(curl --silent "https://api.github.com/repos/argoproj/argo-cd/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
TMP=$(mktemp -d argocd_cli_tmp.XXXXXXX --suffix .tmp.d)
trap 'rm -Rf $TMP' EXIT

curl -sSL -o ${TMP}/argocd-${ARGOCD_VERSION} https://github.com/argoproj/argo-cd/releases/download/${ARGOCD_VERSION}/argocd-linux-amd64
chmod +x ${TMP}/argocd-${ARGOCD_VERSION}
sudo mv ${TMP}/argocd-${ARGOCD_VERSION} /usr/local/bin/argocd
