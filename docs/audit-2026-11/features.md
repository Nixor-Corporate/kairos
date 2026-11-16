# Sign-off requirements and Excel export

## Course policy and lifecycle

In **Manager → Student progress → Sign-off requirements**, an assigned manager or admin can independently require a rating, a comment, or both. The setting covers existing task details in the selected course. The initial policy requires neither. Category and task overrides can be considered if course-wide settings prove insufficient. This release uses the existing `progress_details` and `progress_category` relationship as the completion boundary. Stopping service only ends a queue assignment.

Choices are ordered labels. Integers, decimal labels, and descriptive labels are all supported. The service accepts up to 50 choices per course and 120 characters per label. Active labels must be distinct. At least one active choice is required when rating is mandatory. Use deactivation to preserve saved option IDs. Manager saves compare the policy revision and record each changed configuration and actor in `signoff_policy_history`.

A TA with existing progress permission in the course can mark a currently enrolled student's task complete. When either requirement is enabled, the browser prompts within the progress panel workflow. The server verifies authorization and required data for each new completion. Comments are limited to 2,000 characters. An existing completed task does not require new metadata. A repeated completion request does not overwrite a prior record. An allowed reversal changes the current status and records its actor, timestamp, and prior status. A subsequent completion uses the current policy. Historical ratings, comments and their actors remain immutable. A label snapshot preserves old meaning even when a choice is renamed or deactivated.

The transaction uses a shared course lock against policy edits and serializes writes to the same student's task state. Together with the existing unique progress key, that prevents duplicate active progress and duplicate history from retrying the same transition. Progress and history commit together. The existing change-feed record is written with the transition and the relay receives a scoped progress hint after commit, without rating values or comments. The manager detail dialog shows the latest 50 events per student. The workbook includes the complete in-scope history.

| API | Authorization and behavior |
| --- | --- |
| `GET api/progress.php?course_id=…` | Protected course view, own status only. Legacy mutation is retired. |
| `GET api/manager/signoff_policy.php?course_id=…` | Course Manage capability. Returns ordered choices and revision. |
| `POST api/manager/signoff_policy.php` | Same scope, same-origin request policy, validated entire ordered configuration and revision. |
| `GET api/ta/student_progress.php` | Existing TA gate plus course progress capability and target student enrollment. Returns active choices. |
| `POST api/ta/update_progress.php` | Same gate. Status changes, history and change-feed mutation are transactional. |
| `GET api/manager/progress_export.php?course_id=…` | Course Manage capability. Excel attachment with private, no-store headers. |

[Migration](../../db/migrations/20261116_0200_add_signoff_requirements.sql) · [Service](../../src/signoff.php) · [Student and staff access policy](../security/course_authorization_matrix.md)

## Workbook contract

Select a course and use **Download Excel workbook** in **Student progress**. Course selection is the scope filter. The workbook uses the central current student enrollment policy across supported mappings, with one student row per course. It includes all in-scope rows even if the browser shows a subset. Administrative users select each course directly through the existing course access controls. Current enrollment and active content policies govern data scope. Staff notes, student notes, submission bodies/files, quiz response content, account identifiers such as email, and authentication data are excluded. The tracked schema used for this release has no authoritative student campus field or enrollment timestamp common to its supported membership mappings.

| Worksheet | Row grain and join keys | Main values |
| --- | --- | --- |
| About | One row per workbook attribute | Course scope, handling and interpretation |
| Enrollments | Course ID + Student ID | Course name and code, student name |
| Tasks | Task ID, Category ID, Course ID | Task and category labels |
| Task progress | Course ID + Student ID + Task ID | Current status, created and updated times. Missing rows indicate no recorded status |
| Sign-off history | Event ID, Student ID, Task ID, Staff ID | Actor name, prior/current status, policy revision, option ID and historical label, comment, timestamp |
| Serving sessions | Serving ID, Queue ID, Student ID, TA ID | TA name and service timestamps. The export includes records still retained by existing queue history |
| Modules | Module ID, Course ID | Title, position and publication flag |
| Lessons | Lesson ID, Module ID, Course ID | Title and position |
| Lesson completions | Completion ID, Lesson ID, Module ID, Student ID | Recorded completion timestamp |
| Quizzes | Assessment ID, Course ID | Title, type, status and due date |
| Quiz attempts | Attempt ID, Assessment ID, Student ID | Workflow and grading status, score/max, grader and lifecycle timestamps |
| Assignments | Assignment ID, Course ID | Title, due date, status and maximum points |
| Submissions | Submission ID, Assignment ID, Student ID | Version, status, lateness and timestamps |
| Grades | Grade ID, Submission ID or Attempt ID, Student ID | Status, score, max, override, effective score, grader/releaser IDs and timestamps |

Identifiers are stored as text to preserve exact joins across sheets, including long IDs. Scores and counts are numeric. Dates are Excel date cells with database wall time, and missing values are blank. Rating labels are text so a configured `1.0` stays `1.0`. Text fields are encoded as inline strings, with formula evaluation disabled by construction. Sheets have frozen headings and filters. Export uses a read-only transaction, unbuffered rows, streamed worksheet XML and private temporary files. It opens the attachment after the archive has finalized. The deployment needs PHP ZipArchive and XMLWriter. Profile worst-case course size and available temporary space on cPanel.

[SQL and column definitions](../../src/progress_export.php) · [Workbook writer](../../src/XlsxWorkbook.php) · [Verification](verification.md)
