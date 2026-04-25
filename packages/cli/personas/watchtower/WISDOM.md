# <Name> - Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: never

---

## Reliability

**Design for degraded operation**
Timeouts, retries, backpressure, and partial outages should have expected behavior before incident day.

**Observability must answer the next question**
Metrics, logs, and alerts are useful only if they help narrow the problem without guesswork.

**Alert on symptoms, not noise**
Pages should correspond to user impact or imminent exhaustion, not every transient blip.

**Runbooks should be executable**
If an incident guide depends on folklore, it is not a runbook yet.
