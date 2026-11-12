#!/usr/bin/env python3
"""settings_merge.py — добавить/убрать хуки и права kit в settings.json Claude Code. Идемпотентно.

  settings_merge.py add    <settings.json> <hooks_dir> [--scope project|user]
  settings_merge.py remove <settings.json>
  settings_merge.py show   <settings.json>          # kit-записи в файле

Записи kit узнаются по `/kit/hooks/` в команде — чужие хуки не трогаются. Перед записью — копия
`<файл>.bak-kit-<время>`. Невалидный JSON на входе — отказ без изменений.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import time

MARK = "/kit/hooks/"

PERM_DENY = ["Bash(git push --force)", "Bash(git push --force:*)", "Bash(git push -f:*)",
             "Bash(git add -A)", "Bash(git add -A:*)", "Bash(git add .)"]
PERM_ASK = ["Bash(git push --force-with-lease:*)", "Bash(git reset --hard:*)", "Bash(git rebase:*)",
            "Bash(git cherry-pick:*)", "Bash(git branch -D:*)", "Bash(git merge:*)"]


def hooks_for(hdir: str, scope: str) -> dict:
    q = lambda name: f'"{hdir}/{name}"'  # noqa: E731
    h = {
        "PreToolUse": [
            {"matcher": "Bash", "hooks": [{"type": "command", "command": f"bash {q('git-guard.sh')}",
                                            "timeout": 20, "onFailure": "block"}]},
            {"matcher": "Agent|Task", "hooks": [{"type": "command", "command": f"python3 {q('plan-gate.py')}",
                                                  "timeout": 30}]},
        ],
        "PostToolUse": [
            {"matcher": "Edit|Write|MultiEdit", "hooks": [{"type": "command",
                                                           "command": f"bash {q('lint-on-edit.sh')}", "timeout": 40}]},
            {"matcher": "Bash", "hooks": [{"type": "command", "command": f"python3 {q('state-reminder.py')}",
                                           "timeout": 10}]},
        ],
        "SessionStart": [
            {"matcher": "startup|clear", "hooks": [{"type": "command", "command": f"bash {q('guards-selfcheck.sh')}",
                                                     "timeout": 60}]},
        ],
    }
    if scope == "user":
        router = {"type": "command", "command": f"python3 {q('tree-hooks.py')}", "timeout": 120}
        for ev in ("PreToolUse", "PostToolUse", "SessionStart", "UserPromptSubmit", "Stop",
                   "SubagentStart", "SubagentStop", "Notification"):
            h.setdefault(ev, []).append({"hooks": [dict(router)]})
    return h


def is_kit(entry: dict) -> bool:
    return any(MARK in (x.get("command") or "") for x in entry.get("hooks", []))


def load(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(path: str, data: dict) -> None:
    if os.path.exists(path):
        shutil.copy2(path, f"{path}.bak-kit-{time.strftime('%Y%m%d-%H%M%S')}")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    json.load(open(tmp, encoding="utf-8"))
    os.replace(tmp, path)


def remove_kit(data: dict) -> dict:
    hooks = data.get("hooks") or {}
    for ev in list(hooks):
        hooks[ev] = [e for e in hooks[ev] if not is_kit(e)]
        if not hooks[ev]:
            del hooks[ev]
    if "hooks" in data and not hooks:
        del data["hooks"]
    # права (deny/ask) не убираем: такие же могли стоять у пользователя и до kit
    return data


def main(argv: list) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    cmd, path = argv[1], argv[2]
    try:
        data = load(path)
    except ValueError as e:
        print(f"✗ {path}: невалидный JSON ({e}) — ничего не меняю")
        return 1
    if cmd == "show":
        for ev, entries in (data.get("hooks") or {}).items():
            for e in entries:
                if is_kit(e):
                    print(ev, e.get("matcher", ""), [x["command"] for x in e["hooks"]])
        return 0
    if cmd == "remove":
        save(path, remove_kit(data))
        print(f"✓ kit убран из {path}")
        return 0
    if cmd == "add":
        hdir = argv[3]
        scope = argv[argv.index("--scope") + 1] if "--scope" in argv else "project"
        data = remove_kit(data)  # переустановка = замена своих записей
        hooks = data.setdefault("hooks", {})
        for ev, entries in hooks_for(hdir, scope).items():
            hooks.setdefault(ev, []).extend(entries)
        perms = data.setdefault("permissions", {})
        for key, vals in (("deny", PERM_DENY), ("ask", PERM_ASK)):
            cur = perms.setdefault(key, [])
            cur.extend(v for v in vals if v not in cur)
        save(path, data)
        print(f"✓ хуки kit записаны в {path}")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
