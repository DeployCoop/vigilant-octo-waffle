#!/usr/bin/env bash
# Plan III §9.1 — root `pnpm check`: run locally everything the seven
# required branch-protection checks judge, in CI order, and print a
# summary table (gate -> PASS / SKIPPED / FAIL).
#
# Gates mirrored from .github/workflows/ci.yml:
#   1. Tests & typecheck   (orchestrator / web / ink tests; web+ink+
#                            githubio typechecks; orchestrator typechecks
#                            via its build)
#   2. Production build    (pnpm build; plus the Docker image build when
#                            docker is present)
#   3. Lint                (pnpm -r lint, with each package's budget)
#   4. ShellCheck          (error severity gate + warning budget, exactly
#                            as CI invokes it)
#   5. Shell tests         (bash scripts/tests/run.sh)
#   6. Secrets scan        (gitleaks over the change range, as CI does)
#   7. Analyze (CodeQL)    — CI-only; always SKIPPED here, loudly.
#
# Tools absent locally are NEVER a silent pass: the gate prints a loud
# SKIPPED block naming the missing tool and what CI enforces instead,
# and the summary marks the gate SKIPPED. The script exits non-zero if
# any gate that ran FAILs; SKIPPED gates do not fail the run.
#
# Binary-gated tests (CI runs them with VOW_BINARY_REQUIRED=1 and
# VOW_PARITY_REQUIRED=1 after installing helm, mkcert, yq, envsubst):
# locally each REQUIRED flag is set only when its tools are present;
# otherwise the corresponding subset is reported SKIPPED and the suite
# runs with its normal skip semantics.
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

declare -a SUMMARY=()
FAILED=0

note() { printf '%s\n' "$*"; }
header() { printf '\n===== %s =====\n' "$*"; }

# record <gate> <PASS|SKIPPED|FAIL>
record() {
  SUMMARY+=("$1: $2")
  if [ "$2" = "FAIL" ]; then FAILED=1; fi
}

# loud_skip <gate> <reason...> — prints a bordered SKIPPED block.
loud_skip() {
  local gate="$1"; shift
  printf '\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n'
  printf 'SKIPPED: %s\n' "$gate"
  printf '%s\n' "$@"
  printf '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n'
}

have() { command -v "$1" >/dev/null 2>&1; }

if ! have pnpm; then
  printf 'ERROR: pnpm is not on PATH (repo pins pnpm@11.24.0).\n' >&2
  exit 2
fi

# ---------------------------------------------------------------- 1. Tests
header "GATE 1/7: Tests & typecheck"
GATE1_FAIL=0

# Orchestrator: clean dist first (a stale dist across branch switches
# fabricates failures), then build (which is also its typecheck).
rm -rf packages/orchestrator/dist
if ! pnpm --filter @vow/orchestrator build; then GATE1_FAIL=1; fi

# Binary-gated test subsets: mirror CI's REQUIRED flags only when the
# tools are actually installed; otherwise say so loudly.
if have helm && have mkcert; then
  export VOW_BINARY_REQUIRED=1
else
  loud_skip "helm/mkcert-gated orchestrator tests" \
    "helm and/or mkcert are not installed. CI installs both and runs" \
    "with VOW_BINARY_REQUIRED=1, which turns a missing binary into a" \
    "suite failure instead of a skip. Locally those tests skip."
fi
if have yq && have envsubst; then
  export VOW_PARITY_REQUIRED=1
else
  loud_skip "bash<->TS parity tests requiring yq/envsubst" \
    "yq and/or envsubst are not installed. CI installs both and runs" \
    "with VOW_PARITY_REQUIRED=1, which turns a missing tool into a" \
    "parity failure instead of a skip. Locally those tests skip."
fi
if ! pnpm --filter @vow/orchestrator test; then GATE1_FAIL=1; fi

if ! pnpm --filter @vow/web test; then GATE1_FAIL=1; fi

if ! pnpm --filter @vow/ink build; then GATE1_FAIL=1; fi
if ! pnpm --filter @vow/ink test; then GATE1_FAIL=1; fi

if ! pnpm --filter @vow/web typecheck; then GATE1_FAIL=1; fi
if ! pnpm --filter @vow/ink typecheck; then GATE1_FAIL=1; fi
if ! pnpm --filter @vow/githubio typecheck; then GATE1_FAIL=1; fi

if [ "$GATE1_FAIL" -eq 0 ]; then record "Tests & typecheck" "PASS"; else record "Tests & typecheck" "FAIL"; fi

# ------------------------------------------------------- 2. Production build
header "GATE 2/7: Production build"
GATE2_FAIL=0
if ! pnpm build; then GATE2_FAIL=1; fi
if have docker; then
  if ! docker build -t vow-web:ci .; then GATE2_FAIL=1; fi
else
  loud_skip "Docker image build (part of the CI Production build job)" \
    "docker is not installed. CI builds the image and boots it (node" \
    "version assertion, non-root uid assertion, HTTP smoke). The pnpm" \
    "build above is the gate that ran locally."
fi
if [ "$GATE2_FAIL" -eq 0 ]; then record "Production build" "PASS"; else record "Production build" "FAIL"; fi

# ------------------------------------------------------------------- 3. Lint
header "GATE 3/7: Lint"
if pnpm -r lint; then record "Lint" "PASS"; else record "Lint" "FAIL"; fi

# -------------------------------------------------------------- 4. ShellCheck
header "GATE 4/7: ShellCheck"
GATE4_FAIL=0
if have shellcheck; then
  if ! shellcheck --severity=error src/*.bash src/*.sh up bin/vow; then GATE4_FAIL=1; fi
  # Warning budget: CI's exact invocation and budget file. The count
  # may only shrink; lower the budget file in the same PR that lowers
  # the count (Plan II §6.2).
  count=$(shellcheck --severity=warning --format=gcc src/*.bash src/*.sh up bin/vow | grep -cE ': (warning|error):' || true)
  budget=$(cat .github/shellcheck-warning-budget.txt)
  note "ShellCheck warnings: ${count} (budget: ${budget})"
  if [ "${count}" -gt "${budget}" ]; then
    note "ERROR: ShellCheck warning count ${count} exceeds budget ${budget}"
    GATE4_FAIL=1
  fi
else
  loud_skip "ShellCheck gate" \
    "shellcheck is not installed. CI installs ShellCheck 0.10.0 and" \
    "gates on error severity plus the warning budget in" \
    ".github/shellcheck-warning-budget.txt. Nothing was checked."
  record "ShellCheck" "SKIPPED"
fi
if [ "$GATE4_FAIL" -eq 0 ] && have shellcheck; then record "ShellCheck" "PASS"; fi
if [ "$GATE4_FAIL" -ne 0 ]; then record "ShellCheck" "FAIL"; fi

# ------------------------------------------------------------ 5. Shell tests
header "GATE 5/7: Shell tests"
if bash scripts/tests/run.sh; then record "Shell tests" "PASS"; else record "Shell tests" "FAIL"; fi

# ----------------------------------------------------------- 6. Secrets scan
header "GATE 6/7: Secrets scan"
if have gitleaks; then
  # Mirror CI's range: the PR change range when a base exists, else the
  # last commit (CI's push fallback). Config auto-loads from the repo
  # root .gitleaks.toml, which documents the audited allowlist.
  if git rev-parse --verify --quiet origin/main >/dev/null && [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    RANGE="origin/main..HEAD"
  else
    RANGE="-n 1"
  fi
  note "Scanning range: ${RANGE}"
  if gitleaks git --redact --log-opts="$RANGE" .; then record "Secrets scan" "PASS"; else record "Secrets scan" "FAIL"; fi
else
  loud_skip "Secrets scan gate" \
    "gitleaks is not installed. CI installs gitleaks 8.28.0 and scans" \
    "the change range with --redact. Nothing was scanned."
  record "Secrets scan" "SKIPPED"
fi

# ------------------------------------------------------- 7. Analyze (CodeQL)
header "GATE 7/7: Analyze (CodeQL)"
loud_skip "CodeQL analysis" \
  "CodeQL runs on GitHub Actions only (the Analyze jobs); there is no" \
  "local equivalent this script can run. This gate is always SKIPPED" \
  "locally and is judged by CI."
record "Analyze (CodeQL)" "SKIPPED"

# ------------------------------------------------------------------ Summary
header "CHECK SUMMARY"
for row in "${SUMMARY[@]}"; do printf '  %s\n' "$row"; done
if [ "$FAILED" -eq 0 ]; then
  printf '\nRESULT: PASS (skipped gates listed above ran nowhere)\n'
  exit 0
else
  printf '\nRESULT: FAIL — see the failed gate(s) above\n'
  exit 1
fi
