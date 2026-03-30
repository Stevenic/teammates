---
version: 0.7.2
name: Agent Tabs Active Target Routing
description: The shell uses a left-side TEAM plus per-agent tab model, and the single bottom composer always routes to the active tab.
type: decision
---

# Agent Tabs Active Target Routing

## Decision

The shell UX uses a left-side tab rail with `TEAM` first and one tab per agent after it. The main content area shows activity for the selected tab only. There is one shared composer at the bottom, and submitted input always routes to the active tab.

## Why

- Makes the message target explicit at all times
- Keeps the interaction model simple: one selection, one visible activity surface, one composer
- Preserves a team-wide aggregate view without mixing all agent activity into every screen
- Avoids ambiguous routing from the shared input box

## Apply This

- Treat `activeTabId` as the shell-owned routing selector
- Require explicit target ids in shell-to-engine input commands
- Show background activity on inactive tabs via badges or status, not forced focus changes
- Fall back to `TEAM` if the active tab becomes invalid
