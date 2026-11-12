#!/usr/bin/env python3
"""state.py — состояние задачи с диска и из git, а не по памяти (agent-kit).

  state.py <KEY | путь к папке задачи> [...]

Показывает: круг, пройденные шаги конвейера, последний вердикт ревью и принят ли он, приёмку,
воркtree/ветку задачи (upstream, коммиты, застейдженное), объявленный в STATE.md следующий шаг
и выведенный следующий шаг. Только читает.
Ограничение: порядок событий восстанавливается по наличию файлов, время файла ≠ время события.
"""
from __future__ import annotations

import glob
import os
import re
import subprocess
import sys
from datetime import datetime
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_config  # noqa: E402
from check_gates import latest  # noqa: E402

STEPS = [("TASK_CARD", "интейк"), ("PLAN", "план"), ("QA_PLAN", "план проверки"), ("CHANGES", "реализация"),
         ("REVIEW", "ревью"), ("QA_REPORT", "QA-отчёт"), ("ACCEPTANCE", "приёмка")]
ACCEPTED = ("APPROVED", "PASS", "OK")


def sh(cwd: str, *args: str) -> str:
    r = subprocess.run(list(args), cwd=cwd, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def find_dir(arg: str, root: str, cfg: dict) -> Optional[str]:
    if os.path.isdir(arg):
        return os.path.abspath(arg)
    tdir = os.path.join(root, kit_config.get(cfg, "tasks.dir") or ".tasks")
    hits = sorted(p for p in glob.glob(os.path.join(tdir, arg + "*")) if os.path.isdir(p))
    return hits[0] if hits else None


def marker(path: str, name: str) -> Optional[str]:
    vals = re.findall(rf"(?m)^\**{name}:\**\s*\**([^\n*]+)", open(path, encoding="utf-8").read())
    return vals[-1].strip() if vals else None


def worktree_for(root: str, key: str) -> Optional[tuple]:
    out = sh(root, "git", "worktree", "list", "--porcelain")
    path = None
    for line in out.splitlines():
        if line.startswith("worktree "):
            path = line[9:]
        elif line.startswith("branch ") and key.lower() in line.lower():
            return path, line.split("refs/heads/", 1)[-1]
    br = [b.strip("* ").strip() for b in sh(root, "git", "branch", "--list", f"*{key}*").splitlines()]
    return (root, br[0]) if br else None


def show(arg: str) -> None:
    root, cfg = kit_config.load(os.getcwd())
    if not root:
        print("нет .agent-kit.yml выше текущей папки")
        return
    d = find_dir(arg, root, cfg)
    if not d:
        print(f"{arg}: папка задачи не найдена в {kit_config.get(cfg, 'tasks.dir')}")
        return
    key = os.path.basename(d).split("-")[0] if not os.path.basename(d).startswith("T-") \
        else "-".join(os.path.basename(d).split("-")[:3])
    m = re.match(kit_config.get(cfg, "tracker.key_pattern") or r"[A-Z]+-\d+", os.path.basename(d))
    if m:
        key = m.group(0)
    rnd = max([latest(d, s)[1] for s, _ in STEPS] + [1])
    print(f"== {key} — {os.path.relpath(d, root)}  (круг {rnd})")
    done, nxt = [], None
    for stem, label in STEPS:
        p, r = latest(d, stem)
        if p and r == rnd:
            ts = datetime.fromtimestamp(os.path.getmtime(p)).strftime("%m-%d %H:%M")
            done.append(f"{label} ({os.path.basename(p)}, {ts})")
    print("шаги:", "; ".join(done) if done else "ничего")
    rev, rr = latest(d, "REVIEW")
    verdict = marker(rev, "VERDICT") if rev and rr == rnd else None
    if rev and rr == rnd:
        ok = bool(verdict) and verdict.split()[0].upper() in ACCEPTED
        print(f"вердикт ревью: {verdict or 'нет строки VERDICT — считается не принятым'} → {'принят' if ok else 'НЕ принят'}")
        if not ok:
            nxt = "доработка по REVIEW.md → повторное ревью"
    acc, ar = latest(d, "ACCEPTANCE")
    if acc and ar == rnd:
        last = [l for l in open(acc, encoding="utf-8").read().splitlines() if l.strip()][-1:]
        print("приёмка:", last[0] if last else "пусто")
        if last and not last[0].startswith("ACCEPTANCE: PASS") and not nxt:
            nxt = "баги приёмки → исполнитель → повторная приёмка по кейсам"
    qa, qr = latest(d, "QA_REPORT")
    if qa and qr == rnd:
        print("QA:", ", ".join(f"{k}: {marker(qa, k)}" for k in ("ACCEPTANCE_RUN", "TEST_PLAN_REVIEW", "GATES_AFTER_QA")
                               if marker(qa, k)))
    wt = worktree_for(root, key)
    git_next = None
    if wt:
        path, branch = wt
        up = sh(path, "git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
        base = f"{kit_config.get(cfg, 'git.remote')}/{kit_config.get(cfg, 'git.base_branch')}"
        ahead = sh(path, "git", "rev-list", "--count", f"{base}..HEAD") or "?"
        staged = len([x for x in sh(path, "git", "diff", "--cached", "--name-only").splitlines() if x])
        warn = " ⚠ upstream на защищённую ветку" if up and up.split("/", 1)[-1] in \
            (kit_config.get(cfg, "git.protected_branches") or []) else ""
        print(f"ветка: {branch} @ {path}; upstream: {up or 'нет'}{warn}; коммитов от {base}: {ahead}; в индексе: {staged}")
        if staged:
            git_next = "коммит застейдженного (через сторож)"
        elif not up and ahead not in ("0", "?"):
            git_next = "ревью диффа → пуш («да» на код, /kit-deliver)"
        elif up:
            git_next = "PR/MR и трекер (/kit-deliver)"
    else:
        print("ветка: не найдена (по ключу в имени ветки)")
    st = os.path.join(d, kit_config.get(cfg, "tasks.state_file") or "STATE.md")
    declared = None
    if os.path.exists(st):
        mm = re.search(r"(?mi)^следующий шаг:\s*(.+)$", open(st, encoding="utf-8").read())
        declared = mm.group(1).strip() if mm else None
    if not nxt:
        names = [s for s, _ in STEPS if latest(d, s)[0] and latest(d, s)[1] == rnd]
        order = ["TASK_CARD", "PLAN", "CHANGES", "REVIEW", "QA_REPORT"]
        missing = [s for s in order if s not in names]
        labels = dict(STEPS)
        if missing:
            nxt = {"TASK_CARD": "kit-intake", "PLAN": "kit-planner → гейт плана (человек)",
                   "CHANGES": "kit-implementer (после «да» на план)", "REVIEW": "kit-reviewer",
                   "QA_REPORT": "kit-qa-report"}[missing[0]]
            _ = labels
        else:
            nxt = git_next or "сдача (/kit-deliver)"
    print(f"следующий шаг (выведено): {nxt}")
    if declared:
        print(f"STATE.md говорит: {declared}" + ("" if declared.split()[0] in nxt else "  ← расходится, проверь"))


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    for a in sys.argv[1:]:
        show(a)
    return 0


if __name__ == "__main__":
    sys.exit(main())
