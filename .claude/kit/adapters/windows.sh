#!/usr/bin/env bash
# windows.sh — окна задач для диспетчера (skills/kit-dispatch). Бэкенд: KIT_WINDOWS=tmux|herdr|print,
# по умолчанию — tmux внутри tmux, herdr если установлен, иначе print (напечатать команду).
#   windows.sh open <KEY> <cwd> [label]   — окно с Claude Code в папке задачи / воркtree
#   windows.sh list                       — окна (имя, папка)
set -euo pipefail
backend="${KIT_WINDOWS:-}"
if [ -z "$backend" ]; then
  if [ -n "${TMUX:-}" ]; then backend=tmux
  elif command -v herdr >/dev/null 2>&1; then backend=herdr
  else backend=print; fi
fi
CLAUDE_CMD="${KIT_CLAUDE_CMD:-claude}"
case "${1:-}" in
  open)
    key="${2:?KEY}"; cwd="${3:?cwd}"; label="${4:-$key}"
    [ -d "$cwd" ] || { echo "нет папки $cwd" >&2; exit 1; }
    case "$backend" in
      tmux)  tmux new-window -d -n "$label" -c "$cwd" "$CLAUDE_CMD"; echo "tmux: окно «$label» в $cwd" ;;
      herdr) herdr workspace create --cwd "$cwd" --label "$label" --no-focus
             echo "herdr: пространство «$label» в $cwd — запусти в нём: $CLAUDE_CMD" ;;
      *)     echo "открой терминал и выполни: cd $(printf '%q' "$cwd") && $CLAUDE_CMD" ;;
    esac ;;
  list)
    case "$backend" in
      tmux)  tmux list-windows -F '#{window_name}	#{pane_current_path}' ;;
      herdr) herdr workspace list 2>/dev/null || echo "herdr: список недоступен" ;;
      *)     echo "бэкенд print: окон не отслеживаю" ;;
    esac ;;
  *) sed -n '2,5p' "$0"; exit 2 ;;
esac
