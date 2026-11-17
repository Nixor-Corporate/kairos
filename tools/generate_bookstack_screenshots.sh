#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$ROOT_DIR/tools/bookstack-screenshots/fixture.html"
OUTPUT_DIR="$ROOT_DIR/docs/bookstack/kairos/screenshots"
CHROME_BIN="${CHROME_BIN:-$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)}"

if [[ -z "$CHROME_BIN" ]]; then
  echo "Google Chrome or Chromium is required to generate screenshots." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

views=(
  login
  activation
  dashboard
  room-serving
  settings
  student-modules
  student-assignment
  student-notes
  student-quiz
  student-feedback
  ta-dashboard
  ta-signoff
  grading-workspace
  manager-dashboard
  manager-progress
  manager-course-settings
  manager-modules
  assignment-editor
  quiz-editor
  analytics
  admin-dashboard
  local-account-invite
  pending-accounts
  course-staff
)

if (($#)); then
  views=("$@")
fi

for view in "${views[@]}"; do
  screenshot="$OUTPUT_DIR/$view.png"
  fixture_path="$FIXTURE"
  if command -v cygpath >/dev/null 2>&1; then
    screenshot="$(cygpath -am "$screenshot")"
    fixture_path="/$(cygpath -am "$fixture_path")"
  fi
  "$CHROME_BIN" \
    --headless \
    --disable-gpu \
    --hide-scrollbars \
    --no-sandbox \
    --allow-file-access-from-files \
    --window-size=1440,1000 \
    --screenshot="$screenshot" \
    "file://$fixture_path?view=$view" >/dev/null 2>&1
  if [[ ! -s "$OUTPUT_DIR/$view.png" ]]; then
    echo "Chrome did not write $view.png." >&2
    exit 1
  fi
done

echo "Generated ${#views[@]} screenshots in $OUTPUT_DIR"
