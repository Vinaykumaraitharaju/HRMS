window.WavelynkRoleWorkspaces = {
  Admin: {
    title: "Admin Control Center",
    eyebrow: "Organization overview",
    nav: ["Overview", "Employees", "Departments", "Roles", "Approvals", "Reports"],
    metrics: [
      ["Employees", "128", "12 departments"],
      ["Open Approvals", "17", "Leave and timesheets"],
      ["Attendance", "94", "Checked in today"],
      ["Notifications", "23", "Unread events"],
    ],
    panels: [
      ["Employee Governance", "Create employees, assign departments, map reporting managers, and manage role access.", "Manage employees"],
      ["Approval Load", "Supervisor and manager queues are visible with escalation status.", "Review approvals"],
      ["System Events", "Leave, timesheet, chat, and attendance notifications are flowing through the event layer.", "View events"],
    ],
  },
  Manager: {
    title: "Manager Workspace",
    eyebrow: "Team delivery",
    nav: ["Overview", "My Team", "Leave", "Timesheets", "Attendance"],
    metrics: [
      ["Team Members", "24", "5 direct reports"],
      ["Timesheets", "11", "Awaiting review"],
      ["Leave Requests", "4", "Manager approval"],
      ["Team Attendance", "19", "Checked in today"],
    ],
    panels: [
      ["Timesheet Review", "Approve weekly summaries, inspect daily task notes, and return rejected entries with comments.", "Open queue"],
      ["Leave Escalations", "Supervisor-approved leave appears here for final manager decision.", "Review leave"],
      ["Team Structure", "See reporting lines, departments, and active workload for your team.", "View team"],
    ],
  },
  Supervisor: {
    title: "Supervisor Desk",
    eyebrow: "First-level approvals",
    nav: ["Overview", "Direct Reports", "Leave", "Attendance", "Chat"],
    metrics: [
      ["Direct Reports", "9", "Active employees"],
      ["Leave Queue", "6", "Needs supervisor action"],
      ["Late Check-ins", "2", "Today"],
      ["Messages", "14", "Team updates"],
    ],
    panels: [
      ["Leave Screening", "Approve eligible requests or escalate sensitive cases to managers.", "Start review"],
      ["Attendance Watch", "GPS check-ins outside office radius are flagged for review.", "Inspect logs"],
      ["Team Chat", "Coordinate daily work and see typing indicators in live conversations.", "Open chat"],
    ],
  },
  Employee: {
    title: "Employee Portal",
    eyebrow: "My workspace",
    nav: ["Home", "My Leave", "My Timesheets", "Attendance", "Chat"],
    metrics: [
      ["Leave Balance", "18", "Available days"],
      ["This Week", "30.0h", "Tracked hours"],
      ["Today", "7.5h", "Work time"],
      ["Breaks", "45m", "Logged today"],
    ],
    panels: [
      ["Leave Balance", "View leave balance, applied leaves, approval status, and upcoming holidays.", "My Leave"],
      ["Timesheet", "Track daily tasks, billable hours, notes, and weekly submission status.", "My Timesheets"],
      ["Attendance", "Track login, logout, break time, working hours, and office check-in status.", "Attendance"],
    ],
  },
};
