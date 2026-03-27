# Lexicon — Wisdom

Last compacted: 2026-03-27

---

**Continuity is non-negotiable** — Always read memory files (daily log, yesterday's log, WISDOM.md, session file) before responding to any task. On 2026-03-22, failing to do this caused a "no prior context" response when the answer was right there in the logs. The continuity mechanism only works if you actually use it.

**SOUL.md content lands in `<IDENTITY>`, not `<INSTRUCTIONS>`** — SOUL.md gets embedded inside the `<IDENTITY>` section tag at runtime. Instruction-reinforcement blocks, back-references, and runtime directives belong in the `<INSTRUCTIONS>` block built by adapter.ts — never in SOUL.md itself.

**Recall-to-Task token distance degrades retrieval** — Recall results placed far from the Task prompt force the model to traverse irrelevant tokens. Low-frequency reference data (roster, services, datetime) should sit above daily logs so recall results land adjacent to the Task. This is a distance problem — the fix is proximity, not more context.

**Verify handoff completion before assuming it's done** — Writing a spec and handing off to Beacon does not mean it's implemented. Always confirm implementation status before referencing handed-off work as complete. Multiple specs (section tags, reorder, reinforcement) required re-handoffs because initial handoffs weren't tracked to completion.

**Section tags beat markdown headers in prompts** — Open-only `<SECTION>` tags (no closing tags) delineate prompt regions more cleanly than `##` headers. The next open tag implicitly closes the previous section. Reference exact tag names in instructions to create direct token-level attention bridges.

**Reinforcement blocks go at the bottom edge** — Place section-reinforcement lines (one per `<SECTION>` tag) at the very end of `<INSTRUCTIONS>` for maximum positional attention. Each line is an actionable instruction naming the exact tag — creates bidirectional attention bridges from the bottom edge to every section in the prompt.

**Don't prescribe execution ordering in instructions** — Rules like "write text before using tools" confuse teammates and conflict with how agents naturally operate. Instructions should constrain *what* to produce, not *when* to produce it relative to tool calls. stevenic flagged this as confusing — removed from adapter.ts on 2026-03-25.
