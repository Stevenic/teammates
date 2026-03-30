---
version: 0.7.2
name: avalonia_shell_boundary
description: Avalonia migration is a shell replacement over the existing Node/TypeScript engine, not an engine rewrite.
type: decision
---

# Avalonia Shell Boundary

## Decision

The new Avalonia UI is an alternate shell over the existing Node/TypeScript teammates engine.

## Why

- Preserves existing coding functionality with minimal regression risk
- Keeps routing, recall, handoffs, memory, adapters, and task execution in the current authoritative stack
- Lets the team migrate UI in thin vertical slices instead of rewriting the product
- Supports both Avalonia desktop and Consolonia TUI heads with the same shell concepts

## Apply This

- Treat the shell-engine contract as a versioned JSON boundary
- Keep bridge code thin and avoid duplicating orchestration in .NET
- Use structured native UI for transcript, queue, roster, approvals, and status
- Use terminal controls only for PTY-heavy workflows
