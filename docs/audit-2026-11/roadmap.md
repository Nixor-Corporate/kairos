# Prioritized roadmap

| Priority | Category | Work and evidence | Expected benefit | Estimate | Dependency | Approval |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | A | Incident containment, GitHub and host evidence preservation, credential rotation, deploy provenance. SEC-01 | Reduce risk from already-exposed access | 1–3 days initial triage plus follow-up | Org/security/hosting owners and clean machines | Owner action |
| P0 | A | Lock down `main` and CI trust. SEC-04 | Prevent unreviewed workflow, release or dependency paths | 0.5–1 day | Incident review and team policy | Repository owner |
| P0 | A | Fix HTTPS redirect and verify effective URL, cookie and OAuth behavior. SEC-05 | Keep users on HTTPS and remove a plausible session disruption | 0.5–1 day | Cloudflare/cPanel access | Hosting owner |
| P1 | A | Stage student progress authorization and dependency updates. SEC-02, SEC-03 | Protect recorded status and relay availability | 0.5–1 day | Clean build and PHP/Python compatibility | Reviewed release |
| P1 | A | Align relay authorization and revocation with PHP and remove command-line secret forwarding. SEC-06, SEC-07 | Apply timely access revocation and reduce secret exposure | 2–4 days | Common policy decision, relay testing and release ownership | Existing fixes. Confirm revocation timing |
| P1 | B | Release queue accept fix and inspect historical duplicate or stale assignments. QUE-01, QUE-02 | Restore reliable acceptance and avoid destructive recovery | 1–2 days | Staging queue data and approved repair if needed | Existing code fix. Data repair requires review |
| P1 | B | Resolve serving hints across reconnect, refresh and multiple tabs. NOT-01 | More predictable serving alerts and visible state | 2–4 days | Two-role staging session, reliable relay and device matrix | Existing fix |
| P1 | B | Verify enrollment roster consistency beyond progress. ENR-01 | Reduce manual lookup and mismatches | 1–3 days | Inventory mapping sources and confirm removal semantics | Read fixes authorized. Approval for changes to enrollment semantics |
| P1 | D | Stage course sign-off requirements and workbook. FEAT-01, FEAT-02 | Configurable evidence and usable reporting | 1–2 days QA and rollout | Migration, ext-zip/XMLWriter, schema and recovery checklist | Implemented with approval. Release pending |
| P2 | C | Calibrate ETA, count queue queries, address stale tab state and loading. QUE-03, PERF-01 | Improve wait information and dashboard latency | 2–4 days | Baseline traces and representative synthetic queue size | Existing improvement |
| P2 | C | Improve mobile task discovery, visible serving state and projector readability. PRO-01, UX-02 | Faster workflow under classroom conditions | 1–3 days | 320/375 px devices, accessibility and projector check | Existing improvements |
| P3 | E | Consider new tools after establishing reliability and uptake. PROP-01 | Invest in features only where evidence supports them | Estimate by proposal | Product decisions below | Requires approval |

## Proposals requiring approval

### Targeted TA recovery and requeue

TA rows 2 and 5 describe being blocked pending manager help. After fixing active-assignment duplication and verifying current stop behavior, a narrow recovery control could let the assigned TA release their own interrupted service back to the queue with a visible outcome. Define original position versus tail order and the behavior when the student has left. A server action would scope the transition to the active assignment and queue, use the existing transaction and role policy, and record durable recovery metadata. It may need a reason/event field or an additive audit migration. Broad manager permission would expose unrelated operations and increases risk. Allow 3–5 days including race and audit tests. Recommendation is to measure residual interruptions first and prefer a scoped recovery action when the evidence supports it.

**Approval question** — After staging confirms a residual recovery gap, should Kairos add a TA-only release-and-requeue action, and should it use original position or tail order?

### Assisted sign-off or code submission outside the queue

TA row 2 asked to complete tasks when students cannot enter the queue. Student row 22 requested code submission. Test whether current enrolled-student progress and LMS submission capabilities meet the need. If an authorized non-queue roster entry point is still needed, provide an assigned-course student lookup and apply the same sign-off policy, actor, history and rate constraints. Prefer current assignment uploads or a linked code artifact for student submissions. The lookup may require no schema change. Attaching code directly to sign-off adds file mapping, content validation, feedback visibility and retention decisions. Allow 2–4 days for scoped lookup and more for raw file handling. Recommendation is to use existing planning and submission tools first.

**Approval question** — If the enrolled student lookup gap remains, should the TA dashboard expose a scoped alternative entry point to its existing sign-off form?

### Communication, a mobile app, or competitive marks

Student rows 14 and 17 request calls and app packaging, while TA row 3 suggests a competitive marking workflow. Hosted calls involve permission, safeguarding, moderation, capacity and retention decisions, and may require a new service. Existing institution-approved meeting links are a lower-effort alternative. App packaging entails updates, offline/version behavior, OAuth redirect handling and device security. A responsive existing workflow addresses the immediate mobile friction. A competition tool would need explicit audience and scoring rules, opt-in decisions, durable audit and likely new schema and permissions. The approved sign-off ratings remain operational feedback. Recommendation is to prioritize reliable responsive workflows and defer all three. Scope discovery is roughly 1–2 days each before a build estimate.

**Approval question** — Should any of these receive product discovery after the reliability fixes, and which one has an institutional owner?
