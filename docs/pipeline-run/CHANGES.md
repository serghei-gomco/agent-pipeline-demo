# CHANGES — T-20261112-1 due-dates-overdue (круг r1)

Ветка `feat/T-20261112-1-due-dates`, COMMIT_MODE: per-step. Remote `origin` в проекте нет; `git merge-base HEAD main` =
`67e45b2`, но ветка до начала работы уже несла два чужих коммита (`1647cad` установка kit, `317f74c` тест сторожа).
Поэтому дифф задачи считан как `git diff 317f74c HEAD` (11 файлов, +465 −23).

## Исходное состояние
- `bash scripts/node.sh npm test --silent` → 2 файла, 15 passed (server 11, web 4); `npm run -s typecheck` → ok.
- `README.md` из `project.docs` в корне отсутствует (как и отмечено в TASK_CARD «Не прочитано»).

## S-1 — контракт и сервер: поле, проверка, хранение
- файлы: `server/src/types.ts`, `server/src/validate.ts`, `server/src/store.ts`, `server/test/tasks.test.ts`,
  `web/src/App.test.tsx` (только `dueDate: null` в двух литералах `Task`)
- результат: `Task.dueDate: string | null` всегда в ответе; `checkDueDate` (регулярка + арифметика дней в месяце,
  полное правило високосного года, без `new Date`/`trim`) общая для POST и PATCH; PATCH только с `dueDate` проходит,
  `null` убирает срок, PATCH без ключа срок не трогает; `POST` с `dueDate: null` → без срока (A-4). Тексты ошибок —
  дословно из плана. Из существующих ожиданий изменена одна строка — `tasks.test.ts:23` (+`dueDate: null`).
  Новые тесты: AC-1, A-4, AC-2/3, AC-4, AC-5, AC-6 (`it.each` 9 значений), AC-7 (`it.each` 6 + `2028-02-29`), AC-8, AC-9.
- проверка: `npx vitest run server/test/tasks.test.ts` → 34 passed · typecheck → ok · eslint 5 файлов → ok ·
  `npm test --silent` → 38 passed
- коммит: `9595204`

## S-2 — правило просрочки и настоящий тест
- файлы: `web/src/overdue.ts` (новый), `web/src/overdue.test.ts` (новый)
- результат: `localDay(now)` по локальным геттерам с ведущими нулями; `isOverdue(task, now)`,
  `filterOverdue(tasks, now)` — `export function`. Тест без моков, только `toBe`/`toEqual`, `now` локальным
  конструктором; кейсы AC-18 (+ `2020-01-01`, R-29), AC-19 (а)/(б), AC-20, `filterOverdue` на пяти задачах.
- проверка: `TZ=Europe/Chisinau … vitest run web/src/overdue.test.ts` → 9 passed · `TZ=America/New_York …` → 9 passed ·
  grep `vi.mock|typeof` → пусто · grep `export (function|const) (isOverdue|filterOverdue)` → 2 строки (`:13`, `:17`) ·
  grep `new Date\(\)|Date\.now|toISOString` → пусто (комментарий переформулирован, чтобы не содержать `toISOString`) ·
  typecheck → ok · eslint → ok
- контроль мутацией (файл восстановлен из копии, `cmp` — идентичен):
  - `isOverdue` → `return true`: Chisinau 7 failed / 9, New York 7 failed / 9
  - сравнение с `now.toISOString().slice(0, 10)`: Chisinau 1 failed (AC-19а), New York 1 failed (AC-19б)
  - `filterOverdue` → `return tasks`: 1 failed в обоих поясах
  - исходное: 9 passed в обоих поясах
- коммит: `66dcf93`

## S-3 — UI: ввод срока (создание, изменение, сброс, ошибка)
- файлы: `web/src/api.ts`, `web/src/useTasks.ts`, `web/src/App.tsx`, `web/src/App.test.tsx`
- результат: `api.create(input: NewTaskInput)`, `add(input)`; в форме поле `#new-due` «Due date», отправка
  `{ title, dueDate: dueDate || null }`, после — оба поля очищаются; в строке `<time class="due">` внутри `<label>`
  и `DueDateInput` (черновик, `useEffect([value])`, сохранение на blur только при отличии, `draft || null`).
  В тестах: `fakeApi(initial, failCreate, failUpdate)` возвращает `Api` + `calls.update`; хелпер `task(..., dueDate)`;
  хелпер `rowOf(title)`. Новые тесты: AC-10 ×2, AC-11 ×3 (изменение, очистка → `null`, blur без изменения),
  AC-12, AC-13. Ожидания четырёх прежних тестов не менялись.
- проверка: `npx vitest run web/src/App.test.tsx` → 11 passed · typecheck → ok · eslint 4 файлов → ok ·
  доп. мутация `onSave(draft || null)` → `onSave(draft)`: 1 failed, возврат → 11 passed
- коммит: `67b316b`

## S-4 — UI: красная просрочка, переключатель, пустой режим; общий гейт
- файлы: `web/src/App.tsx`, `web/src/styles.css`, `web/src/App.test.tsx`
- результат: проп `now?: () => Date` (по умолчанию `() => new Date()`), `today = now()` на каждой перерисовке;
  `<li className="overdue">` через `isOverdue`; у названия класс `title` (+`done`); `role="group" aria-label="Filter"`
  с кнопками «Все» / «Просроченные» (`aria-pressed`) после формы и перед алертом; `visible` через `filterOverdue`;
  ветки «Loading…» → «No tasks yet.» (режим «Все») → «Нет просроченных задач» (режим «Просроченные») → список;
  счётчик `open` по `tasks`. CSS: `.filter`, `.due { margin-left: 8px }`, `.overdue .title, .overdue .due { color: #c62828 }`.
  Новые тесты (все с `now = new Date(2026, 10, 12, 15, 0)`): AC-14, AC-15, AC-16, AC-17, AC-20, AC-21.
- проверка: `npx vitest run web/src/App.test.tsx` → 17 passed · grep `isOverdue|filterOverdue` в `App.tsx` → `:3`, `:25`,
  `:58` · eslint → ok · `npm run check` → код 0 (60 passed) · `npm run -s build` → ok ·
  `TZ=America/New_York npm test --silent` → 60 passed
- коммит: `73d8f1b`

## Вне плана
- `web/src/App.test.tsx`: хелпер `rowOf(title)` (поиск `<li>` по названию) — вспомогательная функция для тестов
  AC-10…AC-20, поведение не меняет.
- `web/src/overdue.ts:6`: комментарий сформулирован без слова `toISOString`, чтобы проверка плана grep'ом была пустой.
- STATE.md задачи не обновлял (хук просил после каждого коммита) — оставлено главной сессии.

## Расхождение
—

## Финальный проход — карта двойников
Все строки «да» (`validate.ts` POST/PATCH, `store.ts` create, `tasks.test.ts:23`, `App.test.tsx` fakeApi/хелпер/update,
`api.ts:20`, `useTasks.ts:34`, `App.tsx` пустые состояния и класс названия) — изменены в диффе. Строки «нет»
(`store.update`, `app.ts`, `api.update`, `useTasks.update`, `createdAt` в UTC, `maxLength`) — не тронуты.
grep `dueDate|overdue|Overdue|Просроч|NewTaskInput|TaskPatch` по `server/`, `web/` — 11 файлов, все в диффе, новых
потребителей нет. Файлы из «Границ» (`app.ts`, `index.ts`, `main.tsx`, `index.html`, `vite.config.ts`,
`vitest.workspace.ts`, `eslint.config.js`, `package.json`) — дифф пустой. `.env` не создавался.

## Итог
- test: `bash scripts/node.sh npm test --silent` → Test Files 3 passed, Tests 60 passed (то же под `TZ=America/New_York`)
- lint: `npm run check` (в составе `eslint .`) → без ошибок, код 0
- typecheck: `bash scripts/node.sh npm run -s typecheck` → ok (`tsc -p server && tsc -p web`)

## Исправления по ревью (проход 1)
Исходное состояние перед правками: `npm test --silent` → 3 files, 60 passed. Трогались только F-1 и F-3; F-2, F-5 (DEFER),
F-4, F-6 (CLOSE-ACCEPTED) не трогались. План не менялся.

### F-1 — неудачное создание стирало название и срок
- файлы: `web/src/useTasks.ts`, `web/src/App.tsx`, `web/src/App.test.tsx`
- результат: `run` возвращает `Promise<boolean>` (true — успех, false — ошибка перехвачена и показана); `add` отдаёт
  этот признак; `onSubmit` в `App.tsx` очищает `title` и `dueDate` только при `true`. `update`/`remove` тоже теперь
  возвращают признак, их вызовы не менялись. При ошибке создания алерт виден, оба поля сохраняют введённое.
- тест: `App.test.tsx` «keeps the entered title and due date when creating fails (F-1)» — `fakeApi([], true)`,
  название «Pay rent» + срок `2026-12-01` → «Add» → алерт, `New task` = `Pay rent`, `Due date` = `2026-12-01`.
- мутация: строка `if (!(await add(...))) return;` → прежняя `await add(...)` (очистка безусловно) → 1 failed (тест F-1);
  файл восстановлен из копии (`cmp` — идентичен) → 18 passed.
- проверка: `npx vitest run web/src/App.test.tsx` → 18 passed · eslint 3 файлов → ok · typecheck → ok
- коммит: `0c632b8`

### F-3 — правило столетий для 29 февраля не было закреплено тестом
- файлы: `server/test/tasks.test.ts` (код `validate.ts` не менялся — он верен)
- результат: в `it.each` AC-7 (отклонение) добавлены `2100-02-29`, `1900-02-29` → 400 `DAY_ERROR`; тест «accepts 29 February
  of a leap year» стал `it.each` на `2028-02-29` и `2000-02-29` → 201, срок возвращается как есть.
- мутации `server/src/validate.ts:25` (файл восстановлен, `cmp` — идентичен):
  - условие → `year % 4 === 0`: 2 failed (`2100-02-29`, `1900-02-29`)
  - условие → `year % 4 === 0 && year % 100 !== 0` (без правила 400): 1 failed (`2000-02-29`)
  - исходное: 37 passed
- проверка: `npx vitest run server/test/tasks.test.ts` → 37 passed · eslint → ok · typecheck → ok
- коммит: `7127f31`

### Вне плана (проход 1)
- изменение сигнатуры `run`/`add`/`update`/`remove` в `useTasks.ts` (возврат признака успеха) — прямо следует из
  диспозиции F-1 в REVIEW.md; потребители: только `App.tsx` (grep `add(`/`update(`/`remove(` по `web/src`).
- STATE.md задачи не обновлял (хук просил после коммитов) — оставлено главной сессии.

### Итог (проход 1)
- test: `bash scripts/node.sh npm test --silent` → Test Files 3 passed, Tests 64 passed; `TZ=America/New_York` → 64 passed
- lint + typecheck + tests: `bash scripts/node.sh npm run -s check` → код 0
- typecheck: `bash scripts/node.sh npm run -s typecheck` → ok
- дифф от `chore/agent-kit`: 11 файлов, +489 −24, 6 коммитов; рабочее дерево по файлам задачи чистое

## Исправления по ревью плана тестов и приёмке (круг r1)
Основание: `bugs/BUG-1.md`, `bugs/BUG-2.md`, таблица «## Ревью плана тестов» в QA_REPORT.md (принято: TF-1, TF-2, TF-3,
TF-6, TF-8, TF-10, D-2), TF-4 подтверждён приёмкой (QC-83). План не менялся; TF-5, TF-7, TF-9 (компромисс/шум) не трогались.
Исходное состояние: `npm run -s check` → код 0, 3 files, 64 passed. Каждая мутация — правка в рабочем дереве, файл
восстановлен из копии (`cmp` — идентичен), после — зелёный прогон.

### TF-1 — гейт не фиксировал пояс
- файлы: `package.json` (только `scripts`)
- результат: новый скрипт `test:tz` = `TZ=Europe/Chisinau vitest run && TZ=America/New_York vitest run`; `check` вызывает его
  вместо `npm test`. `test` не менялся.
- мутация `localDay` на UTC-поля (`getUTCFullYear/Month/Date`): `TZ=UTC npm test` → 64 passed (дыра подтверждена);
  `npm run check` → код 1, падает AC-19a в Chisinau; отдельно `TZ=America/New_York` → падает AC-19b.
- коммит: `ccf3ceb`

### D-2 — `localDay` без ведущих нулей не ловился
- файлы: `web/src/overdue.test.ts`
- результат: `it.each` при «сегодня» 2027-01-05 (однозначные месяц и день: `2027-01-04/05/10`, `2026-12-31`, `2026-09-30`)
  и тест смены года (00:30 1 января и 23:30 31 декабря).
- мутация «без нулей» (`${getMonth()+1}-${getDate()}`) → 3 failed (`2027-01-05`, `2027-01-10`, смена года).
- коммит: `ecfcb30`

### TF-2 — «сегодня» в UI-тестах совпадало с реальной датой
- файлы: `web/src/App.test.tsx`
- результат: блок overdue закреплён на 2031-03-05 15:00 (даты задач сдвинуты так же) + тест с «сегодня» в прошлом
  (2020-01-05: срок 2025-06-01 не просрочен, 2020-01-04 просрочен).
- мутация `const today = new Date()` в `App.tsx`: прежние тесты (из `HEAD`) → 18 passed (дыра подтверждена);
  новые → 4 failed (AC-14, AC-16, AC-20, TF-2).
- коммит: `f999ba4`

### TF-3 — тело POST и `api.ts` не проверялись, фейк терпимее сервера
- файлы: `web/src/App.test.tsx`, `web/src/api.test.ts` (новый)
- результат: фейк пишет `calls.create`, отклоняет `dueDate: ""` в create и update текстом сервера; AC-10 проверяют тело
  `{title, dueDate: '2026-12-01'}` и `{title, dueDate: null}`. `api.test.ts` — настоящий `api` на заглушке `fetch`:
  POST `/api/tasks` + JSON + заголовок, срок строкой как есть, PATCH `/api/tasks/7`, ошибки 400 склеиваются в одну.
- мутации: `add({ title, dueDate })` (без `|| null`) → 2 failed; `add({ title })` → 2 failed; `api.create` без `dueDate`
  в теле → 2 failed; `api.update` методом PUT → 1 failed.
- коммит: `62899cf`

### TF-6 — клик по дате отмечал задачу выполненной
- файлы: `web/src/App.tsx`, `web/src/App.test.tsx`
- результат: `<time>` вынесен из `<label>`; `<label>` и `<time>` обёрнуты в `<span className="item">`, чтобы у `li`
  по-прежнему было три дочерних элемента и раскладка `space-between` не поменялась. Тест: клик по дате — чекбокс не
  отмечен, `update` не вызван; клик по названию — отмечен.
- мутация: прежний `App.tsx` (дата внутри label) → 1 failed (TF-6).
- коммит: `3be578d`

### BUG-1 — поле даты выталкивало «Add» за экран на 375 px; дата переносилась по дефису
- файлы: `web/src/styles.css`, `web/src/styles.test.tsx` (новый)
- результат: `.add { flex-wrap: wrap }`; `.due { display: inline-block; white-space: nowrap }`.
  Только `nowrap` недостаточно: между названием и `<time>` нет пробела, последнее слово и дата становились неразрывным
  куском, и на длинном названии страница расширялась до 393 px; `inline-block` даёт место переноса перед датой.
- проверка в Chrome 375 px (Playwright 1.66, dev-сервер локально, задача «Позвонить в банк…», срок 2026-11-13):
  до — `scrollWidth` 458, правый край «Add» 458; после — 375 / 359; при 1280 — «Add» 920 до и после.
  Перебор 72 вариантов длины названия: без `nowrap` — 20 переносов даты; `nowrap` без `inline-block` — 0 переносов,
  макс. `scrollWidth` 393; итог — 0 переносов, макс. 375. Мутация «без `flex-wrap`» → снова 458.
- тест (jsdom считает правила из `styles.css` в `getComputedStyle`; CSS читается с диска — Vitest подменяет импорт
  CSS, также `?raw`, пустой строкой): у формы `flex-wrap: wrap`, у даты `nowrap` и `inline-block`.
  Мутации: исходный `styles.css` → 1 failed; без `inline-block` → 1 failed.
- коммит: `3f38ddf`

### BUG-2 — активный режим «Все / Просроченные» на вид не отличался
- файлы: `web/src/styles.css`, `web/src/styles.test.tsx`
- результат: `.filter button[aria-pressed='true']` — тёмный фон `#1d1d1f`, белый текст, сплошная рамка 2px (ширина как у
  штатной), `font-weight: 600`. Неактивная кнопка — штатная.
- Chrome: до — у обеих кнопок `rgb(239,239,239)` / `rgb(0,0,0)` / 400 в обоих режимах; после — активная
  `rgb(29,29,31)` / `rgb(255,255,255)` / 600, неактивная прежняя; после клика стили меняются местами.
- тест: вычисленные стили активной и неактивной различаются и меняются местами после клика.
  Мутация без правила → 1 failed (BUG-2).
- коммит: `f8eef35`

### TF-4 — Backspace в годе молча стирал срок
- файлы: `web/src/App.tsx`, `web/src/App.test.tsx`
- результат: в `DueDateInput.onBlur` при `e.currentTarget.validity.badInput` сохранение не отправляется; пустое поле без
  `badInput` по-прежнему уходит как `null`. Тест эмулирует `validity` (в jsdom нет частичных дат): недовведённое → `update`
  не вызван, дата в строке прежняя; затем поле пустое → `PATCH {dueDate: null}`, дата исчезает.
- мутация без проверки `badInput` → 1 failed (TF-4).
- Chrome (сценарий QC-83, локаль ru-RU): после Backspace в сегменте года `value ''`, `badInput true`; после ухода — PATCH 0,
  `<time>` `2026-11-13`, API отдаёт `2026-11-13` (в приёмке был `PATCH {"dueDate":null}`).
- наблюдение: после ухода в поле остаётся недовведённая дата браузера, строка показывает сохранённую — поле не
  возвращается к сохранённому значению (это не было в задании).
- коммит: `715df46`

### TF-8 — синхронизация черновика из `value` в `useEffect` без теста
- файлы: `web/src/App.tsx`, `web/src/App.test.tsx`
- разбор: под смонтированным полем `value` меняется только по успешному `update` этой задачи; сервер возвращает срок
  как прислали (`checkDueDate` отдаёт `raw`), отметка «выполнено» срок не меняет, смена фильтра перемонтирует поле.
  Значит `value ≠ draft` бывает только в одном случае: ответ на сохранение пришёл, пока пользователь уже вводит новую
  дату. В этом случае эффект затирал ввод: тест с задержанным `update` (A ушла, введена B, пришёл ответ на A) —
  ожидалось `2027-02-20`, в поле `2027-01-15`.
- результат: эффект удалён (вариант диспозиции «удалить код»; полезного достижимого случая у него нет), импорт
  `useEffect` убран, в комментарии объяснено почему. Тест «keeps a date typed while the previous save is still in flight».
- мутация: эффект возвращён → 1 failed (TF-8). Это отступление от текста PLAN.md S-3 (`useEffect([value])`) по диспозиции
  TF-8 — ревьюеру на проверку.
- коммит: `eda6b2a`

### TF-10 — `PATCH /api/tasks/1` → 404 сразу после POST
- воспроизведение: 40 полных последовательных `npm run -s test:tz` (80 запусков vitest), без параллельных прогонов,
  dev-сервер остановлен → 3 красных: `501` вместо 201 на POST, `404` вместо 201 на POST, `{}` вместо `[]` на GET.
  Каждый раз ответ — не от нашего приложения.
- причина: supertest 7 (`serverAddress`) для голого `app` делает `app.listen(0)` на всех интерфейсах (`::`), а запрос
  шлёт на `127.0.0.1:<port>`. На macOS `listen` на `::` проходит, даже когда этот порт на `127.0.0.1` уже занят другим
  процессом, и запрос уходит в чужой сервис. Доказательство (скрипт): «чужой» сервер на `127.0.0.1:P` (501) + наш
  `listen(P)` → `listening on ::`, `fetch 127.0.0.1:P` → 501 `foreign`. На машине в момент прогона на `127.0.0.1`
  в эфемерном диапазоне слушали 6 процессов (LogiPlugin ×3, ещё ×3) — редкое попадание (3 из 80 запусков) этим объясняется.
  Параллельные прогоны в копиях добавляют своих слушателей и делают это чаще, но причина не в них.
- результат: `server/test/tasks.test.ts` — в `beforeEach` приложение слушает `127.0.0.1` на порту 0 (ОС выбирает порт,
  свободный именно на этом адресе), supertest берёт готовый адрес; `afterEach` закрывает сервер. Код сервера не менялся.
- мутация с усилением: занят каждый второй порт 49152–65535 на `127.0.0.1` (8190 слушателей, отвечают 501):
  без фикса — 36, 37, 36 и 37 failed из 37; с фиксом — 37 passed четыре раза.
- после фикса: 40 полных `test:tz` подряд → 40/40 зелёных (80/80 запусков vitest по 80 passed).
- коммит: `6c5ba24`

### Вне плана (круг r1)
- новые файлы `web/src/api.test.ts` (TF-3), `web/src/styles.test.tsx` (BUG-1, BUG-2) — тесты этих исправлений.
- обёртка `<span className="item">` в `App.tsx` (TF-6) — чтобы раскладка строки не поменялась.
- удаление `useEffect` в `DueDateInput` (TF-8) — расходится с текстом PLAN.md S-3, основание — диспозиция TF-8.
- двойник TF-4 вне задания, не правился: поле создания `#new-due` (`web/src/App.tsx:35`) с недовведённой датой отдаёт
  `''` → задача создаётся без срока, без предупреждения. Решение — за главной сессией.
- длинное название без пробелов переполняет строку и при 1280 (BUG-1, «попутно, не регрессия») — не трогалось.

### Итог (круг r1)
- `bash scripts/node.sh npm run -s check` → код 0; typecheck ok; eslint ok; Europe/Chisinau: 5 files, 80 passed;
  America/New_York: 5 files, 80 passed
- `bash scripts/node.sh npm test --silent` → 5 files, 80 passed
- `bash scripts/node.sh npm run -s build` → built
- дифф круга от `7127f31`: 8 файлов, +257 −31, 10 коммитов; от `chore/agent-kit`: 14 файлов, +724 −33, 16 коммитов;
  рабочее дерево по файлам задачи чистое (вне git только `KIT_FINDINGS.md`, не трогался)

### Двойник TF-4 — форма создания с недовведённой датой (FIX-HERE главной сессии)
- `web/src/App.tsx`, `web/src/App.test.tsx`: при `#new-due.validity.badInput` создание не отправляется, после формы
  `role="alert"` «Enter a complete due date or clear the field.», поля не очищаются; пустое поле — как раньше `dueDate: null`.
  Тест (эмуляция `validity`) · мутация без проверки → 1 failed, восстановлено (`cmp`) → 23 passed · eslint ok ·
  `npm run -s check` → код 0 (81 passed в обоих поясах) · коммит `59dd52f`. STATE.md не обновлял (по заданию — ничего сверх).

## Исправления по ревью (проход 3)

### Исходное состояние
- `bash scripts/node.sh npm test --silent` на `59dd52f` → 5 files, 81 passed.

### F-7 — синхронизация черновика `DueDateInput` с `value`, кроме несохранённого ввода (FIX)
- файлы: `web/src/App.tsx` (`DueDateInput`, импорт), `web/src/App.test.tsx` (+2 теста).
- результат: черновик снова следует за `value` (эффект `[value]`), но только пока `edited` (ref) снят. `edited` ставится
  в `onChange`, снимается в `onBlur` — после проверки `badInput` (недовведённая дата — всё ещё несохранённый ввод,
  флаг остаётся). Комментарий над `DueDateInput` («the field is the only place that changes this date») заменён верным.
- тесты: «shows a due date changed elsewhere and does not send the old one back on blur (F-7)» (сценарий 1: ответ PATCH
  `{done}` несёт чужую дату → поле её показывает, focus+blur без ввода PATCH не шлёт); «shows the saved date after typing
  it back while the save was in flight (F-7)» (сценарий 2: X → blur → O → blur → ответ: поле = строка = X).
  TF-8 остался зелёным.
- мутации (в рабочем дереве, после — восстановлено из копии): HEAD-код (`59dd52f`) → оба новых теста failed;
  эффект без проверки флага → failed TF-8; флаг не снимается в `onBlur` → failed сценарий 2.
- проверка: `npx vitest run web/src/App.test.tsx` → 25 passed; eslint по обоим файлам ok; typecheck ok.
- коммит: `59da2cc` (заголовок 71 символ).
- PLAN.md S-3 не правил (исполнителю запрещено): уточнение одной строкой — «синхронизация с `value` только когда в поле
  нет несохранённого ввода» — за главной сессией.

### F-8 попутно — два алерта при раннем `return` в `onSubmit` (не трогал)
- одной строкой не делается без нового дефекта. Устаревшая ошибка живёт в `useTasks` (`error`), сбросить её из
  `onSubmit` нельзя — для этого `useTasks` должен отдать сброс наружу (правка хука, вне задания). Однострочный вариант
  `{!dueError && error && …}` (`App.tsx:57`) прячет ЛЮБУЮ последующую ошибку API (например, неудачную отметку
  «выполнено»), пока висит `dueError`, а он снимается только следующей отправкой формы. Обратный порядок покажет
  устаревшую ошибку вместо нашей. Оставлено как есть; вместе с F-8 решается по итогу приёмки в Chrome (если встроенная
  проверка блокирует отправку — ветка с алертом кандидат на удаление, и вопрос снимается).

### Вне плана (проход 3)
- —

### Итог (проход 3)
- `bash scripts/node.sh npm run -s check` → код 0; typecheck ok; eslint ok; Europe/Chisinau 83 passed; America/New_York 83 passed
- `bash scripts/node.sh npm test --silent` → 5 files, 83 passed
- дифф от `chore/agent-kit`: 14 файлов, +806 −33, 18 коммитов; рабочее дерево по файлам задачи чистое.
