# Tasks demo — notes for agents

- Stack: Node/TS Express API in `server/` (in-memory store), React/TS Vite UI in `web/`, Vitest for both.
- `server/src/types.ts` is shared by API and UI — change the contract there once.
- Run every npm/npx command through `bash scripts/node.sh …` (picks Node from `.nvmrc` if the default is too old).
- One gate for everything: `bash scripts/node.sh npm run check` (typecheck + lint + tests).

<!-- agent-kit:start -->
## agent-kit — конвейер агентов (установлено 2026-11-12; блок обновляет install.sh, правки — выше/ниже блока)
Профиль проекта — `.agent-kit.yml`; контракт — `.claude/kit/docs/CONVENTIONS.md`.
Задача целиком — `/kit-task`; состояние — `/kit-state <KEY>`; сдача — `/kit-deliver`; возврат — `/kit-reopen`.
@.claude/kit/rules/communication.md
@.claude/kit/rules/git-gates.md
@.claude/kit/rules/pipeline.md
<!-- agent-kit:end -->
