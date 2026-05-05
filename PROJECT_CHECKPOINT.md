# HRMS Project Checkpoint

Use this file first before exploring the repo again.

## App Entry

- Workspace: `C:\Users\bhuth\Documents\HRMS`
- Server: FastAPI / Uvicorn
- Main app: `app/main.py`
- Run command: `python -m uvicorn app.main:app --host 127.0.0.1 --port 8051`
- Browser URL: `http://127.0.0.1:8051/`
- Health URL: `http://127.0.0.1:8051/health`

## Frontend Files

- Main HTML: `app/static/index.html`
- Main JS: `app/static/app.js`
- Premium glass UI CSS: `app/static/workspace-glass.css`
- Fallback/synced CSS: `app/static/styles.css`
- Main image asset: `app/static/assets/executive-command-center.png`

## Main UI Pages / Views

- Dashboard: `#dashboardSection`
- Team Pulse / Chat: `#chatView`
- Time Studio / Timesheet: `#timesheetView`
- Leave Hub / Leave: `#leaveView`
- Calendar: `#calendarView`
- Activity: `#activityView`
- Admin workspace pages: `#adminView`

`app.js` controls view switching through `showView(viewName, targetId)`.

## Sidebar Notes

- Sidebar is intentionally hidden until pointer hover.
- It stays visible for about 5.5 seconds after pointer leaves.
- Behavior is in `bindSidebarReveal()` inside `app/static/app.js`.
- Sidebar labels are mapped in `renderSidebar()` inside `app/static/app.js`.
- Removed from side panel per user request:
  - Admin Console
  - Hierarchy
  - My Team
  - Work Tracking
  - Attendance
  - Breaks
  - My Leaves
  - Leave Calendar
  - Leave Balance
  - Shift Settings

## Current Design Direction

- Premium dark glass UI.
- Background should feel like a luxury command center, not flat black.
- Avoid patchy top bars on non-dashboard pages.
- Dashboard, Team Pulse, and inner pages should share the same glass language.
- User prefers bold visual polish, rich cards, stylish buttons, icons, colors, and images.

## Recent Important Fixes

- Team Pulse now defaults to `All` conversations.
- Team Pulse clears stale global search when opened.
- Chat list filter supports `Groups`.
- Chat thread uses controlled vertical scroll and hides awkward horizontal scroll.
- Pulse suite navigation is shared across Chat, Activity, and Calendar through `#pulseSuiteNav`.
- Team Pulse no longer uses the permanent right profile panel; profile details show from `#profileHoverCard` when hovering/focusing the chat avatar.
- Team Pulse layout is now conversation rail plus thread, with extra room for the message composer.
- Command Deck / Dashboard and Team Pulse / Chat are protected from broad polish passes unless user explicitly asks.
- Remaining pages have a scoped premium polish block in `workspace-glass.css`: Profile, Admin, Timesheet, Leave, Calendar, and Activity.
- Sidebar hover reveal and lingering open state are implemented.
- Cache bust versions in `index.html` should be bumped after CSS/JS edits.

## Quick Verification

Use these quick checks:

- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8051/health`
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8051/`
- `python -m py_compile app\main.py`

Known issue: `node.exe` may fail with `Access is denied` in this environment, so do not rely on `node --check`.
