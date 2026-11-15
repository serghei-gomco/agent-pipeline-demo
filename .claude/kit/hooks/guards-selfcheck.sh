#!/usr/bin/env bash
# guards-selfcheck.sh — SessionStart (startup|clear). Сторож с "onFailure": "block", который не
# запускается, закрывает свой инструмент целиком. Здесь каждый такой сторож прогоняется на холостом
# входе (tool_name=Noop) с потолком 5 с: из ~/.claude/settings.json, проектного .claude/settings.json
# и всех .claude/tree-hooks.json вверх от cwd. Код не 0/2 или таймаут — громкое предупреждение.
# Сам никогда не блокирует и всегда выходит 0. Аргумент --print — вывести отчёт текстом (для тестов).
data="$(cat 2>/dev/null)"
src="$(printf '%s' "$data" | jq -r '.source // empty' 2>/dev/null)"
case "$src" in startup|clear|"") : ;; *) exit 0 ;; esac
command -v jq >/dev/null 2>&1 || { printf '%s\n' '{"systemMessage":"guards-selfcheck: нет jq — сторожа слепы"}'; exit 0; }
cwd="$(printf '%s' "$data" | jq -r '.cwd // empty' 2>/dev/null)"; [ -z "$cwd" ] && cwd="$PWD"

files=("$HOME/.claude/settings.json")
[ -n "$CLAUDE_PROJECT_DIR" ] && files+=("$CLAUDE_PROJECT_DIR/.claude/settings.json")
d="$cwd"; while :; do
  [ -f "$d/.claude/tree-hooks.json" ] && files+=("$d/.claude/tree-hooks.json")
  [ -f "$d/.claude/settings.json" ] && [ "$d" != "$HOME" ] && files+=("$d/.claude/settings.json")
  [ "$d" = "/" ] && break; d="$(dirname "$d")"
done

payload="$(jq -nc --arg c "$cwd" '{session_id:"guards-selfcheck",hook_event_name:"PreToolUse",cwd:$c,tool_name:"Noop",tool_input:{}}')"
problems=(); checked=0; seen=""
for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  if ! jq -e . "$f" >/dev/null 2>&1; then problems+=("$f — невалидный JSON"); continue; fi
  while IFS= read -r cmd; do
    [ -z "$cmd" ] && continue
    case "$seen" in *"|$cmd|"*) continue ;; esac; seen="$seen|$cmd|"
    checked=$((checked+1))
    out="$(printf '%s' "$payload" | (cd "$cwd" 2>/dev/null || cd /tmp; perl -e 'alarm 5; exec @ARGV' /bin/bash -c "$cmd") 2>&1)"; rc=$?
    case "$rc" in
      0|2) : ;;
      142) problems+=("таймаут 5 с: $cmd") ;;
      *)   problems+=("код $rc: $cmd — $(printf '%s' "$out" | tail -1 | cut -c1-160)") ;;
    esac
  done < <(jq -r '.hooks.PreToolUse[]?.hooks[]? | select(.onFailure=="block") | .command' "$f" 2>/dev/null)
done
if [ "$1" = "--print" ]; then
  echo "guards-selfcheck: проверено сторожей: $checked, проблем: ${#problems[@]}"
  for p in "${problems[@]}"; do echo "  ✗ $p"; done
  [ ${#problems[@]} -eq 0 ]; exit $?
fi
[ ${#problems[@]} -eq 0 ] && exit 0
msg="⛔ guards-selfcheck: сторож с onFailure:block не запускается — его инструмент будет заблокирован целиком. Скажи человеку сразу. $(printf '%s; ' "${problems[@]}")"
jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$m}, systemMessage:$m}'
exit 0
