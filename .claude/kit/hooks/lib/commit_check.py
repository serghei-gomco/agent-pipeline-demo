#!/usr/bin/env python3
"""commit_check.py — сторож коммита без «да» (agent-kit).

Коммит по шагам плана идёт без подтверждения человека, поэтому безопасен только с механической
проверкой. Любой промах (F) → код 2 и список причин; коммита нет. Предупреждения (W) — в stdout, код 0.

  commit_check.py <repo> [--msg TEXT | --msg-file PATH] [--amend]

Проверки (всё настраивается в .agent-kit.yml):
  F1 ветка не из git.protected_branches; если задан git.branch_pattern — ветка ему соответствует
  F2 upstream пуст или <remote>/<своя ветка>; upstream на защищённую ветку — стоп
  F3 индекс не пуст (кроме --amend); нет файлов, изменённых после `git add` (AM/MM/RM)
  F4 в индексе нет путей из git.forbidden_paths и файлов больше git.max_file_mb
  F5 в добавленных строках нет приватных ключей и ключей облаков (W — подозрительные присваивания)
  F6 сообщение: git.commit_pattern по первой строке; ключ задачи при git.require_task_key;
     без AI-трейлеров при git.forbid_ai_trailers; W — заголовок > 72 символов
"""
from __future__ import annotations

import fnmatch
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "scripts"))
import kit_config  # noqa: E402

AI_TRAILERS = re.compile(r"(?im)^(co-authored-by:.*(claude|anthropic|copilot|gpt|openai|noreply@anthropic)"
                         r"|.*generated with \[?claude|.*🤖 generated)")
SECRET_HARD = [
    (re.compile(r"-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----"), "приватный ключ"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "ключ AWS"),
    (re.compile(r"ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,}"), "токен GitHub"),
    (re.compile(r"glpat-[A-Za-z0-9_-]{20,}"), "токен GitLab"),
    (re.compile(r"sk-(ant-)?[A-Za-z0-9_-]{32,}"), "API-ключ"),
    (re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"), "токен Slack"),
]
SECRET_SOFT = re.compile(r"(?i)(password|passwd|secret|token|api_key|apikey)\s*[:=]\s*['\"][^'\"]{12,}['\"]")


def git(repo: str, *args: str) -> str:
    r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def main(argv: list) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    repo = argv[1]
    msg = None
    amend = "--amend" in argv
    if "--msg" in argv:
        msg = argv[argv.index("--msg") + 1]
    if "--msg-file" in argv:
        p = argv[argv.index("--msg-file") + 1]
        try:
            msg = open(p, encoding="utf-8").read()
        except OSError:
            msg = None
    _, cfg = kit_config.load(repo)
    g = lambda k, d=None: kit_config.get(cfg, k, d)  # noqa: E731
    fails, warns = [], []
    protected = set(g("git.protected_branches") or [])
    remote = g("git.remote") or "origin"

    # F1
    branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD")
    if branch in protected:
        fails.append(f"F1 ветка '{branch}' защищённая (git.protected_branches) — коммит только в ветке задачи.")
    elif branch == "HEAD":
        fails.append("F1 detached HEAD — создай ветку задачи.")
    pat = g("git.branch_pattern")
    if pat and branch not in protected and branch != "HEAD" and not re.search(pat, branch):
        fails.append(f"F1 ветка '{branch}' не подходит под git.branch_pattern `{pat}`.")

    # F2
    up = git(repo, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    if up:
        up_branch = up.split("/", 1)[1] if "/" in up else up
        if up_branch in protected:
            fails.append(f"F2 upstream ветки — '{up}' (защищённая): bare push уедет в базу. "
                         f"`git branch --unset-upstream`, потом `git push -u {remote} {branch}`.")
        elif up_branch != branch:
            warns.append(f"W upstream '{up}' не совпадает с веткой '{branch}'.")

    # F3
    staged = [l for l in git(repo, "diff", "--cached", "--name-only").splitlines() if l]
    if not staged and not amend:
        fails.append("F3 индекс пуст — сначала `git add <явные пути>`.")
    status = subprocess.run(["git", "-C", repo, "status", "--porcelain"], capture_output=True, text=True).stdout
    dirty_after_add = [l[3:] for l in status.splitlines() if len(l) > 2 and l[0] in "AMR" and l[1] == "M"]
    if dirty_after_add:
        fails.append("F3 файлы изменены после `git add` (в коммит уйдёт старая версия): "
                     + ", ".join(dirty_after_add[:10]) + " — перестейджи их.")

    # F4
    forb = g("git.forbidden_paths") or []
    max_mb = float(g("git.max_file_mb") or 0)
    for f in staged:
        base = os.path.basename(f)
        for p in forb:
            if p.endswith("/"):
                hit = f.startswith(p) or ("/" + p) in ("/" + f)
            else:
                hit = fnmatch.fnmatch(f, p) or fnmatch.fnmatch(base, p)
            if hit:
                fails.append(f"F4 '{f}' в запрещённых путях (git.forbidden_paths: {p}).")
                break
        if max_mb:
            size = git(repo, "cat-file", "-s", f":{f}")
            if size.isdigit() and int(size) > max_mb * 1024 * 1024:
                fails.append(f"F4 '{f}' больше {max_mb:g} МБ — бинарники не коммитим.")

    # F5
    diff = subprocess.run(["git", "-C", repo, "diff", "--cached", "-U0", "--no-color"],
                          capture_output=True, text=True).stdout
    for line in diff.splitlines():
        if not line.startswith("+") or line.startswith("+++"):
            continue
        for rx, name in SECRET_HARD:
            if rx.search(line):
                fails.append(f"F5 в добавленных строках {name} — убери секрет из коммита.")
                break
        else:
            if SECRET_SOFT.search(line):
                warns.append(f"W похоже на секрет в коде: {line[:100]}")

    # F6
    if msg is not None:
        head = msg.strip().splitlines()[0] if msg.strip() else ""
        if not head:
            fails.append("F6 пустое сообщение коммита.")
        cp = g("git.commit_pattern")
        if cp and head and not re.search(cp, head):
            fails.append(f"F6 заголовок «{head}» не подходит под git.commit_pattern `{cp}`.")
        if g("git.require_task_key"):
            kp = g("tracker.key_pattern") or ""
            if kp and not re.search(kp, msg):
                fails.append(f"F6 в сообщении нет ключа задачи (tracker.key_pattern `{kp}`).")
        if g("git.forbid_ai_trailers", True) and AI_TRAILERS.search(msg):
            fails.append("F6 AI-трейлер в сообщении (Co-Authored-By / Generated with) — git.forbid_ai_trailers.")
        if len(head) > 72:
            warns.append(f"W заголовок {len(head)} символов (> 72).")

    for w in warns:
        print(w)
    if fails:
        print("commit-check: коммит не пропущен:\n" + "\n".join("  " + f for f in dict.fromkeys(fails)))
        return 2
    print(f"commit-check: ok ({len(staged)} файлов в индексе)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
