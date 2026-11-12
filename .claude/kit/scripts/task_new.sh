#!/usr/bin/env bash
# task_new.sh <KEY|-> <slug> [title] — создать папку задачи <tasks.dir>/<KEY>-<slug>/ из шаблонов.
# KEY «-» → T-<yyyymmdd>-<n> (проект без трекера). Печатает путь к папке. Существующую не трогает.
set -euo pipefail
KIT="$(cd "$(dirname "$0")/.." && pwd -P)"
CFG="python3 -I $KIT/scripts/kit_config.py"
ROOT="$($CFG root "$PWD")" || { echo "нет .agent-kit.yml выше $PWD — сначала install.sh" >&2; exit 1; }
KEY="${1:?KEY}"; SLUG="${2:?slug}"; TITLE="${3:-$SLUG}"
TDIR="$ROOT/$($CFG get tasks.dir "$ROOT" || echo .tasks)"
if [ "$KEY" = "-" ]; then
  n=1; while compgen -G "$TDIR/T-$(date +%Y%m%d)-$n-*" >/dev/null; do n=$((n+1)); done
  KEY="T-$(date +%Y%m%d)-$n"
fi
SLUG="$(printf '%s' "$SLUG" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9._-')"
DIR="$TDIR/$KEY-$SLUG"
if [ -d "$DIR" ]; then echo "$DIR"; exit 0; fi
mkdir -p "$DIR/attachments"
for f in TASK.md STATE.md; do
  sed -e "s|{KEY}|$KEY|g" -e "s|{TITLE}|$TITLE|g" -e "s|{DATE}|$(date '+%Y-%m-%d %H:%M')|g" -e "s|{SOURCE}|—|g" \
    "$KIT/templates/$f" > "$DIR/$f"
done
echo "$DIR"
