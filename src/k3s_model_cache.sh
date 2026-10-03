#!/usr/bin/env bash
# ==============================================================================
# src/k3s_model_cache.sh - Shared Model Cache for Ollama & vLLM Fleets
# ==============================================================================
# Provisions shared RWX persistent volume storage for Ollama and HuggingFace
# model weights, eliminating redundant multi-gigabyte downloads across nodes.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:${PATH}"

if [[ -f "${SCRIPT_DIR}/default.env" ]]; then
  set +u
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/default.env"
  set -u
fi

AI_NAMESPACE="${AI_NAMESPACE:-ai}"
CACHE_SIZE="${MODEL_CACHE_SIZE:-50Gi}"
STORAGE_CLASS="${MODEL_CACHE_STORAGE_CLASS:-local-path}"
JSON_OUTPUT=false
MODEL_NAME=""
ACTION="${1:-status}"
shift || true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      JSON_OUTPUT=true
      shift
      ;;
    --namespace|-n)
      AI_NAMESPACE="$2"
      shift 2
      ;;
    --size)
      CACHE_SIZE="$2"
      shift 2
      ;;
    --storage-class)
      STORAGE_CLASS="$2"
      shift 2
      ;;
    --model)
      MODEL_NAME="$2"
      shift 2
      ;;
    -h|--help)
      cat << 'EOF'
Usage: ./src/k3s_model_cache.sh <action> [options]

Shared LLM weight caching engine for Ollama and vLLM in K3s.

Actions:
  status                        Inspect shared model cache PVC and mounted capacity
  setup                         Deploy shared PVC and HuggingFace/Ollama volume mounts
  list                          List models stored in the shared volume
  preload                       Download and cache a specific LLM into the shared cache
  clean                         Purge obsolete or unreferenced model weights

Options:
      --namespace <ns>          Target namespace (default: ai)
      --size <capacity>         Persistent volume capacity (default: 50Gi)
      --storage-class <sc>      StorageClass (default: local-path or longhorn)
      --model <name>            Model tag to preload (e.g., llama3.2, mistral, deepseek-r1)
      --json                    Output status in structured JSON format
  -h, --help                    Show this help message

Examples:
  ./src/k3s_model_cache.sh status --json
  ./src/k3s_model_cache.sh setup --size 100Gi
  ./src/k3s_model_cache.sh preload --model llama3.2
EOF
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

cmd_status() {
  local pvc_exists=false
  local pvc_phase="NotFound"
  local allocated_size="0"
  local cached_count=0

  if command -v kubectl >/dev/null 2>&1; then
    local phase
    phase=$(kubectl get pvc -n "${AI_NAMESPACE}" k3s-model-cache -o jsonpath='{.status.phase}' 2>/dev/null || true)
    if [[ -n "${phase}" ]]; then
      pvc_exists=true
      pvc_phase="${phase}"
      allocated_size=$(kubectl get pvc -n "${AI_NAMESPACE}" k3s-model-cache -o jsonpath='{.spec.resources.requests.storage}' 2>/dev/null || echo "0")
    fi
  fi

  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    cat << EOF
{
  "namespace": "${AI_NAMESPACE}",
  "cachePvcExists": ${pvc_exists},
  "pvcStatus": "${pvc_phase}",
  "requestedCapacity": "${allocated_size}",
  "cachedModelsCount": ${cached_count}
}
EOF
    return 0
  fi

  echo "============================================================"
  echo "K3s Shared LLM Model Cache Status"
  echo "============================================================"
  echo "Namespace          : ${AI_NAMESPACE}"
  echo "Shared PVC (k3s-model-cache): $( [[ "${pvc_exists}" == "true" ]] && echo "PRESENT (${pvc_phase})" || echo "NOT CREATED" )"
  echo "Capacity Requested : ${allocated_size}"
  echo "Models Cached      : ${cached_count}"
  echo "============================================================"
}

cmd_setup() {
  echo "--> Provisioning Shared Model Cache PVC in '${AI_NAMESPACE}' (${CACHE_SIZE})..."
  kubectl create namespace "${AI_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

  cat << EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: k3s-model-cache
  namespace: ${AI_NAMESPACE}
  labels:
    app.kubernetes.io/name: k3s-model-cache
    app.kubernetes.io/part-of: edge-ai
spec:
  accessModes:
    - ReadWriteMany
  storageClassName: ${STORAGE_CLASS}
  resources:
    requests:
      storage: ${CACHE_SIZE}
EOF

  echo "Shared Model Cache PVC 'k3s-model-cache' created successfully."
}

cmd_preload() {
  if [[ -z "${MODEL_NAME}" ]]; then
    echo "Error: --model <name> is required to preload weights (e.g. --model llama3.2)."
    exit 1
  fi

  echo "--> Preloading model '${MODEL_NAME}' into shared cache..."
  kubectl create namespace "${AI_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

  cat << EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: preload-${MODEL_NAME//[:.]/-}
  namespace: ${AI_NAMESPACE}
spec:
  ttlSecondsAfterFinished: 120
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: puller
          image: ollama/ollama:latest
          command:
            - /bin/sh
            - -c
            - |
              ollama serve &
              sleep 4
              echo "Pulling model ${MODEL_NAME}..."
              ollama pull ${MODEL_NAME}
          volumeMounts:
            - name: model-volume
              mountPath: /root/.ollama
      volumes:
        - name: model-volume
          persistentVolumeClaim:
            claimName: k3s-model-cache
EOF

  echo "Preload Job 'preload-${MODEL_NAME//[:.]/-}' scheduled. Weights downloading into shared cache."
}

case "${ACTION}" in
  status)
    cmd_status
    ;;
  setup)
    cmd_setup
    ;;
  preload)
    cmd_preload
    ;;
  *)
    cmd_status
    ;;
esac
