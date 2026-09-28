#!/usr/bin/env bash
source src/util.bash
source src/merge2yaml.bash
: "${DEBUG:=false}"

fluxRunner () {
  FLUXRUNNER_TMP=$(mktemp -d --suffix .tmp.d)
  FLUXRUNNER_ENVSUBST=${FLUXRUNNER_TMP}/envsubst.sh
  FLUXRUNNR_INSTALL_TMP=${FLUXRUNNER_TMP}/fluxrunnr.yaml
  trap "rm -rf ${FLUXRUNNER_TMP}" EXIT
  this_cwd=$(pwd)

  if [[ $# -eq 1 ]]; then
    THIS_THING=$1
  else
    echo "wrong number of args $#"
    exit 1
  fi

  set -eu
  if [[ -f ./.env ]]; then
    set -a && source ./.env && set +a
  fi
  if [[ ${VERBOSITY:-100} -gt 10 ]]; then
    set -x
  fi

  local flux_ns="${THIS_FLUX_NAMESPACE:-flux-system}"
  local flux_manifest_src=""

  # 1. Check for dedicated flux manifests & overrides
  if [[ -f ".flux_overrides/${THIS_THING}/flux.yaml" ]]; then
    mkdir -p "${FLUXRUNNER_TMP}/${THIS_THING}"
    if [[ -f "flux/${THIS_THING}/flux.yaml" ]]; then
      merge2yaml ".flux_overrides/${THIS_THING}/flux.yaml" "flux/${THIS_THING}/flux.yaml" > "${FLUXRUNNER_TMP}/${THIS_THING}/flux.yaml"
    else
      cp -a ".flux_overrides/${THIS_THING}/flux.yaml" "${FLUXRUNNER_TMP}/${THIS_THING}/flux.yaml"
    fi
    flux_manifest_src="${FLUXRUNNER_TMP}/${THIS_THING}/flux.yaml"
  elif [[ -f "flux/${THIS_THING}/flux.yaml" ]]; then
    mkdir -p "${FLUXRUNNER_TMP}/${THIS_THING}"
    cp -a "flux/${THIS_THING}/flux.yaml" "${FLUXRUNNER_TMP}/${THIS_THING}/flux.yaml"
    flux_manifest_src="${FLUXRUNNER_TMP}/${THIS_THING}/flux.yaml"
  elif [[ -f "argo/${THIS_THING}/argocd.yaml" ]]; then
    # 2. Seamless interoperability: synthesize Flux manifest from existing Argo Application CRD
    mkdir -p "${FLUXRUNNER_TMP}/${THIS_THING}"
    local argo_src="argo/${THIS_THING}/argocd.yaml"
    if [[ -f ".argo_overrides/${THIS_THING}/argocd.yaml" ]]; then
      merge2yaml ".argo_overrides/${THIS_THING}/argocd.yaml" "argo/${THIS_THING}/argocd.yaml" > "${FLUXRUNNER_TMP}/${THIS_THING}/argo_merged.yaml"
      argo_src="${FLUXRUNNER_TMP}/${THIS_THING}/argo_merged.yaml"
    fi

    local target_ns repo_url chart_path is_helm
    target_ns=$(yq '.spec.destination.namespace // "${THIS_NAMESPACE}"' "${argo_src}")
    repo_url=$(yq '.spec.source.repoURL // "${THIS_REPO_URL}"' "${argo_src}")
    chart_path=$(yq '.spec.source.path // ""' "${argo_src}")
    is_helm=$(yq '.spec.source.helm != null' "${argo_src}")

    local synth_file="${FLUXRUNNER_TMP}/${THIS_THING}/flux.yaml"

    if [[ "${is_helm}" == "true" ]]; then
      cat <<EOF > "${synth_file}"
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: ${THIS_THING}-repo
  namespace: ${flux_ns}
spec:
  interval: \${THIS_FLUX_INTERVAL:-5m}
  url: ${repo_url}
  ref:
    branch: \${THIS_FLUX_BRANCH:-main}
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: ${THIS_THING}
  namespace: ${target_ns}
spec:
  interval: \${THIS_FLUX_INTERVAL:-5m}
  targetNamespace: ${target_ns}
  chart:
    spec:
      chart: ${chart_path}
      sourceRef:
        kind: GitRepository
        name: ${THIS_THING}-repo
        namespace: ${flux_ns}
  values:
EOF
      # Append Helm values if present
      yq '.spec.source.helm.values // ""' "${argo_src}" | sed 's/^/    /' >> "${synth_file}"
    else
      cat <<EOF > "${synth_file}"
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: ${THIS_THING}-repo
  namespace: ${flux_ns}
spec:
  interval: \${THIS_FLUX_INTERVAL:-5m}
  url: ${repo_url}
  ref:
    branch: \${THIS_FLUX_BRANCH:-main}
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: ${THIS_THING}
  namespace: ${flux_ns}
spec:
  interval: \${THIS_FLUX_INTERVAL:-5m}
  targetNamespace: ${target_ns}
  prune: true
  sourceRef:
    kind: GitRepository
    name: ${THIS_THING}-repo
  path: "./${chart_path}"
EOF
    fi
    flux_manifest_src="${synth_file}"
  else
    echo "ERROR: No manifest found for '${THIS_THING}' in flux/ or argo/"
    exit 1
  fi

  # 3. Environment variable interpolation
  echo '#!/usr/bin/env bash' > "${FLUXRUNNER_ENVSUBST}"
  echo 'set -eu' >> "${FLUXRUNNER_ENVSUBST}"
  echo 'envsubst \' >> "${FLUXRUNNER_ENVSUBST}"
  convert_default_env_to_envsubst >> "${FLUXRUNNER_ENVSUBST}"
  echo "< \"${flux_manifest_src}\" \\" >> "${FLUXRUNNER_ENVSUBST}"
  echo "> ${FLUXRUNNR_INSTALL_TMP}" >> "${FLUXRUNNER_ENVSUBST}"

  bash "${FLUXRUNNER_ENVSUBST}"

  if [[ "${DEBUG}" == "true" ]]; then
    cat "${FLUXRUNNR_INSTALL_TMP}"
  fi

  echo "==> Deploying '${THIS_THING}' via FluxCD runner"
  kubectl apply --server-side --force-conflicts -f "${FLUXRUNNR_INSTALL_TMP}"

  # 4. Trigger reconciliation if flux CLI is available or via kubectl annotation
  local now_ts
  now_ts=$(date +%s)
  kubectl annotate --overwrite helmrelease "${THIS_THING}" -n "${THIS_NAMESPACE:-default}" reconcile.fluxcd.io/requestedAt="${now_ts}" 2>/dev/null || true
  kubectl annotate --overwrite kustomization "${THIS_THING}" -n "${flux_ns}" reconcile.fluxcd.io/requestedAt="${now_ts}" 2>/dev/null || true

  cd "${this_cwd}"
}
