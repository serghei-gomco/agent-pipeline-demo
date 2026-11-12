#!/usr/bin/env python3
"""tree-hooks.py — хуки «для дерева папок»: `<предок>/.claude/tree-hooks.json` действует на любую
сессию, чей cwd лежит внутри этого предка (воркtree, вложенные репо, подпапки).

Зачем. Claude Code читает проектный `.claude/settings.json` только из папки запуска. Воркtree задачи
(`../repo-123`) и соседние репо внутри одного рабочего пространства его не видят, а командные репо
трогать нельзя. Этот роутер регистрируется один раз (глобально) и подхватывает хуки рабочего
пространства по дереву.

Формат файла — как раздел `hooks` в settings.json:
  {"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "...",
                                                            "timeout": 10, "onFailure": "block"}]}]}}
Регистрация (на каждое нужное событие, без matcher):
  {"type": "command", "command": "python3 <kit>/hooks/tree-hooks.py", "timeout": 120}

Семантика (как у Claude Code):
- matcher — регулярное выражение на имя инструмента (для SessionStart — на source); пусто/`*` — всё;
- код 2 → блок (stderr — причина); JSON с permissionDecision deny → отказ сразу; ask — копится;
- updatedInput передаётся следующим хукам; additionalContext и systemMessage — склеиваются;
- сбой или таймаут хука с `onFailure: block` → отказ с причиной; без него — пропуск;
- `async: true` — запуск в фоне без ожидания.
Файлы обходятся от ближнего предка к дальнему. Сбой самого роутера → молча 0 (не ломать все сессии).
`TREE_HOOKS=off` — выключить роутер.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from typing import List, Optional

NAME = os.path.join(".claude", "tree-hooks.json")
TOOL_EVENTS = {"PreToolUse", "PostToolUse", "PermissionRequest", "PostToolUseFailure"}
CTX_EVENTS = {"PreToolUse", "PostToolUse", "SessionStart", "UserPromptSubmit", "SubagentStart"}


def find_files(cwd: str) -> List[str]:
    out, d = [], os.path.abspath(cwd)
    while True:
        p = os.path.join(d, NAME)
        if os.path.isfile(p):
            out.append(p)
        parent = os.path.dirname(d)
        if parent == d:
            return out
        d = parent


def matches(matcher: Optional[str], value: str) -> bool:
    if not matcher or matcher == "*":
        return True
    try:
        return re.fullmatch(matcher, value or "") is not None
    except re.error:
        return matcher == value


def main() -> int:
    if os.environ.get("TREE_HOOKS") == "off":
        return 0
    raw = sys.stdin.read()
    data = json.loads(raw)
    event = data.get("hook_event_name", "")
    cwd = data.get("cwd") or os.getcwd()
    files = find_files(cwd)
    if not files:
        return 0
    value = data.get("tool_name", "") if event in TOOL_EVENTS else data.get("source", "")
    ctx: List[str] = []
    sysmsg: List[str] = []
    asks: List[str] = []
    updated = None
    for f in files:
        try:
            cfg = json.load(open(f, encoding="utf-8"))
        except Exception as e:
            sysmsg.append(f"tree-hooks: {f} не читается ({e})")
            continue
        for group in (cfg.get("hooks") or {}).get(event, []) or []:
            if not matches(group.get("matcher"), value):
                continue
            for h in group.get("hooks", []):
                if h.get("type", "command") != "command" or not h.get("command"):
                    continue
                payload = json.dumps(data, ensure_ascii=False)
                env = dict(os.environ, TREE_HOOKS_FILE=f, TREE_HOOKS_ROOT=os.path.dirname(os.path.dirname(f)))
                if h.get("async"):
                    try:
                        p = subprocess.Popen(["/bin/bash", "-c", h["command"]], stdin=subprocess.PIPE,
                                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                             cwd=cwd if os.path.isdir(cwd) else None, env=env,
                                             start_new_session=True)
                        p.stdin.write(payload.encode())
                        p.stdin.close()
                    except Exception:
                        pass
                    continue
                block = h.get("onFailure") == "block"
                try:
                    r = subprocess.run(["/bin/bash", "-c", h["command"]], input=payload, text=True,
                                       capture_output=True, timeout=float(h.get("timeout", 60)),
                                       cwd=cwd if os.path.isdir(cwd) else None, env=env)
                    rc, so, se = r.returncode, r.stdout.strip(), r.stderr.strip()
                except subprocess.TimeoutExpired:
                    rc, so, se = -1, "", f"таймаут {h.get('timeout', 60)} с"
                except Exception as e:
                    rc, so, se = -1, "", str(e)
                if rc == 2:
                    sys.stderr.write(se or f"tree-hooks: заблокировано ({h['command'][:80]})")
                    return 2
                if rc != 0:
                    if block:
                        reason = f"tree-hooks: сторож упал (код {rc}): {h['command'][:100]} — {se[-200:]}"
                        if event == "PreToolUse":
                            return deny(reason)
                        sys.stderr.write(reason)
                        return 2
                    continue
                if not so:
                    continue
                try:
                    j = json.loads(so)
                except ValueError:
                    if event in ("SessionStart", "UserPromptSubmit"):
                        ctx.append(so)
                    continue
                if not isinstance(j, dict):
                    continue
                if j.get("decision") == "block" or j.get("continue") is False:
                    print(so)
                    return 0
                hso = j.get("hookSpecificOutput") or {}
                dec = hso.get("permissionDecision")
                if dec == "deny":
                    print(json.dumps({"hookSpecificOutput": {"hookEventName": event, "permissionDecision": "deny",
                                      "permissionDecisionReason": hso.get("permissionDecisionReason", "")}},
                                     ensure_ascii=False))
                    return 0
                if dec == "ask":
                    asks.append(hso.get("permissionDecisionReason", ""))
                if hso.get("updatedInput"):
                    updated = hso["updatedInput"]
                    data["tool_input"] = updated
                if hso.get("additionalContext"):
                    ctx.append(hso["additionalContext"])
                if j.get("systemMessage"):
                    sysmsg.append(j["systemMessage"])
    out: dict = {}
    hso = {}
    if event == "PreToolUse" and asks:
        hso.update(permissionDecision="ask", permissionDecisionReason=" | ".join(a for a in asks if a))
    elif event == "PreToolUse" and updated is not None:
        hso.update(permissionDecision="allow")
    if updated is not None and event == "PreToolUse":
        hso["updatedInput"] = updated
    if ctx and event in CTX_EVENTS:
        hso["additionalContext"] = "\n\n".join(ctx)
    if hso:
        hso["hookEventName"] = event
        out["hookSpecificOutput"] = hso
    if sysmsg:
        out["systemMessage"] = " ".join(sysmsg)
    if out:
        print(json.dumps(out, ensure_ascii=False))
    return 0


def deny(reason: str) -> int:
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                             "permissionDecisionReason": reason}}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
