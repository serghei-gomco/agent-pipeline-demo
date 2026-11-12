#!/usr/bin/env python3
"""plan-gate.py — PreToolUse(Agent): исполнитель не стартует, пока план не прошёл гейт.

Срабатывает на subagent_type=kit-implementer или промт со ссылкой на kit-implementer.md.
Папка задачи — строка `TASK_DIR: <путь>` в промте, иначе папка в tasks.dir по ключу задачи из промта.
Гейт — scripts/check_gates.py --stage plan. ✗ → deny с перечнем. Снять на вызов — строка
`PLAN_GATE: off (<причина>)` в промте (только по слову человека). Не проект kit → no-op.
Сбой самого гейта → deny (fail-closed): лучше спросить, чем пустить код без плана.
"""
import glob
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(KIT, "scripts"))
import kit_config  # noqa: E402


def out(decision, reason):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                             "permissionDecision": decision,
                                             "permissionDecisionReason": reason}}, ensure_ascii=False))
    sys.exit(0)


def main():
    if os.environ.get("KIT_HOOKS") == "off":
        return
    try:
        data = json.load(sys.stdin)
    except Exception:
        return
    if data.get("tool_name") not in ("Agent", "Task"):
        return
    ti = data.get("tool_input") or {}
    prompt = ti.get("prompt") or ""
    if ti.get("subagent_type") != "kit-implementer" and "kit-implementer.md" not in prompt:
        return
    cwd = data.get("cwd") or os.getcwd()
    root, cfg = kit_config.load(cwd)
    if not root:
        return
    if re.search(r"(?m)^\s*PLAN_GATE:\s*off\s*\(.+\)", prompt):
        return
    m = re.search(r"(?m)^\s*TASK_DIR:\s*(\S+)", prompt)
    task_dir = None
    if m:
        task_dir = m.group(1) if os.path.isabs(m.group(1)) else os.path.join(cwd, m.group(1))
    else:
        tdir = os.path.join(root, kit_config.get(cfg, "tasks.dir") or ".tasks")
        keys = re.findall(kit_config.get(cfg, "tracker.key_pattern") or r"[A-Z]+-\d+", prompt)
        keys += re.findall(r"T-\d{8}-\d+", prompt)
        for k in keys:
            hits = [p for p in glob.glob(os.path.join(tdir, k + "*")) if os.path.isdir(p)]
            if hits:
                task_dir = sorted(hits)[0]
                break
    if not task_dir or not os.path.isdir(task_dir):
        out("deny", "kit plan-gate: не нашёл папку задачи — добавь в промт исполнителя строку "
                    "`TASK_DIR: <путь>` (или ключ задачи, папка которой лежит в tasks.dir).")
    try:
        r = subprocess.run([sys.executable, "-I", os.path.join(KIT, "scripts", "check_gates.py"),
                            "--stage", "plan", task_dir], capture_output=True, text=True, timeout=20)
    except Exception as e:
        out("deny", f"kit plan-gate: гейт не запустился ({e}).")
    if r.returncode == 0:
        return
    if r.returncode == 1:
        bad = "\n".join(l for l in r.stdout.splitlines() if l.startswith("✗"))
        out("deny", "kit plan-gate: план не готов к реализации —\n" + bad +
            "\nПочини план (kit-planner) и снова покажи человеку блок «Для человека».")
    out("deny", "kit plan-gate: ошибка гейта — " + (r.stderr or r.stdout)[-300:])


if __name__ == "__main__":
    main()
