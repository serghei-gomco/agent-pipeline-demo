#!/usr/bin/env python3
"""state-reminder.py — PostToolUse(Bash): после коммита, пуша или PR/MR напомнить обновить STATE.md задачи.
Напоминание, не гейт: любой сбой — молча выходим. Не проект kit → no-op."""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "scripts"))

GATE = re.compile(r"\bgit\b[^;&|]*\b(commit|push)\b|\bgh\s+pr\s+(create|merge)\b|\bglab\s+mr\s+(create|merge)\b")


def main():
    if os.environ.get("KIT_HOOKS") == "off":
        return
    try:
        import kit_config
        data = json.load(sys.stdin)
        cmd = (data.get("tool_input") or {}).get("command") or ""
        if not GATE.search(cmd):
            return
        root, cfg = kit_config.load(data.get("cwd") or os.getcwd())
        if not root:
            return
        state = kit_config.get(cfg, "tasks.state_file") or "STATE.md"
        msg = (f"agent-kit: прошёл шаг сдачи (`{GATE.search(cmd).group(0)[:40]}`). Обнови {state} "
               "в папке задачи: что сделано, следующий шаг, строки «открыто: …».")
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": msg}},
                         ensure_ascii=False))
    except Exception:
        return


if __name__ == "__main__":
    main()
