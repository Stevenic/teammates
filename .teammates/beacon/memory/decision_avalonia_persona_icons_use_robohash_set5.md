---
version: 0.7.2
name: Avalonia persona icons use RoboHash set5
description: Use RoboHash human-style avatars derived from the agent name for shell persona icons
type: decision
---

# Avalonia persona icons use RoboHash set5

## Decision

For the Avalonia shell, derive each tab's avatar from `https://robohash.org/<seed>.png?set=set5&size=96x96`, where the seed is the agent name (or the tab target name for non-agent tabs).

## Why

- The user explicitly requested RoboHash-based persona icons keyed by agent name.
- RoboHash `set5` provides human-style "avataaars", which matches a persona/avatar presentation better than the default robot sets.
- Deriving the URL locally from existing tab identity keeps the shell bridge contract unchanged and deterministic.

## Implementation guidance

- Prefer the stable target identifier (`agent:<name>`) as the seed source, falling back to display name trimming when needed.
- URL-encode the seed before building the RoboHash URI.
- Bind the resulting URI directly in the Avalonia shell templates for tab headers and the active tab summary/composer area.

## Consequence

The shell now has zero-maintenance persona icons, but it also depends on RoboHash being reachable at runtime unless a future local avatar provider is introduced.
