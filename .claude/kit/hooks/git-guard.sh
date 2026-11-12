#!/usr/bin/env bash
# git-guard.sh — PreToolUse(Bash). Сторож git по гейтам kit (docs/CONVENTIONS.md, п. 9).
#  1. lib/git_policy.py разбирает команду (shlex, heredoc, sh -c, eval) на git-вызовы:
#     push в защищённую ветку / --force / --delete / +refspec / upstream на базу, commit -a/-n/без -m,
#     add -A/., новые ветки с upstream на базу → deny; amend → ask.
#  2. `git commit` → lib/commit_check.py (сообщение, индекс, секреты, запрещённые пути).
# Работает только в проектах с .agent-kit.yml (ищется от репо цели команды). Сбой разборщика → deny.
. "$(dirname "$0")/_common.sh"
kit_off && exit 0
data="$(cat 2>/dev/null)" || exit 0
cmd="$(printf '%s' "$data" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -z "$cmd" ] && exit 0
printf '%s' "$cmd" | grep -Eq "(^|[^A-Za-z0-9_.-])git([[:space:]\"');]|\$)" || exit 0
cwd="$(printf '%s' "$data" | jq -r '.cwd // empty' 2>/dev/null)"; [ -z "$cwd" ] && cwd="$PWD"

# защищённые ветки берём из конфига проекта cwd (до разбора; цель уточним ниже)
KIT_ROOT="$(kit_root "$cwd")"
export KIT_PROTECTED_BRANCHES="$( [ -n "$KIT_ROOT" ] && kit_get git.protected_branches | tr '\n' ' ')"
[ -z "$KIT_PROTECTED_BRANCHES" ] && unset KIT_PROTECTED_BRANCHES

pol="$(printf '%s' "$cmd" | python3 -I "$KIT_DIR/hooks/lib/git_policy.py" --cwd "$cwd" 2>/dev/null)"
decision="$(printf '%s' "$pol" | jq -r '.decision // empty' 2>/dev/null)"
target="$(printf '%s' "$pol" | jq -r '.target // empty' 2>/dev/null)"
[ -n "$target" ] && KIT_ROOT="$(kit_root "$target")"
[ -z "$KIT_ROOT" ] && exit 0                       # не проект kit — не наше дело
[ -z "$decision" ] && kit_deny "kit git-guard: разборщик команды не ответил — git-команда не пропущена."
reason="$(printf '%s' "$pol" | jq -r '.reason // ""')"
[ "$decision" = "deny" ] && kit_deny "kit git-guard: $reason"

if [ "$(printf '%s' "$pol" | jq -r '.commit != null')" = "true" ]; then
  crepo="$(printf '%s' "$pol" | jq -r '.commit.repo')"
  args=("$crepo")
  mfile="$(printf '%s' "$pol" | jq -r '.commit.msg_file // empty')"
  if [ -n "$mfile" ]; then args+=(--msg-file "$mfile")
  elif [ "$(printf '%s' "$pol" | jq -r '.commit.msg != null')" = "true" ]; then
    args+=(--msg "$(printf '%s' "$pol" | jq -r '.commit.msg')")
  fi
  [ "$(printf '%s' "$pol" | jq -r '.commit.amend // false')" = true ] && args+=(--amend)
  out="$(python3 -I "$KIT_DIR/hooks/lib/commit_check.py" "${args[@]}" 2>&1)"; rc=$?
  [ "$rc" -ne 0 ] && kit_deny "$out"
fi
[ "$decision" = "ask" ] && kit_ask "kit git-guard: $reason"
exit 0
