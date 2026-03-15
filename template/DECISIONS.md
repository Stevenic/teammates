# Decision Log

<!-- template-version: 2 -->

Lightweight record of architectural and process decisions. When someone asks "why did we do X?" — the answer is here.

**Format:** One entry per decision, numbered sequentially. Reverse chronological (newest first).

**When to record:** Any choice that affects multiple teammates, changes a convention, picks a tool, or constrains future work. If you'd want to explain it to someone joining next month, write it down.

**Who records:** Any teammate can add a decision. The teammate who led the discussion writes the entry.

---

<!-- Add new decisions above this line, newest first -->

## Template

```markdown
## DDDD — <Title>

**Date:** YYYY-MM-DD
**Decided by:** <teammates and/or humans involved>
**Status:** accepted | superseded by DDDD | deprecated

### Context
<1-3 sentences: why did this decision come up? What problem or question triggered it?>

### Decision
<What was decided. Be specific — name the choice, not just the category.>

### Alternatives considered
- <Option A> — <why it was rejected>
- <Option B> — <why it was rejected>
```

### Status values

| Status | Meaning |
|---|---|
| `accepted` | Active and in effect |
| `superseded by DDDD` | Replaced by a newer decision (link to it) |
| `deprecated` | No longer relevant, kept for history |

### Tips

- Keep entries short. The decision log is a reference, not a narrative.
- Link to relevant files, PRs, or docs when helpful.
- Don't record implementation details — those belong in code and commit messages.
- If a decision is reversed, don't delete the old entry. Update its status and add the new decision.
