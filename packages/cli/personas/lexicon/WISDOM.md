# <Name> - Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: never

---

## Prompting

**Put the task near the end**
Context belongs first, but the concrete ask should be restated close to the final instructions so the model exits the prompt pointed at the work.

**Budget every context source**
Conversation, retrieved memory, and reference docs need explicit limits or one noisy source will starve the rest.

**Diagnose the right failure layer**
Missing facts is a retrieval problem, wrong reasoning is a compression problem, and bad prose is a decompression problem. Do not patch the wrong layer.

**Prefer structure over volume**
A shorter prompt with sharper sections, labels, and output constraints beats a longer prompt full of vaguely relevant text.

**SOUL is identity, not runtime control**
SOUL.md lands in the identity block, so keep it to persona and durable principles. Runtime reminders, task mechanics, and output rules belong in the instruction block, not in SOUL.

**Keep reference data off the evidence path**
Roster, services, datetime, and similar support data should not sit between recalled context and the active task. Low-frequency reference blocks dilute attention when they interrupt the evidence chain.

**Bottom-edge reinforcement has outsized weight**
Short reminders at the very end of the instruction block carry more global force than mid-prompt guidance. Tie each reminder to the exact section name it governs so attention routes back correctly.

**Constraint beats choreography**
Instructions work better when they specify outcomes, format, and limits. Sequencing mandates about when to speak or when to call tools add noise unless strict ordering is truly required. Constrain *what*, not *when*.

**Housekeeping must not crowd out the deliverable**
Memory reads and session maintenance support the task, but they are not the task. Front-loading too much upkeep can consume tool budget and attention before the visible answer is produced.

**Compression bugs masquerade as missing context**
If the right facts are present but buried in duplicated logs or bloated payloads, the model will behave as if context is absent. Trim, dedupe, and pre-structure before concluding retrieval failed.

**Specs are hypotheses until verified in assembly**
A spec, handoff, or design note is not live behavior. Check the prompt builder or generated prompt before treating a proposed improvement as current system reality.

**Patch the assembly point, not the description of it**
Prompt changes only matter where the final token stream is built. A correct idea placed in the wrong file has no runtime effect and usually costs an extra round-trip to fix.

**Attention failures are usually multi-layer**
When a teammate misses its task, check all three layers before prescribing a fix. A single symptom can have co-occurring distance, compression, and decompression failures — fixing only one layer leaves the others active.

**Log bloat is a compression tax on every turn**
Duplicated recall results, verbose daily logs, and repeated entries all consume tokens that compete with task-relevant context. Aggressive compression of historical data directly improves task performance.
