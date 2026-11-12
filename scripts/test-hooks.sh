#!/usr/bin/env bash
# test-hooks.sh — proves the agent-kit git guard blocks what it must and lets normal work through.
#
# It feeds the hook the same JSON that Claude Code sends before a Bash command (PreToolUse),
# inside a throwaway git repo, so nothing in this repo is touched and no network is used.
# Every "blocked" case has a "allowed" twin (positive control): a guard that blocks everything
# would fail this test too.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
GUARD="$ROOT/.claude/kit/hooks/git-guard.sh"
[ -x "$GUARD" ] || [ -f "$GUARD" ] || { echo "✗ guard not found: $GUARD (install agent-kit first)"; exit 1; }

SANDBOX="$(mktemp -d)"; trap 'rm -rf "$SANDBOX"' EXIT
cd "$SANDBOX"
git init -q -b main && git config user.name t && git config user.email t@example.invalid
cp "$ROOT/.agent-kit.yml" . && mkdir .claude && ln -s "$ROOT/.claude/kit" .claude/kit
echo "# sandbox" > README.md && git add README.md && KIT_HOOKS=off git commit -qm "chore: init"
git switch -qc feat/sandbox

pass=0; fail=0
decide() {  # decide <command> → prints deny | ask | allow
  local out
  out="$(jq -n --arg c "$1" --arg d "$SANDBOX" '{tool_name:"Bash",tool_input:{command:$c},cwd:$d}' | bash "$GUARD")"
  local d; d="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null)"
  echo "${d:-allow}"
}
expect() {  # expect <deny|ask|allow> <label> <command>
  local got; got="$(decide "$3")"
  if [ "$got" = "$1" ]; then pass=$((pass+1)); printf '  ✓ %-5s %s\n' "$got" "$2"
  else fail=$((fail+1)); printf '  ✗ %-5s %s (expected %s)\n' "$got" "$2" "$1"; fi
}

echo "push:"
expect deny  "git push --force"                       "git push --force origin feat/sandbox"
expect deny  "git push -f (short flag)"               "git push -f origin feat/sandbox"
expect deny  "git push +refspec (force in disguise)"  "git push origin +feat/sandbox"
expect deny  "push into protected main"               "git push origin main"
expect allow "push own branch (control)"              "git push -u origin feat/sandbox"
expect allow "--force-with-lease own branch (control)" "git push --force-with-lease origin feat/sandbox"

echo "commit:"
echo "PORT=3001" > .env && git add -f .env
expect deny  "commit with .env staged"                "git commit -m 'feat: add env'"
git rm -q --cached .env && rm .env
echo "ok" > app.txt && git add app.txt
expect allow "normal commit (control)"                "git commit -m 'feat: add app'"
expect deny  "commit message off pattern"             "git commit -m 'wip'"
expect deny  "AI trailer in message"                  "$(printf "git commit -m 'feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>'")"
expect deny  "--no-verify"                            "git commit --no-verify -m 'feat: x'"
expect deny  "git add -A"                             "git add -A"
expect ask   "--amend needs a separate yes"           "git commit --amend -m 'feat: x'"

echo
echo "hook tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
