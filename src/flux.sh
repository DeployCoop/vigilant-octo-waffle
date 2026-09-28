#!/usr/bin/env bash
THIS_THING=flux
source src/common.sh
export this_cwd=$(pwd)
TMP=$(mktemp -d --suffix .tmp.d)
trap 'rm -rf ${TMP}' EXIT

main() {
  set -eu
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi

  local flux_ns="${THIS_FLUX_NAMESPACE:-flux-system}"
  local flux_ver="${THIS_FLUX_VERSION:-v2.5.1}"
  local flux_method="${THIS_FLUX_METHOD:-yaml}"

  echo "==> Setting up FluxCD namespace: ${flux_ns}"
  src/namespacer.sh "${flux_ns}"

  if [[ "${flux_method}" == "cli" ]] && command -v flux >/dev/null 2>&1; then
    echo "==> Installing FluxCD via flux CLI"
    flux install --namespace="${flux_ns}"
  else
    echo "==> Installing FluxCD (${flux_ver}) via official release manifests"
    kubectl apply \
      --server-side \
      --force-conflicts \
      -f "https://github.com/fluxcd/flux2/releases/download/${flux_ver}/install.yaml"
  fi

  echo "==> Waiting for FluxCD controllers in namespace: ${flux_ns}"
  w8_all_namespace "${flux_ns}"

  echo "==> Initializing primary GitRepository source for cluster"
  cat <<EOF | envsubst | kubectl apply -f -
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: vow-repo
  namespace: ${flux_ns}
spec:
  interval: ${THIS_FLUX_INTERVAL:-5m}
  url: ${THIS_REPO_URL}
  ref:
    branch: ${THIS_FLUX_BRANCH:-main}
EOF

  if [[ -d "$this_cwd/init/flux_${THIS_CLUSTER_INGRESS}" ]]; then
    echo "==> Deploying Ingress for FluxCD components (${THIS_CLUSTER_INGRESS})"
    initializer "$this_cwd/init/flux_${THIS_CLUSTER_INGRESS}"
  fi

  echo "==> FluxCD (${flux_ver}) is ready and running alongside ArgoCD"
}

time main
