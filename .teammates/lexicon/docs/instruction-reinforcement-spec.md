# Instruction Reinforcement Spec

**Author:** Lexicon
**Date:** 2026-03-22
**Diagnostic:** Distance problem — section tags define prompt regions, but without back-references in `<INSTRUCTIONS>`, the model has no token-level link from the high-attention bottom edge back to each section. Instructions that implicitly rely on data in earlier sections must explicitly name those sections to close the attention loop.

## Problem

The `<INSTRUCTIONS>` block at the bottom of the prompt (high-attention edge) currently references only `<TEAM>` (in the handoffs subsection). Every other section tag — `<IDENTITY>`, `<WISDOM>`, `<SERVICES>`, `<RECALL_TOOL>`, `<ENVIRONMENT>`, `<DAILY_LOGS>`, `<USER_PROFILE>`, `<RECALL_RESULTS>`, `<HANDOFF_CONTEXT>`, `<TASK>` — has no back-reference from `<INSTRUCTIONS>`.

This means the model's attention from the bottom edge doesn't get reinforced back to those sections. The section tags at the top/middle define regions, but without a matching token at the bottom, the attention path is one-way.

## Solution

Add a `### Section Reinforcement` subsection at the **very end** of `<INSTRUCTIONS>` (last content before the prompt ends — maximum positional attention). Each line is a concise, actionable instruction that names the exact section tag.

## Reinforcement Lines

```
### Section Reinforcement

- Stay in character as defined in `<IDENTITY>` — never break persona or speak as a generic assistant.
- Apply lessons from `<WISDOM>` before proposing solutions — do not repeat past mistakes.
- Only hand off to teammates listed in `<TEAM>` using the handoff block format above.
- Use tools and services from `<SERVICES>` when they fit the task — do not reinvent what is already available.
- If pre-loaded context is insufficient, use `<RECALL_TOOL>` to search for additional memories before giving up.
- Respect platform, date, and path conventions from `<ENVIRONMENT>`.
- Check `<DAILY_LOGS>` for prior work on this topic before starting — avoid duplicating what was already done today.
- Honor the user's role, preferences, and communication style from `<USER_PROFILE>`.
- Incorporate relevant context from `<RECALL_RESULTS>` into your response — these memories were retrieved for a reason.
- When `<HANDOFF_CONTEXT>` is present, address its requirements and open questions directly.
- Your response must answer `<TASK>` — everything else is supporting context.
```

## Design Rationale

1. **Token-level back-links** — Each line contains the literal `<TAG>` string. When the model processes `<INSTRUCTIONS>`, the repeated tag token activates the same attention head that encoded the original section, creating a bidirectional attention bridge.

2. **Actionable, not decorative** — Each line is a real instruction, not a placeholder. "Check `<DAILY_LOGS>` for prior work" is something the model should actually do. This makes the reinforcement functional, not just structural.

3. **Last position = strongest** — Placed at the very end of the prompt. Positional attention is strongest at the edges. The reinforcement block is the last thing the model sees before generating, so every back-reference fires at peak attention.

4. **Conditional sections** — `<SERVICES>`, `<HANDOFF_CONTEXT>`, `<RECALL_RESULTS>` are only present when data exists. The reinforcement lines for absent sections are harmless — the model simply has nothing to reference. However, for maximum cleanliness, the implementation MAY conditionally include only lines for sections that are present in the current prompt. This is optional — the unconditional approach is simpler and the attention cost of referencing absent sections is negligible.

## Implementation

In `adapter.ts`, append the reinforcement block after the Memory Updates REMINDER line, as the final content in the `instrLines` array. This is a ~12-line addition.

Handoff to **@beacon** for implementation.
