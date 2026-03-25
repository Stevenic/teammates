# Sandbox & Isolation — Design Spec

Agent isolation in two tiers: **git worktrees** for lightweight repo-level isolation (works everywhere, zero dependencies), and **containers** for true OS-level sandboxing (untrusted agents, CI/CD, shared infra). Both are managed by a new `@teammates/sandbox` package that the CLI consumes.

**Status:** Draft
**Owner:** Beacon (implementation) → Pipeline (container deployment)
**Priority:** TBD
**Dependencies:** AI1 (Preset Capabilities Declaration)

---

## Problem

Today, every agent runs as a child process with full host access:

| Adapter | Isolation | What the agent can do |
|---|---|---|
| Claude (`-p`) | None | Read/write any file, run any command, full network |
| Codex (`exec`) | Codex's `-s` flag | Landlock sandbox (Linux only), three levels |
| Copilot SDK | `approveAll` callback | Auto-approves everything — no real gate |
| Aider | None | Full host access |

Problems this causes:

1. **Cross-teammate file collisions** — Two teammates editing the same file simultaneously. Whoever writes last wins; the other's changes are silently lost.
2. **Unscoped changes** — An agent asked to fix a bug in `packages/cli/` can also modify `packages/recall/` or `.teammates/` or anything else on disk.
3. **No rollback** — If an agent makes a bad change, the user has to manually `git checkout` or `git stash`. There's no structured undo.
4. **No review gate** — Changes land directly in the working tree. There's no "review before apply" step like a PR provides.
5. **No untrusted agent support** — Running a third-party or community agent with full host access is a non-starter for most teams.

---

## Design Principles

1. **Agent-agnostic** — Isolation works the same regardless of which agent binary is running. The sandbox wraps the agent, not the other way around.
2. **Opt-in, progressive** — Default behavior is unchanged (no isolation). Teams opt in per teammate or globally. Worktrees first, containers when needed.
3. **Zero cloud** — Both tiers run locally. No remote services, no API keys.
4. **Git-native** — Worktrees use git's own isolation primitives. Changes are branches, review is `git diff`, approval is `git merge`, rejection is branch deletion.
5. **Composable** — Worktrees and containers are independent. You can use worktrees without containers, containers without worktrees, or both (container with a worktree mount).

---

## Architecture Overview

```
@teammates/sandbox (new package)
├── worktree.ts     — git worktree lifecycle (create, diff, merge, remove)
├── container.ts    — container lifecycle (create, exec, destroy)
├── policy.ts       — sandbox policy types and validation
├── index.ts        — public API
└── types.ts        — shared types

@teammates/cli (existing — consumes sandbox)
├── adapters/
│   └── cli-proxy.ts  — wires sandbox into agent spawn
└── types.ts          — SandboxLevel extended with isolation mode
```

The sandbox package is a pure library — no CLI of its own. The CLI package imports it and wires it into the adapter layer.

---

## Tier 1: Git Worktrees — Repo-Level Isolation

### Concept

Each task runs in its own **git worktree** — a separate checkout of the repo with its own working tree and branch, sharing the same `.git` directory. The agent's `cwd` is set to the worktree path instead of the main working tree.

```
repo/                          ← main working tree (user's checkout)
  .teammates/
    .tmp/
      worktrees/
        beacon-a1b2c3/         ← worktree for beacon's current task
        scribe-d4e5f6/         ← worktree for scribe's current task
```

### What Worktrees Solve

| Problem | How worktrees address it |
|---|---|
| Cross-teammate collisions | Each teammate works in its own directory on its own branch |
| Unscoped changes | Agent can only modify files in its worktree (by convention — not enforced at OS level) |
| No rollback | `git worktree remove` + `git branch -D` — instant, clean |
| No review gate | Post-task diff shown to user; merge only on approval |
| Parallel execution | Multiple worktrees active simultaneously without interference |

### What Worktrees Don't Solve

- **Process isolation** — The agent still runs on the host. It can `cd ..` out of the worktree, read `/etc/passwd`, or make network calls. Worktrees are filesystem scoping, not security sandboxing.
- **Untracked file leakage** — Temp files, caches, and artifacts created outside git tracking live on the host filesystem.
- **Non-git state** — Databases, environment variables, Docker volumes, running services are shared across all worktrees.

### Lifecycle

```
1. CREATE
   git worktree add -b <branch> <path> HEAD
   ├── branch: <teammate>/<task-slug>-<short-id>
   └── path:   .teammates/.tmp/worktrees/<teammate>-<id>

2. EXECUTE
   spawn(agent, args, { cwd: worktreePath })
   └── agent works in isolated checkout

3. REVIEW
   git diff HEAD...<branch>         ← show changes
   git log HEAD...<branch>          ← show commits (if agent committed)
   ├── approve  → merge or cherry-pick into main working tree
   ├── reject   → discard worktree + branch
   └── defer    → keep worktree alive for later review

4. CLEANUP
   git worktree remove <path>
   git branch -D <branch>           ← only on reject/after merge
```

### API (`@teammates/sandbox/worktree.ts`)

```typescript
export interface WorktreeOptions {
  /** Repo root (where .git lives) */
  repoRoot: string;
  /** Teammate name — used in branch naming */
  teammate: string;
  /** Short task description — used in branch naming */
  taskSlug: string;
  /** Base ref to branch from (default: HEAD) */
  base?: string;
}

export interface WorktreeInfo {
  /** Absolute path to the worktree directory */
  path: string;
  /** Branch name created for this worktree */
  branch: string;
  /** Short ID for dedup and display */
  id: string;
}

export interface WorktreeDiff {
  /** Files added */
  added: string[];
  /** Files modified */
  modified: string[];
  /** Files deleted */
  deleted: string[];
  /** Full unified diff text */
  patch: string;
  /** Number of lines added/removed */
  stats: { additions: number; deletions: number };
}

/** Create a new worktree with an isolated branch */
export async function createWorktree(opts: WorktreeOptions): Promise<WorktreeInfo>;

/** Get the diff between the worktree branch and its base */
export async function diffWorktree(info: WorktreeInfo): Promise<WorktreeDiff>;

/** Merge worktree changes back into the main working tree */
export async function mergeWorktree(info: WorktreeInfo, repoRoot: string): Promise<{
  success: boolean;
  conflicts?: string[];
}>;

/** Remove worktree and optionally delete its branch */
export async function removeWorktree(info: WorktreeInfo, opts?: {
  deleteBranch?: boolean;
}): Promise<void>;

/** List all active worktrees managed by teammates */
export async function listWorktrees(repoRoot: string): Promise<WorktreeInfo[]>;

/** Clean up stale worktrees (no matching branch, older than maxAge) */
export async function pruneWorktrees(repoRoot: string, maxAgeMs?: number): Promise<string[]>;
```

### Branch Naming Convention

```
<teammate>/<task-slug>-<6-char-id>

Examples:
  beacon/fix-footer-bug-a1b2c3
  scribe/update-onboarding-docs-d4e5f6
  pipeline/ci-workflow-fix-789abc
```

- `task-slug`: first 40 chars of task text, kebab-cased, non-alphanumeric stripped
- `6-char-id`: random hex for uniqueness

### .teammates Directory Changes

```
.teammates/
  .tmp/
    worktrees/           ← NEW: worktree checkouts (gitignored)
      beacon-a1b2c3/
      scribe-d4e5f6/
```

Add to `.teammates/.gitignore`:
```
.tmp/worktrees/
```

### Integration with CLI (`cli-proxy.ts`)

```typescript
// In CliProxyAdapter.executeTask()

if (teammate.isolation === "worktree") {
  const wt = await createWorktree({
    repoRoot: this.cwd,
    teammate: teammate.name,
    taskSlug: slugify(task),
  });

  try {
    // Agent runs in the worktree
    const result = await this.spawnAgent(cmd, args, { cwd: wt.path });

    // Post-task: show diff, ask for approval
    const diff = await diffWorktree(wt);
    result.worktree = { info: wt, diff };
    return result;
  } catch (err) {
    await removeWorktree(wt, { deleteBranch: true });
    throw err;
  }
}
```

The CLI's post-task display (`displayTaskResult`) shows the diff summary and offers `[merge]` / `[reject]` actions — same UX pattern as the existing handoff approval flow.

### Configuration

Add to `TeammateConfig`:

```typescript
export type IsolationMode = "none" | "worktree" | "container";

export interface TeammateConfig {
  // ... existing fields ...
  /** Isolation mode for task execution (default: "none") */
  isolation?: IsolationMode;
}
```

Parsed from SOUL.md:
```markdown
**Isolation:** worktree
```

Or set globally in `settings.json`:
```json
{
  "version": 1,
  "defaultIsolation": "worktree"
}
```

Per-teammate overrides global.

---

## Tier 2: Containers — True OS-Level Sandboxing

### Concept

Each task runs inside a **container** (Docker/Podman) with the repo mounted as a volume. The agent binary, its dependencies, and all file/network/process access are confined to the container. Nothing escapes.

### What Containers Solve (Beyond Worktrees)

| Problem | How containers address it |
|---|---|
| Process escape | Agent can't `cd ..` out — the mount is the filesystem boundary |
| Network access | `--network none` blocks all outbound traffic |
| Resource abuse | Memory/CPU/time limits enforced by the container runtime |
| Untrusted agents | Run any agent binary without trusting it |
| Environment parity | Consistent Linux env regardless of host OS (Windows/macOS/Linux) |
| Secret leakage | Environment variables, SSH keys, credentials not mounted by default |

### Container Modes

Three modes, matching the existing `SandboxLevel` type:

| Mode | Network | Filesystem | Processes |
|---|---|---|---|
| `read-only` | None | Repo mounted read-only | Agent binary only |
| `workspace-write` | None | Repo mounted read-write, host read-only | Agent binary only |
| `danger-full-access` | Host | Full host mount | Unrestricted |

`workspace-write` is the default and recommended mode. It's equivalent to what Copilot Coding Agent provides.

### Lifecycle

```
1. BUILD/PULL IMAGE
   docker pull teammates/sandbox:latest
   └── or build from a local Dockerfile / devcontainer.json

2. CREATE CONTAINER
   docker create \
     --name teammates-<teammate>-<id> \
     --network none \
     --memory 4g \
     --cpus 2 \
     --mount type=bind,src=<repo>,dst=/workspace \
     --workdir /workspace \
     teammates/sandbox:latest

3. EXECUTE
   docker exec teammates-<teammate>-<id> <agent-cmd> <args>
   └── agent runs inside container with mounted repo

4. EXTRACT CHANGES
   docker diff teammates-<teammate>-<id>    ← filesystem changes
   └── or: use worktree mount (Tier 1 + Tier 2 composed)

5. CLEANUP
   docker rm -f teammates-<teammate>-<id>
```

### API (`@teammates/sandbox/container.ts`)

```typescript
export interface ContainerPolicy {
  /** Container image to use */
  image: string;
  /** Network mode: "none" (default), "host", or custom network name */
  network?: "none" | "host" | string;
  /** Memory limit (e.g., "4g", "512m") */
  memoryLimit?: string;
  /** CPU limit (e.g., 2 = two cores) */
  cpuLimit?: number;
  /** Task timeout in milliseconds */
  timeout?: number;
  /** Additional bind mounts (read-only by default) */
  mounts?: Array<{
    src: string;
    dst: string;
    readonly?: boolean;
  }>;
  /** Environment variables to inject */
  env?: Record<string, string>;
  /** Sandbox level controlling default mount permissions */
  sandboxLevel?: SandboxLevel;
}

export interface ContainerInfo {
  /** Container ID */
  id: string;
  /** Container name */
  name: string;
  /** Status: created, running, exited */
  status: "created" | "running" | "exited";
}

export interface ContainerExecResult {
  /** Exit code */
  exitCode: number;
  /** Stdout content */
  stdout: string;
  /** Stderr content */
  stderr: string;
  /** Files changed inside the container */
  changedFiles: string[];
}

/** Create a container with the given policy */
export async function createContainer(
  policy: ContainerPolicy,
  teammate: string,
  repoRoot: string,
): Promise<ContainerInfo>;

/** Execute a command inside the container */
export async function execInContainer(
  container: ContainerInfo,
  cmd: string,
  args: string[],
): Promise<ContainerExecResult>;

/** Extract changed files from the container */
export async function extractChanges(
  container: ContainerInfo,
  repoRoot: string,
): Promise<WorktreeDiff>;

/** Destroy the container */
export async function destroyContainer(container: ContainerInfo): Promise<void>;

/** Check if Docker/Podman is available */
export async function detectRuntime(): Promise<"docker" | "podman" | null>;
```

### Composing Worktrees + Containers

The most powerful configuration: worktree mounted inside a container. You get git-native change tracking AND OS-level isolation.

```
docker create \
  --mount type=bind,src=<worktree-path>,dst=/workspace \
  --network none \
  teammates/sandbox:latest
```

Flow:
1. Create worktree (Tier 1)
2. Create container with worktree as mount (Tier 2)
3. Agent runs inside container, changes land in worktree
4. Destroy container
5. Review worktree diff, merge or reject (Tier 1)
6. Remove worktree

This is the recommended configuration for untrusted agents.

### Base Image

The `teammates/sandbox` image is a minimal Node.js environment with common agent binaries:

```dockerfile
FROM node:20-slim

# Agent binaries (optional — can be mounted or installed per-teammate)
# Users extend this image or use devcontainer.json for custom setups

WORKDIR /workspace
```

Teams can customize by:
- Extending the base image with their own Dockerfile
- Using a `devcontainer.json` (VS Code / GitHub Codespaces compatible)
- Mounting agent binaries from the host via bind mounts

### Configuration

```typescript
export interface TeammateConfig {
  // ... existing fields ...
  isolation?: IsolationMode;
  /** Container policy (only used when isolation === "container") */
  containerPolicy?: ContainerPolicy;
}
```

Parsed from SOUL.md:
```markdown
**Isolation:** container
**Container Image:** teammates/sandbox:latest
**Network:** none
**Memory Limit:** 4g
```

Or in `settings.json`:
```json
{
  "version": 1,
  "defaultIsolation": "container",
  "containerPolicy": {
    "image": "teammates/sandbox:latest",
    "network": "none",
    "memoryLimit": "4g",
    "cpuLimit": 2
  }
}
```

---

## Sandbox Policy System (`@teammates/sandbox/policy.ts`)

A unified policy type that covers both tiers:

```typescript
export interface SandboxPolicy {
  /** Isolation tier */
  isolation: IsolationMode;

  /** Worktree options (Tier 1) */
  worktree?: {
    /** Base ref (default: HEAD) */
    base?: string;
    /** Auto-merge on success (skip review gate) */
    autoMerge?: boolean;
    /** Keep worktree alive after task for manual inspection */
    persist?: boolean;
  };

  /** Container options (Tier 2) */
  container?: ContainerPolicy;

  /** Paths the agent is allowed to modify (glob patterns) */
  allowedPaths?: string[];

  /** Paths the agent must not read (glob patterns) — e.g., .env, credentials */
  deniedPaths?: string[];

  /** Maximum number of files the agent can create */
  maxNewFiles?: number;

  /** Maximum total bytes the agent can write */
  maxWriteBytes?: number;
}
```

The `allowedPaths` and `deniedPaths` fields are **advisory for worktrees** (checked post-task, violations flagged in review) and **enforced for containers** (paths outside allowed patterns are mounted read-only or not mounted at all).

---

## CLI Integration

### New Commands

| Command | Description |
|---|---|
| `/worktree` | List active worktrees, their status, and diffs |
| `/worktree merge <id>` | Merge a worktree's changes into the main working tree |
| `/worktree reject <id>` | Delete a worktree and its branch |
| `/worktree diff <id>` | Show the full diff for a worktree |

### Post-Task Review Flow

When a task completes with worktree isolation:

```
✔  beacon... fix footer alignment (42s)

  3 files changed (+28 −12)
  M packages/cli/src/cli.ts
  M packages/cli/src/banner.ts
  A packages/cli/src/cli-utils.ts

  [merge]  [reject]  [diff]
```

Clicking `[merge]` runs `mergeWorktree()`. Clicking `[reject]` runs `removeWorktree({ deleteBranch: true })`. Clicking `[diff]` shows the full patch in the feed.

### Startup Maintenance

On startup, `pruneWorktrees()` cleans up:
- Worktrees whose branches no longer exist (merged or deleted externally)
- Worktrees older than 24 hours with no changes
- Orphaned directories in `.teammates/.tmp/worktrees/`

Same pattern as the existing debug log cleanup.

---

## Package Structure: `@teammates/sandbox`

```
packages/sandbox/
├── src/
│   ├── index.ts          — public API exports
│   ├── types.ts          — SandboxPolicy, IsolationMode, etc.
│   ├── worktree.ts       — git worktree lifecycle
│   ├── container.ts      — container lifecycle
│   ├── policy.ts         — policy resolution and validation
│   ├── git.ts            — git command helpers (shared by worktree.ts)
│   ├── worktree.test.ts  — worktree unit tests
│   ├── container.test.ts — container unit tests
│   └── policy.test.ts    — policy validation tests
├── package.json
├── tsconfig.json
└── README.md
```

Dependencies:
- **None** for Tier 1 (worktrees use `child_process.execSync` for git commands)
- **Optional** Docker/Podman CLI for Tier 2 (detected at runtime via `detectRuntime()`)

The package has zero npm dependencies — all operations shell out to `git` or `docker`/`podman`.

---

## Migration Path

### Phase 1 — Worktrees Only (~300 LOC)

1. Create `packages/sandbox/` with `worktree.ts`, `types.ts`, `policy.ts`, `index.ts`
2. Add `isolation?: IsolationMode` to `TeammateConfig` in CLI types
3. Wire `createWorktree` / `diffWorktree` / `mergeWorktree` into `cli-proxy.ts`
4. Add post-task review flow (`[merge]`/`[reject]`/`[diff]` actions) to `displayTaskResult`
5. Add `/worktree` command to CLI
6. Add startup pruning to `startupMaintenance()`

### Phase 2 — Containers (~500 LOC)

1. Add `container.ts` to sandbox package
2. Add `containerPolicy` to `TeammateConfig`
3. Wire container lifecycle into adapter layer
4. Add `detectRuntime()` check to `/configure` service detection
5. Publish base image (`teammates/sandbox`) to Docker Hub / GitHub Container Registry
6. Add `/sandbox` or `/configure sandbox` command for interactive setup

### Phase 3 — Compose + Polish (~200 LOC)

1. Worktree-inside-container composition
2. `allowedPaths` / `deniedPaths` enforcement
3. Resource limit monitoring and reporting
4. Auto-merge option for trusted teammates
5. CI/CD integration (worktree branches trigger checks before merge)

---

## Open Questions

1. **Worktree branch cleanup timing** — Delete branch immediately after merge, or keep for N days as an audit trail?
2. **Container image management** — Ship a base image, or let users bring their own? Both?
3. **Agent binary availability** — How do agent binaries get into the container? Host mount, baked into image, or installed at container creation?
4. **`@teammates/sandbox` vs inline in CLI** — Is a separate package warranted, or should this live in `packages/cli/src/sandbox/`? A separate package is cleaner for testing and reuse, but adds monorepo surface area.
5. **Merge conflict resolution** — When `mergeWorktree` hits conflicts, show them in the feed and let the user resolve? Or abort and keep the worktree alive?
6. **devcontainer.json support** — Should we detect and use existing devcontainer configs for container setup? This would give teams a familiar configuration surface.
