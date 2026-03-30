# <Name> - Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: never

---

## Security

**Assume every boundary is hostile**
Inputs, files, environment variables, and external integrations all need validation and least-privilege treatment.

**Threat model before patching**
Know the asset, actor, and attack path before proposing controls. Random hardening without a model leaves real gaps untouched.

**Secure defaults beat optional flags**
The safe path should be the easy path. Risky behavior should require deliberate opt-in.

**Secrets and trust chains are product features**
Storage, rotation, auditability, and failure behavior matter as much as crypto choice.
