# Wavelynk HRMS API

Wavelynk is a FastAPI HRMS backend structured as a modular monolith. Each domain owns its router, service, schemas, and SQLAlchemy models so modules can later split into independent services.

## Project structure

```text
app/
  core/                 # config, database, security, dependencies, Redis
  db/schema.py          # imports all SQLAlchemy models for metadata
  modules/
    auth/               # JWT auth, roles, user_roles
    employees/          # departments, employee CRUD, reporting hierarchy
    leave/              # apply, supervisor approval, manager escalation
    timesheets/         # daily entries, weekly summaries, approval workflow
    attendance/         # GPS capture and office-radius validation
    chat/               # REST messages plus WebSocket typing/message fanout
    notifications/      # DB notifications plus Redis pub/sub publishing
scripts/create_tables.py
```

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python scripts/create_tables.py
uvicorn app.main:app --reload
```

For Render or another web host, use:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

## Database schema

The schema is defined with SQLAlchemy models:

- `users`, `roles`, `user_roles`
- `departments`, `employees`
- `leave_requests`
- `timesheets`, `timesheet_entries`
- `attendance_logs`
- `chat_groups`, `chat_group_members`, `chat_messages`
- `notifications`

For production, add Alembic migrations before changing schema over time. `scripts/create_tables.py` is intentionally simple for first-run development.

## API endpoints

Auth:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/users`

Employees:

- `POST /api/v1/employees/departments`
- `GET /api/v1/employees/departments`
- `POST /api/v1/employees`
- `GET /api/v1/employees`
- `GET /api/v1/employees/{employee_id}`
- `PATCH /api/v1/employees/{employee_id}`
- `DELETE /api/v1/employees/{employee_id}`

Leave:

- `POST /api/v1/leaves`
- `GET /api/v1/leaves`
- `POST /api/v1/leaves/{leave_id}/supervisor-approve`
- `POST /api/v1/leaves/{leave_id}/manager-approve`
- `POST /api/v1/leaves/{leave_id}/reject`

Timesheets:

- `POST /api/v1/timesheets`
- `POST /api/v1/timesheets/{timesheet_id}/entries`
- `GET /api/v1/timesheets`
- `GET /api/v1/timesheets/{timesheet_id}/summary`
- `POST /api/v1/timesheets/{timesheet_id}/submit`
- `POST /api/v1/timesheets/{timesheet_id}/approve`
- `POST /api/v1/timesheets/{timesheet_id}/reject`

Attendance:

- `POST /api/v1/attendance/capture`
- `GET /api/v1/attendance/me`

Chat:

- `POST /api/v1/chat/groups`
- `POST /api/v1/chat/messages`
- `GET /api/v1/chat/messages`
- `WS /api/v1/chat/ws/users/{user_id}`
- `WS /api/v1/chat/ws/groups/{group_id}`

Notifications:

- `GET /api/v1/notifications`
- `PATCH /api/v1/notifications/{notification_id}/read`
