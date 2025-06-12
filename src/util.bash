#!/bin/bash
# src/util.bash
# Utility functions for deployment scripts

# Default number of parallel jobs if parallel is available
: "${PARALLEL_JOBS:=5}"
: "${DEBUG:='false'}"
: "${ENABLER:='./.env.enabler'}"

# Log an error message and exit
log_error() {
  echo "ERROR: $1" >&2
  exit 1
}

# Log a warning message
log_warn() {
  echo "WARN: $1" >&2
}

# Log a debug message if DEBUG is enabled
log_debug() {
  if [[ "$DEBUG" == "true" ]]; then
    echo "DEBUG: $1" >&2
  fi
}

# Check if a command exists in the system PATH
check_cmd() {
  if [[ $# -ne 1 ]]; then
    log_error "Usage: check_cmd <command>"
  fi

  if ! command -v "$1" > /dev/null 2>&1; then
    log_error "'$1' is not installed or not in PATH. Please install it and try again."
  fi
}

# Check if Docker is running by verifying the 'docker' command exists
check_docker() {
  check_cmd docker

  if ! docker info > /dev/null 2>&1; then
    log_debug "Docker is not running. Attempting to start Docker..."
    if ! sudo systemctl start docker 2>/dev/null; then
      log_error "Failed to start Docker. Please start it manually."
    fi
  fi
}

# Check if the application is enabled via .env.enabler
check_enabler() {
  if [[ ! -f "$ENABLER" ]]; then
    log_warn "No enabler file found. Running all applications."
    THIS_ENABLED=true
    return 0
  fi

  # Safely source the enabler file
  if ! source "$ENABLER"; then
    log_error "Failed to source enabler file: $ENABLER"
  fi

  local varname=$(echo "${THIS_THING}_ENABLED" | tr '[:lower:]' '[:upper:]' | tr '-' '_')
  THIS_ENABLED=${!varname:-false}

  if [[ "$THIS_ENABLED" != "true" ]]; then
    log_debug "'$THIS_THING' is disabled. Set '$varname=true' in '$ENABLER' to enable."
    return 1
  fi
}

# Run commands in parallel if supported
para_runner() {
  if [[ $# -ne 1 ]]; then
    log_error "Usage: para_runner <file>"
  fi

  local target="$1"
  if [[ ! -f "$target" ]]; then
    log_error "'$target' does not exist."
  fi

  log_debug "Contents of '$target':"
  cat "$target" >&2

  if [[ "$PARALLEL_JOBS" -gt 1 ]]; then
    if ! command -v parallel > /dev/null 2>&1; then
      log_error "GNU parallel is required for parallel execution. Please install it."
    fi
    parallel -j "$PARALLEL_JOBS" -- "$target"
  else
    bash "$target"
  fi
}

# Initialize Kubernetes resources from a directory
initializer() {
  if [[ $# -ne 1 ]]; then
    log_error "Usage: initializer <directory>"
  fi

  local init_dir="$1"
  if [[ ! -d "$init_dir" ]]; then
    log_error "'$init_dir' is not a valid directory."
  fi

  log_debug "Initializing Kubernetes resources from '$init_dir'"

  while IFS= read -r -d '' file; do
    local ext="${file##*.}"
    if [[ "$ext" != "yaml" && "$ext" != "yml" ]]; then
      log_debug "Skipping non-YAML file: '$file'"
      continue
    fi

    log_debug "Processing file: '$file'"

    if [[ "$DEBUG" == "true" ]]; then
      log_debug "envsubst output for '$file':"
      envsubst < "$file" >&2
    fi

    if ! envsubst < "$file" | kubectl apply -f -; then
      log_error "Failed to apply '$file'"
    fi
  done < <(find "$init_dir" -type f -name "*.yaml" -o -name "*.yml" -print0)
}
