#!/usr/bin/env bash
# _common.sh — общее для хуков agent-kit (source-ится из хуков).
# KIT_DIR — папка kit (…/.claude/kit или клон репо), KIT_ROOT — корень проекта с .agent-kit.yml.
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
KIT_CFG="python3 -I $KIT_DIR/scripts/kit_config.py"

kit_off() { [ "${KIT_HOOKS:-on}" = "off" ]; }

# kit_root <dir> — корень проекта или пусто (тогда хук — no-op)
kit_root() { $KIT_CFG root "${1:-$PWD}" 2>/dev/null; }

kit_get() { $KIT_CFG get "$1" "${2:-$KIT_ROOT}" 2>/dev/null; }

kit_deny() {
  jq -nc --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}
kit_ask() {
  jq -nc --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:$r}}'
  exit 0
}
kit_context() {  # kit_context <Event> <text>
  jq -nc --arg e "$1" --arg m "$2" '{hookSpecificOutput:{hookEventName:$e,additionalContext:$m}}'
  exit 0
}
