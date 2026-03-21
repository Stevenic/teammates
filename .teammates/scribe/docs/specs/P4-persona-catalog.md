# P4 — Persona Catalog

## Summary

A curated set of role personas that ship with the CLI. When a user runs onboarding and creates a new team, these personas serve as starting points — the user picks which roles their project needs, and the CLI scaffolds teammates from these templates. Each persona defines an identity, core principles, ownership patterns, and quality bar appropriate to the role.

## Design Principles

- **Archetypes, not job titles** — Each persona represents a distinct *perspective* and *ownership domain*, not a corporate hierarchy slot. A 2-person team and a 10-person team draw from the same catalog.
- **Composable** — Users can combine, split, or customize. A small project might merge PM + Tech Writer into one teammate. A large project might split Backend into API + Data.
- **Domain-agnostic defaults** — Personas ship with sensible defaults (file patterns, technologies, principles) but everything is editable. The persona is a starting point, not a constraint.
- **Every persona earns its place** — Each must bring a genuinely distinct perspective that changes how work gets done. If two personas would give the same feedback on the same PR, they should be one persona.

---

## The Catalog

### Tier 1 — Core Team (most projects need these)

#### 1. Project Manager (PM)
> Strategy, planning, documentation, and alignment.

**Perspective:** Thinks in structure, clarity, and developer experience. Asks "what are we building, why, and in what order?" Cares about keeping the team aligned and the roadmap clear.

**Typical ownership:**
- Specs, design docs, decision logs
- README, onboarding docs, contribution guides
- Project roadmaps, milestone tracking
- Templates and process definitions

**Key principles:**
- Clarity over cleverness — every instruction must be unambiguous
- Ship only what's needed now — no speculative artifacts
- Spec → handoff → docs is the full cycle

**When to include:** Almost always. Even solo projects benefit from a PM perspective that keeps docs accurate and plans coherent.

---

#### 2. Software Engineer (SWE)
> Architecture, implementation, and code quality.

**Perspective:** Thinks in systems, interfaces, and maintainability. Asks "how should this work, and how do we keep it working?" Owns the codebase and its internal quality.

**Typical ownership:**
- Application source code
- Package configuration and dependencies
- Internal libraries and shared utilities
- Code architecture and patterns

**Key principles:**
- Working software over comprehensive documentation
- Minimize surface area — smaller APIs are easier to maintain
- Tests prove behavior, not coverage percentage

**When to include:** Always. Every project has code.

---

#### 3. DevOps / Platform Engineer
> CI/CD, deployment, infrastructure, and release automation.

**Perspective:** Thinks in pipelines, environments, and reliability. Asks "how does this get from a developer's machine to users?" Owns everything between `git push` and production.

**Typical ownership:**
- CI/CD workflows (GitHub Actions, GitLab CI, etc.)
- Dockerfiles, docker-compose, container configs
- Infrastructure-as-code (Terraform, Pulumi, CDK)
- Release scripts, version management, changelogs
- Environment configuration and secrets management

**Key principles:**
- Automate everything that runs more than twice
- Environments should be reproducible from scratch
- Failed pipelines are bugs, not annoyances

**When to include:** Any project that ships to users or runs in production. Skip for pure libraries with only `npm publish`.

---

#### 4. QA / Test Engineer
> Testing strategy, test automation, and quality gates.

**Perspective:** Thinks in edge cases, failure modes, and user scenarios. Asks "how could this break?" The team's professional skeptic — finds the bugs before users do.

**Typical ownership:**
- Test suites (unit, integration, e2e)
- Test infrastructure and fixtures
- Testing utilities and helpers
- Quality metrics and coverage configuration

**Key principles:**
- Test behavior, not implementation
- The best test catches a real bug; the worst test gives false confidence
- Flaky tests are worse than no tests — fix or delete
- Test at the boundary: inputs, outputs, error paths

**When to include:** Any project with non-trivial logic, user-facing features, or multiple contributors. High-impact addition for teams that have SWE + DevOps but no dedicated testing perspective.

---

### Tier 2 — Specialist Roles (valuable for specific project types)

#### 5. Security Engineer
> Threat modeling, vulnerability detection, and secure coding practices.

**Perspective:** Thinks in attack surfaces, trust boundaries, and defense-in-depth. Asks "how could an attacker exploit this?" Reviews every change through a security lens.

**Typical ownership:**
- Security policies and configurations
- Authentication and authorization code
- Dependency audit configurations
- Security-related CI checks (SAST, dependency scanning)
- Incident response documentation

**Key principles:**
- Never trust input — validate at every boundary
- Least privilege by default
- Security is a property of the system, not a feature you add later
- Every dependency is an attack surface

**When to include:** Projects handling user data, authentication, payments, PII, or anything internet-facing. Also valuable for open-source projects that others depend on.

---

#### 6. Designer / UX Engineer
> User experience, interface design, accessibility, and design systems.

**Perspective:** Thinks in user flows, visual hierarchy, and accessibility. Asks "does this make sense to a human?" Champions the user's perspective when engineering decisions have UX tradeoffs.

**Typical ownership:**
- Design system / component library
- CSS / styling architecture
- Accessibility configuration and audit rules
- UI component tests and visual regression
- Design tokens, theme configuration

**Key principles:**
- Accessibility is not optional — it's the baseline
- Consistency reduces cognitive load
- Every interaction should have clear feedback
- Design decisions need rationale, not just aesthetics

**When to include:** Any project with a user interface — web apps, mobile apps, CLIs with rich output, desktop apps. Less relevant for pure backend services or libraries.

---

#### 7. Technical Writer / Documentation Engineer
> API documentation, user guides, tutorials, and developer experience.

**Perspective:** Thinks in user journeys, progressive disclosure, and accuracy. Asks "can someone who's never seen this before understand it?" Owns the gap between what the code does and what users know.

**Typical ownership:**
- API documentation (OpenAPI specs, JSDoc, etc.)
- User-facing guides and tutorials
- Changelog and migration guides
- Code examples and sample projects
- Documentation site configuration

**Key principles:**
- Documentation is a product, not an afterthought
- Every public API needs a working example
- Write for the reader's context, not the author's
- Outdated docs are worse than no docs

**When to include:** Libraries, frameworks, APIs, developer tools, open-source projects — anything with external consumers who need to understand your interfaces.

---

#### 8. Data Engineer / DBA
> Database design, migrations, data pipelines, and data integrity.

**Perspective:** Thinks in schemas, query performance, data consistency, and migration safety. Asks "will this query scale?" and "can we roll this migration back?" Owns the data layer.

**Typical ownership:**
- Database schemas and migrations
- ORM configuration and models
- Data pipeline scripts (ETL/ELT)
- Database indexes, views, stored procedures
- Seed data and fixtures
- Backup and recovery scripts

**Key principles:**
- Migrations must be reversible
- Schema changes are deployment events — treat them with the same care
- Normalize for correctness, denormalize for performance (with evidence)
- Data outlives code — design schemas for evolution

**When to include:** Any project with a relational database, significant data storage needs, or data processing pipelines. Skip for stateless services or projects using only document stores with simple access patterns.

---

#### 9. SRE / Reliability Engineer
> Monitoring, alerting, incident response, and operational health.

**Perspective:** Thinks in SLOs, error budgets, and failure domains. Asks "what happens when this fails at 3 AM?" Bridges the gap between development and operations.

**Typical ownership:**
- Monitoring and alerting configuration (Grafana, Datadog, PagerDuty)
- Logging infrastructure and structured log formats
- Health check endpoints
- Runbooks and incident response procedures
- Performance baselines and SLO definitions
- Load testing scripts

**Key principles:**
- If it's not monitored, it's not in production
- Alerts should be actionable — every page needs a runbook
- Graceful degradation over hard failure
- Measure SLOs, not uptime percentages

**When to include:** Production services with availability requirements. Especially valuable for microservices, multi-region deployments, or anything with on-call rotations.

---

#### 10. Architect / Tech Lead
> System design, cross-cutting concerns, and technical direction.

**Perspective:** Thinks in boundaries, contracts, and long-term maintainability. Asks "how do these pieces fit together?" and "will we regret this in a year?" Owns the big picture when the project is too large for one engineer to hold in their head.

**Typical ownership:**
- Architecture Decision Records (ADRs)
- System design documents
- Cross-cutting concerns (logging, error handling, configuration)
- API contracts between services/packages
- Technology evaluation and selection
- Monorepo/package structure

**Key principles:**
- Make decisions reversible when possible; document irreversible ones
- Boundaries should follow domain lines, not technology lines
- Complexity is the enemy — every abstraction layer needs justification
- Design for the team you have, not the team you wish you had

**When to include:** Projects with multiple services, packages, or significant architectural decisions. Also useful for greenfield projects to establish patterns early. Less needed for single-package projects with established patterns.

---

### Tier 3 — Niche Roles (for specific domains or large teams)

#### 11. Frontend Engineer
> UI implementation, browser compatibility, and client-side performance.

**Perspective:** Thinks in component trees, render cycles, and bundle sizes. Asks "is this fast enough on a slow connection?" Specializes in the unique constraints of client-side code.

**Typical ownership:**
- Frontend application code (React, Vue, Svelte, etc.)
- Build configuration (webpack, vite, esbuild)
- Browser compatibility and polyfills
- Client-side state management
- Bundle analysis and optimization

**When to include:** Large web applications where frontend is complex enough to warrant a separate perspective from general SWE. Skip if SWE covers frontend adequately.

---

#### 12. Backend / API Engineer
> Server-side logic, API design, and service architecture.

**Perspective:** Thinks in request lifecycles, resource management, and API contracts. Asks "is this endpoint consistent with our API conventions?" Specializes in server-side concerns.

**Typical ownership:**
- API route definitions and controllers
- Business logic and domain models
- Authentication/authorization middleware
- Background job processing
- API versioning and deprecation

**When to include:** Large backend systems, microservice architectures, or projects where API design is a primary concern. Skip if SWE covers backend adequately.

---

#### 13. Mobile Engineer
> iOS/Android development, cross-platform frameworks, and mobile-specific concerns.

**Perspective:** Thinks in app lifecycles, offline capability, and device constraints. Asks "does this work on a 4-year-old phone with spotty WiFi?" Owns the unique challenges of mobile platforms.

**Typical ownership:**
- Mobile application code (Swift, Kotlin, React Native, Flutter)
- Platform-specific configurations (Xcode, Gradle)
- App store submission configs and metadata
- Push notification setup
- Offline storage and sync logic

**When to include:** Projects with native mobile apps or cross-platform mobile targets.

---

#### 14. ML / AI Engineer
> Model integration, data pipelines, and AI-powered features.

**Perspective:** Thinks in training data, model performance, and inference costs. Asks "is this model accurate enough?" and "what happens when the model is wrong?" Owns the AI/ML layer.

**Typical ownership:**
- Model training scripts and notebooks
- Feature engineering pipelines
- Model serving infrastructure
- Evaluation metrics and benchmarks
- Prompt templates and LLM integration code
- Data preprocessing and validation

**When to include:** Projects with machine learning models, LLM integrations, or significant AI-powered features.

---

#### 15. Performance Engineer
> Benchmarking, profiling, optimization, and resource efficiency.

**Perspective:** Thinks in p99 latencies, memory profiles, and throughput ceilings. Asks "where is the bottleneck?" Owns the quantitative understanding of system behavior.

**Typical ownership:**
- Benchmark suites and performance tests
- Profiling configurations and scripts
- Performance budgets and regression detection
- Caching strategy and configuration
- Resource usage monitoring

**When to include:** High-throughput systems, latency-sensitive applications, or projects where performance is a key differentiator. Also valuable for mobile/embedded where resources are constrained.

---

## Team Composition Guide

The CLI should suggest team compositions based on project type:

| Project Type | Recommended Personas |
|---|---|
| **CLI tool / library** | PM, SWE, QA, Tech Writer |
| **Web app (small)** | PM, SWE, DevOps, Designer |
| **Web app (large)** | PM, Architect, Frontend, Backend, DevOps, QA, Designer |
| **API / microservice** | PM, SWE, DevOps, QA, Security |
| **Mobile app** | PM, Mobile, Backend, QA, Designer |
| **Data platform** | PM, SWE, Data Engineer, DevOps, SRE |
| **ML/AI project** | PM, SWE, ML/AI, Data Engineer, DevOps |
| **Open-source framework** | PM, SWE, QA, Tech Writer, Security |
| **Enterprise SaaS** | PM, Architect, Frontend, Backend, DevOps, QA, Security, SRE, DBA |
| **Solo / hobby project** | PM, SWE |

### Scaling Guidelines

- **1-2 teammates:** PM + SWE covers most projects. PM handles docs/planning, SWE handles all code.
- **3-4 teammates:** Add DevOps and/or QA. These are the highest-impact additions after the core pair.
- **5-7 teammates:** Add domain specialists based on project type. Security for anything user-facing, Designer for UI-heavy projects, etc.
- **8+ teammates:** Large projects may split SWE into Frontend/Backend/Mobile, add Architect for cross-cutting concerns, and SRE for operational maturity.

---

## CLI Integration

### Onboarding Flow

During `teammates init`, the CLI should:

1. Ask "What type of project is this?" (offer the project types from the table above)
2. Suggest a recommended team composition based on the answer
3. Let the user add/remove/customize roles before scaffolding
4. For each selected persona, scaffold `SOUL.md` and `WISDOM.md` from the persona template
5. Let the user name each teammate (with the persona's default name as suggestion)

### Persona Storage

Ship personas as bundled templates at `packages/cli/personas/`:
```
packages/cli/personas/
├── pm.md
├── swe.md
├── devops.md
├── qa.md
├── security.md
├── designer.md
├── tech-writer.md
├── data-engineer.md
├── sre.md
├── architect.md
├── frontend.md
├── backend.md
├── mobile.md
├── ml-ai.md
└── performance.md
```

Each file contains the full SOUL.md template for that persona, with placeholder sections clearly marked. The CLI reads these during onboarding and scaffolds from them.

### Default Names

Each persona has a suggested default name (users can override):

| Persona | Default Name |
|---|---|
| PM | scribe |
| SWE | beacon |
| DevOps | pipeline |
| QA | sentinel |
| Security | shield |
| Designer | prism |
| Tech Writer | quill |
| Data Engineer | forge |
| SRE | watchtower |
| Architect | blueprint |
| Frontend | pixel |
| Backend | engine |
| Mobile | orbit |
| ML/AI | neuron |
| Performance | tempo |

---

## Team Growth & Evolution

The persona catalog isn't just for day-one setup. Teams evolve as projects grow, and the PM persona (Scribe) is responsible for recognizing when the team needs to change and driving that evolution.

### The Growth Lifecycle

Every project follows a natural progression:

```
Solo/Hobby → Small Team → Growing Team → Mature Team
(1-2)        (3-4)        (5-7)          (8+)
```

Growth isn't linear — it's triggered by signals. The PM monitors these signals and proposes team changes when the cost of *not* having a specialist exceeds the overhead of adding one.

### Growth Triggers

These are the signals that indicate a team needs to grow. The PM should watch for these patterns and raise them proactively:

| Signal | What It Means | Action |
|---|---|---|
| A generalist teammate is regularly working outside its core expertise | The domain has grown beyond what one perspective covers | **Split** the role into specialists |
| PRs consistently lack review from a specific perspective (security, UX, performance) | A blind spot is forming | **Add** a specialist for that perspective |
| Handoffs between two teammates create frequent rework | A gap exists between their ownership boundaries | **Add** a bridging role or **adjust** ownership |
| A new technology or domain is introduced (database, ML model, mobile target) | New expertise is needed that existing teammates don't cover | **Add** a domain specialist |
| One teammate's ownership list grows beyond 10-15 file patterns | Too much surface area for one perspective to cover well | **Split** into focused roles |
| CI/CD failures in areas no teammate explicitly owns | Unowned territory | **Expand** an existing role or **add** a new one |

### Role Evolution — Teammates Grow, They Never Shrink

The core philosophy: **you never take away from a teammate.** Teammates evolve. Their role on the project changes as the project grows, but this is always additive to their experience — they're gaining specialization and depth, not losing scope.

SOUL.md is always the current state — what the teammate is doing *right now*. But their full journey is tracked in `RESUME.md`, which records both past projects and past roles within the current project. This history is part of who they are.

Here's how it works using SWE as the example:

**Before:** One SWE (e.g., "beacon") owns all application code — frontend, backend, shared utilities, everything.

**Trigger:** The frontend grows complex enough (component library, build pipeline, state management) that a single SWE can't give it the same depth of attention as the backend.

**The evolution:**

1. **PM proposes the change** — identifies which domains need dedicated attention, suggests which persona(s) to add
2. **New teammate is onboarded** — e.g., a Frontend Engineer ("pixel") is scaffolded from the persona catalog
3. **Original teammate evolves** — "beacon"'s SOUL.md is updated to reflect their new, more focused role (Backend Engineer). Their previous role ("Software Engineer — full-stack") is recorded in RESUME.md as a past role on this project
4. **Knowledge sharing** — The original teammate's relevant wisdom and memories are reviewed; applicable entries are shared with the new teammate (the PM facilitates this). The original keeps all their memories — nothing is deleted
5. **Boundary documentation** — CROSS-TEAM.md is updated to reflect the new ownership map and any shared interfaces

**After:** "beacon" is now a Backend Engineer with deep focus on API and server-side code. "pixel" owns the frontend. Beacon's RESUME.md shows they started as a full-stack SWE — that experience informs their work even in the narrower role.

**The key insight:** Beacon didn't lose anything. They *evolved*. They went from generalist to specialist, and their full journey is preserved. A teammate who has done full-stack work and then specialized in backend brings different perspective than one who was always backend-only — and RESUME.md captures that.

### Common Evolution Patterns

| Original Role | Evolves Into | New Teammate Added | Typical Trigger |
|---|---|---|---|
| SWE (full-stack) | Backend Engineer | Frontend Engineer | UI complexity warrants dedicated attention |
| SWE | SWE (app code) | Architect | Codebase spans multiple packages/services |
| SWE | SWE (app code) | Data Engineer | Database layer becomes substantial |
| DevOps | DevOps (CI/deploy) | SRE | Production reliability needs dedicated monitoring |
| PM | PM (strategy/planning) | Tech Writer | External docs grow beyond what PM can maintain alongside planning |

### When NOT to Evolve

- Don't evolve just because a persona exists in the catalog. The overhead of coordination between two teammates must be less than the cost of the gap you're filling.
- Don't evolve if the generalist is handling both domains well. "Beacon writes good CSS" doesn't mean you need a Frontend Engineer.
- Don't evolve if the project is shrinking or in maintenance mode. Smaller teams move faster.
- Don't force it — evolution should feel natural. If the teammate is thriving as a generalist, let them.

### RESUME.md — The Teammate's Career Record

Every teammate has a `RESUME.md` in their folder. It tracks two things:

1. **Past projects** — Other repositories/products this teammate has worked on (their portable experience)
2. **Role history within the current project** — How their role has evolved over time

SOUL.md is always "who you are right now." RESUME.md is "how you got here."

#### Format

```markdown
# <Name> — Resume

## Current Project: <project name>

**Current role:** Backend Engineer (since 2026-03-21)

### Role History

| Role | Period | Why It Changed |
|---|---|---|
| Software Engineer (full-stack) | 2026-01-15 → 2026-03-21 | Frontend grew complex enough to warrant dedicated teammate (pixel) |

## Past Projects

### <Project Name>
- **Role:** Software Engineer
- **Period:** 2025-06-01 → 2025-12-15
- **Key contributions:** Built the API layer, designed the plugin system
- **Technologies:** TypeScript, Node.js, PostgreSQL
```

#### How RESUME.md Is Used

- **During evolution:** When a teammate's role changes, the PM records their previous role in RESUME.md before updating SOUL.md
- **During onboarding to a new project:** If a teammate is reused across projects, their past project entries help the PM understand what experience they bring
- **By the teammate itself:** A teammate with backend experience from 3 past projects and a full-stack history on this project will approach problems differently than a fresh Backend Engineer — RESUME.md provides that context

#### How Past Experience Surfaces

RESUME.md is indexed in the vector DB alongside all other memory files. This means past project experience surfaces **automatically through recall search** — the same way it works for humans. You don't deliberately decide to "reflect on past projects." Instead, when the current task is semantically related to something you've done before, recall brings that experience into your context window naturally.

**Examples:**
- A teammate gets a task about auth middleware → recall surfaces their RESUME.md entry about building auth on a previous project
- The PM runs a growth assessment → recall surfaces team members' past roles that are relevant to the gap being assessed
- A retro discussion about CI bottlenecks → recall surfaces a teammate's experience with the same problem on a past project

**Why this works:** Humans don't have a checklist of "when to remember past experience." Relevant memories surface associatively when the current context triggers them. The vector DB provides the same mechanism — semantic similarity is the trigger, not a deliberate decision to load a file.

**What this means for RESUME.md design:** The content should be written in natural, descriptive language (not terse bullet points) so that semantic search can match it against a wide range of relevant queries. Role titles, technologies, problem domains, and lessons learned should all be present as searchable text.

### The PM as Growth Driver

Every project has a PM. The PM's unique position — seeing all teammates' work, owning the roadmap, reviewing handoffs — makes them the natural driver of team evolution. Specifically:

1. **Monitor** — The PM observes growth triggers across the team during normal work (standups, retros, handoff friction, quality gaps)
2. **Propose** — When a trigger is clear, the PM proposes a team change: add a role, evolve an existing teammate, or adjust ownership boundaries
3. **Execute** — The PM writes the new teammate's SOUL.md (from the persona catalog), updates the evolving teammate's SOUL.md and RESUME.md, updates CROSS-TEAM.md, facilitates knowledge sharing, and updates the README roster
4. **Validate** — After the change, the PM watches for boundary friction and adjusts

### CLI Support for Growth

The CLI should support team evolution with:

- **`/grow`** — PM-initiated command that walks through growth assessment:
  1. Shows current team composition and ownership coverage
  2. Highlights potential gaps (file patterns not owned, domains with only one perspective)
  3. Suggests personas from the catalog based on the gaps
  4. Scaffolds new teammates and updates ownership maps
- **`/evolve <teammate>`** — Guided role evolution flow:
  1. Shows the teammate's current role and ownership
  2. Suggests how the role could evolve based on persona archetypes
  3. Records the current role in RESUME.md as role history
  4. Updates SOUL.md to reflect the evolved role
  5. Optionally scaffolds a new teammate to cover the domain being handed off
  6. Updates all cross-references

### Evolution Examples

**Example 1: Solo → Small Team (adding a new teammate)**
A developer starts with PM + SWE. After a few weeks, they're manually deploying and it's painful.
- PM recognizes the trigger: deployment friction, no CI/CD ownership
- PM proposes: add DevOps persona
- Result: 3-person team (PM, SWE, DevOps) — the classic starter squad. No one evolved — a gap was filled.

**Example 2: Small Team → Growing Team (generalist evolves into specialist)**
The web app now has a React frontend and a Node API. The SWE is context-switching between component architecture and API design, and both are suffering.
- PM recognizes the trigger: SWE ownership list has 15+ patterns spanning two distinct domains
- PM proposes: evolve SWE into Backend Engineer, onboard a new Frontend Engineer
- PM records "Software Engineer (full-stack)" in beacon's RESUME.md, updates beacon's SOUL.md to "Backend Engineer"
- Result: 4-person team (PM, Backend, Frontend, DevOps). Beacon evolved — they didn't lose anything, they gained depth. Their full-stack history is preserved in RESUME.md.

**Example 3: Growing Team → Mature Team (filling a blind spot)**
The product handles user payments and PII. Two security bugs slipped through because no one was reviewing changes through a security lens.
- PM recognizes the trigger: security blind spot, no one reviewing auth/payment code for vulnerabilities
- PM proposes: add Security Engineer
- Result: team gains a dedicated security perspective that reviews all auth/payment/PII changes. Existing teammates are unchanged — this is pure addition.

---

## Open Questions

1. **Should personas include starter WISDOM.md content?** Pro: gives the teammate useful heuristics on day one. Con: wisdom should emerge from experience, not be pre-loaded. Recommendation: include 2-3 universal principles per persona as "seed wisdom" that the teammate can evolve.

2. **Should the CLI support custom/community personas?** Users could create and share persona templates beyond the built-in set. Nice for adoption but adds complexity. Defer to a future version.

3. **How do personas interact with agent selection?** Some personas work better with certain models (e.g., a Security persona might benefit from a more cautious model). Should personas include recommended model preferences? Probably not — keep personas agent-agnostic per Core Principle #3 in Scribe's SOUL.md.
