# Deployment and rollback

Use the [final release handoff](final-release.md) for the current review units, release gates and staging acceptance criteria.

Deploy from a clean, reviewed artifact after incident owners complete containment and verify source provenance. Use the existing Apache/cPanel and Socket.IO topology. Keep the application, deploy credentials and generated exports in their existing protected storage boundaries.

## Sequence

1. Review the [incident gates](security.md#containment-and-release-gate). Resolve the observed HTTPS redirect, confirm effective canonical path/origin and verify the deployed webroot. Back up the DB, deployed code and relay configuration. Capture the current migration inventory and link it to the release.
2. Stage on a representative MariaDB 10.6+ or compatible MySQL installation. Check PHP 8.1+ with PDO MySQL, ZIP, XMLWriter, fileinfo and OpenSSL. Confirm database and temp disk capacity, timeout, writable private temp directory, and ability to run read-only consistent transactions.
3. Verify the baseline schema and previously approved migrations, especially `20260614_1605_add_staff_private_note_to_lms_grades.sql` and `20260614_2100_add_local_authentication.sql`. Fresh installs also need the LMS baseline and the discovery migration before pre-enroll claim tracking. Use existing [production checklist](../../PRODUCTION_DEPLOYMENT_CHECKLIST.md).
4. Apply `db/migrations/20261116_0200_add_signoff_requirements.sql` if absent, then `20261116_0300_add_task_signoff_overrides.sql` and `20261116_0400_record_student_withdrawals.sql` to staging with the approved MariaDB client. Apply `20261116_0500_add_realtime_session_leases.sql` before the matching realtime security update. Confirm that the baseline, task policy, withdrawal and realtime lease tables exist. Check that existing progress counts and statuses stay consistent, and reapply the reviewed migrations on a disposable copy. Apply the same reviewed SQL to production only during an authorized window.
5. Build PHP dependencies from the committed lock using Composer. Audit the lock. For a controlled no-hook build, use `composer install --no-dev --prefer-dist --classmap-authoritative --no-interaction --no-plugins --no-scripts`. If using Google package cleanup to satisfy hosting storage requirements, inspect and explicitly review the locked hook provenance before running it. Keep vendor and configuration outside webroot.
6. Build and stage a new relay environment using `python -m pip install -r requirements.txt` after provenance verification and with the documented Python runtime. Audit resolved packages and validate imports, socket startup, scoped DB connectivity and private broker access before shifting traffic. Restart relay workers in the agreed window with the matching PHP token issuance, JS auth-frame handshake, emitter and Apache configuration. Cached clients must refresh to pick up the new handshake. Test both queue and LMS events. [Relay hosting checklist](release-gates.md#sec-06--sec-07--websocket-authorization-and-host-isolation)
7. Deploy reviewed PHP, JS, CSS and templates. Smoke test all four roles and two course scopes, OAuth and local sign-in as applicable, serving/stop recovery, sign-off with flags off and on, historical label preservation and workbooks. Look for export and sign-off errors, temp-space pressure, HTTP latency, or increased lock waits. Set policy only on the agreed courses after smoke tests pass.

## Rollback

- If requirements must be disabled during a rollback, review effective task overrides as well as course defaults. Record any necessary policy edits and preserve the written history.
- Roll back the frontend, PHP and relay as a matched set to a known-clean reviewed artifact. Keep the student progress authorization fix and patched dependency artifacts where practical. Reverting to a pre-fix application can restore legacy progress writes and skip the sign-off history, so plan any partial rollback with engineering and security.
- A rollback across the realtime credential change should keep the protected relay pair or disable realtime until a compatible patched artifact is available. REST remains authoritative. Keep the additive leases table and avoid restoring public broker forwarding or obsolete query-token authentication.
- Leave the additive tables intact. A prior application can ignore these tables while recorded audit data remains available. Avoid collapsing or removing history during incident recovery. Restore a database backup only through the authorized recovery process and reconcile any newer academic writes first.
- Stop further rollout if record counts change unexpectedly, an unauthorized export returns data, duplicate completions occur, or OAuth/routes redirect incorrectly. Preserve diagnostic metadata in protected logs.

[Manual smoke checklist](verification.md#manual-qa-checklist)
