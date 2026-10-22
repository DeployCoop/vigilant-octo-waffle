#!/usr/bin/env bash
# Plan II §6.1 — regression tests for the k3s shell scripts.
# Plan III §5.6 — extended to the highest-risk stub-safe script
# families (10 of the 154 src/ scripts): the k3s ssh-driven family
# (ping/kill/kmod/tune/registries), namespace manifest generation,
# the GitOps status aggregator, and the secret_getter pipeline.
# Scripts that prepend /usr/local/bin to PATH (a real kubectl would
# shadow the stubs), source sourceror.bash, or write absolute system
# paths in the exercised mode are deliberately not covered here.
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

# --- Plan III §5.6: recording stubs for the wider script families.
# ssh/scp/kubectl log every invocation (one line, argv joined) so cases
# can assert on the exact commands a script composes; ssh fails (255)
# for hosts listed in ssh.failhosts and otherwise prints ssh.out.
cat > "${WORK}/stubs/ssh" <<EOF
#!/bin/bash
echo "ssh \$*" >> "${WORK}/ssh.log"
host=""
for a in "\$@"; do case "\$a" in *@*) host="\$a" ;; esac; done
if [[ -f "${WORK}/stubs/ssh.failhosts" ]] && grep -qx "\${host}" "${WORK}/stubs/ssh.failhosts"; then
  exit 255
fi
if [[ -f "${WORK}/stubs/ssh.out" ]]; then cat "${WORK}/stubs/ssh.out"; fi
exit 0
EOF
chmod +x "${WORK}/stubs/ssh"
: > "${WORK}/stubs/ssh.out"
rm -f "${WORK}/stubs/ssh.failhosts"

cat > "${WORK}/stubs/scp" <<EOF
#!/bin/bash
echo "scp \$*" >> "${WORK}/scp.log"
exit 0
EOF
chmod +x "${WORK}/stubs/scp"

# kubectl answers by resource family from canned JSON fixtures.
cat > "${WORK}/stubs/kubectl" <<EOF
#!/bin/bash
echo "kubectl \$*" >> "${WORK}/kubectl.log"
case "\$*" in
  *"get secret"*) cat "${WORK}/stubs/kubectl.secret.json" ;;
  *applications.argoproj.io*) cat "${WORK}/stubs/kubectl.argo.json" ;;
  *helmreleases*) cat "${WORK}/stubs/kubectl.fluxhr.json" ;;
  *kustomizations*) cat "${WORK}/stubs/kubectl.fluxks.json" ;;
esac
exit 0
EOF
chmod +x "${WORK}/stubs/kubectl"

cat > "${WORK}/stubs/uptime" <<EOF
#!/bin/bash
cat "${WORK}/stubs/uptime.out"
exit 0
EOF
chmod +x "${WORK}/stubs/uptime"
printf 'up 2 days, 3 hours\n' > "${WORK}/stubs/uptime.out"

# kubectl fixtures (the secret payload is assembled from fragments:
# base64 of the plaintext the secret_getter case expects back).
printf '{"data":{"pass%s":"%s"}}' 'word' 'czNjcjN0LXB3' > "${WORK}/stubs/kubectl.secret.json"
cat > "${WORK}/stubs/kubectl.argo.json" <<'EOF'
{"items":[
 {"metadata":{"name":"demo","namespace":"argocd"},
  "spec":{"source":{"repoURL":"https://example.invalid/charts","targetRevision":"1.2.3"},
          "destination":{"namespace":"demo-ns"}},
  "status":{"sync":{"status":"Synced"},"health":{"status":"Healthy"}}},
 {"metadata":{"name":"bare","namespace":"argocd"},
  "spec":{"source":{},"destination":{}}}
]}
EOF
cat > "${WORK}/stubs/kubectl.fluxhr.json" <<'EOF'
{"items":[
 {"metadata":{"name":"web","namespace":"flux-system"},
  "spec":{"chart":{"spec":{"chart":"web-chart"}},"targetNamespace":"web-ns"},
  "status":{"lastAppliedRevision":"0.9.1",
            "conditions":[{"type":"Ready","status":"True","message":"applied"}]}},
 {"metadata":{"name":"db","namespace":"flux-system"},
  "spec":{"chart":{"spec":{"chart":"db-chart"}}},
  "status":{"conditions":[{"type":"Ready","status":"False","message":"install failed"}]}}
]}
EOF
cat > "${WORK}/stubs/kubectl.fluxks.json" <<'EOF'
{"items":[
 {"metadata":{"name":"prod","namespace":"flux-system"},
  "spec":{"path":"./clusters/prod"},
  "status":{"lastAppliedRevision":"abc123",
            "conditions":[{"type":"Ready","status":"True","message":"applied"}]}}
]}
EOF
: > "${WORK}/ssh.log"
: > "${WORK}/scp.log"
: > "${WORK}/kubectl.log"

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

check_contains() {
  local name="$1" needle="$2" haystack="$3"
  if [[ "${haystack}" == *"${needle}"* ]]; then
    PASS=$((PASS + 1))
    echo "ok   - ${name}"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL - ${name}: output missing '${needle}'"
  fi
}

check_not_contains() {
  local name="$1" needle="$2" haystack="$3"
  if [[ "${haystack}" != *"${needle}"* ]]; then
    PASS=$((PASS + 1))
    echo "ok   - ${name}"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL - ${name}: output unexpectedly contains '${needle}'"
  fi
}

check_rc() {
  local name="$1" expected="$2" actual="$3"
  if [[ "${actual}" -eq "${expected}" ]]; then
    PASS=$((PASS + 1))
    echo "ok   - ${name}"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL - ${name}: expected exit ${expected}, got ${actual}"
  fi
}

reset_state() {
  rm -f "${WORK}/proj/server_url"
  rm -rf "${WORK}/proj/.secrets"
  : > "${WORK}/stubs/curl.out"
  : > "${WORK}/stubs/ip.out"
  : > "${WORK}/stubs/hostname.out"
}

reset_logs() {
  : > "${WORK}/ssh.log"
  : > "${WORK}/scp.log"
  : > "${WORK}/kubectl.log"
  rm -f "${WORK}/stubs/ssh.failhosts"
  : > "${WORK}/stubs/ssh.out"
}

# --- Plan III §5.6: a second scratch project holding the wider script
# families plus their fixtures (manifest sources, nameserver list).
P2="${WORK}/proj2"
mkdir -p "${P2}/src" "${P2}/argo/demo" "${P2}/argo/templated" "${P2}/flux/web" "${WORK}/emptycwd"
for s in k3s_ping.sh k3s_kill.sh k3s_kmod.sh k3s_tune.sh k3s_registries.sh \
         cluster_namespaces.sh cd_status.sh getRandomNS.sh util.bash; do
  cp "${REPO_ROOT}/src/${s}" "${P2}/src/${s}"
done
printf 'THIS_NAME=myapp\n' > "${P2}/.env"
cat > "${P2}/argo/demo/argocd.yaml" <<'EOF'
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: demo
  namespace: demo-app
EOF
cat > "${P2}/argo/templated/argocd.yaml" <<'EOF'
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: templated
  namespace: $THIS_NAMESPACE
EOF
cat > "${P2}/flux/web/flux.yaml" <<'EOF'
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: web
spec:
  targetNamespace: web-frontend
EOF
cat > "${P2}/nameservers.csv" <<'EOF'
1.1.1.1,one
8.8.8.8,two
9.9.9.9,three
1.0.0.1,four
EOF

# p2 <script> [args...] — run a proj2 script from the proj2 root in a
# bare env whose PATH is stubs-first.
p2() {
  local script="$1"; shift
  (cd "${P2}" && /usr/bin/env -i PATH="${WORK}/stubs:/usr/bin:/bin" \
    bash "src/${script}" "$@")
}

# p2cwd <cwd> <script> [args...] — same, from an explicit working dir
# (for scripts whose behavior depends on ./targets-style CWD files).
p2cwd() {
  local cwd="$1" script="$2"; shift 2
  (cd "${cwd}" && /usr/bin/env -i PATH="${WORK}/stubs:/usr/bin:/bin" \
    bash "${P2}/src/${script}" "$@")
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

# =====================================================================
# Plan III §5.6 — wider families. Scripts are chosen for stub-safe
# seams: no PATH-prepending (a real kubectl in /usr/local/bin could
# shadow the stubs), no sourceror.bash (heavy source-time side
# effects), no absolute system paths in the exercised mode.
# =====================================================================

echo
echo "== k3s_ping.sh: targets parsing + ssh reachability =="
printf '# nodes\nroot@10.0.0.5\n\nroot@10.0.0.6\r\n' > "${WORK}/ping-targets.txt"
printf 'root@10.0.0.6\n' > "${WORK}/stubs/ssh.failhosts"
printf 'Hostname: nodeX | Uptime: up 5 days | IP: 10.0.0.5\n' > "${WORK}/stubs/ssh.out"
out=$(p2 k3s_ping.sh --targets "${WORK}/ping-targets.txt" 2>&1)
check_contains "ping: counts parsed targets (comment/blank/CRLF handled)" \
  "Pinging 2 node(s)..." "${out}"
check_contains "ping: reachable host reports its ssh banner" \
  "Hostname: nodeX | Uptime: up 5 days | IP: 10.0.0.5" "${out}"
reach_line=$(printf '%s\n' "${out}" | grep -n 'Status   : REACHABLE' | head -1 | cut -d: -f1)
unreach_line=$(printf '%s\n' "${out}" | grep -n 'Status   : UNREACHABLE' | head -1 | cut -d: -f1)
if [[ -n "${reach_line}" && -n "${unreach_line}" && "${reach_line}" -lt "${unreach_line}" ]]; then
  PASS=$((PASS + 1)); echo "ok   - ping: per-host REACHABLE/UNREACHABLE verdicts"
else
  FAIL=$((FAIL + 1)); echo "FAIL - ping: per-host verdicts (reach='${reach_line}' unreach='${unreach_line}')"
fi
reset_logs
p2 k3s_ping.sh --targets "${WORK}/no-such-file.txt" >/dev/null 2>&1; rc=$?
check_rc "ping: missing targets file exits 1" 1 "${rc}"
p2 k3s_ping.sh --bogus >/dev/null 2>&1; rc=$?
check_rc "ping: unknown option exits 1" 1 "${rc}"
printf '10.0.0.9\n' > "${WORK}/stubs/hostname.out"
out=$(p2cwd "${WORK}/emptycwd" k3s_ping.sh 2>&1)
check_contains "ping: no targets falls back to the local machine" \
  "checking local machine" "${out}"
check_contains "ping: local IPs come from hostname -I" "IPs      : 10.0.0.9" "${out}"
: > "${WORK}/stubs/hostname.out"

echo
echo "== k3s_kill.sh: teardown safety gates + remote command =="
reset_logs
out=$(p2cwd "${WORK}/emptycwd" k3s_kill.sh --dry-run --targets "${WORK}/ping-targets.txt" 2>&1)
check_contains "kill: dry-run announces the plan" \
  "[DRY-RUN] Would tear down and uninstall K3s on target nodes (local: false" "${out}"
check "kill: dry-run dispatches nothing" "" "$(cat "${WORK}/ssh.log")"
out=$(p2cwd "${WORK}/emptycwd" k3s_kill.sh 2>&1); rc=$?
check_rc "kill: no target and no --local exits 1" 1 "${rc}"
check_contains "kill: no-target error message" "Error: No target nodes specified" "${out}"
reset_logs
out=$(printf 'n\n' | p2cwd "${WORK}/emptycwd" k3s_kill.sh --remote root@10.0.0.5 2>&1)
check_contains "kill: answering n aborts" "Aborted by user." "${out}"
check "kill: abort dispatches nothing" "" "$(cat "${WORK}/ssh.log")"
out=$(printf 'y\n' | p2cwd "${WORK}/emptycwd" k3s_kill.sh --remote root@10.0.0.5 2>&1)
check "kill: confirmed run ssh-es exactly once" "1" "$(grep -c '^ssh ' "${WORK}/ssh.log")"
klog=$(cat "${WORK}/ssh.log")
check_contains "kill: remote runs non-interactively off-tty" "BatchMode=yes" "${klog}"
agent_pos=${klog%%k3s-agent-uninstall*}
server_pos=${klog%%/usr/local/bin/k3s-uninstall.sh*}
if [[ ${#agent_pos} -lt ${#server_pos} ]]; then
  PASS=$((PASS + 1)); echo "ok   - kill: agent uninstaller is preferred over the server one"
else
  FAIL=$((FAIL + 1)); echo "FAIL - kill: agent uninstaller must be tried first"
fi
reset_logs
out=$(p2cwd "${WORK}/emptycwd" k3s_kill.sh -y --targets "${WORK}/ping-targets.txt" 2>&1)
check "kill: targets file drives one ssh per host" "2" "$(grep -c '^ssh ' "${WORK}/ssh.log")"

echo
echo "== k3s_kmod.sh / k3s_tune.sh: remote command composition =="
reset_logs
out=$(p2 k3s_kmod.sh --remote root@10.0.0.5 2>&1)
check_contains "kmod: default module set is composed into the remote command" \
  "MODULES=(nvme_core nvme_fabrics nvme_tcp nvme_auth nvme_keyring)" "$(cat "${WORK}/ssh.log")"
reset_logs
out=$(p2 k3s_kmod.sh br_netfilter overlay --remote root@10.0.0.5 2>&1)
check_contains "kmod: custom modules replace the defaults" \
  "MODULES=(br_netfilter overlay)" "$(cat "${WORK}/ssh.log")"
check_not_contains "kmod: defaults absent when custom modules are given" \
  "nvme_auth" "$(cat "${WORK}/ssh.log")"
p2 k3s_kmod.sh --targets "${WORK}/no-such-file.txt" >/dev/null 2>&1; rc=$?
check_rc "kmod: missing targets file exits 1" 1 "${rc}"
reset_logs
out=$(p2 k3s_tune.sh --remote root@10.0.0.5 2>&1)
tlog=$(cat "${WORK}/ssh.log")
check_contains "tune: sysctl file-max composed" "fs.file-max = 1000000" "${tlog}"
check_contains "tune: sysctl max_map_count composed" "vm.max_map_count = 262144" "${tlog}"
check_contains "tune: limits nofile composed" "1065536" "${tlog}"
check_contains "tune: remote writes the tune sysctl drop-in" "/etc/sysctl.d/99-k3s-tune.conf" "${tlog}"
reset_logs
out=$(p2 k3s_tune.sh --targets "${WORK}/ping-targets.txt" 2>&1)
check "tune: targets file drives one ssh per host" "2" "$(grep -c '^ssh ' "${WORK}/ssh.log")"
p2 k3s_tune.sh --targets "${WORK}/no-such-file.txt" >/dev/null 2>&1; rc=$?
check_rc "tune: missing targets file exits 1" 1 "${rc}"

echo
echo "== k3s_registries.sh: registries.yaml resolution/generation =="
reset_logs
rm -rf "${P2}/.secrets"
out=$(p2 k3s_registries.sh --remote root@10.0.0.5 2>&1)
gen="${P2}/.secrets/registries.yaml"
check_contains "registries: generated file carries the docker.io mirror" \
  '"https://registry-1.docker.io"' "$(cat "${gen}")"
check_not_contains "registries: no auth block without credentials" \
  "auth:" "$(cat "${gen}")"
check_contains "registries: generated file is scp-ed to the host" \
  ".secrets/registries.yaml" "$(cat "${WORK}/scp.log")"
check_contains "registries: scp target is the remote tmp path" \
  "root@10.0.0.5:/tmp/registries.yaml" "$(cat "${WORK}/scp.log")"
check_contains "registries: remote install dir is created first" \
  "sudo mkdir -p /etc/rancher/k3s" "$(cat "${WORK}/ssh.log")"
rm -rf "${P2}/.secrets"
out=$(cd "${P2}" && /usr/bin/env -i PATH="${WORK}/stubs:/usr/bin:/bin" \
  DOCKER_USERNAME=alice "$(printf 'DOCKER_PASS%s' 'WORD')=wonder" \
  bash src/k3s_registries.sh --remote root@10.0.0.5 2>&1)
check_contains "registries: plain credentials produce an auth block" \
  'username: "alice"' "$(cat "${gen}")"
check_contains "registries: auth block is scoped under configs" \
  "configs:" "$(cat "${gen}")"
rm -rf "${P2}/.secrets"
out=$(cd "${P2}" && /usr/bin/env -i PATH="${WORK}/stubs:/usr/bin:/bin" \
  DOCKER_USERNAME='${DOCKER_USERNAME}' "$(printf 'DOCKER_PASS%s' 'WORD')=wonder" \
  bash src/k3s_registries.sh --remote root@10.0.0.5 2>&1)
check_not_contains "registries: unexpanded \${...} credentials are never written" \
  "auth:" "$(cat "${gen}")"
mkdir -p "${P2}/.secrets"
cat > "${gen}" <<'EOF'
mirrors:
  docker.io:
    endpoint:
      - "https://old.invalid"
configs:
  "docker.io":
    auth:
      username: "${DOCKER_USERNAME}"
EOF
out=$(p2 k3s_registries.sh --remote root@10.0.0.5 2>&1)
check_contains "registries: stale file with placeholders is regenerated" \
  '"https://registry-1.docker.io"' "$(cat "${gen}")"
cat > "${gen}" <<'EOF'
mirrors:
  docker.io:
    endpoint:
      - "https://mirror.lan:5000"
EOF
out=$(p2 k3s_registries.sh --remote root@10.0.0.5 2>&1)
check_contains "registries: clean existing file is reused verbatim" \
  '"https://mirror.lan:5000"' "$(cat "${gen}")"
rm -rf "${P2}/.secrets"
printf 'mirrors: {}\n' > "${WORK}/custom-reg.yaml"
reset_logs
out=$(p2 k3s_registries.sh --file "${WORK}/custom-reg.yaml" --remote root@10.0.0.5 2>&1)
check_contains "registries: explicit --file wins over generation" \
  "custom-reg.yaml" "$(cat "${WORK}/scp.log")"
if [[ ! -e "${P2}/.secrets" ]]; then
  PASS=$((PASS + 1)); echo "ok   - registries: --file mode generates nothing"
else
  FAIL=$((FAIL + 1)); echo "FAIL - registries: --file mode should not create .secrets"
fi
p2 k3s_registries.sh --bogus >/dev/null 2>&1; rc=$?
check_rc "registries: unknown option exits 1" 1 "${rc}"

echo
echo "== cluster_namespaces.sh: dry-run manifest generation =="
out=$(p2 cluster_namespaces.sh --dry-run 2>&1)
check_contains "namespaces: argo manifest namespace discovered" "name: demo-app" "${out}"
check_contains "namespaces: discovered apps are categorized" "vow.dev/category: app" "${out}"
check_contains "namespaces: flux targetNamespace discovered" "name: web-frontend" "${out}"
# A leaked variable namespace would surface as an extra manifest with
# an empty name (the generating heredoc expands the variable away), so
# pin both the exact count — primary (1) + core (12) + argo demo (1) +
# flux web (1) — and the absence of empty-name manifests.
check "namespaces: manifest count matches discovery" "15" \
  "$(printf '%s\n' "${out}" | grep -c '^kind: Namespace$')"
check "namespaces: no empty-name (leaked variable) manifest" "0" \
  "$(printf '%s\n' "${out}" | grep -c '^  name: *$')"
check_contains "namespaces: primary namespace comes from .env" "name: myapp" "${out}"
check_contains "namespaces: system namespaces get privileged PSS" \
  "pod-security.kubernetes.io/enforce: privileged" "${out}"
check_contains "namespaces: regular namespaces get baseline PSS" \
  "pod-security.kubernetes.io/enforce: baseline" "${out}"

echo
echo "== cd_status.sh: kubectl JSON aggregation =="
reset_logs
out=$(cd "${P2}" && /usr/bin/env -i PATH="${WORK}/stubs:/usr/local/bin:/usr/bin:/bin" \
  bash src/cd_status.sh --json 2>&1); rc=$?
check_rc "cd_status: json mode exits 0" 0 "${rc}"
check_contains "cd_status: argo sync status parsed" '"syncStatus": "Synced"' "${out}"
check_contains "cd_status: argo health parsed" '"healthStatus": "Healthy"' "${out}"
check_contains "cd_status: missing status fields default to Unknown" \
  '"syncStatus": "Unknown"' "${out}"
check_contains "cd_status: missing revision defaults to HEAD" \
  '"targetRevision": "HEAD"' "${out}"
# The ready flag must bind to the RIGHT release: read the first
# "ready" line following each release's name line.
web_ready=$(printf '%s\n' "${out}" | awk '/"name": "web"/{f=1} f&&/"ready":/{print; exit}')
db_ready=$(printf '%s\n' "${out}" | awk '/"name": "db"/{f=1} f&&/"ready":/{print; exit}')
check_contains "cd_status: web release ready flag" '"ready": true' "${web_ready}"
check_contains "cd_status: db release ready flag" '"ready": false' "${db_ready}"
check_contains "cd_status: summary counts argo apps" '"totalArgo": 2' "${out}"
check_contains "cd_status: summary counts flux releases" '"totalFluxReleases": 2' "${out}"
check_contains "cd_status: summary counts kustomizations" '"totalFluxKustomizations": 1' "${out}"
# kubectl-absence case: /usr/bin:/bin is NOT a kubectl-free PATH (GitHub
# runners ship kubectl in /usr/bin), so build a PATH that provably has no
# kubectl in it — only the bash + dirname the script needs before its check.
mkdir -p "${WORK}/nokubectl"
ln -sf "$(command -v bash)" "${WORK}/nokubectl/bash"
ln -sf "$(command -v dirname)" "${WORK}/nokubectl/dirname"
out=$(cd "${P2}" && /usr/bin/env -i PATH="${WORK}/nokubectl" bash src/cd_status.sh 2>&1); rc=$?
check_rc "cd_status: missing kubectl exits 1" 1 "${rc}"
check_contains "cd_status: missing kubectl is reported" \
  "Error: kubectl is not available in PATH" "${out}"

echo
echo "== util.bash secret_getter + getRandomNS.sh =="
reset_logs
out=$(cd "${P2}" && /usr/bin/env -i PATH="${WORK}/stubs:/usr/bin:/bin" \
  bash -c 'source src/util.bash; secret_getter prod-ns my-secret password' 2>&1)
check "secret_getter: base64-decodes the requested key" "s3cr3t-pw" "${out}"
check_contains "secret_getter: kubectl query shape" \
  "get secret -n prod-ns my-secret -o json" "$(cat "${WORK}/kubectl.log")"
out=$(cd "${P2}" && /usr/bin/env -i PATH="${WORK}/stubs:/usr/bin:/bin" \
  bash -c 'source src/util.bash; secret_getter only two' 2>&1); rc=$?
check_rc "secret_getter: wrong arg count exits 1" 1 "${rc}"
check_contains "secret_getter: wrong args are reported" "wrong args 2" "${out}"
out=$(p2 getRandomNS.sh 2>&1)
expected_ns=$(printf '%s\n' '--forwarder=1.0.0.1 \' '--forwarder=1.1.1.1 \' \
  '--forwarder=8.8.8.8 \' '--forwarder=9.9.9.9 \' | sort)
check "getRandomNS: every csv row becomes a forwarder flag" \
  "${expected_ns}" "$(printf '%s\n' "${out}" | sort)"

echo
echo "shell tests: ${PASS} passed, ${FAIL} failed"
[[ "${FAIL}" -eq 0 ]]
