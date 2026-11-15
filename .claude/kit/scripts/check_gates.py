#!/usr/bin/env python3
"""check_gates.py — машинная проверка артефактов задачи по стадиям (agent-kit).

  check_gates.py --stage plan|qa|deliver <task_dir> [--json]

Код 0 — всё ✓ (⚠ допустимы), 1 — есть ✗, 2 — ошибка вызова.
Правила — docs/CONVENTIONS.md, п. 5 (план) и п. 6 (QA-отчёт). Риск-триггеры — из .agent-kit.yml.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from typing import List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_config  # noqa: E402

HUMAN_LINES = ["Решения:", "Допущения:", "Не делаем:", "Риски:", "Посмотри сам:"]


def latest(task_dir: str, stem: str) -> Tuple[Optional[str], int]:
    """Самый свежий круг артефакта: PLAN.md (r1), PLAN-r2.md …"""
    best, rnd = None, 0
    for name in os.listdir(task_dir):
        m = re.fullmatch(rf"{stem}(?:-r(\d+))?\.md", name)
        if m:
            n = int(m.group(1) or 1)
            if n > rnd:
                best, rnd = os.path.join(task_dir, name), n
    return best, rnd


def section(text: str, title: str) -> Optional[str]:
    m = re.search(rf"(?m)^##\s+{re.escape(title)}\s*$", text)
    if not m:
        return None
    rest = text[m.end():]
    n = re.search(r"(?m)^##\s+", rest)
    return rest[: n.start()] if n else rest


def frontmatter(text: str) -> dict:
    m = re.match(r"^---\n(.*?)\n---", text, re.S)
    out = {}
    if m:
        for line in m.group(1).splitlines():
            k, _, v = line.partition(":")
            if v:
                out[k.strip()] = v.strip().strip("'\"")
    return out


class Report:
    def __init__(self) -> None:
        self.items: List[Tuple[str, str]] = []

    def ok(self, m: str) -> None:
        self.items.append(("✓", m))

    def warn(self, m: str) -> None:
        self.items.append(("⚠", m))

    def fail(self, m: str) -> None:
        self.items.append(("✗", m))

    @property
    def failed(self) -> bool:
        return any(s == "✗" for s, _ in self.items)


def check_plan(task_dir: str, cfg: dict, r: Report) -> dict:
    path, rnd = latest(task_dir, "PLAN")
    if not path:
        r.fail("PLAN.md не найден")
        return {}
    text = open(path, encoding="utf-8").read()
    fm = frontmatter(text)
    risk = fm.get("risk", "")
    if risk in ("low", "medium", "high"):
        r.ok(f"{os.path.basename(path)}: risk={risk}")
    else:
        r.fail(f"{os.path.basename(path)}: во фронтматтере нет risk: low|medium|high")
    if rnd >= 2 and risk != "high":
        r.warn(f"круг {rnd}: для возврата риск обычно поднимается до high (сейчас {risk or '—'})")
    first = re.search(r"(?m)^##\s+(.+?)\s*$", text)
    human = section(text, "Для человека")
    if human is None:
        r.fail("нет секции «## Для человека»")
    else:
        if first and first.group(1) != "Для человека":
            r.fail("«## Для человека» должна быть первой секцией плана")
        lines = [l for l in human.splitlines() if l.strip()]
        in_mermaid, n = False, 0
        for l in lines:
            if l.strip().startswith("```"):
                in_mermaid = not in_mermaid
                continue
            if not in_mermaid:
                n += 1
        if n > 25:
            r.fail(f"«Для человека»: {n} строк (> 25)")
        missing = [h for h in HUMAN_LINES if h not in human]
        if missing:
            r.fail("«Для человека»: нет строк " + ", ".join(missing))
        else:
            r.ok(f"«Для человека»: {n} строк, все обязательные пункты")
    reg = section(text, "Реестр требований")
    reg_ids = {}
    if reg is None:
        r.fail("нет секции «## Реестр требований»")
    else:
        for row in reg.splitlines():
            m = re.match(r"\|\s*(R-\d+)\s*\|(.*)\|", row)
            if m:
                cells = [c.strip() for c in m.group(2).split("|")]
                status = next((c.upper() for c in cells if c.upper() in ("IN", "OUT")), "")
                reg_ids[m.group(1)] = (status, " ".join(cells))
        if not reg_ids:
            r.fail("реестр требований пуст (нужны строки | R-n | … | IN/OUT | …)")
        else:
            bad = [k for k, (s, _) in reg_ids.items() if not s]
            if bad:
                r.fail("реестр: без статуса IN/OUT — " + ", ".join(bad))
            no_ac = [k for k, (s, row) in reg_ids.items() if s == "IN" and not re.search(r"AC-\d+", row)]
            if no_ac:
                r.fail("реестр: IN без AC-n — " + ", ".join(no_ac))
            if not bad and not no_ac:
                r.ok(f"реестр: {len(reg_ids)} строк")
    if human:
        for rid in set(re.findall(r"R-\d+", human)):
            if rid not in reg_ids:
                r.fail(f"«Для человека» ссылается на {rid}, которого нет в реестре")
        nd = re.search(r"Не делаем:(.*)", human)
        if nd:
            for rid in re.findall(r"R-\d+", nd.group(1)):
                if rid in reg_ids and reg_ids[rid][0] != "OUT":
                    r.fail(f"«Не делаем» называет {rid}, но в реестре он не OUT")
        for aid in set(re.findall(r"A-\d+", human)):
            assum = section(text, "Допущения") or ""
            if aid not in assum:
                r.fail(f"{aid} из «Для человека» не описано в «## Допущения»")
    steps = section(text, "Шаги")
    if not steps or not re.search(r"S-\d+", steps):
        r.fail("нет шагов S-n в «## Шаги»")
    cov = section(text, "Матрица покрытия")
    ac_all = set(re.findall(r"AC-\d+", reg or ""))
    if cov is None:
        r.fail("нет «## Матрица покрытия»")
    else:
        covered = set(re.findall(r"AC-\d+", cov))
        lost = sorted(ac_all - covered, key=lambda x: int(x[3:]))
        if lost:
            r.fail("матрица покрытия: AC без шага — " + ", ".join(lost))
        else:
            r.ok(f"матрица покрытия: {len(covered)} AC")
    if section(text, "Карта двойников") is None:
        r.fail("нет «## Карта двойников» (или фразы «grep по … — других путей нет»)")
    # QA_PLAN по риску
    need_qa = risk in (kit_config.get(cfg, "pipeline.qa_plan_risk") or []) or rnd >= 2
    qa_path = os.path.join(task_dir, "QA_PLAN.md")
    if need_qa:
        if not os.path.exists(qa_path):
            r.fail(f"risk={risk}{', круг ' + str(rnd) if rnd >= 2 else ''}: нужен QA_PLAN.md до кода (kit-qa-planner)")
        else:
            head = open(qa_path, encoding="utf-8").readline()
            sha = hashlib.sha256(open(path, "rb").read()).hexdigest()[:12]
            m = re.search(r"sha=([0-9a-f]{12})", head)
            if not head.startswith("QA_PLAN_FOR:") or not m:
                r.fail("QA_PLAN.md: первая строка должна быть `QA_PLAN_FOR: <KEY> r<N> plan=<файл> sha=<12 hex>`")
            elif m.group(1) != sha:
                r.fail(f"QA_PLAN.md написан по другой версии плана (sha {m.group(1)} ≠ {sha}) — перезапусти kit-qa-planner")
            else:
                r.ok("QA_PLAN.md совпадает с текущим планом")
    return {"risk": risk, "round": rnd, "plan": path}


def check_qa(task_dir: str, cfg: dict, r: Report) -> None:
    info = check_plan(task_dir, cfg, Report())  # только факты плана
    path, _ = latest(task_dir, "QA_REPORT")
    if not path:
        r.fail("QA_REPORT.md не найден")
        return
    text = open(path, encoding="utf-8").read()
    for title in ("Покрытие требований", "Матрица вариаций", "Не проверено"):
        s = section(text, title)
        if s is None:
            r.fail(f"нет «## {title}»")
        elif title == "Не проверено" and not re.sub(r"[\s\-|*]", "", s):
            r.fail("«Не проверено» пустая — так не бывает")
    mat = section(text, "Матрица вариаций") or ""
    for axis in kit_config.get(cfg, "qa.axes") or []:
        if axis.lower() not in mat.lower():
            r.fail(f"матрица: нет оси «{axis}» (qa.axes)")
    if re.search(r"(?mi)\|\s*н/п\s*\|", mat):
        r.fail("матрица: голое «н/п» — нужна причина («н/п: …»)")
    plan_text = open(info["plan"], encoding="utf-8").read() if info.get("plan") else ""
    ins = [m.group(1) for m in re.finditer(r"\|\s*(R-\d+)\s*\|[^\n]*\|\s*IN\s*\|", plan_text)]
    cov = section(text, "Покрытие требований") or ""
    lost = [x for x in ins if x not in cov]
    if lost:
        r.fail("покрытие: R-n IN без кейса — " + ", ".join(lost))
    m = re.search(r"(?m)^ACCEPTANCE_RUN:\s*(required|not required)", text)
    risk, rnd = info.get("risk", ""), info.get("round", 1)
    must = risk in (kit_config.get(cfg, "pipeline.acceptance_risk") or []) or rnd >= 2
    if not m:
        r.fail("нет маркера ACCEPTANCE_RUN: required|not required (<причина>)")
    elif m.group(1) == "not required" and must:
        r.fail(f"ACCEPTANCE_RUN: not required, но risk={risk} / круг {rnd} требует приёмку (pipeline.acceptance_risk)")
    elif m.group(1) == "required":
        acc, _ = latest(task_dir, "ACCEPTANCE")
        if acc:
            last = [l for l in open(acc, encoding="utf-8").read().splitlines() if l.strip()][-1:]
            if last and last[0].startswith("ACCEPTANCE: PASS"):
                r.ok("приёмка: PASS")
            else:
                r.fail(f"приёмка: последняя строка {os.path.basename(acc)} не `ACCEPTANCE: PASS`")
        else:
            r.warn("приёмка required, ACCEPTANCE.md ещё нет")
    t = re.search(r"(?m)^TEST_PLAN_REVIEW:\s*(required|not required)", text)
    must_t = risk in (kit_config.get(cfg, "pipeline.test_plan_review_risk") or []) or rnd >= 2
    if not t:
        r.fail("нет маркера TEST_PLAN_REVIEW")
    elif t.group(1) == "not required" and must_t:
        r.fail(f"TEST_PLAN_REVIEW: not required, но risk={risk} требует ревью плана тестов")
    elif t.group(1) == "required" and section(text, "Ревью плана тестов") is None:
        r.warn("ревью плана тестов required — секции «## Ревью плана тестов» пока нет")
    if not r.failed:
        r.ok(os.path.basename(path) + ": структура в порядке")


def check_deliver(task_dir: str, cfg: dict, r: Report) -> None:
    check_qa(task_dir, cfg, r)
    rev, _ = latest(task_dir, "REVIEW")
    if not rev:
        r.fail("REVIEW.md не найден")
    else:
        m = re.findall(r"(?m)^\**VERDICT:\**\s*\**([A-Z_]+)", open(rev, encoding="utf-8").read())
        if not m:
            r.fail("REVIEW.md: нет строки VERDICT:")
        elif m[-1] != "APPROVED":
            r.fail(f"ревью: VERDICT {m[-1]} — сдача закрыта")
        else:
            r.ok("ревью: APPROVED")


def main(argv: List[str]) -> int:
    if "--stage" not in argv:
        print(__doc__)
        return 2
    stage = argv[argv.index("--stage") + 1]
    rest = [a for i, a in enumerate(argv[1:], 1) if not a.startswith("--") and argv[i - 1] != "--stage"]
    if not rest or not os.path.isdir(rest[0]):
        print("нужна папка задачи")
        return 2
    task_dir = os.path.abspath(rest[0])
    _, cfg = kit_config.load(task_dir)
    r = Report()
    {"plan": check_plan, "qa": check_qa, "deliver": check_deliver}[stage](task_dir, cfg, r)
    if "--json" in argv:
        print(json.dumps({"ok": not r.failed, "items": r.items}, ensure_ascii=False))
    else:
        for s, m in r.items:
            print(s, m)
        print(f"GATE {stage}: {'✗' if r.failed else 'ok'}")
    return 1 if r.failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
