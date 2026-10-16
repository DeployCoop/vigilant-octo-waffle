#!/usr/bin/env bash
# Plan II §6.1 — regression tests for the k3s shell scripts.
#
# Covers resolve_server_url / normalize_server_url in src/k3s_add_node.sh
# across the case matrix that shipped broken in the setup wizard (PR #81):
# empty server file, bare IP (port must be appended), IP:port (port must
# NOT be doubled), trailing slash / CRLF, and the `ip route get` src-field
# parse (the "uid 1000 becomes the node IP" trap). External commands
# (curl / ip / hostname) are stubbed on PATH; no cluster is needed.
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

mkdir -p "${WORK}/proj/src" "${WORK}/stubs"
cp "${REPO_ROOT}/src/k3s_add_node.sh" "${WORK}/proj/src/k3s_add_node.sh"

# --- stubs: each prints the canned content of its .out file (may be empty)
for tool in curl ip hostname; do
  cat > "${WORK}/stubs/${tool}" <<EOF
#!/bin/bash
f="${WORK}/stubs/${tool}.out"
if [[ -f "\${f}" ]]; then cat "\${f}"; fi
exit 0
EOF
  chmod +x "${WORK}/stubs/${tool}"
  : > "${WORK}/stubs/${tool}.out"
done

PASS=0
FAIL=0

# get_url <extra env assignments...> -- runs --get-url in a bare env whose
# PATH contains only the stubs plus the system dirs.
get_url() {
  /usr/bin/env -i PATH="${WORK}/stubs:/usr/bin:/bin" "$@" \
    bash "${WORK}/proj/src/k3s_add_node.sh" --get-url 2>/dev/null
}

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "${actual}" == "${expected}" ]]; then
    PASS=$((PASS + 1))
    echo "ok   - ${name}"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL - ${name}: expected '${expected}', got '${actual}'"
  fi
}

reset_state() {
  rm -f "${WORK}/proj/server_url"
  rm -rf "${WORK}/proj/.secrets"
  : > "${WORK}/stubs/curl.out"
  : > "${WORK}/stubs/ip.out"
  : > "${WORK}/stubs/hostname.out"
}

# 1. server_url file: bare IP gets scheme + default port
reset_state
printf '192.168.1.10' > "${WORK}/proj/server_url"
check "file: bare IP" "https://192.168.1.10:6443" "$(get_url)"

# 2. server_url file: IP:port is left alone (no doubled port)
reset_state
printf '192.168.1.10:8443' > "${WORK}/proj/server_url"
check "file: IP:port" "https://192.168.1.10:8443" "$(get_url)"

# 3. server_url file: full URL with trailing slash and CRLF
reset_state
printf 'https://k3s.lan:6443/\r\n' > "${WORK}/proj/server_url"
check "file: URL + slash + CRLF" "https://k3s.lan:6443" "$(get_url)"

# 4. whitespace-only file falls through to detection; on a directly
#    connected route (no via field) a positional parse lands on the uid —
#    the src-aware parse must win (the #81 uid-trap regression)
reset_state
printf '  \n' > "${WORK}/proj/server_url"
printf '1.1.1.1 dev eth0 src 192.168.1.42 uid 1000\n' \
  > "${WORK}/stubs/ip.out"
check "detect: ip route src (uid trap)" "https://192.168.1.42:6443" "$(get_url)"

# 4b. same, on a gateway route (via field present)
reset_state
printf '1.1.1.1 via 192.168.1.1 dev eth0 src 192.168.1.42 uid 1000\n' \
  > "${WORK}/stubs/ip.out"
check "detect: ip route src (via layout)" "https://192.168.1.42:6443" "$(get_url)"

# 5. SERVER_URL env beats the file
reset_state
printf '192.168.1.10' > "${WORK}/proj/server_url"
check "env SERVER_URL wins" "https://env.lan:9443" \
  "$(get_url SERVER_URL='env.lan:9443')"

# 6. THIS_K3S_SERVER_IP is the next fallback
reset_state
check "THIS_K3S_SERVER_IP fallback" "https://10.9.9.9:6443" \
  "$(get_url THIS_K3S_SERVER_IP='10.9.9.9')"

# 7. public-IP detection via curl
reset_state
printf '203.0.113.7' > "${WORK}/stubs/curl.out"
check "detect: curl public IP" "https://203.0.113.7:6443" "$(get_url)"

# 8. hostname -I fallback (first address wins)
reset_state
printf '10.0.0.9 172.17.0.1 \n' > "${WORK}/stubs/hostname.out"
check "detect: hostname -I first IP" "https://10.0.0.9:6443" "$(get_url)"

# 9. nothing detectable -> loopback default
reset_state
check "detect: loopback default" "https://127.0.0.1:6443" "$(get_url)"

echo
echo "shell tests: ${PASS} passed, ${FAIL} failed"
[[ "${FAIL}" -eq 0 ]]
