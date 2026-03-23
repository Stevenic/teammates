# Section Tag Conversion Spec

**Author:** Lexicon
**Date:** 2026-03-22
**Diagnostic:** Distance problem + compression problem — markdown headers provide no structural signal to the model, and instructions can't reference data sections by name.

## Problem

`buildTeammatePrompt()` in `adapter.ts` uses markdown `##` headers as section delimiters. These are human-readable but provide no structural signal to the model. Instructions that refer to data sections (e.g., "teammates listed in 'Your Team' above") use fuzzy string references instead of direct token links.

## Solution

Replace all `##` headers with open-only `<SECTION>` tags. No closing tags — the next open tag implicitly ends the previous section.

## Tag Mapping

| Current Header | Tag | Notes |
|---|---|---|
| `# You are ${name}` | `<IDENTITY>` | Keep `# You are` line as content inside |
| `## Your Wisdom` | `<WISDOM>` | |
| `## Recent Daily Logs` | `<DAILY_LOGS>` | |
| `## Relevant Memories` | `<RECALL_RESULTS>` | |
| `## Your Team` | `<TEAM>` | |
| `## Available Services` | `<SERVICES>` | |
| `## Recall — Memory Search Tool` | `<RECALL_TOOL>` | |
| `## Handoff Context` | `<HANDOFF_CONTEXT>` | |
| Date/time block | `<ENVIRONMENT>` | |
| `## User Profile` | `<USER_PROFILE>` | |
| `## Task` | `<TASK>` | |
| Output Protocol + Handoffs + Session State + Memory Updates | `<INSTRUCTIONS>` | Merge all instruction sections into one |

## Rules

1. **Open-only tags** — no closing tags. Each open tag implicitly closes the previous section.
2. **Remove `---` separators** — tags replace them.
3. **Instructions reference tags** — Any instruction that refers to a data section uses the exact tag name (e.g., "teammates listed in `<TEAM>`").
4. **Single `<INSTRUCTIONS>` block** — All behavioral instructions (output protocol, handoffs, session state, memory updates) merge into one section at the bottom (high-attention edge).

## Interaction with Reorder Spec

This spec should be implemented simultaneously with the reorder spec (`adapter-reorder-spec.md`). The final section order after both changes:

```
<IDENTITY>       — top edge (high attention)
<WISDOM>
<TEAM>           — reference data (middle)
<SERVICES>
<RECALL_TOOL>
<ENVIRONMENT>
<DAILY_LOGS>     — session context
<USER_PROFILE>
<RECALL_RESULTS> — adjacent to task
<HANDOFF_CONTEXT>
<TASK>           — the question
<INSTRUCTIONS>   — bottom edge (high attention)
```
