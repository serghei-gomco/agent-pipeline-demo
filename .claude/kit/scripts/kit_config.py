#!/usr/bin/env python3
"""kit_config.py — чтение `.agent-kit.yml` без внешних зависимостей.

CLI:
  kit_config.py root [dir]            # корень проекта (папка с .agent-kit.yml) или код 1
  kit_config.py get <key.path> [dir]  # значение; список — по строке на элемент; словарь — JSON
  kit_config.py json [dir]            # весь конфиг с дефолтами, JSON
  kit_config.py check [dir]           # проверка конфига: ошибки → код 1

Поддерживаемый YAML: словари отступами, списки `- x` и `[a, b]`, скаляры (строки в ' или ",
числа, true/false/null), комментарии `#`. Если установлен PyYAML — используется он.
"""
from __future__ import annotations

import json
import os
import re
import sys
from typing import Any, List, Optional, Tuple

CONFIG_NAME = ".agent-kit.yml"

DEFAULTS: dict = {
    "project": {"name": "", "language": "other", "description": "", "docs": []},
    "commands": {"install": "", "test": "", "test_one": "", "lint": "", "typecheck": "",
                 "build": "", "run": "", "smoke_url": ""},
    "git": {"base_branch": "main", "remote": "origin",
            "protected_branches": ["main", "master", "prod", "production", "release"],
            "branch_pattern": "", "commit_pattern": "", "require_task_key": False,
            "forbid_ai_trailers": True,
            "forbidden_paths": [".env", ".env.*", ".tasks/", "*.log", "node_modules/", ".DS_Store"],
            "max_file_mb": 1, "worktrees": True, "worktree_dir": "../{repo}-{key}", "host": "none"},
    "tracker": {"kind": "none", "key_pattern": "[A-Z][A-Z0-9]+-[0-9]+", "write_requires_yes": True, "file": ""},
    "tasks": {"dir": ".tasks", "state_file": "STATE.md"},
    "pipeline": {"qa_plan_risk": ["high"], "acceptance_risk": ["medium", "high"],
                 "test_plan_review_risk": ["medium", "high"],
                 "mr_self_review_risk": ["high"], "auto_chain": True,
                 "commit_mode": "per-step", "max_review_passes": 3},
    "qa": {"axes": [], "main_axis": "", "surface": [], "browsers": ["chrome"]},
    "danger": [],
    "language": "ru",
}


# ---------- мини-YAML ----------

def _strip_comment(line: str) -> str:
    out, q = [], None
    for i, ch in enumerate(line):
        if q:
            out.append(ch)
            if ch == q:
                q = None
            continue
        if ch in "'\"":
            q = ch
        elif ch == "#" and (i == 0 or line[i - 1].isspace()):
            break
        out.append(ch)
    return "".join(out).rstrip()


def _scalar(s: str) -> Any:
    s = s.strip()
    if s == "":
        return ""
    if s[0] == s[-1] and s[0] in "'\"" and len(s) >= 2:
        body = s[1:-1]
        return body.replace("''", "'") if s[0] == "'" else body.replace('\\"', '"')
    if s.startswith("[") and s.endswith("]"):
        inner = s[1:-1].strip()
        return [_scalar(x) for x in _split_flow(inner)] if inner else []
    if s.startswith("{") and s.endswith("}"):
        inner = s[1:-1].strip()
        d = {}
        for part in _split_flow(inner):
            k, _, v = part.partition(":")
            d[k.strip()] = _scalar(v)
        return d
    low = s.lower()
    if low in ("true", "yes", "on"):
        return True
    if low in ("false", "no", "off"):
        return False
    if low in ("null", "~"):
        return None
    if re.fullmatch(r"-?\d+", s):
        return int(s)
    if re.fullmatch(r"-?\d+\.\d+", s):
        return float(s)
    return s


def _split_flow(s: str) -> List[str]:
    parts, buf, depth, q = [], [], 0, None
    for ch in s:
        if q:
            buf.append(ch)
            if ch == q:
                q = None
            continue
        if ch in "'\"":
            q = ch
        elif ch in "[{":
            depth += 1
        elif ch in "]}":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append("".join(buf).strip())
            buf = []
            continue
        buf.append(ch)
    if "".join(buf).strip():
        parts.append("".join(buf).strip())
    return parts


def parse_yaml(text: str) -> Any:
    lines: List[Tuple[int, str]] = []
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        s = _strip_comment(raw.replace("\t", "  "))
        if s.strip():
            lines.append((len(s) - len(s.lstrip()), s.strip()))
    val, _ = _block(lines, 0, lines[0][0] if lines else 0)
    return val if val is not None else {}


def _block(lines, i, indent):
    if i >= len(lines):
        return None, i
    if lines[i][1].startswith("- ") or lines[i][1] == "-":
        out = []
        while i < len(lines) and lines[i][0] == indent and (lines[i][1].startswith("- ") or lines[i][1] == "-"):
            item = lines[i][1][1:].strip()
            i += 1
            if item == "":
                v, i = _block(lines, i, lines[i][0]) if i < len(lines) and lines[i][0] > indent else (None, i)
                out.append(v)
            elif re.match(r"^[^'\"\[{][^:]*:(\s|$)", item):
                # элемент-словарь: "- key: v" + продолжение с большим отступом
                sub = [(indent + 2, item)]
                while i < len(lines) and lines[i][0] > indent:
                    sub.append(lines[i])
                    i += 1
                v, _ = _block(sub, 0, indent + 2)
                out.append(v)
            else:
                out.append(_scalar(item))
        return out, i
    out = {}
    while i < len(lines) and lines[i][0] == indent:
        m = re.match(r"^((?:'[^']*'|\"[^\"]*\"|[^:])+?):(?:\s+(.*))?$", lines[i][1])
        if not m:
            raise ValueError(f"не разобрал строку YAML: {lines[i][1]!r}")
        key = _scalar(m.group(1))
        rest = (m.group(2) or "").strip()
        i += 1
        if rest:
            out[key] = _scalar(rest)
        elif i < len(lines) and lines[i][0] > indent:
            out[key], i = _block(lines, i, lines[i][0])
        elif i < len(lines) and lines[i][0] == indent and lines[i][1].startswith("- "):
            out[key], i = _block(lines, i, indent)
        else:
            out[key] = None
    return out, i


# ---------- загрузка ----------

def find_root(start: Optional[str] = None) -> Optional[str]:
    d = os.path.abspath(start or os.getcwd())
    if os.path.isfile(d):
        d = os.path.dirname(d)
    while True:
        if os.path.isfile(os.path.join(d, CONFIG_NAME)):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def _merge(base: Any, over: Any) -> Any:
    if isinstance(base, dict) and isinstance(over, dict):
        out = dict(base)
        for k, v in over.items():
            out[k] = _merge(base.get(k), v) if k in base else v
        return out
    return base if over is None else over


def load(start: Optional[str] = None) -> Tuple[Optional[str], dict]:
    root = find_root(start)
    if not root:
        return None, json.loads(json.dumps(DEFAULTS))
    with open(os.path.join(root, CONFIG_NAME), encoding="utf-8") as f:
        text = f.read()
    try:
        import yaml  # type: ignore
        data = yaml.safe_load(text) or {}
    except ImportError:
        data = parse_yaml(text)
    return root, _merge(json.loads(json.dumps(DEFAULTS)), data)


def get(cfg: dict, path: str, default: Any = None) -> Any:
    cur: Any = cfg
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur


def check(cfg: dict) -> List[str]:
    errs = []
    for key in ("git.branch_pattern", "git.commit_pattern", "tracker.key_pattern"):
        v = get(cfg, key)
        if v:
            try:
                re.compile(v)
            except re.error as e:
                errs.append(f"{key}: неверное регулярное выражение ({e})")
    for key in ("git.protected_branches", "git.forbidden_paths", "qa.axes",
                "pipeline.qa_plan_risk", "pipeline.acceptance_risk"):
        if not isinstance(get(cfg, key), list):
            errs.append(f"{key}: ожидается список")
    for key in ("pipeline.qa_plan_risk", "pipeline.acceptance_risk", "pipeline.test_plan_review_risk"):
        for r in get(cfg, key) or []:
            if r not in ("low", "medium", "high"):
                errs.append(f"{key}: неизвестный риск {r!r}")
    if get(cfg, "pipeline.commit_mode") not in ("per-step", "off"):
        errs.append("pipeline.commit_mode: per-step | off")
    if get(cfg, "git.base_branch") in (None, ""):
        errs.append("git.base_branch: пусто")
    return errs


def main(argv: List[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd = argv[1]
    if cmd == "root":
        r = find_root(argv[2] if len(argv) > 2 else None)
        if not r:
            return 1
        print(r)
        return 0
    start = None
    if cmd == "get":
        if len(argv) < 3:
            return 2
        start = argv[3] if len(argv) > 3 else None
    elif len(argv) > 2:
        start = argv[2]
    root, cfg = load(start)
    if cmd == "json":
        print(json.dumps(cfg, ensure_ascii=False, indent=2))
        return 0 if root else 1
    if cmd == "check":
        if not root:
            print(f"{CONFIG_NAME} не найден")
            return 1
        errs = check(cfg)
        for e in errs:
            print("✗", e)
        if not errs:
            print(f"✓ {os.path.join(root, CONFIG_NAME)}")
        return 1 if errs else 0
    if cmd == "get":
        v = get(cfg, argv[2])
        if v is None:
            return 1
        if isinstance(v, list):
            print("\n".join(str(x) for x in v))
        elif isinstance(v, dict):
            print(json.dumps(v, ensure_ascii=False))
        elif isinstance(v, bool):
            print("true" if v else "false")
        else:
            print(v)
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
