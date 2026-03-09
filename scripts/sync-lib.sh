#!/bin/sh
# sync-lib.sh — Pull shared lib files from the turtle-talk main repo and adapt
# them for NodeNext module resolution (no cross-imports, flat single files).
#
# The main repo uses moduleResolution:bundler (no .js extensions needed).
# This agent uses moduleResolution:NodeNext (requires .js extensions).
# So we flatten and inline rather than copying files directly.
#
# Usage: sh scripts/sync-lib.sh
#        make sync-lib

set -e

MAIN_REPO="https://github.com/ianktoo/turtle-talk.git"
TMP_DIR="/tmp/tt-sync"
LIB_OUT="$(dirname "$0")/../../lib/speech"

echo "==> Syncing lib/speech from turtle-talk main repo..."

# Clone or update
if [ -d "$TMP_DIR/.git" ]; then
  echo "    Updating cached clone..."
  git -C "$TMP_DIR" pull --quiet --depth=1
else
  echo "    Cloning (shallow)..."
  rm -rf "$TMP_DIR"
  git clone --depth=1 --quiet "$MAIN_REPO" "$TMP_DIR"
fi

SRC="$TMP_DIR/lib/speech"
mkdir -p "$LIB_OUT"

# ── types.ts ──────────────────────────────────────────────────────────────────
# Copy types.ts from main repo, removing the GuardrailAgent import and the
# SpeechServiceConfig interface that references it (not used by the agent).
echo "    Writing types.ts..."
grep -v "GuardrailAgent" "$SRC/types.ts" \
  > "$LIB_OUT/types.ts"

# ── prompts.ts ────────────────────────────────────────────────────────────────
# The main repo stores prompts as a directory with cross-imports (no .js ext).
# We flatten the three files the agent needs into a single prompts.ts:
#   shelly-ending.ts  → GOODBYE_EXCEPTION_SECTION
#   shelly-base.ts    → BASE_SYSTEM_PROMPT  (imports shelly-ending — inlined)
#   first-message.ts  → getFirstMessageInstruction
echo "    Writing prompts.ts..."

{
  # shelly-ending: just the export, no imports
  grep -v "^import" "$SRC/prompts/shelly-ending.ts"

  echo ""

  # shelly-base: drop the import line (we inlined shelly-ending above)
  grep -v "^import" "$SRC/prompts/shelly-base.ts"

  echo ""

  # first-message: no imports, safe to copy directly
  cat "$SRC/prompts/first-message.ts"

} > "$LIB_OUT/prompts.ts"

echo "==> Done. lib/speech synced from turtle-talk."
echo "    Run 'make build' to recompile."
