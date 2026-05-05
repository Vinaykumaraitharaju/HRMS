# HRMS Stabilization Audit

This tracker keeps the production-readiness work module-by-module without rewriting the app from scratch.

## Completed

### Batch 1 - Backend foundations
- Added HR role support to RBAC.
- Restricted employee and department admin writes to Admin/HR.
- Added hierarchy-based employee visibility:
  - Admin/HR: all employees.
  - Manager/Supervisor: self plus direct reports.
  - Employee: self only.
- Fixed duplicate employee ID generation by scanning the max existing employee code suffix.
- Added validation for employee department, manager, and self-manager rules.
- Tightened auth, employee, and chat schemas.

### Batch 2 - Frontend stabilization
- Removed stale hidden Team Approvals view from the dashboard shell.
- Removed dead approvals sidebar route and approve/reject demo handler.
- Removed Activity "Approvals" filter that pointed at removed demo-only data.
- Added stable routed-page scroll rules for admin, profile, timesheet, leave, activity, and calendar views.
- Kept admin console deep links wired through:
  - `/admin/employees`
  - `/admin/roles-access`
  - `/admin/leave-policies`
  - `/admin/timesheet-control`
  - `/admin/audit-logs`

### Batch 3 - Employee admin controls
- Expanded the Admin Employees form with editable mobile, personal email, job title, employment type, and joining date.
- Added duplicate work-email validation and mobile-number validation before save.
- Updated employee table columns to show contact and job details.
- Preserved existing employee ID, active status, manager, supervisor, and assignment-rule behavior during edits.

### Batch 4 - Scoped holiday policies
- Added country and location selectors to Leave Policies holiday setup.
- Seeded location-specific holiday lists for India, US, and UK.
- Scoped holiday add/remove actions by country and location.
- Timesheet holiday detection now uses the selected country/location holiday calendar.

### Batch 5 - Leave types and holiday rules
- Added Leave Policies controls to create and delete leave types.
- Apply Leave dropdown and leave balance tiles now read from configured leave types.
- Added public/optional holiday selection.
- Holiday creation blocks Saturday/Sunday dates and same-location date overlaps.
- Seeded weekday public holiday calendars for India/Hyderabad, US/New York, and UK/London.
- Timesheet uses the current employee location holiday scope; admin uses the selected Leave Policies scope as a preview.

### Batch 6 - Leave type approvals
- Leave types now carry their own balance and approval flow.
- Added default leave types: Sick Leave, Casual Leave, EL, Flexi (Optional Holiday), Comp Off, Bereavement Leave, Maternity Leave, and Paternity Leave.
- Leave type rows include plus/minus controls for manual day balance adjustment.
- Apply Leave now reflects per-type approval behavior:
  - Manager then HR
  - Manager only
  - Supervisor then Manager
  - No approval required

### Batch 7 - Editable policy row flows
- Existing leave type rows now include an approval-flow selector.
- Existing holiday rows now include a public/optional selector.
- Weekend holidays remain optional only.
- Added major India festival entries such as Dussehra, Diwali, and Guru Nanak Jayanti as optional holidays so admins can promote them when needed.

## Current Risks

### Dashboard
- Attendance actions still mix demo state and persisted API state.
- Break policy warnings are frontend-only.

### Leave
- Apply/revoke flows need backend persistence and approval state reconciliation.
- Leave balances are still demo-calculated in parts of the UI.

### Timesheet
- Freeze rules, public holidays, and manager override need backend enforcement.
- Calendar selection is frontend-driven and should be backed by API data.

### Chat
- Chat state is demo/bootstrap data, not real-time WebSocket persistence yet.

### Admin
- Employee management has stronger backend validation now.
- Role assignment UI still needs API-backed save and audit events.
- Leave policies, holidays, and timesheet controls need real CRUD endpoints.

## Next Recommended Batch

Batch 4 should connect Admin Employees and Roles & Access UI to the backend APIs, then add clear toast feedback for save/deactivate/reassign failures. This will remove the biggest mismatch between what the admin screen shows and what the backend actually stores.
