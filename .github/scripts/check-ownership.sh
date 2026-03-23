#!/usr/bin/env bash
# Ownership Map Overlay — parses SOUL.md ownership sections and maps changed files to their owners.
# Usage: check-ownership.sh [file...]
#   If no files given, reads from stdin (one file per line).
#   If no files at all, uses git diff against origin/main.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# ── Parse ownership from all SOUL.md files ──────────────────────────────────

# Arrays to hold parsed ownership data (indexed in parallel)
OWNER_PATTERNS=()
OWNER_NAMES=()
OWNER_LEVELS=()

# Regex for matching bullet lines with backtick-wrapped patterns
BACKTICK_RE='^[[:space:]]*-[[:space:]]+`([^`]+)`'

for soul_file in .teammates/*/SOUL.md; do
  [[ -f "$soul_file" ]] || continue
  teammate="$(basename "$(dirname "$soul_file")")"

  section=""
  in_ownership=false

  while IFS= read -r line; do
    # Track which section we're in
    if [[ "$line" =~ ^##[[:space:]]+Ownership ]]; then
      in_ownership=true
      section=""
      continue
    fi

    # Exit ownership on next ## heading (but not ### subheadings)
    if $in_ownership && [[ "$line" =~ ^##[[:space:]] ]] && [[ ! "$line" =~ ^### ]]; then
      in_ownership=false
      continue
    fi

    if ! $in_ownership; then continue; fi

    # Track Primary / Secondary subsections
    if [[ "$line" =~ ^###[[:space:]]+Primary ]]; then
      section="primary"
      continue
    elif [[ "$line" =~ ^###[[:space:]]+Secondary ]]; then
      section="secondary"
      continue
    elif [[ "$line" =~ ^###[[:space:]] ]]; then
      section=""
      continue
    fi

    if [[ -z "$section" ]]; then continue; fi

    # Extract glob pattern from bullet lines: - `pattern` — description
    if [[ "$line" =~ $BACKTICK_RE ]]; then
      raw_pattern="${BASH_REMATCH[1]}"
      # Strip parenthetical qualifiers like "(root)"
      raw_pattern="$(echo "$raw_pattern" | sed 's/ *([^)]*)$//')"

      OWNER_PATTERNS+=("$raw_pattern")
      OWNER_NAMES+=("$teammate")
      OWNER_LEVELS+=("$section")
    fi
  done < "$soul_file"
done

# ── Glob matching ────────────────────────────────────────────────────────────

# Convert a SOUL.md glob pattern to an extended regex for matching file paths.
#   ** → match anything (including /)
#   *  → match anything except /
glob_to_regex() {
  local glob="$1"
  local regex=""
  local i=0
  local len=${#glob}

  while (( i < len )); do
    local c="${glob:$i:1}"
    if [[ "$c" == "*" ]] && (( i + 1 < len )) && [[ "${glob:$((i+1)):1}" == "*" ]]; then
      regex+=".*"
      (( i += 2 ))
      # Skip trailing /
      if (( i < len )) && [[ "${glob:$i:1}" == "/" ]]; then
        (( i++ ))
      fi
    elif [[ "$c" == "*" ]]; then
      regex+="[^/]*"
      (( i++ ))
    elif [[ "$c" == "?" ]]; then
      regex+="[^/]"
      (( i++ ))
    elif [[ "$c" =~ [.+{}\\^\$\|] ]]; then
      regex+="\\$c"
      (( i++ ))
    else
      regex+="$c"
      (( i++ ))
    fi
  done

  echo "^${regex}$"
}

# Precompile all patterns to regex
OWNER_REGEXES=()
for (( i=0; i < ${#OWNER_PATTERNS[@]}; i++ )); do
  OWNER_REGEXES+=("$(glob_to_regex "${OWNER_PATTERNS[$i]}")")
done

# Match a file path against all ownership patterns.
# Outputs lines of: teammate:level
match_file() {
  local filepath="$1"
  for (( i=0; i < ${#OWNER_PATTERNS[@]}; i++ )); do
    if [[ "$filepath" =~ ${OWNER_REGEXES[$i]} ]]; then
      echo "${OWNER_NAMES[$i]}:${OWNER_LEVELS[$i]}"
    fi
  done
}

# ── Get changed files ───────────────────────────────────────────────────────

changed_files=()
if [[ $# -gt 0 ]]; then
  changed_files=("$@")
else
  # Try reading from stdin if not a terminal
  if [[ ! -t 0 ]]; then
    while IFS= read -r f; do
      [[ -n "$f" ]] && changed_files+=("$f")
    done
  fi

  # Fall back to git diff
  if [[ ${#changed_files[@]} -eq 0 ]]; then
    while IFS= read -r f; do
      [[ -n "$f" ]] && changed_files+=("$f")
    done < <(git diff --name-only origin/main...HEAD 2>/dev/null || git diff --name-only HEAD~1 2>/dev/null || true)
  fi
fi

if [[ ${#changed_files[@]} -eq 0 ]]; then
  echo "No changed files to check."
  exit 0
fi

# ── Classify and output ─────────────────────────────────────────────────────

total=0
primary_count=0
secondary_count=0
unowned_count=0
multi_primary_count=0

for filepath in "${changed_files[@]}"; do
  (( total++ )) || true
  owners="$(match_file "$filepath")"

  if [[ -z "$owners" ]]; then
    (( unowned_count++ )) || true
    echo "::notice file=${filepath}::⚠️ Unowned — no teammate claims this file"
    echo "  $filepath  → ⚠️ unowned"
    continue
  fi

  # Collect primary and secondary owners (deduplicated by teammate name)
  primary_owners=()
  secondary_owners=()
  declare -A seen_primary=() seen_secondary=()
  while IFS=: read -r name level; do
    if [[ "$level" == "primary" ]]; then
      if [[ -z "${seen_primary[$name]:-}" ]]; then
        primary_owners+=("$name")
        seen_primary[$name]=1
      fi
    else
      if [[ -z "${seen_secondary[$name]:-}" ]]; then
        secondary_owners+=("$name")
        seen_secondary[$name]=1
      fi
    fi
  done <<< "$owners"
  unset seen_primary seen_secondary

  # Build display string
  display=""
  for owner in "${primary_owners[@]}"; do
    display+="@${owner} (primary), "
  done
  for owner in "${secondary_owners[@]}"; do
    display+="@${owner} (secondary), "
  done
  display="${display%, }"

  echo "  $filepath  → $display"

  # Annotations for multi-primary conflicts
  if [[ ${#primary_owners[@]} -gt 1 ]]; then
    (( multi_primary_count++ )) || true
    echo "::warning file=${filepath}::Claimed by multiple primary owners: ${primary_owners[*]}"
  fi

  if [[ ${#primary_owners[@]} -gt 0 ]]; then
    (( primary_count++ )) || true
  elif [[ ${#secondary_owners[@]} -gt 0 ]]; then
    (( secondary_count++ )) || true
  fi
done

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "── Ownership Summary ──"
echo "  Total files checked:     $total"
echo "  Primary-owned:           $primary_count"
echo "  Secondary-only:          $secondary_count"
echo "  Unowned:                 $unowned_count"
echo "  Multi-primary conflicts: $multi_primary_count"

# ── GitHub Actions Step Summary ──────────────────────────────────────────────

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "## Ownership Map"
    echo ""
    echo "| File | Owner(s) |"
    echo "|------|----------|"
    for filepath in "${changed_files[@]}"; do
      owners="$(match_file "$filepath")"
      if [[ -z "$owners" ]]; then
        echo "| \`$filepath\` | ⚠️ **unowned** |"
      else
        display=""
        while IFS=: read -r name level; do
          display+="@${name} (${level}), "
        done <<< "$owners"
        display="${display%, }"
        echo "| \`$filepath\` | $display |"
      fi
    done
    echo ""
    echo "**Summary:** $total files — $primary_count primary, $secondary_count secondary-only, $unowned_count unowned, $multi_primary_count conflicts"
  } >> "$GITHUB_STEP_SUMMARY"
fi

# Multi-primary is informational (co-ownership is valid) — never block merges
exit 0
