#!/bin/bash
# src/util.bash
# Utility functions for deployment scripts

# Default number of parallel jobs if parallel is available
: "${PARALLEL_JOBS:=5}"
: "${DEBUG:='false'}"
: "${ENABLER:='./.env.enabler'}"

# Check if a command exists in the system PATH
check_cmd() {
  if [[ $# -ne 1 ]]; then
    echo "Usage: check_cmd <command>" >&2
    return 1
  fi
  command -v "$1" > /dev/null 2>&1 || {
    echo "Error: '$1' is not installed or not in PATH. Please install it and try again." >&2
    return 1
  }
}

# Check if Docker is running by verifying the 'docker' command exists
check_docker() {
  check_cmd docker || return 1
  docker info > /dev/null 2>&1 || {
    echo "Error: Docker is not running. Starting Docker..." >&2
    sudo systemctl start docker || {
      echo "Failed to start Docker. Please start it manually." >&2
      return 1
    }
  }
}

# Check if the application is enabled via .env.enabler
check_enabler() {
  if [[ ! -f "$ENABLER" ]]; then
    echo "WARN: No enabler file found. Running all applications." >&2
    THIS_ENABLED=true
    return 0
  fi

  set -a
  source "$ENABLER"
  set +a

  local varname=$(echo "${THIS_THING}_ENABLED" | tr '[:lower:]' '[:upper:]' | tr '-' '_')
  THIS_ENABLED=${!varname:-false}

  if [[ "$THIS_ENABLED" != "true" ]]; then
    echo "INFO: '$THIS_THING' is disabled. Set '$varname=true' in '$ENABLER' to enable." >&2
    return 1
  fi
}

# Run commands in parallel if supported
para_runner() {
  if [[ $# -ne 1 ]]; then
    echo "Usage: para_runner <file>" >&2
    return 1
  fi

  local target="$1"
  if [[ ! -f "$target" ]]; then
    echo "Error: '$target' does not exist." >&2
    return 1
  fi

  if [[ "$VERBOSITY" -gt 9 ]]; then
    echo "DEBUG: Contents of '$target':" >&2
    cat "$target" >&2
  fi

  if [[ "$PARALLEL_JOBS" -gt 1 ]]; then
    parallel -j "$PARALLEL_JOBS" -- "$target"
  else
    bash "$target"
  fi
}

# Initialize Kubernetes resources from a directory
initializer() {
  if [[ $# -ne 1 ]]; then
    echo "Usage: initializer <directory>" >&2
    return 1
  fi

  local init_dir="$1"
  if [[ ! -d "$init_dir" ]]; then
    echo "Error: '$init_dir' is not a valid directory." >&2
    return 1
  fi

  echo "DEBUG: Initializing Kubernetes resources from '$init_dir'" >&2

  while IFS= read -r -d '' file; do
    if [[ "${file##*.}" != "yaml" && "${file##*.}" != "yml" ]]; then
      echo "DEBUG: Skipping non-YAML file: '$file'" >&2
      continue
    fi

    echo "DEBUG: Processing file: '$file'" >&2
    if [[ "$DEBUG" == "true" ]]; then
      echo "DEBUG: envsubst output for '$file':" >&2
      envsubst < "$file" >&2
    fi

    envsubst < "$file" | kubectl apply -f -
    if [[ $? -ne 0 ]]; then
      echo "ERROR: Failed to apply '$file'" >&2
      return 1
    fi
  done < <(find "$init_dir" -type f -name "*.yaml" -o -name "*.yml" -print0)
}
