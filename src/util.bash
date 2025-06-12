#!/bin/bash
# src/util.bash
# Utility functions for deployment scripts

# Default number of parallel jobs if parallel is available
: "${PARALLEL_JOBS:=1}"
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
check_enabler () {
  if [[ ! -f "$ENABLER" ]]; then
    log_warn "No enabler file found. Running all applications."
    THIS_ENABLED=true
    return 0
  fi
  set -a && source ${ENABLER} && set +a
  set -x
  varname=$(echo ${THIS_THING}_ENABLED | tr '[:lower:]' '[:upper:]' | tr '-' '_' )
  if [[ ! ${!varname} == 'true' ]]; then
    echo "${varname} is not enabled check ${ENABLER}"
    exit 0
    THIS_ENABLED=false
  else
    THIS_ENABLED=true
  fi
}

# Run commands in parallel if supported
para_runner () {
: "${PARALLEL_JOBS:=1}"
  if [[ $# -ne 1 ]]; then
    log_error "Usage: para_runner <file>"
  fi
  local target=$1
  if [[ ! -f "$target" ]]; then
    log_error "'${target}' does not exist."
  fi
  if [[ "${VERBOSITY}" -gt "9" ]] ; then
    check_cmd parallel
    cat "${target}"
  fi
  if [[ "${PARALLEL_JOBS}" -gt "1" ]] ; then
    parallel -j "${PARALLEL_JOBS}" -- < "${target}"
  else
    bash "${target}"
  fi
}


# Initialize Kubernetes resources from a directory
robo_initializer() {
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

initializer () {
  if [[ ! $# -eq 1 ]]; then
    log_error "Usage: $0 <directory>"
  fi

  local init_dir="$1"

  if [[ ! -d ${init_dir} ]]; then
    log_error "'${init_dir}' is not a valid directory."
  fi

  these_files=$(find ${init_dir} -regex '.*.ya?ml'|sort)
  for f in ${these_files[@]}; do
    echo "subbing ${f}"
    if [[ "${DEBUG}" == "true" ]]; then
      envsubst < ${f}
    fi
    envsubst < ${f} | kubectl apply -f -
  done
}
