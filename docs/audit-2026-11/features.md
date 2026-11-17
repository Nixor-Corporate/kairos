# Sign-off requirements and Excel export

## Course policy and lifecycle

In **Manager → Student progress → Sign-off requirements**, an assigned manager or admin can independently require a rating, a comment, or both. The initial course policy requires neither. Under **Task overrides**, each requirement and the ordered rating choices inherit independently. Select a task to see its effective settings. **Reset to course defaults** restores all three inherited settings. Course default changes reach inheriting tasks at once. Explicit overrides and prior events retain their saved values. The existing `progress_details` and `progress_category` relationship is the completion boundary. Stop Serving ends the queue assignment separately.

Choices are ordered labels. Integers, decimal labels, and descriptive labels are all supported. The service accepts up to 50 choices per course and 120 characters per label. Active labels must be distinct. At least one active choice is required when rating is mandatory. Use deactivation to preserve saved option IDs. Manager saves compare the policy revision and record each changed configuration and actor in `signoff_policy_history`.

A TA with existing progress permission in the course can mark a currently enrolled student's task complete. When either requirement is enabled, the browser prompts within the progress panel workflow. The server verifies authorization and required data for each new completion. Comments are limited to 2,000 characters. An existing completed task does not require new metadata. A repeated completion request does not overwrite a prior record. An allowed reversal changes the current status and records its actor, timestamp, and prior status. A subsequent completion uses the current policy. Historical ratings, comments and their actors remain immutable. A label snapshot preserves old meaning even when a choice is renamed or deactivated.

The transaction uses a shared course lock against policy edits and serializes writes to the same student's task state. Manager changes append one immutable task revision. Completion validates both revisions and stores any selected task-choice position with the event. Together with the existing unique progress key, the transaction prevents duplicate active progress and duplicate history from retrying the same transition. Progress, history and the change-feed record commit together. The relay receives a scoped progress hint after commit, without rating values or comments. The manager detail dialog shows the latest 50 events per student. The workbook includes the complete in-scope history.

| API | Authorization and behavior |
| --- | --- |
| `GET api/progress.php?course_id=…` | Protected course view, own status only. Legacy mutation is retired. |
| `GET api/manager/signoff_policy.php?course_id=…` | Course Manage capability. Returns ordered choices and revision. `detail_id` selects the saved and effective task policy. |
| `POST api/manager/signoff_policy.php` | Same scope and same-origin request policy. A `detail_id` write validates both revisions and accepts `null` to inherit each setting. |
| `GET api/ta/student_progress.php` | Existing TA gate plus course progress capability and target student enrollment. Returns effective policies for overridden tasks and the course defaults. |
| `POST api/ta/update_progress.php` | Same gate. Status changes, history and change-feed mutation are transactional. |
| `GET api/manager/progress_export.php?course_id=…` | Course Manage capability. Excel attachment with private, no-store headers. |

[Course migration](../../db/migrations/20261116_0200_add_signoff_requirements.sql) · [Task migration](../../db/migrations/20261116_0300_add_task_signoff_overrides.sql) · [Student and staff access policy](../security/course_authorization_matrix.md)

## Workbook contract

Select a course and use **Download Excel workbook** in **Student progress**. Each workbook covers one course and includes all retained, authorized academic records, including archived content. Course Manage capability is checked on each download. Staff notes, student notes, submission bodies and files, quiz response content, email and authentication data are excluded.

The Enrollments sheet deduplicates by course and student ID. **Current** takes precedence when a supported student grant remains active, including the historical role-less student grants. Without a current grant, **Former** is backed by a recorded withdrawal, explicitly withdrawn legacy status, claimed pre-enrollment, or retained course-linked progress, sign-off, completion, attempt, submission or grade. **Indeterminate** indicates weaker evidence such as a serving session or inactive legacy grant without corroboration. Identifiers remain usable when a display name is unavailable. The exporter does not join people by name. The withdrawal ledger covers removals through Kairos going forward. Historical records already purged from the source database are unavailable. About lists aggregate counts of rows excluded for missing or conflicting required links. Repair of conflicting source records needs an authorized data review.

| Worksheet | Row grain and join keys | Main values |
| --- | --- | --- |
| About | One row per workbook attribute | Course scope, handling and interpretation |
| Enrollments | Course ID + Student ID | Course name and code, student name, enrollment status |
| Tasks | Task ID, Category ID, Course ID | Task and category labels |
| Task progress | Course ID + Student ID + Task ID | Current status, created and updated times. Missing rows indicate no recorded status |
| Sign-off history | Event ID, Student ID, Task ID, Staff ID | Actor name, prior/current status, course policy revision, option ID and historical label, comment, timestamp, task policy revision and task-choice position when present |
| Serving sessions | Serving ID, Queue ID, Student ID, TA ID | TA name and service timestamps. The export includes records still retained by existing queue history |
| Modules | Module ID, Course ID | Title, position, publication flag and deletion timestamp |
| Lessons | Lesson ID, Module ID, Course ID | Title, position and deletion timestamp |
| Lesson completions | Completion ID, Lesson ID, Module ID, Student ID | Recorded completion timestamp |
| Quizzes | Assessment ID, Course ID | Title, type, status, due date and deletion timestamp |
| Quiz attempts | Attempt ID, Assessment ID, Student ID | Workflow and grading status, score/max, grader and lifecycle timestamps |
| Assignments | Assignment ID, Course ID | Title, due date, status, maximum points and deletion timestamp |
| Submissions | Submission ID, Assignment ID, Student ID | Version, status, lateness and timestamps |
| Grades | Grade ID, Assignment ID, Submission ID or Attempt ID, Student ID | Status, score, max, override, effective score, grader/releaser IDs, timestamps and source linkage. A retained course-owned grade with no available parent is labeled `Source unavailable`. |

Identifiers are stored as text to preserve exact joins across sheets, including long IDs. Scores and counts are numeric. Dates are Excel date cells with database wall time, and missing values are blank. Rating labels are text so a configured `1.0` stays `1.0`. Text fields are encoded as inline strings, with formula evaluation disabled by construction. Sheets have frozen headings and filters. Export uses a read-only transaction, unbuffered rows, streamed worksheet XML and private temporary files. It opens the attachment after the archive has finalized. The deployment needs PHP ZipArchive and XMLWriter. Profile worst-case course size and available temporary space on cPanel.

[SQL and column definitions](../../src/progress_export.php) · [Workbook writer](../../src/XlsxWorkbook.php) · [Verification](verification.md)
