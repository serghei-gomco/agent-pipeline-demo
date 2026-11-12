#!/usr/bin/env bash
# lint-on-edit.sh — PostToolUse(Edit|Write|MultiEdit): прогнать commands.lint по изменённому файлу.
# Не блокирует: замечания уходят модели как контекст. Нет commands.lint / не проект kit → no-op.
# Файлы задачи (tasks.dir) и вне проекта не линтуются. Потолок — 30 с.
. "$(dirname "$0")/_common.sh"
kit_off && exit 0
data="$(cat 2>/dev/null)" || exit 0
f="$(printf '%s' "$data" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
[ -n "$f" ] && [ -f "$f" ] || exit 0
f="$(cd "$(dirname "$f")" && pwd -P)/$(basename "$f")"
KIT_ROOT="$(kit_root "$(dirname "$f")")"; [ -n "$KIT_ROOT" ] || exit 0
KIT_ROOT="$(cd "$KIT_ROOT" && pwd -P)"
lint="$(kit_get commands.lint)"; [ -n "$lint" ] || exit 0
tdir="$(kit_get tasks.dir)"; case "$f" in "$KIT_ROOT/${tdir:-.tasks}"/*|*/.claude/*) exit 0 ;; esac
case "$f" in "$KIT_ROOT"/*) : ;; *) exit 0 ;; esac
q="$(printf '%q' "$f")"
cmd="${lint//\{files\}/$q}"; [ "$cmd" = "$lint" ] && cmd="$lint $q"
out="$(cd "$KIT_ROOT" && perl -e 'alarm 30; exec @ARGV' /bin/bash -c "$cmd" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && exit 0
kit_context PostToolUse "agent-kit lint (${cmd:0:80}) — код $rc:
$(printf '%s' "$out" | tail -25)"
