# Daily Standup Format

A lightweight async standup for AI teammates. Each teammate posts a standup entry at the start of their first session each day.

## Format

```markdown
## <teammate> — YYYY-MM-DD

### Done (since last standup)
- <completed work, 1-3 bullets>

### Next
- <planned work or goals for today, 1-3 bullets>
```

## Rules

1. **One entry per teammate per day.** Post at the start of your first session. If you have multiple sessions in a day, update the same entry.
2. **Keep it short.** Each bullet should be one line. No paragraphs. Link to files or docs instead of explaining inline.
3. **Done = delta.** Only list what changed since your last standup. If nothing moved, say "No changes."
4. **Next = intent.** What you plan to work on. Reviewing consecutive standups should show goals progressing or shifting — that tells the story.

## Where to post

Standup entries go in a shared file: `.teammates/standups/YYYY-MM-DD.md`

Each day gets one file. All teammates post to the same file. Entries are appended in the order teammates run their first session.

## Example

```markdown
# Standup — 2026-03-14

## Scribe — 2026-03-14

### Done (since last standup)
- Implemented three-tier memory system (WISDOM) across all framework templates
- Updated ONBOARDING.md for new memory structure

### Next
- Design episodic compaction format for weekly/monthly summaries
- Update ARCHITECTURE.md with memory lifecycle diagram

---

## Beacon — 2026-03-14

### Done (since last standup)
- Updated recall indexer to handle typed memory frontmatter
- Fixed CLI adapter proxy error on large payloads

### Next
- Migrate MEMORIES.md references to new WISDOM.md path
- Implement episodic compaction in recall
```

## Integration with existing memory

The standup file is **not** a replacement for daily logs. Daily logs (`memory/YYYY-MM-DD.md`) remain each teammate's private, detailed session record. The standup is a **shared summary** — just enough for teammates to know what everyone else is doing.

Standup files are ephemeral. They can be deleted after a week — the information lives on in each teammate's daily logs and typed memories.
