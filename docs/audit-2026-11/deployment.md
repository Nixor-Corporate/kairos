# Deployment and rollback

Deploy from a clean, reviewed artifact after incident owners complete containment and verify source provenance. Use the existing Apache/cPanel and Socket.IO topology. Keep the application, deploy credentials and generated exports in their existing protected storage boundaries.

## Sequence

1. Review the [incident gates](security.md#containment-and-release-gate). Resolve the observed HTTPS redirect, confirm effective canonical path/origin and verify the deployed webroot. Back up the DB, deployed code and relay configuration. Capture the current migration inventory and link it to the release.
2. Stage on a representative MariaDB 10.6+ or compatible MySQL installation. Check PHP 8.1+ with PDO MySQL, ZIP, XMLWriter, fileinfo and OpenSSL. Confirm database and temp disk capacity, timeout, writable private temp directory, and ability to run read-only consistent transactions.
3. Verify the baseline schema and previously approved migrations, especially `20260614_1605_add_staff_private_note_to_lms_grades.sql` and `20260614_2100_add_local_authentication.sql`. Fresh installs also need the LMS baseline and the discovery migration before pre-enroll claim tracking. Use existing [production checklist](../../PRODUCTION_DEPLOYMENT_CHECKLIST.md).
4. Apply `db/migrations/20261116_0200_add_signoff_requirements.sql` to staging with the approved MariaDB client. Confirm that four tables exist, existing progress counts/statuses have not changed, and reapplying the migration is safe. Apply the same reviewed SQL to production only during an authorized window.
5. Build PHP dependencies from the committed lock using Composer. Audit the lock. For a controlled no-hook build, use `composer install --no-dev --prefer-dist --classmap-authoritative --no-interaction --no-plugins --no-scripts`. If using Google package cleanup to satisfy hosting storage requirements, inspect and explicitly review the locked hook provenance before running it. Keep vendor and configuration outside webroot.
6. Build and stage a new relay environment using `python -m pip install -r requirements.txt` after provenance verification and with the documented Python runtime. Audit resolved packages and validate imports, socket startup, application DB connectivity and private broker access before shifting traffic. Restart relay workers in the agreed window. Check that old and new clients still process legacy and LMS events.
7. Deploy reviewed PHP, JS, CSS and templates. Smoke test all four roles and two course scopes, OAuth and local sign-in as applicable, serving/stop recovery, sign-off with flags off and on, historical label preservation and workbooks. Look for export and sign-off errors, temp-space pressure, HTTP latency, or increased lock waits. Set policy only on the agreed courses after smoke tests pass.

## Rollback

- Turn off both requirements in the affected course if operationally needed while preserving written history. This is an audited policy change.
- Roll back the frontend, PHP and relay as a matched set to a known-clean reviewed artifact. Keep the student progress authorization fix and patched dependency artifacts where practical. Reverting to a pre-fix application can restore legacy progress writes and skip the sign-off history, so plan any partial rollback with engineering and security.
- Leave the additive tables intact. A prior application can ignore these tables while recorded audit data remains available. Avoid collapsing or removing history during incident recovery. Restore a database backup only through the authorized recovery process and reconcile any newer academic writes first.
- Stop further rollout if record counts change unexpectedly, an unauthorized export returns data, duplicate completions occur, or OAuth/routes redirect incorrectly. Preserve diagnostic metadata in protected logs.

[Manual smoke checklist](verification.md#manual-qa-checklist)
