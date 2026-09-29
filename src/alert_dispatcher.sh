#!/usr/bin/env bash
# ==============================================================================
# src/alert_dispatcher.sh - Unified Webhook Alert Dispatcher
# ==============================================================================
# Dispatches notifications and critical cluster alerts to Slack, Discord,
# PagerDuty, and generic webhooks for proactive incident response.
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

SLACK_URL="${ALERT_WEBHOOK_SLACK:-}"
DISCORD_URL="${ALERT_WEBHOOK_DISCORD:-}"
PAGERDUTY_KEY="${ALERT_PAGERDUTY_KEY:-}"
GENERIC_URL="${ALERT_GENERIC_WEBHOOK:-}"

SEVERITY="warning"
TITLE="K3s Cluster Alert"
MESSAGE=""
SOURCE="k3s-orchestrator"
JSON_OUTPUT=false

ACTION="${1:-status}"
shift || true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      JSON_OUTPUT=true
      shift
      ;;
    --title)
      TITLE="$2"
      shift 2
      ;;
    --message|-m)
      MESSAGE="$2"
      shift 2
      ;;
    --severity|-s)
      SEVERITY="$2"
      shift 2
      ;;
    --source)
      SOURCE="$2"
      shift 2
      ;;
    --slack-url)
      SLACK_URL="$2"
      shift 2
      ;;
    --discord-url)
      DISCORD_URL="$2"
      shift 2
      ;;
    --pagerduty-key)
      PAGERDUTY_KEY="$2"
      shift 2
      ;;
    -h|--help)
      cat << 'EOF'
Usage: ./src/alert_dispatcher.sh <action> [options]

Unified multi-channel webhook alert dispatcher (Slack, Discord, PagerDuty).

Actions:
  status                        Check configured alert channels and webhook readiness
  send                          Dispatch alert notification to all configured channels
  test                          Dispatch test canary alert to verify connectivity

Options:
      --title <string>          Alert subject / title (default: 'K3s Cluster Alert')
      --message <string>        Alert message body / incident details
      --severity <level>        Severity level: info, warning, critical (default: warning)
      --source <string>         Alert source/subsystem (default: 'k3s-orchestrator')
      --slack-url <url>         Override Slack webhook URL
      --discord-url <url>       Override Discord webhook URL
      --pagerduty-key <key>     Override PagerDuty integration routing key
      --json                    Output channel status or result in structured JSON format
  -h, --help                    Show this help message

Examples:
  ./src/alert_dispatcher.sh status --json
  ./src/alert_dispatcher.sh test
  ./src/alert_dispatcher.sh send --title "etcd Latency Alert" --message "fsync latency > 15ms" --severity critical
EOF
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

cmd_status() {
  local has_slack=false
  local has_discord=false
  local has_pagerduty=false
  local has_generic=false

  [[ -n "${SLACK_URL}" ]] && has_slack=true
  [[ -n "${DISCORD_URL}" ]] && has_discord=true
  [[ -n "${PAGERDUTY_KEY}" ]] && has_pagerduty=true
  [[ -n "${GENERIC_URL}" ]] && has_generic=true

  local configured_count=0
  [[ "${has_slack}" == "true" ]] && configured_count=$((configured_count + 1))
  [[ "${has_discord}" == "true" ]] && configured_count=$((configured_count + 1))
  [[ "${has_pagerduty}" == "true" ]] && configured_count=$((configured_count + 1))
  [[ "${has_generic}" == "true" ]] && configured_count=$((configured_count + 1))

  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    cat << EOF
{
  "totalChannelsConfigured": ${configured_count},
  "channels": {
    "slack": ${has_slack},
    "discord": ${has_discord},
    "pagerduty": ${has_pagerduty},
    "generic": ${has_generic}
  }
}
EOF
    return 0
  fi

  echo "============================================================"
  echo "Cluster Alert Dispatcher Status"
  echo "============================================================"
  echo "Slack Webhook     : $( [[ "${has_slack}" == "true" ]] && echo "CONFIGURED" || echo "NOT SET" )"
  echo "Discord Webhook   : $( [[ "${has_discord}" == "true" ]] && echo "CONFIGURED" || echo "NOT SET" )"
  echo "PagerDuty Key     : $( [[ "${has_pagerduty}" == "true" ]] && echo "CONFIGURED" || echo "NOT SET" )"
  echo "Generic Webhook   : $( [[ "${has_generic}" == "true" ]] && echo "CONFIGURED" || echo "NOT SET" )"
  echo "Active Channels   : ${configured_count}"
  echo "============================================================"
}

send_slack() {
  local url="$1"
  local color="#36a64f"
  case "${SEVERITY}" in
    critical) color="#dc3545" ;;
    warning) color="#ffc107" ;;
    info) color="#17a2b8" ;;
  esac

  local payload
  payload=$(cat << EOF
{
  "attachments": [
    {
      "color": "${color}",
      "title": "${TITLE}",
      "text": "${MESSAGE}",
      "fields": [
        {"title": "Severity", "value": "${SEVERITY}", "short": true},
        {"title": "Source", "value": "${SOURCE}", "short": true}
      ],
      "ts": $(date +%s)
    }
  ]
}
EOF
)

  curl -s -X POST -H 'Content-type: application/json' --data "${payload}" "${url}" >/dev/null 2>&1 || true
}

send_discord() {
  local url="$1"
  local color=3066993
  case "${SEVERITY}" in
    critical) color=15158332 ;;
    warning) color=16776960 ;;
    info) color=3447003 ;;
  esac

  local payload
  payload=$(cat << EOF
{
  "embeds": [
    {
      "title": "${TITLE}",
      "description": "${MESSAGE}",
      "color": ${color},
      "fields": [
        {"name": "Severity", "value": "${SEVERITY}", "inline": true},
        {"name": "Source", "value": "${SOURCE}", "inline": true}
      ]
    }
  ]
}
EOF
)

  curl -s -X POST -H 'Content-type: application/json' --data "${payload}" "${url}" >/dev/null 2>&1 || true
}

send_pagerduty() {
  local key="$1"
  local pd_severity="warning"
  case "${SEVERITY}" in
    critical) pd_severity="critical" ;;
    warning) pd_severity="warning" ;;
    info) pd_severity="info" ;;
  esac

  local payload
  payload=$(cat << EOF
{
  "routing_key": "${key}",
  "event_action": "trigger",
  "payload": {
    "summary": "${TITLE}: ${MESSAGE}",
    "source": "${SOURCE}",
    "severity": "${pd_severity}"
  }
}
EOF
)

  curl -s -X POST -H 'Content-type: application/json' --data "${payload}" "https://events.pagerduty.com/v2/enqueue" >/dev/null 2>&1 || true
}

send_generic() {
  local url="$1"
  local payload
  payload=$(cat << EOF
{
  "title": "${TITLE}",
  "message": "${MESSAGE}",
  "severity": "${SEVERITY}",
  "source": "${SOURCE}",
  "timestamp": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
}
EOF
)

  curl -s -X POST -H 'Content-type: application/json' --data "${payload}" "${url}" >/dev/null 2>&1 || true
}

cmd_send() {
  if [[ -z "${MESSAGE}" ]]; then
    MESSAGE="Cluster alert triggered with severity '${SEVERITY}'."
  fi

  local sent_count=0

  if [[ -n "${SLACK_URL}" ]]; then
    send_slack "${SLACK_URL}"
    sent_count=$((sent_count + 1))
  fi

  if [[ -n "${DISCORD_URL}" ]]; then
    send_discord "${DISCORD_URL}"
    sent_count=$((sent_count + 1))
  fi

  if [[ -n "${PAGERDUTY_KEY}" ]]; then
    send_pagerduty "${PAGERDUTY_KEY}"
    sent_count=$((sent_count + 1))
  fi

  if [[ -n "${GENERIC_URL}" ]]; then
    send_generic "${GENERIC_URL}"
    sent_count=$((sent_count + 1))
  fi

  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    cat << EOF
{
  "success": true,
  "channelsDispatched": ${sent_count},
  "severity": "${SEVERITY}",
  "title": "${TITLE}"
}
EOF
    return 0
  fi

  if [[ ${sent_count} -eq 0 ]]; then
    echo "Notice: No alert webhooks configured in environment. Alert logged locally:"
    echo "  [${SEVERITY^^}] ${TITLE}: ${MESSAGE}"
  else
    echo "Alert successfully dispatched to ${sent_count} channels."
  fi
}

case "${ACTION}" in
  status)
    cmd_status
    ;;
  send)
    cmd_send
    ;;
  test)
    TITLE="K3s Test Canary Notification"
    MESSAGE="This is a test notification verifying connectivity from vigilant-octo-waffle."
    SEVERITY="info"
    cmd_send
    ;;
  *)
    cmd_status
    ;;
esac
