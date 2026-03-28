#!/usr/bin/env bash
# fix-memory-metadata.sh
# Adds missing `version:` and `type: daily` to teammates memory records.
#
# Usage: bash fix-memory-metadata.sh [version]
#   version  - CLI version to stamp (default: read from packages/cli/package.json)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TEAMMATES_DIR="$REPO_ROOT/.teammates"

# Resolve version
if [[ ${1:-} ]]; then
  VERSION="$1"
else
  VERSION=$(grep '"version"' "$REPO_ROOT/packages/cli/package.json" | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
fi

echo "Using version: $VERSION"
echo "Scanning: $TEAMMATES_DIR/*/memory/"

UPDATED=0
SKIPPED=0

# Find all .md files under any teammate's memory directory
while IFS= read -r file; do
  # Read the file
  content=$(cat "$file")

  # Check if file has YAML frontmatter (starts with ---)
  if [[ "$content" != ---* ]]; then
    # No frontmatter at all — add it
    has_version=false
    has_type=false
  else
    has_version=false
    has_type=false
    # Extract frontmatter (between first and second ---)
    frontmatter=$(echo "$content" | sed -n '2,/^---$/p' | head -n -1)
    if echo "$frontmatter" | grep -q "^version:"; then
      has_version=true
    fi
    if echo "$frontmatter" | grep -q "^type:"; then
      has_type=true
    fi
  fi

  # Determine if this is a daily memory (filename matches YYYY-MM-DD.md)
  basename=$(basename "$file")
  is_daily=false
  if [[ "$basename" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$ ]]; then
    is_daily=true
  fi

  needs_update=false

  # Build the additions
  add_version=""
  add_type=""

  if [[ "$has_version" == false ]]; then
    add_version="version: $VERSION"
    needs_update=true
  fi

  if [[ "$is_daily" == true && "$has_type" == false ]]; then
    add_type="type: daily"
    needs_update=true
  fi

  if [[ "$needs_update" == false ]]; then
    ((SKIPPED++)) || true
    continue
  fi

  # Apply changes
  if [[ "$content" != ---* ]]; then
    # No frontmatter — create one
    new_front="---"
    [[ -n "$add_version" ]] && new_front="$new_front"$'\n'"$add_version"
    [[ -n "$add_type" ]] && new_front="$new_front"$'\n'"$add_type"
    new_front="$new_front"$'\n'"---"
    printf '%s\n%s\n' "$new_front" "$content" > "$file"
  else
    # Has frontmatter — inject after opening ---
    # Build insertion line(s)
    insert=""
    [[ -n "$add_version" ]] && insert="$add_version"
    if [[ -n "$add_type" ]]; then
      [[ -n "$insert" ]] && insert="$insert"$'\n'"$add_type" || insert="$add_type"
    fi

    # Insert after first line (the opening ---)
    {
      head -n 1 "$file"
      echo "$insert"
      tail -n +2 "$file"
    } > "$file.tmp"
    mv "$file.tmp" "$file"
  fi

  echo "  Updated: $file"
  ((UPDATED++)) || true

done < <(find "$TEAMMATES_DIR" -path "*/memory/*.md" -type f)

echo ""
echo "Done. Updated: $UPDATED, Skipped (already correct): $SKIPPED"
