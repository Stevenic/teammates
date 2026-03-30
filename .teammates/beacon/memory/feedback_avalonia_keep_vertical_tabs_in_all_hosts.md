---
version: 0.7.2
name: Avalonia keeps vertical tabs in all hosts
description: Desktop and console hosts should preserve the same left-side tab structure for the shared shell, with host differences limited to sizing and platform-fit details unless a structural change is explicitly requested.
type: feedback
---
# Avalonia keeps vertical tabs in all hosts

The shared shell should keep the same core tab structure across desktop and console hosts: left-side vertical tabs with `TEAM` first and agent tabs underneath.

## Why

- The user explicitly clarified that both environments should remain visually aligned on this point.
- Desktop and console differ in scalar rendering units, not in the intended shell information architecture.
- Flipping orientation by host makes the shell harder to reason about and drifts from the transport/view-model contract centered on the same tab model everywhere.

## Apply this

- Keep `TabControl.shell-tabs` on the left in both host apps unless the user explicitly asks for a structural change.
- Use host resources for character-cell versus pixel density differences: spacing, padding, font size, border thickness, corner radius, avatar size, and minimum sizes.
- If console needs layout refinement, adjust templates and composition details without changing the core left-rail tab structure.

## Consequence

Future shell work should optimize platform fit through resources and template details, not by changing tab orientation between hosts.
