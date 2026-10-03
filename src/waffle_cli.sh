#!/usr/bin/env bash
# ==============================================================================
# Vigilant Octo Waffle: Waffle Meta-Package Headless CLI Runner
# Validates, simulates, and executes multi-tier Waffle pipeline definitions.
# ==============================================================================
set -euo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${THIS_DIR}/.." && pwd)"

export PATH="/root/.nvm/versions/node/v24.21.0/bin:${PATH}"

ACTION="${1:-help}"
shift || true

PIPELINE_FILE=""
ENV_FILE=""
DRY_RUN=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --verbose|-v)
      VERBOSE=true
      shift
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2 || { echo "Error: --env-file requires a path" >&2; exit 1; }
      ;;
    -h|--help)
      ACTION="help"
      shift
      ;;
    *)
      if [[ -z "${PIPELINE_FILE}" ]]; then
        PIPELINE_FILE="$1"
      fi
      shift
      ;;
  esac
done

if [[ "${ACTION}" == "help" || -z "${ACTION}" ]]; then
  echo "Usage: ./up waffle:run <pipeline.yaml> [options]"
  echo "       ./up waffle:validate <pipeline.yaml>"
  echo "       ./up waffle:blueprints"
  echo ""
  echo "Commands:"
  echo "  waffle:run <file>         Execute a multi-stage Waffle meta-package pipeline"
  echo "  waffle:validate <file>    Validate pipeline syntax, dependencies, and parameters"
  echo "  waffle:blueprints         List built-in community blueprints"
  echo ""
  echo "Options:"
  echo "  --dry-run                 Simulate step execution without modifying cluster"
  echo "  --env-file <path>         Load secrets from a dotenv file (default: .env.production,"
  echo "                            then .env, in the pipeline dir or current dir)"
  echo "  --verbose, -v             Display verbose step logs"
  echo "  -h, --help                Show this help message"
  exit 0
fi

if [[ "${ACTION}" == "blueprints" || "${ACTION}" == "list" ]]; then
  node -e "
    const { getBuiltinBlueprints } = require('${WORKSPACE_ROOT}/packages/orchestrator/dist/index.js');
    const list = getBuiltinBlueprints();
    console.log('Available Built-in Waffle Blueprints (' + list.length + ' found):');
    for (const b of list) {
      console.log('  • ' + (b.metadata.name).padEnd(30) + ' : ' + b.metadata.description);
    }
  "
  exit 0
fi

if [[ -z "${PIPELINE_FILE}" ]]; then
  echo "Error: pipeline file path is required." >&2
  echo "Example: ./up waffle:run charts/waffle.yaml" >&2
  exit 1
fi

if [[ ! -f "${PIPELINE_FILE}" ]]; then
  if [[ -f "${WORKSPACE_ROOT}/${PIPELINE_FILE}" ]]; then
    PIPELINE_FILE="${WORKSPACE_ROOT}/${PIPELINE_FILE}"
  else
    echo "Error: file not found: ${PIPELINE_FILE}" >&2
    exit 1
  fi
fi

# Load secrets for ${VAR} interpolation. Variables already exported win over the file.
if [[ -z "${ENV_FILE}" ]]; then
  for d in "$(dirname "${PIPELINE_FILE}")" "$(pwd)"; do
    for f in .env.production .env; do
      if [[ -f "${d}/${f}" ]]; then ENV_FILE="${d}/${f}"; break 2; fi
    done
  done
fi
if [[ -n "${ENV_FILE}" ]]; then
  if [[ ! -f "${ENV_FILE}" ]]; then echo "Error: env file not found: ${ENV_FILE}" >&2; exit 1; fi
  echo "==> Loading environment from ${ENV_FILE}"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    line="${line#export }"
    [[ "${line}" == *=* ]] || continue
    key="${line%%=*}"; val="${line#*=}"
    [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ -z "${!key:-}" ]]; then
      if [[ "${val}" =~ ^\"(.*)\"$ || "${val}" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
      export "${key}=${val}"
    fi
  done < "${ENV_FILE}"
fi

case "${ACTION}" in
  validate|lint)
    echo "==> Validating Waffle pipeline '${PIPELINE_FILE}'..."
    node -e "
      const fs = require('fs');
      const path = require('path');
      const { parseWaffleYaml, validateWafflePipeline } = require('${WORKSPACE_ROOT}/packages/orchestrator/dist/index.js');
      const yamlContent = fs.readFileSync('${PIPELINE_FILE}', 'utf8');
      const pipeline = parseWaffleYaml(yamlContent);
      const pipelineDir = path.dirname(path.resolve('${PIPELINE_FILE}'));
      const validation = validateWafflePipeline(pipeline, pipelineDir);
      if (validation.valid) {
        console.log('✔ Pipeline valid: ' + pipeline.metadata.name + ' (version: ' + (pipeline.metadata.version || '1.0.0') + ')');
        console.log('  Stages: ' + pipeline.stages.length + ', Total Steps: ' + pipeline.stages.reduce((acc, s) => acc + s.steps.length, 0));
        process.exit(0);
      } else {
        console.error('✖ Pipeline validation failed:');
        for (const err of validation.errors) {
          console.error('  - ' + err);
        }
        process.exit(1);
      }
    "
    ;;
  run|apply|exec)
    echo "==> Executing Waffle pipeline '${PIPELINE_FILE}' (dry-run: ${DRY_RUN})..."
    node -e "
      const fs = require('fs');
      const path = require('path');
      const { parseWaffleYaml, WaffleRunner } = require('${WORKSPACE_ROOT}/packages/orchestrator/dist/index.js');
      const yamlContent = fs.readFileSync('${PIPELINE_FILE}', 'utf8');
      const pipeline = parseWaffleYaml(yamlContent);
      const pipelineDir = path.dirname(path.resolve('${PIPELINE_FILE}'));
      const runner = new WaffleRunner(pipelineDir);

      runner.on('log', (ev) => {
        if ('${VERBOSE}' === 'true' || ev.level === 'error' || ev.level === 'warn') {
          console.log('[' + ev.stepId + '] ' + ev.message);
        }
      });

      runner.on('progress', (progress) => {
        if (progress.currentStep) {
          console.log('  ▶ [' + progress.completedSteps + '/' + progress.totalSteps + '] Step: ' + progress.currentStep + ' (' + progress.status + ')');
        }
      });

      runner.executePipeline({
        sourceId: pipeline.metadata.name,
        pipeline,
        baseDir: pipelineDir,
        dryRun: ${DRY_RUN}
      }).then(record => {
        console.log('\n==================================================================');
        console.log('  Waffle Execution Summary: ' + record.pipelineName);
        console.log('  Status  : ' + record.status.toUpperCase());
        console.log('  Steps   : ' + record.completedSteps + ' / ' + record.totalSteps + ' completed');
        if (record.deployedDomains && record.deployedDomains.length > 0) {
          console.log('  Endpoints:');
          for (const ep of record.deployedDomains) {
            console.log('    • ' + ep.name + ' -> ' + ep.url);
          }
        }
        console.log('==================================================================');
        if (record.status !== 'completed') {
          process.exit(1);
        }
      }).catch(err => {
        console.error('Execution error: ' + err.message);
        process.exit(1);
      });
    "
    ;;
  *)
    echo "Unknown waffle action: ${ACTION}" >&2
    exit 1
    ;;
esac
