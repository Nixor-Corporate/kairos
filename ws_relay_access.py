"""Live relay access checks against the same course grants as PHP."""


STUDENT_GRANTS = (('student_courses', 'user_id'), ('user_courses', 'user_id'), ('enrollments', 'user_id'))
MANAGER_GRANTS = (('manager_courses', 'user_id'), ('course_staff', 'user_id'), ('course_roles', 'user_id'),
                  ('enrollments', 'user_id'), ('user_courses', 'user_id'))
TA_GRANTS = (('ta_courses', 'ta_user_id'), ('course_tas', 'user_id'), ('ta_enrollments', 'user_id'),
             ('staff_courses', 'user_id'))


class RelayAccess:
    """One request or fanout owns the cursor and caches schema metadata only."""

    def __init__(self, cursor):
        self.cursor = cursor
        self.columns = None

    def identity(self, token_hash):
        self.cursor.execute(
            'SELECT u.user_id, LOWER(r.name) AS role_name FROM realtime_session_leases lease '
            'JOIN users u ON u.user_id = lease.user_id JOIN roles r ON r.role_id = u.role_id '
            'WHERE lease.token_hash = UNHEX(%s) AND lease.expires_at > UTC_TIMESTAMP() '
            "AND u.is_active = 1 AND u.account_status = 'active' AND u.auth_session_version = lease.session_version",
            (token_hash,),
        )
        row = self.cursor.fetchone()
        if row:
            return int(row['user_id']), row['role_name']
        return None

    def resolve_course(self, course_id, room_id):
        if room_id is not None:
            self.cursor.execute(
                'SELECT r.course_id FROM rooms r JOIN courses c ON c.course_id = r.course_id '
                'WHERE r.room_id = %s AND c.is_active = 1', (room_id,),
            )
            row = self.cursor.fetchone()
            if row and (course_id is None or int(row['course_id']) == course_id):
                return int(row['course_id'])
        elif course_id is not None:
            self.cursor.execute('SELECT course_id FROM courses WHERE course_id = %s AND is_active = 1', (course_id,))
            if self.cursor.fetchone():
                return course_id
        return None

    def course_access(self, identity, course_id):
        user_id, role = identity
        if role == 'admin':
            return True, True
        staff = role == 'manager' and self._has_grant(MANAGER_GRANTS, user_id, course_id, 'manager')
        if role in ('manager', 'ta') and not staff:
            # PHP's protected course view uses the first nonempty TA assignment ledger.
            staff = self._first_ta_ledger_grants(user_id, course_id)
        enrolled = self._has_grant(STUDENT_GRANTS, user_id, course_id, 'student')
        return staff or enrolled, staff

    def _schema(self):
        if self.columns is None:
            tables = sorted({table for table, _ in STUDENT_GRANTS + MANAGER_GRANTS + TA_GRANTS})
            marks = ','.join(['%s'] * len(tables))
            self.cursor.execute(
                'SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name FROM information_schema.COLUMNS '
                f'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ({marks})', tables,
            )
            self.columns = {}
            for row in self.cursor.fetchall():
                self.columns.setdefault(row['table_name'], set()).add(row['column_name'])
        return self.columns

    def _has_grant(self, mappings, user_id, course_id, role):
        statements = []
        args = []
        for table, user_col in mappings:
            columns = self._schema().get(table, set())
            has_role = table not in ('student_courses', 'manager_courses')
            needed = {user_col, 'course_id'} | ({'role'} if has_role else set())
            if not needed <= columns:
                continue
            clause = f'SELECT 1 FROM `{table}` WHERE `{user_col}` = %s AND course_id = %s'
            args.extend((user_id, course_id))
            if has_role:
                clause += ' AND (LOWER(role) = %s' + (' OR role IS NULL)' if role == 'student' else ')')
                args.append(role)
            statements.append(clause)
        if not statements:
            return False
        self.cursor.execute(' UNION ALL '.join(statements) + ' LIMIT 1', args)
        return self.cursor.fetchone() is not None

    def _first_ta_ledger_grants(self, user_id, course_id):
        for table, user_col in TA_GRANTS:
            if not {user_col, 'course_id'} <= self._schema().get(table, set()):
                continue
            self.cursor.execute(
                f'SELECT COUNT(*) AS total, MAX(t.course_id = %s) AS is_assigned FROM `{table}` t '
                f'JOIN courses c ON c.course_id = t.course_id WHERE t.`{user_col}` = %s', (course_id, user_id),
            )
            row = self.cursor.fetchone()
            if row['total']:
                return bool(row['is_assigned'])
        return False
