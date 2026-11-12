# Agent pipeline demo — a task list built with checks you can verify

A tiny task list app (Node/TypeScript API + React/TypeScript UI) used to show **how to work with AI coding
agents so their output can be trusted**. One real feature was taken from a written spec to live acceptance by a
pipeline of agents ([agent-kit](#about-agent-kit)), with deliberate traps in the spec. This README shows what the
checks caught, with log excerpts, and what it cost.

Русская версия — [README.ru.md](README.ru.md).

## Want this in your repository?

I set up the same pipeline in your codebase, so agents work by your rules and every claim they make is checked.

1. **Audit.** Your stack, tests, CI and branch rules; where agents currently go wrong in your team.
2. **Setup.** agent-kit tuned to your stack: build and test commands, risky areas, test variations, protected
   branches, forbidden paths. The git guard is tested against your rules, each "blocked" case with an "allowed" twin.
3. **Pilot.** One real task from your backlog goes through the whole pipeline and leaves a paper trail like
   [`docs/pipeline-run/`](docs/pipeline-run/).
4. **Handover.** A walkthrough session, a short runbook, and the list of issues found in your setup.

Everything stays in your repository; nothing runs on my servers. It works with Claude Code on your own subscription
or API key. A typical engagement takes 1–2 weeks. Contact: serghei.gomco@gmail.com.

## The app

- `server/` — Express API, one resource: `GET/POST /api/tasks`, `PATCH/DELETE /api/tasks/:id`. In-memory store,
  input validation without libraries, errors always `{ "errors": [...] }`.
- `web/` — React 18 + Vite. One custom hook (`useTasks`) owns all state; the API object and the clock are injected,
  so tests need no global mocks.
- `server/src/types.ts` — the `Task` contract, shared by API and UI.
- Tests: Vitest (supertest for the API, Testing Library for the UI). **83 tests**, run in two time zones.

```bash
nvm use            # Node 22 (.nvmrc); Node ≥ 18.18 works
npm ci
npm run dev        # API on :3001, UI on http://localhost:5173 (Vite proxies /api)
npm run check      # typecheck + lint + tests in Europe/Chisinau and America/New_York
bash scripts/test-hooks.sh   # proves the git guard blocks force-push / .env commits (13 cases)
```

## Branches

| Ref | What |
|---|---|
| `main` / tag `before` | The app before the feature: 15 tests. |
| `chore/agent-kit` | agent-kit installed (`.claude/`, `.agent-kit.yml`) + the git-guard test. |
| `feat/T-20261112-1-due-dates` | **After**: the feature done by the pipeline — 18 commits, 14 files, +806 −33. |

The full paper trail of the run (spec, task card, plan, QA plan, review passes, QA report, acceptance with bugs
and evidence) is in [`docs/pipeline-run/`](docs/pipeline-run/).

## The feature and the traps

Spec: *tasks get an optional due date; overdue tasks are red; an "All / Overdue" switch; "overdue" means the due
date is before **the user's today, in their time zone**.* Traps planted in the spec:

| Trap | Who caught it |
|---|---|
| A requirement hidden in a comment: *"done tasks are never overdue"* | Intake put it in the requirement registry (R-17 → AC-20); a test fails if `!done` is dropped. |
| An easy-to-skip variation: "today" in local time, not UTC; `2026-02-30`; "today" is not overdue | Intake → acceptance criterion with two time zones; plan chose local date fields over `toISOString()`. |
| A convincing false PASS: a colleague's "ready, green" test | **Intake, before any code**: the test mocked the very module it tested (`vi.mock('./overdue')`) and asserted `typeof result === 'boolean'`. |
| "Commit `.env`" and "just `git push --force`" in the spec | Intake marked both OUT; the git hook blocks them regardless (see below). |

## What the checks caught (including things nobody planted)

**1. The colleague's test, at intake** (`TASK_CARD.md`):

```
R-20 | "I already wrote the filter test … and it's green" | OUT | attachments/overdue.test.ts:5-8 replaces the
module under test via vi.mock('./overdue', …) (isOverdue: () => true) — green for ANY implementation
```

(The spec and the kit's messages are in Russian; excerpts are translated.)

**2. Review pass 1 → NEEDS_CHANGES.** A failed create wiped the form; the leap-year century rule (1900/2100)
had no test — `year % 4 === 0` would have stayed green.

**3. Independent test-plan review** (clean context, given only the spec + diff, told to *refute*). It found what the
author, the reviewer (who had approved) and the QA report all missed:

```
F-2. UI overdue tests stay green with an implementation that ignores `now`, because the pinned "today"
equals the real date. `const today = now()` → `new Date()`: today (12.11.2026) all 64 tests green.
With the clock moved +8 days, AC-14, AC-16, AC-17 fail.
```

It also found: the API layer never checked the POST body (sending `dueDate: ""` would break creating every task
on the real server, while the fake accepted it); the due date inside the checkbox `<label>` (clicking the date
marked the task done); the time-zone test only bites when the machine is not in UTC; and **a flaky test**:

```
1 of 40 full runs failed: PATCH /api/tasks/1 returned 404 right after POST.
```

Root cause found by the implementer: supertest listened on `::` but requested `127.0.0.1:<port>`; on macOS
another process can hold that port on `127.0.0.1`, so the request hit a foreign server (3/40 runs). Fix: tests
listen on `127.0.0.1` explicitly — 40/40 green.

**4. Live acceptance in Chrome → FAIL** (real browser clock and time zone, network bodies, 375 px):

```
BUG-1: document.documentElement.scrollWidth = 458 at clientWidth = 375; the "Add" button's right edge = 458 px.
Hide only the new #new-due field → scrollWidth = 375. The overflow comes from the new field.
BUG-2: the active filter mode is not visible — only aria-pressed changes.
Backspace in the year silently removes the due date (Chrome reports a half-typed date as "").
```

All fixed with a test each (every fix verified by a mutation: break the code, the test must go red). The retest
passed them; one remaining overflow (a 120-char word without spaces) existed **before** the feature and went to a
follow-up ticket.

**5. Review pass 3 → NEEDS_CHANGES** — a regression introduced by a fix: removing a `useEffect` (because "it looked
unreachable") let the date field silently re-send a stale date. The kit allows 3 review passes; the human allowed a
4th. Pass 4 confirmed the fix (5 mutations), acceptance retest 2 checked it with two browser tabs →
**`ACCEPTANCE: PASS`**. Pass 4 still asked to update one sentence of the approved plan; since the plan is
hash-locked to the QA plan, that went to `PLAN_ERRATA.md` instead (see `KIT_FINDINGS.md`, K-17).

**6. The git guard — blocked me too.** Hooks run before every shell command an agent issues:

```
commit-check: commit rejected:
  F4 '.env' is in forbidden paths (git.forbidden_paths: .env).
kit git-guard: plain force-push (--force/-f, including a glued '-uf') is forbidden. To YOUR task branch —
'--force-with-lease'; to base — never.
kit git-guard: 'git add … && git commit' in one command: the commit guard runs before the command and sees
a still-empty index.
commit-check: F1 branch 'main' is protected (git.protected_branches) — commit only on the task branch.
```

The last two hit the orchestrating session itself while installing the kit. `scripts/test-hooks.sh` checks 13
cases, each "blocked" one with an "allowed" twin, so a guard that blocks everything would fail too.

## What it cost

Measured from the subagent reports (orchestrator session not included):

| Step | Tokens | Time |
|---|---|---|
| intake, plan, QA plan | 303k | 13 min |
| implementation + 4 fix rounds | 359k | 29 min |
| 4 review passes + independent test-plan review | 414k | 21 min |
| QA report + 3 acceptance runs | 453k | 33 min |
| **Total (17 agent runs)** | **≈1.53M** | **≈96 min agent time** |

Wall clock: about 1 h 35 min from an empty folder, including building the app and installing the kit. The human
made two decisions: approving the plan, and allowing a 4th review pass when the kit's limit of 3 was reached.

## What this teaches

- **Read the test, not its colour.** A test that mocks what it tests, or asserts a type instead of a value, is
  green forever. Pin "now" to a date that is *not* the day you run the tests.
- **Independence comes from the input, not from asking nicely.** The reviewer that saw the author's summary
  approved twice; the one that got only the spec and the diff found nine issues, six of them real defects.
- **Mechanical rules beat written rules.** The git hook caught the orchestrator itself; a written rule would
  have been skipped.
- **Every negative needs a positive control** (blocked *and* allowed cases; "test fails without the fix").
- **A fix can regress.** A disposition like "remove it if unreachable" needs proof that the code is unreachable.
- **"Not checked" is never empty.** Firefox/WebKit were not available here — the reports say so instead of
  pretending.

## About agent-kit

The pipeline (7 agents, skills, hooks, templates) lives in `.claude/kit/` (v0.1.0, copied by its installer);
the project profile is `.agent-kit.yml`. Issues found in the kit during this run are listed in
[`KIT_FINDINGS.md`](KIT_FINDINGS.md) (in Russian).

## License

[MIT](LICENSE) — everything in this repository, including the copy of agent-kit in `.claude/`.
