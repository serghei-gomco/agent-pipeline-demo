#!/usr/bin/env python3
"""Разбор shell-команды на git-вызовы и политика опасных форм (agent-kit).

Зачем. Регексы по строке пропускают `/usr/bin/git`, `sh -c "git …"`, `eval`, `git --no-pager commit`,
`push HEAD:refs/heads/main`, `push --delete main`, `+HEAD:x`, `-uf`, `git branch x origin/main`.
Здесь команда токенизируется (shlex), каждый git-вызов приводится к виду
`git [-C <repo>] <sub> <args>`, и решение принимается по аргументам.

Защищённые ветки — из переменной KIT_PROTECTED_BRANCHES (через пробел или запятую),
её выставляет git-guard.sh из `.agent-kit.yml → git.protected_branches`.

Вход: команда на stdin; argv: --cwd <dir> (cwd сессии).
Выход (stdout, JSON):
  {"decision": "deny"|"allow", "reason": str,
   "normalized": "git -C … push …; git …"   — для дочерних хуков (их регексы видят канон),
   "target": "<repo первого git-вызова>",
   "commit": null | {"repo": str, "msg": str|null, "msg_file": str|null}}
Не git-команда → {"decision":"allow","normalized":""}. Нечего разобрать (кавычки) и в тексте есть
git с пишущей подкомандой → deny. Сам скрипт сеть не трогает; читает только `git rev-parse`.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys

BASES = set(re.split(r"[\s,]+", os.environ.get("KIT_PROTECTED_BRANCHES", "main master prod production release").strip())) - {""}
WRITE_SUBS = {"push", "commit", "merge", "rebase", "reset", "branch", "checkout", "switch",
              "worktree", "tag", "cherry-pick", "revert", "am", "pull", "add", "rm", "mv",
              "restore", "stash", "clean", "filter-branch", "update-ref", "config", "remote"}
SHELLS = {"sh", "bash", "zsh", "dash", "ksh"}
WRAPPERS = {"command", "builtin", "exec", "nohup", "time", "nice", "caffeinate", "sudo"}
SEP = {";", "&&", "||", "|", "&", "(", ")", "\n", "|&", ";;"}
GIT_RX = re.compile(r"(^|[^A-Za-z0-9_.-])git([\s\"');]|$)")

HEREDOC_SUBST = re.compile(
    r"\$\(\s*cat\s+<<-?\s*(['\"]?)(\w+)\1[ \t]*\n(.*?)\n[ \t]*\2[ \t]*\n?\s*\)", re.S)
HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1")
STDIN_MARK = "\x00STDIN:"  # тело heredoc, поданное на stdin вызова (не аргумент)


class Result:
    def __init__(self) -> None:
        self.reasons: list[str] = []
        self.normalized: list[str] = []
        self.target: str | None = None
        self.commit: dict | None = None
        self.subs: list[str] = []
        self.asks: list[str] = []

    def deny(self, reason: str) -> None:
        if reason not in self.reasons:
            self.reasons.append(reason)

    def ask(self, reason: str) -> None:
        # действие «по отдельному „да“» — не deny, а запрос подтверждения в UI.
        if reason not in self.asks:
            self.asks.append(reason)


def git_out(repo: str, *args: str) -> str | None:
    try:
        p = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, timeout=5)
    except Exception:
        return None
    return p.stdout.strip() if p.returncode == 0 else None


def resolve(path: str, cwd: str) -> str:
    path = os.path.expanduser(path)
    return os.path.normpath(path if os.path.isabs(path) else os.path.join(cwd, path))


# ------------------------------------------------------------------ препроцессинг
def extract_heredocs(cmd: str) -> tuple[str, dict[str, str], list[str]]:
    """`"$(cat <<'EOF' … EOF)"` → плейсхолдер (тело — данные, обычно сообщение коммита).
    Прочие heredoc: тело вырезается; если heredoc кормит shell (`bash <<EOF`) — тело
    возвращается как отдельная команда для анализа."""
    bodies: dict[str, str] = {}

    def sub(m: re.Match) -> str:
        key = f"__HEREDOC_{len(bodies)}__"
        bodies[key] = m.group(3)
        return key

    cmd = HEREDOC_SUBST.sub(sub, cmd)
    extra: list[str] = []
    lines = cmd.split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        m = HEREDOC.search(line)
        if not m:
            i += 1
            continue
        term = m.group(2)
        body: list[str] = []
        i += 1
        while i < len(lines) and lines[i].strip() != term:
            body.append(lines[i])
            i += 1
        i += 1  # строка-терминатор
        first = line.split("<<")[0].strip().split()
        word = os.path.basename(first[-1]) if first else ""
        text = "\n".join(body)
        if word in SHELLS or (first and os.path.basename(first[0]) in SHELLS):
            extra.append(text)
        else:
            key = f"__HEREDOC_{len(bodies)}__"
            bodies[key] = STDIN_MARK + text
            out[-1] = line + " " + key  # `git commit -F - <<EOF` → тело доступно как stdin
    return "\n".join(out), bodies, extra


def substitutions(cmd: str) -> list[str]:
    """Тела `$(…)` и `…` (без вложенности) — тоже исполняемые команды."""
    found = re.findall(r"\$\(([^()]*)\)", cmd) + re.findall(r"`([^`]*)`", cmd)
    return [f for f in found if GIT_RX.search(f)]


def tokenize(cmd: str) -> list[str]:
    lex = shlex.shlex(cmd, posix=True, punctuation_chars=";&|()\n")
    lex.whitespace = " \t\r"
    lex.whitespace_split = True
    lex.commenters = ""
    return list(lex)


def simple_commands(tokens: list[str]) -> list[list[str]]:
    cmds, cur = [], []
    for t in tokens:
        if t in SEP or set(t) <= set(";&|()\n"):
            if cur:
                cmds.append(cur)
            cur = []
        else:
            cur.append(t)
    if cur:
        cmds.append(cur)
    return cmds


# ------------------------------------------------------------------ анализ
def analyze(cmd: str, cwd: str, res: Result, depth: int = 0) -> None:
    if depth > 4:
        res.deny("слишком глубокая вложенность sh -c/eval — запусти git напрямую")
        return
    cmd, bodies, extra = extract_heredocs(cmd)
    for e in extra:
        analyze(e, cwd, res, depth + 1)
    for s in substitutions(cmd):
        analyze(s, cwd, res, depth + 1)
    try:
        tokens = tokenize(cmd)
    except ValueError:
        if GIT_RX.search(cmd) and re.search(r"\b(" + "|".join(sorted(WRITE_SUBS)) + r")\b", cmd):
            res.deny("не удалось разобрать команду (кавычки) — git с пишущей подкомандой запусти "
                     "отдельной простой командой")
        return
    tokens = [restore(t, bodies) for t in tokens]
    cur_cwd = cwd
    for argv in simple_commands(tokens):
        cur_cwd = one(argv, cur_cwd, res, depth)


def restore(tok: str, bodies: dict[str, str]) -> str:
    for k, v in bodies.items():
        tok = tok.replace(k, v)
    return tok


def one(argv: list[str], cwd: str, res: Result, depth: int) -> str:
    """Один простой вызов. Возвращает cwd для следующих (учёт `cd`)."""
    while argv and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", argv[0]):
        argv = argv[1:]
    while argv:
        b = os.path.basename(argv[0])
        if b == "env":
            argv = argv[1:]
            while argv and (argv[0].startswith("-") or "=" in argv[0]):
                argv = argv[1:]
        elif b in WRAPPERS:
            argv = argv[1:]
            while argv and argv[0].startswith("-"):
                argv = argv[1:]
        elif b == "xargs":
            argv = argv[1:]
            while argv and argv[0].startswith("-"):
                argv = argv[2:] if argv[0] in ("-I", "-n", "-L", "-P", "-d") else argv[1:]
        else:
            break
    if not argv:
        return cwd
    b = os.path.basename(argv[0])
    if b == "cd" and len(argv) > 1:
        return resolve(argv[1], cwd)
    if b in SHELLS:
        if "-c" in argv[1:]:
            i = argv.index("-c")
            if i + 1 < len(argv):
                analyze(argv[i + 1], cwd, res, depth + 1)
        return cwd
    if b == "eval":
        analyze(" ".join(argv[1:]), cwd, res, depth + 1)
        return cwd
    if b != "git":
        return cwd
    if argv[1:2] and "commit" not in argv:
        argv = [a for a in argv if not a.startswith(STDIN_MARK)]
    git(argv[1:], cwd, res)
    return cwd


def git(args: list[str], cwd: str, res: Result) -> None:
    repo = cwd
    globals_: list[str] = []
    odd = None
    i = 0
    while i < len(args):
        a = args[i]
        if a == "-C" and i + 1 < len(args):
            repo = resolve(args[i + 1], repo)
            i += 2
        elif a == "-c" and i + 1 < len(args):
            globals_ += ["-c", args[i + 1]]
            i += 2
        elif a in ("--no-pager", "-P", "-p", "--paginate", "--no-replace-objects", "--literal-pathspecs",
                   "--no-optional-locks", "--glob-pathspecs", "--noglob-pathspecs", "--icase-pathspecs"):
            i += 1
        elif a.startswith(("--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix")):
            odd = a.split("=")[0]
            i += 1 if "=" in a else 2
        elif a.startswith("-"):
            i += 1
        else:
            break
    if i >= len(args):
        return
    sub, rest = args[i], args[i + 1:]
    if sub == "commit" and "add" in res.subs:
        res.deny("'git add … && git commit' одной командой: сторож коммита работает до выполнения "
                 "команды и видит ещё пустой индекс. Сначала отдельный вызов 'git add <пути>', "
                 "затем отдельный 'git commit'.")
    res.subs.append(sub)
    if res.target is None:
        res.target = repo
    res.normalized.append(" ".join(shlex.quote(x) for x in ["git", "-C", repo, *globals_, sub, *rest]))
    if odd and sub in WRITE_SUBS:
        res.deny(f"'git {odd} … {sub}' — сторож не видит репо цели; используй 'git -C <путь> {sub}'")
    if sub == "push":
        push(rest, repo, res)
    elif sub == "commit":
        commit(rest, repo, res)
    elif sub == "add":
        if any(a in ("-A", "--all", ".", ":/", "-u", "--update") or re.fullmatch(r"-[a-zA-Z]*[Au][a-zA-Z]*", a)
               for a in rest):
            res.deny("Запрещено 'git add -A/--all/-u/.' — стейдж только явными путями (гейты git).")
    elif sub in ("branch", "checkout", "switch", "worktree"):
        tracking(sub, rest, res)


def short_has(a: str, letter: str) -> bool:
    return bool(re.fullmatch(r"-[A-Za-z]+", a)) and letter in a[1:]


def push(rest: list[str], repo: str, res: Result) -> None:
    pos: list[str] = []
    lease = False
    for a in rest:
        if a.startswith("--force-with-lease") or a == "--force-if-includes":
            lease = True
        elif a in ("--force", "-f") or (short_has(a, "f") and not a.startswith("--")):
            res.deny("Плоский force-push (--force/-f, в т.ч. склеенный '-uf') запрещён. В СВОЮ задачную "
                     "ветку — '--force-with-lease'; в base — никогда.")
        elif a in ("--delete", "-d") or (short_has(a, "d") and not a.startswith("--")):
            res.deny("Удаление удалённой ветки ('push --delete' / '-d') запрещено.")
        elif a in ("--mirror", "--all", "--branches", "--prune"):
            res.deny(f"'git push {a}' трогает все ветки, включая base — запрещено.")
        elif a.startswith("-"):
            continue
        else:
            pos.append(a)
    refspecs = pos[1:]
    branch = git_out(repo, "rev-parse", "--abbrev-ref", "HEAD")
    for r in refspecs:
        if r.startswith("+"):
            res.deny(f"Refspec '{r}' с '+' — это force без lease; запрещено.")
            r = r[1:]
        if r.startswith(":"):
            res.deny(f"'git push … {r}' удаляет удалённую ветку — запрещено.")
            continue
        src, _, dst = r.partition(":")
        dst = dst or src
        if dst == "HEAD" and branch:
            dst = branch
        dst = re.sub(r"^refs/heads/", "", dst)
        if dst in BASES:
            res.deny(f"Push в base-ветку '{dst}' — доставка в обход MR. Пуш только в свою ветку: "
                     "'git push -u origin <branch>'.")
    if not refspecs:
        if branch in BASES:
            res.deny(f"Текущая ветка — '{branch}': bare push уедет в base. Пушь из задачной ветки.")
        up = git_out(repo, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
        if up and up.split("/")[-1] in BASES:
            res.deny(f"Ветка трекает '{up}' — bare push уедет в base. 'git branch --unset-upstream', "
                     "затем 'git push -u origin <branch>'.")


def commit(rest: list[str], repo: str, res: Result) -> None:
    msgs: list[str] = []
    trailers: list[str] = []
    msg_file: str | None = None
    i = 0
    stdin = None
    while i < len(rest):
        a = rest[i]
        nxt = rest[i + 1] if i + 1 < len(rest) else None
        if a.startswith(STDIN_MARK):
            stdin = a[len(STDIN_MARK):]
            i += 1
            continue
        if a == "--":
            if rest[i + 1:]:
                res.deny("'git commit -- <пути>' коммитит рабочее дерево мимо проверок индекса — "
                         "сначала 'git add <пути>', потом 'git commit -m …'.")
            break
        if a.startswith("--"):
            name, eq, val = a.partition("=")
            if name in ("--amend",):
                res.ask("'git commit --amend' переписывает историю — только по отдельному «да» человека в этом окне.")
            elif name in ("--no-verify",):
                res.deny("'--no-verify' обходит сторожей — запрещено.")
            elif name in ("--all", "--include", "--only", "--interactive", "--patch", "--pathspec-from-file"):
                res.deny(f"'git commit {name}' коммитит мимо проверок индекса — стейдж явными путями, затем коммит.")
            elif name in ("--reuse-message", "--reedit-message", "--fixup", "--squash"):
                res.deny(f"'git commit {name}' — сообщение не проверить (ключ тикета, трейлеры); пиши -m.")
            elif name == "--message":
                v = val if eq else nxt
                msgs.append(v or "")
                i += 0 if eq else 1
            elif name == "--file":
                msg_file = val if eq else nxt
                i += 0 if eq else 1
            elif name == "--trailer":
                trailers.append((val if eq else nxt) or "")
                i += 0 if eq else 1
            elif name in ("--author", "--date", "--cleanup", "--gpg-sign", "--template") and not eq:
                i += 1
            i += 1
            continue
        if re.fullmatch(r"-[A-Za-z]+.*", a) and not a.startswith("--"):
            body = a[1:]
            j = 0
            while j < len(body):
                ch = body[j]
                tail = body[j + 1:]
                if ch in "mFCct":
                    val = tail if tail else nxt
                    if not tail:
                        i += 1
                    if ch == "m":
                        msgs.append(val or "")
                    elif ch == "F":
                        msg_file = val
                    else:
                        res.deny(f"'git commit -{ch}' — сообщение/шаблон не из -m; пиши -m.")
                    break
                if ch == "n":
                    res.deny("'-n' (--no-verify) обходит сторожей — запрещено.")
                elif ch == "a":
                    res.deny("'git commit -a' коммитит рабочее дерево мимо проверок индекса — "
                             "'git add <пути>', затем 'git commit -m …'.")
                elif ch in "io":
                    res.deny(f"'git commit -{ch}' коммитит пути мимо проверок индекса.")
                elif ch == "p":
                    res.deny("'git commit -p' интерактивен — не поддерживается.")
                j += 1
            i += 1
            continue
        res.deny(f"'git commit … {a}' — пути в коммите идут мимо проверок индекса; сначала 'git add'.")
        i += 1
    amend = "--amend" in rest
    if not msgs and msg_file is None and not (amend and "--no-edit" in rest):
        res.deny("Коммит без -m/-F: сообщение (ключ тикета, без трейлеров) не проверить.")
    text = "\n\n".join(msgs) if msgs else None
    if trailers:
        text = (text or "") + "\n\n" + "\n".join(trailers)
    if msg_file == "-":
        msg_file = None
        if stdin is not None:
            text = stdin if text is None else text + "\n\n" + stdin
        else:
            res.deny("'git commit -F -' без heredoc — сообщение не проверить; пиши -m или -F <файл>.")
    res.commit = {"repo": repo, "msg": text, "msg_file": resolve(msg_file, repo) if msg_file else None,
                  "amend": amend}


def tracking(sub: str, rest: list[str], res: Result) -> None:
    flags = [a for a in rest if a.startswith("-")]
    pos = [a for a in rest if not a.startswith("-")]
    no_track = "--no-track" in flags
    if any(a in ("--track", "-t") or a.startswith("--track=") for a in flags):
        res.deny(f"'git {sub} --track' — задачная ветка не должна трекать базу (--no-track).")
    if sub == "branch":
        for k, a in enumerate(rest):
            if a in ("-u", "--set-upstream-to") or a.startswith("--set-upstream-to="):
                v = a.split("=", 1)[1] if "=" in a else (rest[k + 1] if k + 1 < len(rest) else "")
                if v.split("/")[-1] in BASES:
                    res.deny(f"'git branch -u {v}' — upstream на base запрещён.")
        if len(pos) >= 2 and re.match(r"^(refs/remotes/)?origin/", pos[-1]) and not no_track \
                and not any(f in ("-d", "-D", "-m", "-M", "--delete", "--move") for f in flags):
            res.deny(f"'git branch {pos[0]} {pos[-1]}' без --no-track начнёт трекать {pos[-1]}.")
        return
    creates = any(f in ("-b", "-B", "-c", "-C", "--create", "--force-create", "--orphan") for f in flags)
    if sub == "worktree":
        creates = creates and pos[:1] == ["add"]
    start = pos[-1] if pos else ""
    if creates and re.match(r"^(refs/remotes/)?origin/", start) and not no_track:
        res.deny(f"Новая ветка от '{start}' без --no-track начнёт его трекать → bare push уедет в base. "
                 f"Добавь --no-track.")


def main() -> int:
    cwd = os.getcwd()
    if "--cwd" in sys.argv:
        k = sys.argv.index("--cwd")
        if k + 1 < len(sys.argv) and sys.argv[k + 1]:
            cwd = sys.argv[k + 1]
    cmd = sys.stdin.read()
    res = Result()
    if GIT_RX.search(cmd):
        analyze(cmd, cwd, res)
    out = {
        "decision": "deny" if res.reasons else ("ask" if res.asks else "allow"),
        "reason": " | ".join(res.reasons or res.asks),
        "normalized": "; ".join(res.normalized),
        "target": res.target or "",
        "commit": res.commit,
    }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
