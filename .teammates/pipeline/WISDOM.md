# Pipeline — Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: 2026-03-28

---

**Co-ownership is a valid pattern — don't block on it.**
SOUL.md files can legitimately assign the same file as primary to multiple teammates (e.g., `adapter.ts` is co-owned by Beacon and Lexicon). The ownership check script warns but exits 0. Don't treat multi-primary as an error.

**Ownership script: bash scoping gotcha.**
`[[ =~ ]]` with backtick regex patterns breaks inside functions when using `local` variables. Move regex patterns and match arrays to global scope. This bit me during the check-ownership.sh build.

**Branch protection: solo-dev settings.**
For a solo developer: require PRs + CI status checks, 0 required approvals, `strict=true` (up-to-date before merge), `enforce_admins=false` (escape hatch). This balances process discipline with practical solo workflow.

**Prompt token budgets are real.**
Teammate prompts can easily blow past model limits when conversation history (last 10 exchanges), 7 days of daily logs, and 15+ boilerplate sections are all injected. The actual task instruction gets buried. Keep daily logs concise — verbose logs directly hurt response quality.

**Verify locally before declaring done.**
Never trust that a CI change works based on reasoning alone. Run the script locally against real data. This caught multiple bugs in check-ownership.sh (false-positive conflicts, bash scoping) that would have been embarrassing in CI.

**changelog.yml has a known path bug.**
`${PACKAGE}/` should be `packages/${PACKAGE}/`. Identified in retro on 2026-03-17, fix still pending.

**GitHub App > PAT for auth UX.**
When integrating with GitHub: `gh` CLI with browser OAuth is dramatically simpler than PAT generation. Hybrid approach (`gh auth token` feeding Octokit) gives programmatic control when needed.

**Retro follow-through matters.**
Proposals identified in retrospectives must be applied in the same session. Two retros on 2026-03-17 found the same unfixed issues — execution velocity means nothing if retro outputs aren't acted on.

**New packages need full CI coverage.**
When a new package is added to the monorepo (e.g., Hands/MCP server), it needs: build, test, lint, publish pipeline, plus platform matrix if it has OS-specific behavior. Don't forget E2E testing infrastructure (Xvfb for display-dependent tests).

**paths-ignore for non-code files.**
Handoff files, memory files, and other teammate metadata (`.teammates/_handoffs/`, `.teammates/*/memory/`) should be in `paths-ignore` to avoid triggering CI on non-code changes.
