#!/bin/bash
# src/util.bash
# Utility functions for deployment scripts

# Default number of parallel jobs if parallel is available
: "${PARALLEL_JOBS:=1}"
: "${DEBUG:='false'}"
: "${ENABLER:=.env.enabler}"

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
  else
    set -a && source ${ENABLER} && set +a
  fi
  if [[ "${VERBOSITY}" -gt "99" ]] ; then
    set -x
  fi
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

phile_checkr () {
if [[ $# -eq 1 ]]; then
TARGET_FILE=$1
  if [[ -f $TARGET_FILE ]]; then
    echo "$TARGET_FILE exists, leaving untouched"; exit 0
  fi
else
  echo "Wrong number of args! $#"
  echo "usage: $0 file_to_check"
fi
}

liner () {
  echo "  $1 $2" >> $SECRET_FILE
  if [[ ${THIS_ENABLE_PLAIN_SECRETS_FILE} == 'true' ]]; then
    echo "  $1 $3" >> $KEY_FILE
  fi
}

munger () {
  if [[ $# -eq 0 ]]; then
      echo 'ERROR: no args!'; exit 1
  fi
  KEY_NAME=$1
  if [[ $# -eq 2 ]]; then
    SECRET=$2
  elif [[ $# -eq 3 ]]; then
    PASS_LENGTH=$2
    RANDO_METHOD=$3
    if [[ ${RANDO_METHOD} == 'tr' ]]; then
      check_cmd tr
      SECRET=$(< /dev/random tr -dc _A-Z-a-z-0-9 | head -c${PASS_LENGTH})
    elif [[ ${RANDO_METHOD} == 'pwgen' ]]; then
      SECRET=pwgen ${PASS_LENGTH} 1
    elif [[ ${RANDO_METHOD} == 'openssl' ]]; then
      check_cmd openssl
      SECRET=$(openssl rand -base64 ${PASS_LENGTH})
    else
      echo 'ERROR: unrecognized method!'; exit 1
    fi
  else
    PASS_LENGTH='23'
    SECRET=$(pwgen ${PASS_LENGTH} 1)
  fi
  based=$(echo -n ${SECRET} | base64)
  liner ${KEY_NAME} $based ${SECRET}
}

linerrr () {
  if [[ ! $# -eq 2 ]]; then
    echo "wrong args $#"
    exit 1
  fi
  line_to_add=$1
  file_to_add_to=$2
  if ! grep -q "$line_to_add" "${file_to_add_to}"; then
    touched=1
    echo "$line_to_add" | sudo tee -a "${file_to_add_to}" > /dev/null
    echo "$line_to_add added to "${file_to_add_to}""
  else
    if [[ ${DEBUG} -eq 1 ]]; then
      echo "$line_to_add already exists in "${file_to_add_to}""
    fi
  fi
}

secret_maker () {
  local secret_name=$1
  local secret_user=$2
  local secret_pass=$3
  kubectl create secret generic \
    "${secret_name}" \
    -n "${THIS_NAMESPACE}" \
    --from-literal=username="${secret_user}" \
    --from-literal=password="${secret_pass}"
}

secret_getter () {
  if [[ ! $# -eq 3 ]]; then
    echo "wrong args $# $@"
    exit 1
  fi
  secret_namespace=$1
  secret_name=$2
  data_key=$3
  kubectl get secret -n ${secret_namespace} ${secret_name} -o json|jq .data.${data_key}|sed 's/"//g'|base64 -d
}
