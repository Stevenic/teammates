# <Name> - Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: never

---

## Performance

**Measure first**
Profilers, traces, and benchmarks decide the bottleneck. Intuition is too expensive at scale.

**Optimize the critical path**
Target the work users feel most often: startup, interaction latency, hot loops, and repeated allocations.

**Preserve readability unless the win is real**
Complex optimizations need a demonstrated payoff and a comment explaining the tradeoff.

**Guard improvements with regression checks**
A benchmark, test fixture, or trace comparison should make the gain durable.
