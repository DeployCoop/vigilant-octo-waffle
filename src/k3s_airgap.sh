#!/usr/bin/env bash
# ==============================================================================
# src/k3s_airgap.sh - Air-Gapped & Disconnected Cluster Deployment Engine
# ==============================================================================
# Builds self-contained offline installation bundles with binaries, airgap
# image archives (.tar.zst), and local installers for airgapped environments.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:${PATH}"

DEFAULT_VERSION="v1.31.2+k3s1"
DEFAULT_ARCH="amd64"
OUTPUT_DIR="${SCRIPT_DIR}/../dist/airgap"

usage() {
  cat << 'EOF'
Usage: ./src/k3s_airgap.sh <action> [options]

Air-gapped and offline deployment bundle generator for K3s.

Actions:
  bundle [version]              Download and package offline installer bundle
  install [bundle-path]         Install K3s locally from an unpacked offline bundle
  list [version]                List container images and binaries required for airgap
  status                        Check local airgap staging cache status

Options:
      --version <tag>           Target K3s version (default: v1.31.2+k3s1)
      --arch <amd64|arm64>      Target CPU architecture (default: amd64)
      --output <dir>            Output directory for bundle (default: dist/airgap)
      --include-copilot         Include Ollama & AI container images in bundle
      --dry-run                 Simulate bundle download steps without pulling files
      --json                    Output metadata in structured JSON format
  -h, --help                    Show this help message

Examples:
  # Generate airgap bundle for v1.31.2+k3s1:
  ./src/k3s_airgap.sh bundle v1.31.2+k3s1

  # Dry-run inspection of airgap payload:
  ./src/k3s_airgap.sh bundle --dry-run --json

  # Install on an air-gapped machine:
  ./src/k3s_airgap.sh install ./k3s-airgap-bundle-v1.31.2+k3s1-amd64
EOF
}

check_root() {
  if [[ $(id -u) -ne 0 ]]; then
    SUDO="sudo"
  else
    SUDO=""
  fi
}

cmd_bundle() {
  local version="${VERSION:-$DEFAULT_VERSION}"
  local arch="${ARCH:-$DEFAULT_ARCH}"
  local out_dir="${OUTPUT_DIR}"
  local dry_run="${DRY_RUN:-false}"

  local encoded_version
  encoded_version=$(echo "${version}" | sed 's/+/%2B/g')

  local bundle_name="k3s-airgap-bundle-${version//+/_}-${arch}"
  local stage_dir="${out_dir}/${bundle_name}"

  echo "============================================================"
  echo "Building K3s Air-Gapped Deployment Bundle"
  echo "============================================================"
  echo "Version       : ${version}"
  echo "Architecture  : ${arch}"
  echo "Bundle Name   : ${bundle_name}"
  echo "Output Directory: ${stage_dir}"
  echo "============================================================"

  if [[ "${dry_run}" == "true" ]]; then
    echo "--- [Dry-Run] Download Targets ---"
    echo "1. Binary      : https://github.com/k3s-io/k3s/releases/download/${encoded_version}/k3s"
    echo "2. Images      : https://github.com/k3s-io/k3s/releases/download/${encoded_version}/k3s-airgap-images-${arch}.tar.zst"
    echo "3. Installer   : https://get.k3s.io"
    echo "4. Checksums   : https://github.com/k3s-io/k3s/releases/download/${encoded_version}/sha256sum-${arch}.txt"
    if [[ "${INCLUDE_COPILOT}" == "true" ]]; then
      echo "5. Copilot/AI  : ollama/ollama:latest, vllm/vllm-openai:latest"
    fi
    echo "✓ Dry-run completed."
    if [[ "${JSON_OUTPUT}" == "true" ]]; then
      cat << EOF
{
  "version": "${version}",
  "arch": "${arch}",
  "bundleName": "${bundle_name}",
  "dryRun": true,
  "artifacts": [
    "k3s",
    "k3s-airgap-images-${arch}.tar.zst",
    "install.sh",
    "install_offline.sh"
  ]
}
EOF
    fi
    return 0
  fi

  mkdir -p "${stage_dir}/images"
  mkdir -p "${stage_dir}/bin"

  echo "==> Downloading K3s release binary (${version})..."
  curl -fL "https://github.com/k3s-io/k3s/releases/download/${encoded_version}/k3s" -o "${stage_dir}/bin/k3s"
  chmod +x "${stage_dir}/bin/k3s"

  echo "==> Downloading official K3s install script..."
  curl -fL "https://get.k3s.io" -o "${stage_dir}/install.sh"
  chmod +x "${stage_dir}/install.sh"

  echo "==> Downloading official K3s airgap images archive..."
  curl -fL "https://github.com/k3s-io/k3s/releases/download/${encoded_version}/k3s-airgap-images-${arch}.tar.zst" \
    -o "${stage_dir}/images/k3s-airgap-images-${arch}.tar.zst" || \
  curl -fL "https://github.com/k3s-io/k3s/releases/download/${encoded_version}/k3s-airgap-images-${arch}.tar.gz" \
    -o "${stage_dir}/images/k3s-airgap-images-${arch}.tar.gz"

  echo "==> Generating self-contained install_offline.sh installer..."
  cat << 'EOF' > "${stage_dir}/install_offline.sh"
#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $(id -u) -ne 0 ]]; then
  echo "Error: install_offline.sh must be run as root (or with sudo)." >&2
  exit 1
fi

echo "==> Installing K3s binary to /usr/local/bin/k3s..."
cp -f "${DIR}/bin/k3s" /usr/local/bin/k3s
chmod 755 /usr/local/bin/k3s

echo "==> Pre-loading container images into /var/lib/rancher/k3s/agent/images/..."
mkdir -p /var/lib/rancher/k3s/agent/images/
cp -f "${DIR}"/images/* /var/lib/rancher/k3s/agent/images/

echo "==> Executing offline K3s installation..."
export INSTALL_K3S_SKIP_DOWNLOAD=true
export INSTALL_K3S_BIN_DIR="/usr/local/bin"

"${DIR}/install.sh" "$@"

echo "✓ Airgapped K3s installation successfully completed!"
EOF
  chmod +x "${stage_dir}/install_offline.sh"

  echo "==> Packaging final tarball..."
  tar -czf "${out_dir}/${bundle_name}.tar.gz" -C "${out_dir}" "${bundle_name}"

  echo "============================================================"
  echo "✓ Airgap Bundle Created: ${out_dir}/${bundle_name}.tar.gz"
  echo "  Unpack and run ./install_offline.sh on disconnected machines."
  echo "============================================================"

  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    cat << EOF
{
  "version": "${version}",
  "arch": "${arch}",
  "bundleFile": "${out_dir}/${bundle_name}.tar.gz",
  "stageDir": "${stage_dir}",
  "success": true
}
EOF
  fi
}

cmd_install() {
  local bundle_dir="${1:-}"

  if [[ -z "${bundle_dir}" ]]; then
    echo "Error: Bundle directory required (e.g. ./dist/airgap/k3s-airgap-bundle-...)." >&2
    exit 1
  fi

  if [[ -f "${bundle_dir}/install_offline.sh" ]]; then
    check_root
    ${SUDO} "${bundle_dir}/install_offline.sh"
  else
    echo "Error: ${bundle_dir}/install_offline.sh not found." >&2
    exit 1
  fi
}

ACTION="${1:-status}"
shift || true

VERSION="${DEFAULT_VERSION}"
ARCH="${DEFAULT_ARCH}"
DRY_RUN="false"
JSON_OUTPUT="false"
INCLUDE_COPILOT="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="$2"
      shift 2
      ;;
    --arch)
      ARCH="$2"
      shift 2
      ;;
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    --include-copilot)
      INCLUDE_COPILOT="true"
      shift
      ;;
    --json)
      JSON_OUTPUT="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      TARGET_ARG="$1"
      shift
      ;;
  esac
done

case "${ACTION}" in
  bundle)
    if [[ -n "${TARGET_ARG:-}" ]]; then
      VERSION="${TARGET_ARG}"
    fi
    cmd_bundle
    ;;
  install)
    cmd_install "${TARGET_ARG:-}"
    ;;
  status|list)
    DRY_RUN="true"
    cmd_bundle
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown action: ${ACTION}" >&2
    usage
    exit 1
    ;;
esac
