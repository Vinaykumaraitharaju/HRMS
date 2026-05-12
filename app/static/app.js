(async function initApp() {
  const isLoggedIn = await checkAuth();

  if (!isLoggedIn) {
    window.location.href = "/login";
    return;
  }

  const user = window.currentUser || {};
  currentRole = normalizeRoleForApi(
    (user.roles && user.roles.length > 0 ? user.roles[0] : user.role) || "employee"
  );
  currentRoleProfile = {
    ...(roleProfiles[currentRole] || roleProfiles.employee),
    name: user.name || user.full_name || user.email || "Employee",
    email: user.email || "",
    title: user.employee_code
      ? `${(roleProfiles[currentRole] || roleProfiles.employee).title} - ${user.employee_code}`
      : (roleProfiles[currentRole] || roleProfiles.employee).title,
  };

  applyRoleWorkspace();
  hydrateProfileForm();
  restoreProfilePhoto();
  renderSidebar();
  enforcePasswordChangeIfRequired();

  await loadLeavePolicyStateFromBackend();

  await Promise.allSettled([
    loadAttendanceStateFromBackend(),
    loadActivityFeed(),
    loadPresenceState(),
    loadNotificationState(),
    loadCalendarEvents(),
    loadTimesheetState(),
    loadLeaveState(),
    loadChatUsers(),
    ...(isPeopleManagerRole() ? [loadAdminDataFromApi()] : []),
  ]);
  renderTeamStatusBoard();
  if (!attendanceState.loggedIn) {
    autoAttendanceLogin();
  }
  await loadChatState();
  startChatPolling();
})();
let chatPollingInterval = null;

function handleAuthExpired() {
  sessionStorage.removeItem("hrms_access_token");
  stopChatPolling();
  fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" }).finally(() => {
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
  });
}

function startChatPolling() {
  if (chatPollingInterval) return;

  chatPollingInterval = setInterval(async () => {
    if (document.body.dataset.view !== "chat") return;

    try {
      await loadChatState();
    } catch (err) {
      console.error("Polling failed", err);
    }
  }, 3000);
}

function stopChatPolling() {
  if (!chatPollingInterval) return;
  clearInterval(chatPollingInterval);
  chatPollingInterval = null;
}

async function checkAuth() {
  try {
    const token = sessionStorage.getItem("hrms_access_token");
    const res = await fetch("/api/v1/auth/me", {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!res.ok) throw new Error();

    const user = await res.json();
    window.currentUser = user;

    return true;
  } catch {
    handleAuthExpired();
    return false;
  }
}
const employeeNavSections = [
  ["", [["Dashboard", "D"], ["Chat", "C", "8"], ["Timesheet", "S"]]],
  ["Leave Management", [["Apply Leave", "+"]]],
  ["Requests", [["My Requests", "R"], ["Expense Claims", "$"]]],
  ["Others", [["Notifications", "N", "5"], ["Settings", "G"]]],
];

const managerNavSections = [
  ["", [["Dashboard", "D"], ["Chat", "C", "8"], ["Timesheet", "S"]]],
  ["Leave Management", [["Apply Leave", "+"], ["Team Leaves", "A"]]],
  ["Others", [["Notifications", "N", "5"], ["Settings", "G"]]],
];

const hrNavSections = [
  ["", [["Dashboard", "D"], ["Chat", "C", "8"], ["Timesheet", "S"]]],
  ["People Ops", [["Employees", "E"], ["Roles & Access", "R"], ["Leave Policies", "L"]]],
  ["Leave Management", [["Apply Leave", "+"], ["Team Leaves", "A"]]],
  ["Others", [["Notifications", "N", "5"], ["Settings", "G"]]],
];

const adminNavSections = [
  ["", [["Dashboard", "D"], ["Chat", "C", "8"], ["Timesheet", "S"]]],
  ["People Ops", [["Employees", "E"], ["Roles & Access", "R"], ["Leave Policies", "L"]]],
  ["Leave Management", [["Apply Leave", "+"], ["Team Leaves", "A"]]],
  ["Attendance & Time", [["Timesheet Control", "T"], ["Audit Logs", "G"]]],
  ["Others", [["Notifications", "N", "5"], ["Settings", "G"]]],
];

const roleHierarchyRank = {
  employee: 1,
  supervisor: 2,
  manager: 3,
  hr: 4,
  admin: 5,
};

const roleProfiles = {
  employee: {
    label: "Employee",
    name: window.currentUser?.name || window.currentUser?.full_name || window.currentUser?.email || "Employee",
    email: window.currentUser?.email || "",
    title: "Employee",
    portal: "Wavelynk OS",
    headline: "My Workday Studio",
    note: "Your Wavelynk workspace for time, leave, and daily workflow.",
    nav: employeeNavSections,
  },

  manager: {
    label: "Manager",
    name: window.currentUser?.name || window.currentUser?.full_name || window.currentUser?.email || "Manager",
    email: window.currentUser?.email || "",
    title: "Manager",
    portal: "Wavelynk OS",
    headline: "Team Command Studio",
    note: "Manage team approvals and workflows.",
    nav: managerNavSections,
  },

  supervisor: {
    label: "Supervisor",
    name: window.currentUser?.name || window.currentUser?.full_name || window.currentUser?.email || "Supervisor",
    email: window.currentUser?.email || "",
    title: "Supervisor",
    portal: "Wavelynk OS",
    headline: "Supervisor Dashboard",
    note: "Monitor team and approvals.",
    nav: managerNavSections,
  },

  hr: {
    label: "HR",
    name: window.currentUser?.name || window.currentUser?.full_name || window.currentUser?.email || "HR",
    email: window.currentUser?.email || "",
    title: "HR",
    portal: "Wavelynk OS",
    headline: "People Operations Suite",
    note: "Manage employees and policies.",
    nav: hrNavSections,
  },

  admin: {
    label: "Admin",
    name: window.currentUser?.name || window.currentUser?.full_name || window.currentUser?.email || "Admin",
    email: window.currentUser?.email || "",
    title: "System Admin",
    portal: "Wavelynk OS",
    headline: "Admin Control Center",
    note: "Full system control and management.",
    nav: adminNavSections,
  },
};

let currentRole = "employee";
let currentRoleProfile = roleProfiles.employee;
let teamLeaveRequests = [];
document.body.dataset.view = "dashboard";
if (localStorage.getItem("hrms_theme") === "dark") {
  document.body.classList.add("dark-mode");
}

const stats = [
  ["Work Hours Today", "7h 35m", "Logged since 09:15 AM", "W", "blue"],
  ["Leave Balance", "18 days", "Annual 12 - Casual 4 - Sick 2", "O", "purple"],
  ["Pending Requests", "3", "2 leave - 1 expense", "R", "orange"],
  ["Announcements", "5", "2 require acknowledgement", "N", "green"],
];

const schedule = [
  ["09:15", "Work start", "Checked in from office"],
  ["11:00", "Design sync", "Meeting with product team"],
  ["13:15", "Lunch break", "45 minutes"],
  ["16:30", "Review", "Timesheet and handoff notes"],
  ["18:00", "Work end", "Planned logout"],
];

const leaveBalance = [
  ["Annual Leave", "12 days", "approved"],
  ["Casual Leave", "4 days", "pending"],
  ["Sick Leave", "2 days", "rejected"],
];

const leaveRequests = [
  ["Annual Leave", "May 10-12, 2026", "3", "Pending"],
  ["Casual Leave", "Apr 18, 2026", "1", "Approved"],
  ["Sick Leave", "Mar 28, 2026", "2", "Approved"],
  ["Annual Leave", "Feb 14, 2026", "1", "Rejected"],
];

const announcements = [
  ["Payroll cut-off", "Submit timesheets before Friday 5 PM."],
  ["Wellness day", "Optional virtual session on stress management."],
  ["Policy update", "Hybrid work policy updated for May."],
];

const quickActions = [
  ["Check in", "Capture office attendance", "attendance"],
  ["Start break", "Log lunch or short break", "break"],
  ["Add time", "Update today’s timesheet", "timesheet"],
  ["Apply leave", "Create a new leave request", "leave"],
];

const sessionFacts = [
  ["Checked in", "09:15 AM"],
  ["Break left", "30 min"],
  ["Next meeting", "11:00 AM"],
];

const focusItems = [
  ["Submit timesheet", "Before 5:00 PM", "high"],
  ["Review leave update", "Supervisor already reviewed", "medium"],
  ["Design sync", "Starts in 22 minutes", "normal"],
];

const attendanceConfig = {
  office: { lat: 12.9716, lng: 77.5946, radiusMeters: 250 },
  shiftName: "US Support Shift",
  shiftStart: "10:00 PM",
  shiftEnd: "07:00 AM",
  shiftEditor: "Set by admin",
};

const breakPolicyTypes = [
  ["Lunch", "45 min policy window", "lunch"],
  ["Tea break", "15 min short break", "tea"],
  ["Bio break", "10 min personal break", "bio"],
  ["Shift handoff", "Transition buffer", "handoff"],
];

const breakPolicyMinutes = {
  lunch: 45,
  tea: 15,
  bio: 10,
  handoff: 10,
};

let conversations = [];

let directory = [];

let conversationMembers = {};

let conversationMessages = {};

const navTargets = {
  Dashboard: "dashboardSection",
  Chat: "chatView",
  Timesheet: "timesheetView",
  Leave: "leaveView",
  Calendar: "calendarView",
  "Admin Console": "adminView",
  Employees: "adminView",
  "Roles & Access": "adminView",
  "Leave Policies": "adminView",
  "Team Leaves": "adminView",
  "Shift Settings": "adminView",
  "Timesheet Control": "adminView",
  "Audit Logs": "adminView",
  Documents: "announcementsSection",
  "My Team": "profileView",
  "Work Tracking": "workTrackingSection",
  Attendance: "workTrackingSection",
  Breaks: "workTrackingSection",
  "Apply Leave": "leaveView",
  "My Leaves": "leaveView",
  "Leave Calendar": "leaveView",
  "Leave Balance": "leaveView",
  "My Requests": "leaveRequestsSection",
  "Expense Claims": "announcementsSection",
  Notifications: "announcementsSection",
  Settings: "profileView",
};

const adminActionPaths = {
  "open-employees": "/admin/employees",
  "manage-roles": "/admin/roles-access",
  "leave-policy": "/admin/leave-policies",
  "team-leaves": "/admin/team-leaves",
  "timesheet-freeze": "/admin/timesheet-control",
  "audit-logs": "/admin/audit-logs",
};

const adminPathActions = Object.fromEntries(Object.entries(adminActionPaths).map(([action, path]) => [path, action]));

const adminNavActions = {
  "Admin Console": "admin-console",
  Employees: "open-employees",
  "Roles & Access": "manage-roles",
  "Leave Policies": "leave-policy",
  "Team Leaves": "team-leaves",
  "Shift Settings": "timesheet-freeze",
  "Timesheet Control": "timesheet-freeze",
  "Audit Logs": "audit-logs",
};

const adminActionLabels = {
  "open-employees": "Employees",
  "manage-roles": "Roles & Access",
  "leave-policy": "Leave Policies",
  "team-leaves": "Team Leaves",
  "timesheet-freeze": "Timesheet Control",
  "audit-logs": "Audit Logs",
};

const appShell = document.querySelector("#appShell");
const sidebarNav = document.querySelector("#sidebarNav");
const sidebarToggle = document.querySelector("#sidebarToggle");
const logoutButton = document.querySelector(".logout-button");
const backButton = document.querySelector("#backButton");
const forwardButton = document.querySelector("#forwardButton");
const statsGrid = document.querySelector("#statsGrid");
const teamStatusSection = document.querySelector("#teamStatusSection");
const teamStatusScope = document.querySelector("#teamStatusScope");
const teamStatusRows = document.querySelector("#teamStatusRows");
const teamStatusSearch = document.querySelector("#teamStatusSearch");
const scheduleTimeline = document.querySelector("#scheduleTimeline");
const leaveLegend = document.querySelector("#leaveLegend");
const leaveTable = document.querySelector("#leaveTable");
const announcementsPanel = document.querySelector("#announcements");
const notificationToggle = document.querySelector("#notificationToggle");
const notificationDropdown = document.querySelector("#notificationDropdown");
const profileToggle = document.querySelector("#profileToggle");
const profileDropdown = document.querySelector("#profileDropdown");
const profileHeaderAvatar = document.querySelector(".profile-button .avatar");
const profilePhotoInput = document.querySelector("#profilePhotoInput");
const profilePhotoPreview = document.querySelector("#profilePhotoPreview");
const profilePhotoUpload = document.querySelector("#profilePhotoUpload");
const profileEmployeeIdInput = document.querySelector("#profileEmployeeIdInput");
const profileEmailInput = document.querySelector("#profileEmailInput");
const profileMobileInput = document.querySelector("#profileMobileInput");
const currentPasswordInput = document.querySelector("#currentPasswordInput");
const newPasswordInput = document.querySelector("#newPasswordInput");
const confirmPasswordInput = document.querySelector("#confirmPasswordInput");
const passwordChangeRequiredNotice = document.querySelector("#passwordChangeRequiredNotice");
const saveProfileButton = document.querySelector("#saveProfileButton");
const savePasswordButton = document.querySelector("#savePasswordButton");
const themeToggle = document.querySelector("#themeToggle");
function syncThemeToggleLabel() {
  if (!themeToggle) return;
  const isDark = document.body.classList.contains("dark-mode");
  themeToggle.textContent = isDark ? "D" : "T";
  themeToggle.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  themeToggle.setAttribute("title", isDark ? "Dark theme" : "Light theme");
}
syncThemeToggleLabel();
const employeeAdminPanel = document.querySelector("#employeeAdminPanel");
const employeeAdminForm = document.querySelector("#employeeAdminForm");
const employeeRecordId = document.querySelector("#employeeRecordId");
const employeeNameInput = document.querySelector("#employeeNameInput");
const employeeEmailInput = document.querySelector("#employeeEmailInput");
const employeeMobileInput = document.querySelector("#employeeMobileInput");
const employeePersonalEmailInput = document.querySelector("#employeePersonalEmailInput");
const employeeJobTitleInput = document.querySelector("#employeeJobTitleInput");
const employeeEmploymentTypeInput = document.querySelector("#employeeEmploymentTypeInput");
const employeeJoinDateInput = document.querySelector("#employeeJoinDateInput");
const employeeDepartmentInput = document.querySelector("#employeeDepartmentInput");
const employeeProjectInput = document.querySelector("#employeeProjectInput");
const employeeLocationInput = document.querySelector("#employeeLocationInput");
const projectOptionsList = document.querySelector("#projectOptionsList");
const locationOptionsList = document.querySelector("#locationOptionsList");
const newDepartmentInput = document.querySelector("#newDepartmentInput");
const addDepartmentButton = document.querySelector("#addDepartmentButton");
const employeeRoleInput = document.querySelector("#employeeRoleInput");
const employeeManagerInput = document.querySelector("#employeeManagerInput");
const employeeAdminRows = document.querySelector("#employeeAdminRows");
const employeeCredentialNotice = document.querySelector("#employeeCredentialNotice");
const newEmployeeButton = document.querySelector("#newEmployeeButton");
const resetEmployeeFormButton = document.querySelector("#resetEmployeeFormButton");
const rolesAccessPanel = document.querySelector("#rolesAccessPanel");
const accessAdminForm = document.querySelector("#accessAdminForm");
const accessEmployeeInput = document.querySelector("#accessEmployeeInput");
const accessRoleInput = document.querySelector("#accessRoleInput");
const accessSupervisorInput = document.querySelector("#accessSupervisorInput");
const accessManagerInput = document.querySelector("#accessManagerInput");
const accessAdminRows = document.querySelector("#accessAdminRows");
const passwordResetForm = document.querySelector("#passwordResetForm");
const passwordResetEmployeeInput = document.querySelector("#passwordResetEmployeeInput");
const passwordResetInput = document.querySelector("#passwordResetInput");
const passwordResetAuthenticatorInput = document.querySelector("#passwordResetAuthenticatorInput");
const assignmentRuleForm = document.querySelector("#assignmentRuleForm");
const ruleProjectInput = document.querySelector("#ruleProjectInput");
const ruleLocationInput = document.querySelector("#ruleLocationInput");
const ruleSupervisorInput = document.querySelector("#ruleSupervisorInput");
const ruleHrInput = document.querySelector("#ruleHrInput");
const ruleManagerInput = document.querySelector("#ruleManagerInput");
const assignmentRuleRows = document.querySelector("#assignmentRuleRows");
const assignmentRuleCount = document.querySelector("#assignmentRuleCount");
const leavePolicyPanel = document.querySelector("#leavePolicyPanel");
const teamLeavePanel = document.querySelector("#teamLeavePanel");
const teamLeaveRows = document.querySelector("#teamLeaveRows");
const teamLeaveSummary = document.querySelector("#teamLeaveSummary");
const refreshTeamLeaveRequests = document.querySelector("#refreshTeamLeaveRequests");
const leavePolicyForm = document.querySelector("#leavePolicyForm");
const annualBalanceInput = document.querySelector("#annualBalanceInput");
const casualBalanceInput = document.querySelector("#casualBalanceInput");
const sickBalanceInput = document.querySelector("#sickBalanceInput");
const approvalFlowInput = document.querySelector("#approvalFlowInput");
const revokeRuleInput = document.querySelector("#revokeRuleInput");
const leaveTypeAdminForm = document.querySelector("#leaveTypeAdminForm");
const leaveTypeNameInput = document.querySelector("#leaveTypeNameInput");
const leaveTypeBalanceInput = document.querySelector("#leaveTypeBalanceInput");
const leaveTypeApprovalInput = document.querySelector("#leaveTypeApprovalInput");
const leaveTypePolicyList = document.querySelector("#leaveTypePolicyList");
const holidayAdminForm = document.querySelector("#holidayAdminForm");
const holidayCountryInput = document.querySelector("#holidayCountryInput");
const holidayLocationInput = document.querySelector("#holidayLocationInput");
const holidayNameInput = document.querySelector("#holidayNameInput");
const holidayDateInput = document.querySelector("#holidayDateInput");
const holidayTypeInput = document.querySelector("#holidayTypeInput");
const holidayPolicyList = document.querySelector("#holidayPolicyList");
const timesheetControlPanel = document.querySelector("#timesheetControlPanel");
const timesheetControlForm = document.querySelector("#timesheetControlForm");
const freezeHourInput = document.querySelector("#freezeHourInput");
const freezeRuleInput = document.querySelector("#freezeRuleInput");
const weekendEntryInput = document.querySelector("#weekendEntryInput");
const holidayEntryInput = document.querySelector("#holidayEntryInput");
const managerOverrideInput = document.querySelector("#managerOverrideInput");
const timesheetControlSummary = document.querySelector("#timesheetControlSummary");
const auditLogPanel = document.querySelector("#auditLogPanel");
const auditFilterInput = document.querySelector("#auditFilterInput");
const auditLogRows = document.querySelector("#auditLogRows");
const workState = document.querySelector("#workState");
const attendancePriority = document.querySelector("#attendancePriority");
const liveClock = document.querySelector("#liveClock");
const sessionStrip = document.querySelector("#sessionStrip");
const focusSummary = document.querySelector("#focusSummary");
const quickActionsPanel = document.querySelector("#quickActions");
const chatList = document.querySelector("#chatList");
const chatThread = document.querySelector("#chatThread");
const sendChat = document.querySelector("#sendChat");
const chatMessage = document.querySelector("#chatMessage");
const dashboardView = document.querySelector("#dashboardView");
const profileView = document.querySelector("#profileView");
const chatView = document.querySelector("#chatView");
const threadAvatar = document.querySelector("#threadAvatar");
const detailAvatar = document.querySelector("#detailAvatar");
const adminView = document.querySelector("#adminView");
const timesheetView = document.querySelector("#timesheetView");
const leaveView = document.querySelector("#leaveView");
const calendarView = document.querySelector("#calendarView");
const topHeader = document.querySelector(".top-header");
const contentGrid = document.querySelector(".content-grid");
const mainContent = document.querySelector(".main-content");
const pulseSuiteNav = document.querySelector("#pulseSuiteNav");
const teamsLayout = document.querySelector(".teams-layout");
const teamsChatRail = document.querySelector(".teams-chat-rail");
const teamsThread = document.querySelector(".teams-thread");
const profileHoverCard = document.querySelector("#profileHoverCard");
const threadTabs = document.querySelector(".thread-tabs");
const chatInput = document.querySelector(".chat-input");
const globalSearch = document.querySelector("#globalSearch");
const toast = document.querySelector("#toast");
const callControls = document.querySelector("#callControls");
const addPeople = document.querySelector("#addPeople");
const moreCall = document.querySelector("#moreCall");
const callMenu = document.querySelector("#callMenu");
const peopleModal = document.querySelector("#peopleModal");
const closePeopleModal = document.querySelector("#closePeopleModal");
const cancelPeople = document.querySelector("#cancelPeople");
const confirmPeople = document.querySelector("#confirmPeople");
const peopleSearch = document.querySelector("#peopleSearch");
const peopleResults = document.querySelector("#peopleResults");
const selectedPeople = document.querySelector("#selectedPeople");
const mentionPicker = document.querySelector("#mentionPicker");
const formatToggle = document.querySelector("#formatToggle");
const emojiToggle = document.querySelector("#emojiToggle");
const mediaToggle = document.querySelector("#mediaToggle");
const fileToggle = document.querySelector("#fileToggle");
const formatPicker = document.querySelector("#formatPicker");
const emojiPicker = document.querySelector("#emojiPicker");
const attachmentTray = document.querySelector("#attachmentTray");
const imageUpload = document.querySelector("#imageUpload");
const fileUpload = document.querySelector("#fileUpload");
const imagePreviewModal = document.querySelector("#imagePreviewModal");
const imagePreviewContent = document.querySelector("#imagePreviewContent");
const imagePreviewTitle = document.querySelector("#imagePreviewTitle");
const imagePreviewDownload = document.querySelector("#imagePreviewDownload");
const closeImagePreview = document.querySelector("#closeImagePreview");
const breakModal = document.querySelector("#breakModal");
const breakTypeGrid = document.querySelector("#breakTypeGrid");
const closeBreakModal = document.querySelector("#closeBreakModal");
const cancelBreakModal = document.querySelector("#cancelBreakModal");
const wfhModal = document.querySelector("#wfhModal");
const wfhReason = document.querySelector("#wfhReason");
const closeWfhModal = document.querySelector("#closeWfhModal");
const cancelWfhModal = document.querySelector("#cancelWfhModal");
const submitWfhRequest = document.querySelector("#submitWfhRequest");
const addCalendarEvent = document.querySelector("#addCalendarEvent");
const calendarMonthLabel = document.querySelector("#calendarMonthLabel");
const calendarGrid = document.querySelector("#calendarGrid");
const meetingList = document.querySelector("#meetingList");
const calendarPrev = document.querySelector("#calendarPrev");
const calendarNext = document.querySelector("#calendarNext");
const calendarModal = document.querySelector("#calendarModal");
const closeCalendarModal = document.querySelector("#closeCalendarModal");
const cancelCalendarModal = document.querySelector("#cancelCalendarModal");
const saveCalendarEvent = document.querySelector("#saveCalendarEvent");
const calendarTitle = document.querySelector("#calendarTitle");
const calendarType = document.querySelector("#calendarType");
const calendarLocation = document.querySelector("#calendarLocation");
const calendarVisibility = document.querySelector("#calendarVisibility");
const calendarAttendees = document.querySelector("#calendarAttendees");
const calendarStart = document.querySelector("#calendarStart");
const calendarEnd = document.querySelector("#calendarEnd");
const calendarDescription = document.querySelector("#calendarDescription");
const activityView = document.querySelector("#activityView");
const activityList = document.querySelector("#activityList");
const activityFilters = document.querySelector("#activityFilters");
const timesheetWeekGrid = document.querySelector("#timesheetWeekGrid");
const timesheetDetailHeading = document.querySelector("#timesheetDetailHeading");
const timesheetDetailCard = document.querySelector("#timesheetDetailCard");
const timesheetTask = document.querySelector("#timesheetTask");
const timesheetHours = document.querySelector("#timesheetHours");
const timesheetNotes = document.querySelector("#timesheetNotes");
const saveTimesheetEntry = document.querySelector("#saveTimesheetEntry");
const clearTimesheetEntry = document.querySelector("#clearTimesheetEntry");
const submitWeeklyTimesheet = document.querySelector("#submitWeeklyTimesheet");
const timesheetMiniCalendar = document.querySelector("#timesheetMiniCalendar");
const timesheetMonthPrev = document.querySelector("#timesheetMonthPrev");
const timesheetMonthNext = document.querySelector("#timesheetMonthNext");
const timesheetSummaryChip = document.querySelector("#timesheetSummaryChip");
const timesheetSummaryList = document.querySelector("#timesheetSummaryList");
const timesheetDayState = document.querySelector("#timesheetDayState");
const leaveTypeInput = document.querySelector("#leaveTypeInput");
const leaveReasonCategoryInput = document.querySelector("#leaveReasonCategoryInput");
const leaveStartInput = document.querySelector("#leaveStartInput");
const leaveEndInput = document.querySelector("#leaveEndInput");
const leaveReasonInput = document.querySelector("#leaveReasonInput");
const submitLeaveRequest = document.querySelector("#submitLeaveRequest");
const resetLeaveForm = document.querySelector("#resetLeaveForm");
const leaveRequestList = document.querySelector("#leaveRequestList");
const leaveBalanceGrid = document.querySelector("#leaveBalanceGrid");
const leaveCalendarGrid = document.querySelector("#leaveCalendarGrid");
const leaveMonthLabel = document.querySelector("#leaveMonthLabel");
const leaveSelectionSummary = document.querySelector("#leaveSelectionSummary");
const leaveMonthPrev = document.querySelector("#leaveMonthPrev");
const leaveMonthNext = document.querySelector("#leaveMonthNext");
const leavePendingChip = document.querySelector("#leavePendingChip");

let activeConversationId = null;
let activeRecipientId = null;
let chatUsers = [];
let activeChatFilter = "All";
let activeThreadTab = "Chat";
let pendingPeople = new Set();
let mentionQuery = null;
let mentionStart = -1;
let unreadNotificationCount = 0;
let onlineUserIds = new Set();
let draftConversationIds = new Set();
let calendarEvents = [];
let calendarMonth = new Date();
let selectedCalendarDate = localDateKey(new Date());
let activityItems = [];
let activeActivityFilter = "All";
let attendanceInitialized = false;
let attendanceState = {
  locationStatus: "unknown",
  locationLabel: "Pending verification",
  lastDistanceMeters: null,
  wfhStatus: "none",
  wfhReason: "",
  loggedIn: false,
  loginAt: null,
  logoutAt: null,
  activeBreakType: null,
  breakStartedAt: null,
  todayWorkedMinutes: 0,
  lastSessionMinutes: 0,
};
let pendingAttachments = [];
let selectedTimesheetDate = localDateKey(new Date());
let timesheetCalendarMonth = new Date();
let leaveCalendarMonth = new Date();
let leaveRangeAnchor = null;
let currentTimesheetWeekStart = null;
let timesheetEntries = {};
let leaveTrackerRequests = [];
const leaveBalancesState = [
  ["Annual", 12, "days available"],
  ["Casual", 4, "days available"],
  ["Sick", 2, "days available"],
  ["Pending", 3, "days in approval"],
];

const defaultLeaveTypes = [
  { name: "Sick Leave", balance: 8, approvalFlow: "Manager only" },
  { name: "Casual Leave", balance: 6, approvalFlow: "Manager only" },
  { name: "EL", balance: 12, approvalFlow: "Manager then HR" },
  { name: "Flexi (Optional Holiday)", balance: 2, approvalFlow: "No approval required" },
  { name: "Comp Off", balance: 3, approvalFlow: "Manager only" },
  { name: "Bereavement Leave", balance: 5, approvalFlow: "Manager then HR" },
  { name: "Maternity Leave", balance: 90, approvalFlow: "Manager then HR" },
  { name: "Paternity Leave", balance: 10, approvalFlow: "Manager then HR" },
];

const publicHolidays = [
  { date: "2026-05-01", name: "Labour Day" },
  { date: "2026-05-14", name: "Public Holiday" },
];

const holidayLocationsByCountry = {
  India: ["Hyderabad", "Bangalore", "Chennai", "Mumbai", "Delhi"],
  US: ["New York", "California", "Texas", "Remote"],
  UK: ["London", "Manchester", "Scotland", "Remote"],
};

const defaultScopedHolidays = [
  { country: "India", location: "Hyderabad", name: "New Year's Day", date: "2026-01-01", type: "public" },
  { country: "India", location: "Hyderabad", name: "Sankranti", date: "2026-01-14", type: "public" },
  { country: "India", location: "Hyderabad", name: "Republic Day", date: "2026-01-26", type: "public" },
  { country: "India", location: "Hyderabad", name: "Holi", date: "2026-03-04", type: "public" },
  { country: "India", location: "Hyderabad", name: "Eid al-Fitr", date: "2026-03-20", type: "optional" },
  { country: "India", location: "Hyderabad", name: "Labour Day", date: "2026-05-01", type: "public" },
  { country: "India", location: "Hyderabad", name: "Telangana Formation Day", date: "2026-06-02", type: "public" },
  { country: "India", location: "Hyderabad", name: "Gandhi Jayanti", date: "2026-10-02", type: "public" },
  { country: "India", location: "Hyderabad", name: "Dussehra", date: "2026-10-20", type: "optional" },
  { country: "India", location: "Hyderabad", name: "Diwali (Deepavali)", date: "2026-11-08", type: "optional" },
  { country: "India", location: "Hyderabad", name: "Guru Nanak Jayanti", date: "2026-11-24", type: "optional" },
  { country: "India", location: "Hyderabad", name: "Christmas Day", date: "2026-12-25", type: "public" },
  { country: "India", location: "Bangalore", name: "New Year's Day", date: "2026-01-01", type: "public" },
  { country: "India", location: "Bangalore", name: "Sankranti", date: "2026-01-14", type: "public" },
  { country: "India", location: "Bangalore", name: "Republic Day", date: "2026-01-26", type: "public" },
  { country: "India", location: "Bangalore", name: "Holi", date: "2026-03-04", type: "optional" },
  { country: "India", location: "Bangalore", name: "Labour Day", date: "2026-05-01", type: "public" },
  { country: "India", location: "Bangalore", name: "Gandhi Jayanti", date: "2026-10-02", type: "public" },
  { country: "India", location: "Bangalore", name: "Dussehra", date: "2026-10-20", type: "optional" },
  { country: "India", location: "Bangalore", name: "Diwali (Deepavali)", date: "2026-11-08", type: "optional" },
  { country: "India", location: "Bangalore", name: "Guru Nanak Jayanti", date: "2026-11-24", type: "optional" },
  { country: "India", location: "Bangalore", name: "Christmas Day", date: "2026-12-25", type: "public" },
  { country: "US", location: "New York", name: "New Year's Day", date: "2026-01-01", type: "public" },
  { country: "US", location: "New York", name: "Martin Luther King Jr. Day", date: "2026-01-19", type: "public" },
  { country: "US", location: "New York", name: "Presidents' Day", date: "2026-02-16", type: "public" },
  { country: "US", location: "New York", name: "Memorial Day", date: "2026-05-25", type: "public" },
  { country: "US", location: "New York", name: "Juneteenth", date: "2026-06-19", type: "optional" },
  { country: "US", location: "New York", name: "Independence Day Observed", date: "2026-07-03", type: "public" },
  { country: "US", location: "New York", name: "Labor Day", date: "2026-09-07", type: "public" },
  { country: "US", location: "New York", name: "Thanksgiving Day", date: "2026-11-26", type: "public" },
  { country: "US", location: "New York", name: "Christmas Day", date: "2026-12-25", type: "public" },
  { country: "UK", location: "London", name: "New Year's Day", date: "2026-01-01", type: "public" },
  { country: "UK", location: "London", name: "Good Friday", date: "2026-04-03", type: "public" },
  { country: "UK", location: "London", name: "Easter Monday", date: "2026-04-06", type: "public" },
  { country: "UK", location: "London", name: "Early May Bank Holiday", date: "2026-05-04", type: "public" },
  { country: "UK", location: "London", name: "Spring Bank Holiday", date: "2026-05-25", type: "public" },
  { country: "UK", location: "London", name: "Summer Bank Holiday", date: "2026-08-31", type: "optional" },
  { country: "UK", location: "London", name: "Autumn Bank Holiday", date: "2026-10-26", type: "public" },
  { country: "UK", location: "London", name: "Christmas Day", date: "2026-12-25", type: "public" },
  { country: "UK", location: "London", name: "Boxing Day Substitute", date: "2026-12-28", type: "public" },
];

const emojiPalette = ["😀", "😄", "😊", "😂", "😍", "👍", "👏", "🙏", "🎉", "🔥", "💡", "✅", "⭐", "📌", "🚀", "❤️"];

function inferAttachmentKind(name = "", mimeType = "") {
  const lowerName = name.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(lowerName)) return "image";
  if (lowerMime.includes("pdf") || lowerName.endsWith(".pdf")) return "pdf";
  if (
    lowerMime.includes("word") ||
    lowerMime.includes("officedocument.wordprocessingml") ||
    /\.(doc|docx)$/i.test(lowerName)
  ) return "word";
  if (
    lowerMime.includes("sheet") ||
    lowerMime.includes("excel") ||
    /\.(xls|xlsx|csv)$/i.test(lowerName)
  ) return "sheet";
  if (
    lowerMime.includes("presentation") ||
    lowerMime.includes("powerpoint") ||
    /\.(ppt|pptx)$/i.test(lowerName)
  ) return "slides";
  return "file";
}

let unreadState = conversations.reduce((state, item) => {
  state[item.id] = Number(item.unread || 0);
  return state;
}, {});
let currentUserId = null;
let adminDepartmentRecords = [];
let adminDepartments = [];
let adminEmployees = [];
let teamStatusLoadPromise = null;
let assignmentRules = loadAssignmentRules();
let leavePolicyState = loadLeavePolicyState();
let leavePolicySaveTimer = null;
let timesheetControlState = loadTimesheetControlState();
let auditLogs = loadAuditLogs();
adminEmployees = normalizeReportingLines(adminEmployees);
assignmentRules = normalizeAssignmentRules(assignmentRules);

function rebuildUnreadState() {
  unreadState = conversations.reduce((state, item) => {
    state[item.id] = Number(item.unread || 0);
    return state;
  }, {});
}

function hydrateChatState(state) {
  currentUserId = state.current_user_id || "you";
  directory = state.directory || [];
  conversations = state.conversations || [];
  conversationMembers = state.conversation_members || {};
  conversationMessages = state.conversation_messages || {};
  rebuildUnreadState();
  if (!conversations.some((item) => item.id === activeConversationId)) {
    activeConversationId = conversations[0].id || "";
  }
}

function parseChatPayload(body = "", attachments = []) {
  const rawBody = String(body || "");
  if (rawBody.startsWith("__WAVELYNK_CHAT__")) {
    try {
      const payload = JSON.parse(rawBody.replace("__WAVELYNK_CHAT__", ""));
      return {
        body: payload.body || "",
        attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
      };
    } catch {
      return { body: rawBody, attachments: attachments || [] };
    }
  }
  return { body: rawBody, attachments: attachments || [] };
}

async function fetchJson(url, options = {}) {
  const token = sessionStorage.getItem("hrms_access_token");
  const response = await fetch(url, {
    credentials: "include", // 🔥 ADD THIS LINE
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let detail = `Request failed: ${response.status}`;
    try {
      const payload = await response.json();
      detail = payload.detail || detail;
    } catch {
      // fallback
    }
    if (response.status === 401) {
      handleAuthExpired();
    }
    throw new Error(detail);
  }

  if (response.status === 204) return null;

  return response.json();
}
/* ===== ATTENDANCE BACKEND START ===== */

async function loadAttendanceStateFromBackend() {
  try {
    const logs = await fetchJson("/api/v1/attendance/me");

    window.attendanceLogs = Array.isArray(logs) ? logs : [];

    applyAttendanceLogs(window.attendanceLogs);
    renderSchedule();
  } catch (error) {
    console.warn("Attendance backend load failed", error);

    window.attendanceLogs = [];
    applyAttendanceLogs([]);
    renderSchedule();
  }

  updateAttendancePriority();
  refreshAttendanceDashboard();
  updateClock();
}

function applyAttendanceLogs(logs = []) {
  const sortedDesc = [...logs].sort(
    (a, b) => parseAttendanceDate(b.captured_at) - parseAttendanceDate(a.captured_at)
  );

  const sortedAsc = [...logs].sort(
    (a, b) => parseAttendanceDate(a.captured_at) - parseAttendanceDate(b.captured_at)
  );

  const today = new Date();
  let openLoginAt = null;
  let totalMinutes = 0;
  let lastSessionMinutes = 0;
  let todayWfhFound = false;

  sortedAsc.forEach((log) => {
    const capturedAt = parseAttendanceDate(log.captured_at);
    if (!capturedAt || !isSameLocalDay(capturedAt, today)) return;

    if (log.work_mode === "wfh") {
      todayWfhFound = true;
    }

    if (log.action === "login") {
      openLoginAt = capturedAt;
    }

    if (log.action === "logout" && openLoginAt) {
      const sessionMinutes = Math.max(
        0,
        Math.floor((capturedAt.getTime() - openLoginAt.getTime()) / 60000)
      );

      totalMinutes += sessionMinutes;
      lastSessionMinutes = sessionMinutes;
      openLoginAt = null;
    }
  });

  const lastLogin = sortedDesc.find((i) => i.action === "login");
  const lastLogout = sortedDesc.find((i) => i.action === "logout");
  const lastLog = sortedDesc[0];

  attendanceState.loginAt = lastLogin ? parseAttendanceDate(lastLogin.captured_at) : null;
  attendanceState.logoutAt = lastLogout ? parseAttendanceDate(lastLogout.captured_at) : null;

  attendanceState.loggedIn =
    !!lastLogin &&
    (!lastLogout ||
      parseAttendanceDate(lastLogin.captured_at) > parseAttendanceDate(lastLogout.captured_at));

  attendanceState.todayWorkedMinutes = totalMinutes;
  attendanceState.lastSessionMinutes = lastSessionMinutes;

  if (todayWfhFound) {
    attendanceState.wfhStatus = "requested";
  }

  if (lastLog) {
    attendanceState.lastDistanceMeters = Math.round(Number(lastLog.distance_meters || 0));

    attendanceState.locationStatus =
      lastLog.work_mode === "office" ? "office" : "outside";

    attendanceState.locationLabel =
      attendanceState.locationStatus === "office"
        ? `Inside office - ${attendanceState.lastDistanceMeters}m`
        : `Outside office - ${attendanceState.lastDistanceMeters}m`;
  }

  if (attendanceState.loggedIn && workState) {
    workState.classList.add("active");
    workState.innerHTML = "<span></span>Work session active";
  }

  if (!attendanceState.loggedIn && workState) {
    workState.classList.remove("active");
    workState.innerHTML = attendanceState.logoutAt
      ? `<span></span>Logged out - ${currentTimeLabel(attendanceState.logoutAt)}`
      : "<span></span>Not logged in";
  }
}

// Attendance capture is implemented in the main attendance flow section below.


/* ===== ATTENDANCE BACKEND END ===== */

function clearMeasuredLayout() {
  [
    appShell,
    contentGrid,
    mainContent,
    dashboardView,
    chatView,
    timesheetView,
    leaveView,
    calendarView,
    activityView,
    teamsLayout,
    teamsChatRail,
    teamsThread,
    chatThread,
  ].forEach((element) => {
    if (!element) return;
    element.style.height = "";
    element.style.maxHeight = "";
  });
}

function syncViewportLayout() {
  if (window.innerWidth <= 720) {
    document.body.classList.remove("workspace-page-scroll");
    clearMeasuredLayout();
    return;
  }

  const viewportHeight = window.innerHeight;
  const headerHeight = topHeader.getBoundingClientRect().height || 0;
  const contentStyles = window.getComputedStyle(contentGrid);
  const padTop = parseFloat(contentStyles.paddingTop) || 0;
  const padBottom = parseFloat(contentStyles.paddingBottom) || 0;
  const bottomSafeArea = document.body.dataset.view === "chat" ? 0 : 0;
  const contentHeight = Math.max(320, viewportHeight - headerHeight - bottomSafeArea);
  const availableHeight = Math.max(320, contentHeight - padTop - padBottom);
  const workspaceScrollVisible = false;
  document.body.classList.toggle("workspace-page-scroll", workspaceScrollVisible);
  if (workspaceScrollVisible) {
    clearMeasuredLayout();
    return;
  }
  if (appShell) appShell.style.height = `${viewportHeight}px`;
  if (contentGrid) contentGrid.style.height = `${contentHeight}px`;
  if (mainContent) mainContent.style.height = workspaceScrollVisible ? "" : `${availableHeight}px`;
  if (dashboardView) dashboardView.style.maxHeight = `${availableHeight}px`;
  if (chatView) {
    chatView.style.height = `${availableHeight}px`;
    chatView.style.maxHeight = `${availableHeight}px`;
  }
  if (timesheetView) {
    timesheetView.style.height = `${availableHeight}px`;
    timesheetView.style.maxHeight = `${availableHeight}px`;
  }
  if (leaveView) {
    leaveView.style.height = `${availableHeight}px`;
    leaveView.style.maxHeight = `${availableHeight}px`;
  }
  if (calendarView) {
    calendarView.style.height = `${availableHeight}px`;
    calendarView.style.maxHeight = `${availableHeight}px`;
  }
  if (activityView) {
    activityView.style.height = `${availableHeight}px`;
    activityView.style.maxHeight = `${availableHeight}px`;
  }
  if (teamsLayout) teamsLayout.style.height = `${availableHeight}px`;
  if (teamsChatRail) teamsChatRail.style.height = `${availableHeight}px`;
  if (teamsThread) teamsThread.style.height = `${availableHeight}px`;
  if (chatThread) {
    chatThread.style.height = "";
    chatThread.style.maxHeight = "";
  }
}

function syncPulseSuiteNav(viewName = document.body.dataset.view) {
  pulseSuiteNav.querySelectorAll("[data-suite-view]").forEach((button) => {
    const isActive = button.dataset.suiteView === viewName;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-current", isActive ? "page" : "false");
  });
  const badge = pulseSuiteNav.querySelector('[data-suite-view="chat"] em');
  if (badge) {
    const total = totalUnreadCount();
    badge.textContent = total;
    badge.classList.toggle("hidden", total === 0);
  }
}

function renderChatWorkspace() {
  document.querySelectorAll(".teams-app-rail").forEach((rail) => rail.remove());
  const pulseBrand = document.querySelector(".pulse-brand span");
  if (pulseBrand) pulseBrand.textContent = "\u{1F4AC}";
  document.querySelectorAll(".teams-app-rail button").forEach((button) => {
    const icon = button.querySelector("b");
    if (!icon) return;
    const app = button.dataset.app;
    icon.textContent = app === "Activity" ? "A" : app === "Calendar" ? "C" : "P";
  });
  if (formatToggle) formatToggle.textContent = "B";
  if (emojiToggle) emojiToggle.textContent = "\u{1F60A}";
  if (mediaToggle) mediaToggle.textContent = "\u{1F5BC}";
  if (fileToggle) fileToggle.textContent = "\u{1F4CE}";
  if (sendChat) sendChat.textContent = "Send \u2726";
  syncUnreadState();
  renderSidebar();
  renderChatList();
  renderThread();
  renderConversationMeta();
  syncViewportLayout();
}

function bindSidebarReveal() {
  if (!appShell) return;
  const sidebar = appShell.querySelector(".sidebar");
  if (!sidebar || sidebar.dataset.revealBound === "true") return;
  sidebar.dataset.revealBound = "true";

  const setOpen = (open) => {
    sidebar.classList.toggle("is-open", open);
    appShell.classList.toggle("sidebar-open", open);
    sidebarToggle?.setAttribute("aria-expanded", open ? "true" : "false");
  };

  sidebarToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(!sidebar.classList.contains("is-open"));
  });

  sidebar.addEventListener("click", (event) => {
    if (event.target.closest(".nav-item")) return;
    if (event.target.closest(".sidebar-toggle")) return;
    setOpen(!sidebar.classList.contains("is-open"));
  });
}
async function loadChatUsers() {
  try {
    const users = await fetchJson("/api/v1/auth/directory");
    chatUsers = users || [];
  } catch (err) {
    console.error("Users load failed", err);
    chatUsers = [];
  }
}

function findChatUser(userId) {
  return chatUsers.find((u) => Number(u.id) === Number(userId));
}

function nameFromEmail(email = "") {
  const localPart = String(email).split("@", 1)[0] || "";
  return localPart
    .replace(/[._-]+/g, " ")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function displayUserName(user) {
  if (!user) return "";
  return user.name || user.full_name || user.display_name || nameFromEmail(user?.email) || `User ${user.id}`;
}

function currentUserDisplayName() {
  return displayUserName(window.currentUser) || currentRoleProfile.name || "You";
}

function safeText(value, fallback = "") {
  return value == null ? fallback : String(value);
}

function safeStatus(value) {
  return safeText(value, "");
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeInitial(value, fallback = "U") {
  return (safeText(value, fallback).trim().slice(0, 1) || fallback).toUpperCase();
}

function safeInitials(value, fallback = "U") {
  const text = safeText(value, fallback).trim();
  return (text.split(/\s+/).map((part) => part[0]).join("").slice(0, 2) || fallback).toUpperCase();
}

function chatUserSearchText(userId) {
  const user = findChatUser(userId);
  if (!user) return String(userId);

  return [
    user.id,
    user?.employee_id,
    user?.employeeId,
    user.employee_code,
    user.name,
    user.full_name,
    user.job_title,
    user?.email,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
async function loadChatState() {
  try {
    const messages = await fetchJson("/api/v1/chat/messages");
    const loggedInUserId = Number(window.currentUser?.id);
    currentUserId = String(loggedInUserId);

    const grouped = {};
    for (const m of messages || []) {
      if (!m) continue;
      const otherUserId = Number(
        Number(m.sender_id) === loggedInUserId ? m.recipient_id : m.sender_id
      );
      if (!Number.isFinite(otherUserId)) continue;
      if (!grouped[otherUserId]) grouped[otherUserId] = [];
      grouped[otherUserId].push(m);
    }

    const nextConversations = [];
    const nextMessages = {};
    const nextUnread = {};
    const nextMembers = {};

    Object.keys(grouped).forEach((key) => {
      const userId = Number(key);
      const user = findChatUser(userId);
      const chat = grouped[userId].slice().sort((a, b) => parseChatDate(a.created_at) - parseChatDate(b.created_at));
      const last = chat[chat.length - 1];
      const lastPayload = parseChatPayload(last?.body || "", last?.attachments || []);

      const convId = String(userId);
      nextMessages[convId] = chat.map((m) => {
        const payload = parseChatPayload(m.body || "", m.attachments || []);
        return {
          id: m.id,
          side: Number(m.sender_id) === loggedInUserId ? "right" : "left",
          name:
            Number(m.sender_id) === loggedInUserId
              ? "You"
              : displayUserName(user),
          body: payload.body,
          time: formatChatTime(m.created_at),
          created_at: m.created_at,
          read: Array.isArray(m.read_by_user_ids) ? m.read_by_user_ids.includes(loggedInUserId) : false,
          mentions: [],
          attachments: payload.attachments,
        };
      });

      nextUnread[convId] = chat.filter((m) =>
        Number(m.sender_id) !== loggedInUserId
        && !(Array.isArray(m.read_by_user_ids) && m.read_by_user_ids.includes(loggedInUserId))
      ).length;

      nextMembers[convId] = [String(loggedInUserId), convId];

      const isOnline = onlineUserIds.has(userId);
      nextConversations.push({
        id: convId,
        user_id: userId,
        section: "Chats",
        name: displayUserName(user) || `User ${userId}`,
        role: user?.roles?.[0] || "User",
        preview: attachmentPreviewLabel(lastPayload.attachments, lastPayload.body) || "No messages yet",
        time: last?.created_at
          ? formatChatTime(last.created_at)
          : "",
        unread: nextUnread[convId] ? String(nextUnread[convId]) : "",
        online: isOnline,
        members: 2,
        details: [user?.email || "", user?.roles?.join(", ") || "Team", `${chat.length} messages`],
        email: user?.email || "",
        employee_id: user?.employee_id || user?.employeeId || userId,
      });
    });

    nextConversations.sort((a, b) => {
      const aLast = nextMessages[a.id]?.[nextMessages[a.id].length - 1]?.created_at || "";
      const bLast = nextMessages[b.id]?.[nextMessages[b.id].length - 1]?.created_at || "";
      return parseChatDate(bLast) - parseChatDate(aLast);
    });

    const existingById = new Map((conversations || []).map((c) => [String(c.id), c]));
    draftConversationIds.forEach((draftId) => {
      if (nextConversations.some((c) => String(c.id) === String(draftId))) return;
      const existing = existingById.get(String(draftId));
      const user = findChatUser(Number(draftId));
      nextConversations.push(
        existing || {
          id: String(draftId),
          user_id: Number(draftId),
          section: "Chats",
          name: displayUserName(user) || `User ${draftId}`,
          role: user?.roles?.[0] || "User",
          preview: "Start a conversation",
          time: "",
          unread: "",
          online: onlineUserIds.has(Number(draftId)),
          members: 2,
          details: [user?.email || "", user?.roles?.join(", ") || "Team", "0 messages"],
          email: user?.email || "",
          employee_id: Number(draftId),
        }
      );
      if (!nextMessages[String(draftId)]) nextMessages[String(draftId)] = [];
      if (!nextMembers[String(draftId)]) nextMembers[String(draftId)] = [String(loggedInUserId), String(draftId)];
      if (typeof nextUnread[String(draftId)] !== "number") nextUnread[String(draftId)] = 0;
    });

    conversations = nextConversations;
    conversationMessages = nextMessages;
    conversationMembers = nextMembers;
    unreadState = nextUnread;

    if (activeConversationId && !conversations.some((c) => c.id === activeConversationId)) {
      activeConversationId = null;
      activeRecipientId = null;
    }
    if (!activeConversationId && conversations.length) {
      activeConversationId = conversations[0].id;
      activeRecipientId = Number(conversations[0].user_id || conversations[0].id);
    }
    if (!conversations.length) {
      activeConversationId = null;
      activeRecipientId = null;
    }

    if (document.body.dataset.view === "chat" && activeConversationId && (nextUnread[activeConversationId] || 0) > 0) {
      await markConversationRead(activeConversationId);
    }

    syncUnreadState();
    renderChatList();
    renderThread();
    renderConversationMeta();
    syncViewportLayout();
  } catch (err) {
    console.error("Chat load failed", err);
  }
}

function formatChatTime(input) {
  const value = parseChatDate(input);
  if (Number.isNaN(value.getTime())) return "";
  return value
    .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })
    .replace(/\sx(AM|PM)$/i, (match) => ` ${match.trim().toLowerCase()}`);
}

function parseChatDate(input) {
  if (input instanceof Date) return input;
  const text = String(input || "");
  if (!text) return new Date(NaN);
  const hasTimezone = /(Z|[+-]\d{2}:\d{2})$/i.test(text);
  return new Date(hasTimezone ? text : `${text}Z`);
}

async function loadPresenceState() {
  try {
    const state = await fetchJson("/api/v1/chat/presence");
    onlineUserIds = new Set((state.online_user_ids || []).map((id) => Number(id)));
  } catch (error) {
    onlineUserIds = new Set();
  }
}

async function loadCalendarEvents() {
  const res = await fetch("/api/v1/calendar/events", {
    credentials: "include"
  });

  calendarEvents = await res.json();
  renderCalendar();
}

async function loadActivityFeed() {
  activityItems = await fetchJson("/api/v1/activity/feed");
  renderActivityFeed();
}

let knownNotificationIds = new Set();
let notificationFirstLoadDone = false;

async function loadNotificationState() {
  try {
    const notifications = await fetchJson("/api/v1/notifications?limit=30");
    window.hrmsNotifications = Array.isArray(notifications) ? notifications : [];

    unreadNotificationCount = window.hrmsNotifications.filter((item) => !item.read_at).length;

    updateNotificationBadge();
    renderNotificationDropdown();
    renderAnnouncements();
    showNewNotificationToasts();

    knownNotificationIds = new Set(window.hrmsNotifications.map((item) => Number(item.id)));
    notificationFirstLoadDone = true;
  } catch (error) {
    console.warn("Notifications load failed", error);
    window.hrmsNotifications = [];
    unreadNotificationCount = 0;
    updateNotificationBadge();
    renderNotificationDropdown();
    renderAnnouncements();
  }
}

function updateNotificationBadge() {
  const notificationBadge = notificationToggle?.querySelector(".notification-badge");

  if (!notificationBadge) return;

  notificationBadge.textContent = String(unreadNotificationCount);
  notificationBadge.classList.toggle("hidden", unreadNotificationCount <= 0);
}

function notificationDisplayCopy(item = {}) {
  const rawTitle = String(item.title || item.subject || item.type || "Notification");
  const rawBody = String(item.body || item.message || "No details available.");
  const type = String(item.type || item.category || "").toLowerCase();

  if (type === "attendance" && rawTitle.toLowerCase() === "attendance captured") {
    return {
      title: "Attendance recorded",
      body: rawBody.replace(/attendance has been recorded/i, "attendance is recorded"),
    };
  }

  return {
    title: rawTitle,
    body: rawBody,
  };
}

function renderNotificationDropdown() {
  const list = document.querySelector("#notificationMenuList");
  if (!list) return;

  const notifications = Array.isArray(window.hrmsNotifications)
    ? window.hrmsNotifications
    : [];

  if (!notifications.length) {
    list.innerHTML = `
      <div class="notification-empty">
        <strong>No notifications</strong>
        <p>You are all caught up.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = notifications
    .map((item) => {
      const priority = item.priority || "info";
      const unreadClass = item.read_at ? "read" : "unread";
      const copy = notificationDisplayCopy(item);

      return `
        <button class="notification-menu-item ${priority} ${unreadClass}" type="button" data-notification-id="${item.id}">
          <span class="notification-dot"></span>
          <span>
            <strong>${escapeHtml(copy.title)}</strong>
            <small>${escapeHtml(copy.body)}</small>
            <em>${formatNotificationDate(item.created_at)}</em>
          </span>
        </button>
      `;
    })
    .join("");

  list.querySelectorAll("[data-notification-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.notificationId);
      const item = notifications.find((entry) => Number(entry.id) === id);

      await markNotificationRead(id);

      if (item?.action_url) {
        window.location.href = item.action_url;
      }
    });
  });
}

function showNewNotificationToasts() {
  if (!notificationFirstLoadDone) return;

  const notifications = Array.isArray(window.hrmsNotifications)
    ? window.hrmsNotifications
    : [];

  notifications
    .filter((item) => !item.read_at && !knownNotificationIds.has(Number(item.id)))
    .slice(0, 3)
    .forEach((item) => {
      showNotificationToast(item);
    });
}

function showNotificationToast(item) {
  let container = document.querySelector("#globalNotificationToastStack");

  if (!container) {
    container = document.createElement("div");
    container.id = "globalNotificationToastStack";
    container.className = "global-notification-toast-stack";
    document.body.appendChild(container);
  }

  const toastEl = document.createElement("button");
  toastEl.type = "button";
  toastEl.className = `global-notification-toast ${item.priority || "info"}`;
  const copy = notificationDisplayCopy(item);

  toastEl.innerHTML = `
    <strong>${escapeHtml(copy.title)}</strong>
    <span>${escapeHtml(copy.body)}</span>
  `;

  toastEl.addEventListener("click", async () => {
    await markNotificationRead(item.id);
    toastEl.remove();

    if (item.action_url) {
      window.location.href = item.action_url;
    }
  });

  container.appendChild(toastEl);

  requestAnimationFrame(() => {
    toastEl.classList.add("show");
  });

  setTimeout(() => {
    toastEl.classList.remove("show");
    setTimeout(() => toastEl.remove(), 250);
  }, 5500);
}

async function markNotificationRead(id) {
  if (!id) return;

  try {
    await fetchJson(`/api/v1/notifications/${id}/read`, {
      method: "PATCH",
    });

    await loadNotificationState();
  } catch (error) {
    console.warn("Mark notification read failed", error);
  }
}

async function markAllNotificationsRead() {
  try {
    await fetchJson("/api/v1/notifications/read-all", {
      method: "PATCH",
    });

    await loadNotificationState();
  } catch (error) {
    showToast(error.message || "Notifications could not be updated.");
  }
}

function formatNotificationDate(value) {
  if (!value) return "Live";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Live";

  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showView(viewName, targetId) {
  document.body.dataset.view = viewName || "dashboard";
  document.body.dataset.surface = viewName || "dashboard";
  const isChat = viewName === "chat";
  const isProfile = viewName === "profile";
  const isAdmin = viewName === "admin";
  const isTimesheet = viewName === "timesheet";
  const isLeave = viewName === "leave";
  const isCalendar = viewName === "calendar";
  const isActivity = viewName === "activity";
  if (isChat && globalSearch) {
    globalSearch.value = "";
  }
  syncPulseSuiteNav(viewName);
  dashboardView.classList.toggle("hidden", isChat || isProfile || isAdmin || isTimesheet || isLeave || isCalendar || isActivity);
  profileView.classList.toggle("hidden", !isProfile);
  adminView.classList.toggle("hidden", !isAdmin);
  chatView.classList.toggle("hidden", !isChat);
  timesheetView.classList.toggle("hidden", !isTimesheet);
  leaveView.classList.toggle("hidden", !isLeave);
  activityView.classList.toggle("hidden", !isActivity);
  calendarView.classList.toggle("hidden", !isCalendar);
  contentGrid.classList.remove("workspace-page-scroll");
  mainContent.classList.remove("workspace-scroll");
  const target = document.getElementById(
    targetId || (
      isChat ? "chatView"
        : isProfile ? "profileView"
          : isAdmin ? "adminView"
            : isTimesheet ? "timesheetView"
              : isLeave ? "leaveView"
                : isCalendar ? "calendarView"
                  : isActivity ? "activityView"
                    : "dashboardSection"
    )
  );
  if (!isChat && !isProfile && !isAdmin && !isTimesheet && !isLeave && !isCalendar && !isActivity) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  target.classList.add("focus-pulse");
  window.setTimeout(() => target.classList.remove("focus-pulse"), 800);
  syncViewportLayout();
}

function pushAppPath(path) {
  if (!path || window.location.pathname === path) return;
  window.history.pushState({ path }, "", path);
  updateHistoryControls();
}

const viewPaths = {
  dashboard: "/dashboard",
  chat: "/chat",
  timesheet: "/timesheet",
  leave: "/leave",
  calendar: "/calendar",
  activity: "/activity",
  profile: "/profile",
};

const pathViews = {
  "/": ["dashboard", "dashboardSection", "Dashboard"],
  "/dashboard": ["dashboard", "dashboardSection", "Dashboard"],
  "/chat": ["chat", "chatView", "Chat"],
  "/timesheet": ["timesheet", "timesheetView", "Timesheet"],
  "/leave": ["leave", "leaveView", "Apply Leave"],
  "/calendar": ["calendar", "calendarView", "Calendar"],
  "/activity": ["activity", "activityView", "Activity"],
  "/profile": ["profile", "profileView", "Settings"],
};

function navigateToView(viewName, targetId, label, pushPath = true) {
  showView(viewName, targetId);
  if (label) setActiveSidebarLabel(label);
  if (pushPath) pushAppPath(viewPaths[viewName] || "/dashboard");
}

function updateHistoryControls() {
  if (backButton) backButton.disabled = window.history.length <= 1;
  if (forwardButton) forwardButton.disabled = false;
}

function setActiveSidebarLabel(label) {
  if (!sidebarNav || !label) return;
  sidebarNav.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.label === label || button.querySelector("b").textContent === label);
  });
}

function setActiveAdminButton(action) {
  document.querySelectorAll("[data-role-action]").forEach((button) => {
    const isAdminShortcut = Object.prototype.hasOwnProperty.call(adminActionPaths, button.dataset.roleAction);
    if (isAdminShortcut) {
      button.classList.toggle("active", button.dataset.roleAction === action);
    }
  });
}

function hideAdminPanels() {
  [employeeAdminPanel, rolesAccessPanel, leavePolicyPanel, teamLeavePanel, timesheetControlPanel, auditLogPanel].forEach((panel) => {
    if (!panel) return;
    panel.classList.add("hidden");
  });
}

function scrollAdminPanelIntoView(panel) {
  if (!panel || !adminView) return;
  window.setTimeout(() => {
    adminView.scrollTo({
      top: Math.max(0, panel.offsetTop - 14),
      behavior: "smooth",
    });
  }, 40);
}

function openAdminConsole(pushPath = true) {
  showView("admin", "adminView");
  hideAdminPanels();
  setActiveAdminButton("");
  setActiveSidebarLabel("Admin Console");
  if (pushPath) pushAppPath("/admin");
}

function openAdminModule(action, pushPath = true) {
  const path = adminActionPaths[action];
  showView("admin", "adminView");
  hideAdminPanels();
  setActiveAdminButton(action);
  setActiveSidebarLabel(adminActionLabels[action] || "Admin Console");
  if (pushPath && path) pushAppPath(path);
  if (action === "open-employees") {
    openEmployeeAdmin();
    return;
  }
  if (action === "manage-roles") {
    openRolesAccessAdmin();
    return;
  }
  if (action === "leave-policy") {
    openLeavePolicyAdmin();
    return;
  }
  if (action === "team-leaves") {
    openTeamLeaveAdmin();
    return;
  }
  if (action === "timesheet-freeze") {
    openTimesheetControlAdmin();
    return;
  }
  if (action === "audit-logs") {
    openAuditLogAdmin();
  }
}

function routeFromCurrentPath(pushPath = false) {
  const path = window.location.pathname;
  const viewRoute = pathViews[path];
  if (viewRoute) {
    const [viewName, targetId, label] = viewRoute;
    navigateToView(viewName, targetId, label, pushPath);
    return true;
  }
  if (path === "/admin") {
    openAdminConsole(pushPath);
    return true;
  }
  const adminAction = adminPathActions[path];
  if (adminAction) {
    openAdminModule(adminAction, pushPath);
    return true;
  }
  return false;
}

function handleProfileMenuAction(action) {
  profileDropdown.classList.remove("open");
  notificationDropdown.classList.remove("open");
  const focusProfileCard = (selector) => {
    const card = document.querySelector(selector);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("profile-focus-card");
    window.setTimeout(() => card.classList.remove("profile-focus-card"), 1200);
  };
  if (action === "view-profile") {
    navigateToView("profile", "profileView", "Settings");
    window.setTimeout(() => focusProfileCard("#profileDetailsCard"), 80);
    showToast("Profile opened.");
    return;
  }
  if (action === "account-settings") {
    navigateToView("profile", "profileView", "Settings");
    showToast("Account settings opened.");
    return;
  }
  if (action === "settings") {
    navigateToView("profile", "profileView", "Settings");
    showToast("Settings opened.");
    return;
  }
  if (action === "security") {
    navigateToView("profile", "profileView", "Settings");
    window.setTimeout(() => {
      focusProfileCard("#profileSecurityCard");
      currentPasswordInput?.focus();
    }, 80);
    showToast("Change password opened.");
    return;
  }
  if (action === "logout") {
    logoutToLogin();
  }
}

function enforcePasswordChangeIfRequired() {
  if (!window.currentUser?.password_change_required) {
    passwordChangeRequiredNotice?.classList.add("hidden");
    return;
  }

  passwordChangeRequiredNotice?.classList.remove("hidden");
  navigateToView("profile", "profileView", "Settings");
  showToast("Please change your temporary password.");
  currentPasswordInput?.focus();
}

function currentProfilePhotoDataUrl() {
  return profilePhotoPreview?.dataset.photoSrc || window.currentUser?.profile_photo_data_url || "";
}

function currentEmployeeDisplayId() {
  return window.currentUser?.employee_code || window.currentUser?.employee_id || "Not linked";
}

function hydrateProfileForm() {
  if (profileEmployeeIdInput) profileEmployeeIdInput.value = currentEmployeeDisplayId();
  if (profileEmailInput) profileEmailInput.value = window.currentUser?.email || "";
  if (profileMobileInput) profileMobileInput.value = window.currentUser?.mobile || "";
}

async function saveProfileDetails() {
  const mobile = profileMobileInput.value.trim() || "";

  if (saveProfileButton) {
    saveProfileButton.disabled = true;
    saveProfileButton.textContent = "Saving...";
  }

  try {
    const updated = await fetchJson("/api/v1/auth/me/profile", {
      method: "PUT",
      body: JSON.stringify({
        mobile,
        photo_data_url: currentProfilePhotoDataUrl(),
      }),
    });

    window.currentUser.mobile = updated.mobile || "";
    window.currentUser.profile_photo_data_url = updated.profile_photo_data_url || "";
    hydrateProfileForm();
    restoreProfilePhoto();
    showToast("Profile details saved.");
  } catch (err) {
    showToast(err.message || "Profile details could not be saved.");
  } finally {
    if (saveProfileButton) {
      saveProfileButton.disabled = false;
      saveProfileButton.textContent = "Save profile details";
    }
  }
}

async function savePasswordChanges() {
  const currentPassword = currentPasswordInput.value || "";
  const newPassword = newPasswordInput.value || "";
  const confirmPassword = confirmPasswordInput.value || "";
  const passwordRequired = Boolean(window.currentUser?.password_change_required);

  if (!passwordRequired && !currentPassword && !newPassword && !confirmPassword) {
    showToast("Enter your current and new password to change it.");
    currentPasswordInput.focus();
    return;
  }

  if (passwordRequired || newPassword || confirmPassword || currentPassword) {
    if (!currentPassword) {
      showToast("Enter current password before changing password.");
      currentPasswordInput.focus();
      return;
    }
    if (newPassword.length < 8) {
      showToast("New password must be at least 8 characters.");
      newPasswordInput.focus();
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast("New password and confirmation do not match.");
      confirmPasswordInput.focus();
      return;
    }

    try {
      if (savePasswordButton) {
        savePasswordButton.disabled = true;
        savePasswordButton.textContent = "Updating...";
      }

      await fetchJson("/api/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      currentPasswordInput.value = "";
      newPasswordInput.value = "";
      confirmPasswordInput.value = "";
      window.currentUser.password_change_required = false;
      passwordChangeRequiredNotice?.classList.add("hidden");
      showToast("Password updated. Use your new password next time.");
      return;
    } catch (err) {
      showToast(err.message || "Password update failed.");
      return;
    } finally {
      if (savePasswordButton) {
        savePasswordButton.disabled = false;
        savePasswordButton.textContent = "Change password";
      }
    }
  }
}

function updateProfilePhotoPreview(file) {
  if (!file || !profilePhotoPreview) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    applyProfilePhoto(reader.result);
    try {
      localStorage.setItem(profilePhotoStorageKey(), reader.result);
    } catch {
      showToast("Photo preview updated, but browser storage is full.");
      return;
    }
    saveProfileDetails();
  });
  reader.readAsDataURL(file);
}

function profilePhotoStorageKey() {
  const userKey = window.currentUser?.id || window.currentUser?.email || currentRoleProfile.email || "guest";
  return `hrms_profile_photo:${userKey}`;
}

function resetProfilePhotoAvatar(avatar, label = "") {
  if (!avatar) return;
  avatar.style.backgroundImage = "";
  avatar.dataset.photoSrc = "";
  avatar.classList.remove("has-photo");
  const fallback =
    label ||
    window.currentUser?.name ||
    window.currentUser?.full_name ||
    window.currentUser?.email ||
    currentRoleProfile.name ||
    currentRoleProfile.label ||
    "U";
  avatar.textContent = safeInitials(fallback, "U").slice(0, 2);
}

function applyProfilePhoto(src) {
  if (!profilePhotoPreview && !profileHeaderAvatar) return;
  if (!src) {
    resetProfilePhotoAvatar(profilePhotoPreview);
    resetProfilePhotoAvatar(profileHeaderAvatar);
    return;
  }
  [profilePhotoPreview, profileHeaderAvatar].forEach((avatar) => {
    if (!avatar) return;
    avatar.textContent = "";
    avatar.style.backgroundImage = `url("${src}")`;
    avatar.dataset.photoSrc = src;
    avatar.classList.add("has-photo");
  });
}

function restoreProfilePhoto() {
  const savedProfilePhoto = window.currentUser?.profile_photo_data_url || "";
  try {
    applyProfilePhoto(savedProfilePhoto || localStorage.getItem(profilePhotoStorageKey()));
  } catch {
    // Browser storage may be unavailable in restricted modes.
    applyProfilePhoto(savedProfilePhoto);
  }
}

function openProfilePhotoPreview() {
  const src = profilePhotoPreview.dataset.photoSrc
    || profileHeaderAvatar.dataset.photoSrc
    || avatarPreviewDataUrl(currentRoleProfile.name, currentRoleProfile.title, "#4f46e5", "#06b6d4");
  openImagePreview(src, "Profile photo");
}

function avatarPreviewDataUrl(name, role, colorA = "#7c3aed", colorB = "#38bdf8") {
  const cleanName = safeText(name, "Employee");
  const cleanRole = safeText(role, "Employee");
  const initials = safeInitials(cleanName, "E");
  const safeName = cleanName.replace(/[&<>"']/g, "");
  const safeRole = cleanRole.replace(/[&<>"']/g, "");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="${colorA}"/>
          <stop offset="1" stop-color="${colorB}"/>
        </linearGradient>
      </defs>
      <rect width="720" height="720" rx="72" fill="#f8fafc"/>
      <circle cx="360" cy="292" r="150" fill="url(#g)" opacity="0.95"/>
      <text x="360" y="330" text-anchor="middle" font-family="Arial, sans-serif" font-size="104" font-weight="800" fill="#ffffff">${initials}</text>
      <text x="360" y="505" text-anchor="middle" font-family="Arial, sans-serif" font-size="46" font-weight="800" fill="#0f172a">${safeName}</text>
      <text x="360" y="565" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="600" fill="#64748b">${safeRole}</text>
    </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function openConversationAvatarPreview(conversation = activeConversation()) {
  if (!conversation) return;
  openImagePreview(
    avatarPreviewDataUrl(conversation.name, conversation.role, conversation.online ? "#7c3aed" : "#64748b", "#14b8a6"),
    `${conversation.name} photo`,
  );
}

function applyRoleWorkspace() {
  document.body.dataset.role = currentRole;
  const brandPortal = document.querySelector(".sidebar-brand span");
  if (brandPortal) brandPortal.textContent = currentRoleProfile.portal;
  const profileStrong = profileToggle.querySelector("strong");
  const profileSmall = profileToggle.querySelector("small");
  if (profileStrong) profileStrong.textContent = currentRoleProfile.name;
  if (profileSmall) profileSmall.textContent = currentRoleProfile.title;
  const profileEmail = profileDropdown.querySelector("strong");
  if (profileEmail) profileEmail.textContent = currentRoleProfile.email;
  const welcomeTitle = document.querySelector("#dashboardSection h1");
  const welcomeNote = document.querySelector("#dashboardSection .welcome-note");
  if (welcomeTitle) welcomeTitle.textContent = currentRoleProfile.headline;
  if (welcomeNote) welcomeNote.textContent = currentRoleProfile.note;
  if (profileHeaderAvatar && !profileHeaderAvatar.classList.contains("has-photo")) {
    resetProfilePhotoAvatar(profileHeaderAvatar);
  }
}

function defaultAdminEmployees() {
  return [];
}

function formatEmployeeId(number) {
  return `260${String(number).padStart(3, "0")}`;
}

function employeeIdNumber(employeeId) {
  const match = String(employeeId || "").match(/^260(\d{3,})$/);
  return match ? Number(match[1]) : 0;
}

function seededEmployeeNumber(employee) {
  const directoryIndex = directory.findIndex((person) =>
    person.id === employee.id ||
    safeText(person.email).toLowerCase() === safeText(employee.email).toLowerCase()
  );
  return directoryIndex >= 0 ? directoryIndex + 1 : 0;
}

function assignStableEmployeeIds(employees) {
  const used = new Set();
  let maxNumber = directory.length;
  employees.forEach((employee) => {
    maxNumber = Math.max(maxNumber, employeeIdNumber(employee.employeeId), seededEmployeeNumber(employee));
  });
  return employees.map((employee) => {
    const seededNumber = seededEmployeeNumber(employee);
    const currentNumber = employeeIdNumber(employee.employeeId);
    let employeeId = seededNumber ? formatEmployeeId(seededNumber) : currentNumber ? employee.employeeId : "";
    if (!employeeId || used.has(employeeId)) {
      maxNumber += 1;
      employeeId = formatEmployeeId(maxNumber);
    }
    used.add(employeeId);
    return { ...employee, employeeId };
  });
}

function nextEmployeeId() {
  const maxNumber = (adminEmployees || []).reduce((max, employee) => Math.max(max, employeeIdNumber(employee?.employeeId)), directory.length);
  return formatEmployeeId(maxNumber + 1);
}

function defaultAssignmentRules() {
  return [];
}

function uniqueValues(items) {
  return [...new Set(items.filter(Boolean).map((item) => item.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function adminProjects() {
  return uniqueValues([...(adminEmployees || []).map((employee) => employee?.project), ...(assignmentRules || []).map((rule) => rule?.project), "HRMS Revamp", "Payroll System", "Mobile App", "Support Desk"]);
}

function adminLocations() {
  return uniqueValues([...(adminEmployees || []).map((employee) => employee?.location), ...(assignmentRules || []).map((rule) => rule?.location), "Hyderabad", "Bangalore", "Chennai", "Remote"]);
}

function loadAssignmentRules() {
  try {
    const saved = localStorage.getItem("hrms_assignment_rules");
    return saved ? JSON.parse(saved) : defaultAssignmentRules();
  } catch {
    return defaultAssignmentRules();
  }
}

function saveAssignmentRules() {
  try {
    localStorage.setItem("hrms_assignment_rules", JSON.stringify(assignmentRules));
  } catch {
    showToast("Assignment rules saved for this session only.");
  }
}

function normalizeAssignmentRules(rules) {
  let changed = false;
  const normalized = rules.map((rule) => ({ ...rule }));
  normalized.forEach((rule) => {
    if (!isEligibleSupervisor(rule.supervisor)) {
      rule.supervisor = "";
      changed = true;
    }
    if (!isEligibleManager(rule.manager)) {
      rule.manager = "";
      changed = true;
    }
  });
  if (changed) {
    try {
      localStorage.setItem("hrms_assignment_rules", JSON.stringify(normalized));
    } catch {
      // Keep normalized assignment rules in memory if storage is unavailable.
    }
  }
  return normalized;
}

function normalizeEmployeeShape(employee) {
  return {
    ...employee,
    mobile: employee.mobile || "",
    personalEmail: employee.personalEmail || "",
    jobTitle: employee.jobTitle || employee.role || "Employee",
    employmentType: employee.employmentType || "Full-time",
    dateJoined: employee.dateJoined || "2026-05-01",
    project: employee.project || "HRMS Revamp",
    location: employee.location || "Hyderabad",
    supervisor: employee.supervisor || "",
  };
}

function defaultAdminDepartments() {
  return [];
}

function loadAdminDepartments() {
  return [];
}

function saveAdminDepartments() {
  // Departments are persisted through the backend API.
}

function normalizeRoleForApi(role = "employee") {
  return safeText(role, "employee").toLowerCase();
}

function splitFullName(fullName = "") {
  const parts = safeText(fullName).trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || "",
    last_name: parts.slice(1).join(" ") || "User",
  };
}

function departmentNameById(id) {
  const department = adminDepartmentRecords.find((item) => Number(item.id) === Number(id));
  return department?.name || "";
}

function employeeNameById(id) {
  const employee = adminEmployees.find((item) => Number(item.id) === Number(id));
  return employee?.name || "";
}

function employeeIdByName(name) {
  const employee = adminEmployees.find((item) => safeText(item.name).toLowerCase() === safeText(name).toLowerCase());
  return employee ? Number(employee.id) : null;
}

function mapApiEmployee(employee, usersByEmployeeId = new Map()) {
  const user = usersByEmployeeId.get(Number(employee.id));
  const name = `${employee.first_name || ""} ${employee.last_name || ""}`.trim() || `Employee ${employee.id}`;
  return {
    id: String(employee.id),
    employeeId: employee.employee_code || `EMP-${employee.id}`,
    name,
    email: user?.email || "",
    mobile: user?.mobile || "",
    personalEmail: "",
    jobTitle: employee.job_title || "Employee",
    employmentType: "Full-time",
    dateJoined: employee.date_joined || "",
    department: departmentNameById(employee.department_id),
    departmentId: employee.department_id,
    project: "",
    location: "",
    role: user?.roles?.[0] || "employee",
    totpEnabled: Boolean(user?.totp_enabled),
    manager: employee.reports_to_id ? employeeNameById(employee.reports_to_id) : "",
    managerId: employee.reports_to_id || null,
    supervisor: "",
    active: true,
    raw: employee,
  };
}

async function loadAdminDataFromApi() {
  const [departments, employees, users] = await Promise.all([
    fetchJson("/api/v1/employees/departments"),
    fetchJson("/api/v1/employees"),
    fetchJson("/api/v1/auth/directory"),
  ]);

  adminDepartmentRecords = Array.isArray(departments) ? departments : [];
  adminDepartments = adminDepartmentRecords.map((item) => item.name);

  const usersByEmployeeId = new Map(
    (Array.isArray(users) ? users : [])
      .filter((user) => user?.employee_id)
      .map((user) => [Number(user.employee_id), user])
  );

  adminEmployees = (Array.isArray(employees) ? employees : [])
    .map((employee) => mapApiEmployee(employee, usersByEmployeeId))
    .sort((a, b) => safeText(a.employeeId).localeCompare(safeText(b.employeeId)));
}

function renderDepartmentOptions(selected = employeeDepartmentInput?.value) {
  if (!employeeDepartmentInput) return;

  employeeDepartmentInput.innerHTML = adminDepartmentRecords.length
    ? adminDepartmentRecords.map((department) => `<option value="${department.id}">${department.name}</option>`).join("")
    : `<option value="">Create a department first</option>`;

  if (selected && adminDepartmentRecords.some((department) => String(department.id) === String(selected))) {
    employeeDepartmentInput.value = String(selected);
  } else if (adminDepartmentRecords.length) {
    employeeDepartmentInput.value = String(adminDepartmentRecords[0].id);
  }
}

function renderProjectLocationOptions() {
  if (projectOptionsList) {
    projectOptionsList.innerHTML = adminProjects().map((project) => `<option value="${project}"></option>`).join("");
  }
  if (locationOptionsList) {
    locationOptionsList.innerHTML = adminLocations().map((location) => `<option value="${location}"></option>`).join("");
  }
}

async function addAdminDepartment() {
  const department = newDepartmentInput?.value.trim();
  if (!department) {
    showToast("Enter a department name.");
    newDepartmentInput?.focus();
    return;
  }

  const buttonText = addDepartmentButton?.textContent || "Add department";
  try {
    if (addDepartmentButton) {
      addDepartmentButton.disabled = true;
      addDepartmentButton.textContent = "Adding...";
    }
    await fetchJson("/api/v1/employees/departments", {
      method: "POST",
      body: JSON.stringify({ name: department }),
    });
    await loadAdminDataFromApi();
    renderDepartmentOptions();
    renderEmployeeManagerOptions();
    renderEmployeeAdmin();
    renderAccessOptions();
    renderAccessAdmin();
    if (newDepartmentInput) newDepartmentInput.value = "";
    recordAudit("Employee", `Added department ${department}`);
    showToast("Department added.");
  } catch (err) {
    showToast(err.message || "Department could not be added.");
  } finally {
    if (addDepartmentButton) {
      addDepartmentButton.disabled = false;
      addDepartmentButton.textContent = buttonText;
    }
  }
}

function loadAdminEmployees() {
  return [];
}

function saveAdminEmployees() {
  // Employees are persisted through the backend API.
  renderTeamStatusBoard();
}
function seedAuditLogs() {
  return [];
}

function loadAuditLogs() {
  return seedAuditLogs();
}

function saveAuditLogs() {
  // Audit logs are persisted by the backend.
}

function recordAudit(type, event) {
  auditLogs.unshift({ at: new Date().toISOString(), type, actor: currentRoleProfile.name, event });
  auditLogs = auditLogs.slice(0, 20);
  renderAuditLogs();
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function isValidMobile(value) {
  if (!value) return true;
  return /^[+\d][\d\s().-]{6,18}$/.test(value);
}

function renderAuditLogs() {
  if (!auditLogRows) return;
  const filter = auditFilterInput.value || "All";
  const rows = (auditLogs || []).filter((log) => log && (filter === "All" || log.type === filter));
  auditLogRows.innerHTML = rows
    .map((log) => `
      <tr>
        <td>${new Date(log.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
        <td><span class="status ${statusClassName(log.type)}">${log.type}</span></td>
        <td>${log.actor}</td>
        <td>${log.event}</td>
      </tr>`)
    .join("") || `<tr><td colspan="4">No audit records for this filter.</td></tr>`;
}

async function loadAuditLogsFromApi() {
  const filter = auditFilterInput?.value || "All";
  const params = new URLSearchParams({ limit: "150" });
  if (filter !== "All") params.set("category", filter);
  const rows = await fetchJson(`/api/v1/audit-logs?${params.toString()}`);
  auditLogs = (rows || []).map((log) => ({
    at: log.created_at,
    type: log.category,
    actor: log.actor_email || `User #${log.actor_user_id || "-"}`,
    event: log.message || log.action,
  }));
}

async function openAuditLogAdmin() {
  auditLogPanel.classList.remove("hidden");
  try {
    auditLogRows.innerHTML = `<tr><td colspan="4">Loading audit records...</td></tr>`;
    await loadAuditLogsFromApi();
    renderAuditLogs();
  } catch (err) {
    auditLogRows.innerHTML = `<tr><td colspan="4">${err.message || "Audit logs could not be loaded."}</td></tr>`;
  }
  scrollAdminPanelIntoView(auditLogPanel);
  showToast("Audit logs opened.");
}

function resetEmployeeForm() {
  employeeAdminForm?.reset();
  if (employeeRecordId) employeeRecordId.value = "";
  if (employeeEmailInput) employeeEmailInput.disabled = false;
  employeeCredentialNotice?.classList.add("hidden");
  if (employeeCredentialNotice) employeeCredentialNotice.innerHTML = "";
  renderDepartmentOptions();
  renderProjectLocationOptions();
  if (employeeMobileInput) employeeMobileInput.value = "";
  if (employeePersonalEmailInput) employeePersonalEmailInput.value = "";
  if (employeeJobTitleInput) employeeJobTitleInput.value = "Employee";
  if (employeeEmploymentTypeInput) employeeEmploymentTypeInput.value = "Full-time";
  if (employeeJoinDateInput) employeeJoinDateInput.value = todayInputValue();
  if (employeeProjectInput) employeeProjectInput.value = "";
  if (employeeLocationInput) employeeLocationInput.value = "";
  renderEmployeeManagerOptions("");
  if (employeeRoleInput) employeeRoleInput.value = "Employee";
  if (employeeManagerInput) employeeManagerInput.value = "";
}

function showEmployeeCredentialNotice({ name, email, password }) {
  if (!employeeCredentialNotice) return;
  employeeCredentialNotice.classList.remove("hidden");
  employeeCredentialNotice.innerHTML = `
    <strong>Employee created successfully.</strong>
    <span>Name: <b>${escapeHtml(name)}</b></span>
    <span>Login email: <code>${escapeHtml(email)}</code></span>
    <span>Temporary password: <code>${escapeHtml(password)}</code></span>
    <small>Share this password with the employee for first login. They will be asked to change it.</small>
  `;
}

function renderEmployeeAdmin() {
  if (!employeeAdminRows) return;
  employeeAdminRows.innerHTML = adminEmployees
    .map((employee) => `
      <tr class="employee-row" data-employee-id="${employee.id}">
        <td><span class="employee-id-pill">${employee.employeeId}</span></td>
        <td>
          <div class="employee-person">
            <span class="employee-avatar">${safeInitials(employee?.name)}</span>
            <span><strong>${employee?.name || "Employee"}</strong><small>${employee?.email || ""}</small></span>
          </div>
        </td>
        <td><strong>${employee.mobile || "Not added"}</strong><small>${employee.personalEmail || "No personal email"}</small></td>
        <td><strong>${employee.jobTitle || employee.role}</strong><small>${employee.employmentType || "Full-time"}${employee.dateJoined ? ` - Joined ${employee.dateJoined}` : ""}</small></td>
        <td><span class="soft-chip">${employee?.department || ""}</span></td>
        <td><span class="project-chip">${employee.project || "Not assigned"}</span></td>
        <td><span class="location-chip">${employee.location || "Not assigned"}</span></td>
        <td><span class="role-chip">${employee?.role || ""}</span></td>
        <td>${employee.manager || "Not assigned"}</td>
        <td><span class="status ${employee.active ? "approved" : "revoked"}">${employee.active ? "Active" : "Inactive"}</span></td>
        <td class="role-actions">
          <button type="button" data-employee-action="edit">Edit</button>
          <button type="button" data-employee-action="toggle">${employee.active ? "Deactivate" : "Reactivate"}</button>
        </td>
      </tr>`)
    .join("");
}

function managerCandidates() {
  return (adminEmployees || []).filter((employee) => employee?.active && ["manager", "hr", "admin"].includes(normalizeRoleForApi(employee.role)));
}

function supervisorCandidates() {
  return (adminEmployees || []).filter((employee) => employee?.active && ["supervisor", "manager", "hr", "admin"].includes(normalizeRoleForApi(employee.role)));
}

function isEligibleManager(name, employeeName = "") {
  return !name || managerCandidates().some((employee) => employee.name === name && employee.name !== employeeName);
}

function isEligibleSupervisor(name, employeeName = "") {
  return !name || supervisorCandidates().some((employee) => employee.name === name && employee.name !== employeeName);
}

function fallbackManagerName(employeeName = "") {
  return managerCandidates().find((employee) => employee.name !== employeeName)?.name || "";
}

function normalizeReportingLines(employees) {
  let changed = false;
  const normalized = employees.map((employee) => ({ ...employee }));
  const activeManagers = normalized.filter((employee) => employee.active && ["Manager", "Admin"].includes(employee.role));
  const activeSupervisors = normalized.filter((employee) => employee.active && ["Supervisor", "Manager", "Admin"].includes(employee.role));
  normalized.forEach((employee) => {
    const managerValid = !employee.manager || activeManagers.some((manager) => manager.name === employee.manager && manager.name !== employee.name);
    if (!managerValid) {
      employee.manager = activeManagers.find((manager) => manager.name !== employee.name).name || "";
      changed = true;
    }
    const supervisorValid = !employee.supervisor || activeSupervisors.some((supervisor) => supervisor.name === employee.supervisor && supervisor.name !== employee.name);
    if (!supervisorValid) {
      employee.supervisor = "";
      changed = true;
    }
  });
  if (changed) {
    try {
      localStorage.setItem("hrms_admin_employees", JSON.stringify(normalized));
    } catch {
      // Keep normalized reporting lines in memory if browser storage is unavailable.
    }
  }
  return normalized;
}

function reassignReportsForInactiveLeader(leader) {
  let managerMoves = 0;
  let supervisorMoves = 0;
  adminEmployees.forEach((employee) => {
    if (employee.id === leader.id) return;
    if (employee.manager === leader.name) {
      employee.manager = fallbackManagerName(employee.name);
      managerMoves += 1;
    }
    if (employee.supervisor === leader.name) {
      employee.supervisor = "";
      supervisorMoves += 1;
    }
  });
  return { managerMoves, supervisorMoves };
}

function renderEmployeeManagerOptions(selected = employeeManagerInput?.value, excludeId = employeeRecordId?.value) {
  if (!employeeManagerInput) return;
  const managers = managerCandidates()
    .filter((employee) => String(employee.id) !== String(excludeId));
  employeeManagerInput.innerHTML = `<option value="">Not assigned</option>${managers
    .map((employee) => `<option value="${employee.name}">${employee.name} (${employee.role})</option>`)
    .join("")}`;
  employeeManagerInput.value = selected && managers.some((employee) => employee.name === selected) ? selected : "";
}
function matchingRuleEmployees(rule) {
  return (adminEmployees || []).filter((employee) => {
    if (!employee || employee.active === false) return false;

    return (
      safeText(employee.project).toLowerCase() === safeText(rule.project).toLowerCase() &&
      safeText(employee.location).toLowerCase() === safeText(rule.location).toLowerCase() &&
      employee.name !== rule.supervisor &&
      employee.name !== rule.hr &&
      employee.name !== rule.manager
    );
  });
}

function applyAssignmentRule(rule) {
  const employees = matchingRuleEmployees(rule);

  employees.forEach((employee) => {
    if (rule.supervisor) employee.supervisor = rule.supervisor;
    if (rule.hr) employee.hr = rule.hr;
    if (rule.manager) employee.manager = rule.manager;
  });

  adminEmployees = normalizeReportingLines(adminEmployees);
  saveAdminEmployees();

  return employees.length;
}

function applyAssignmentRule(rule) {
  const employees = matchingRuleEmployees(rule);
  employees.forEach((employee) => {
    if (isEligibleSupervisor(rule.supervisor, employee.name)) employee.supervisor = rule.supervisor;
    if (isEligibleManager(rule.manager, employee.name)) employee.manager = rule.manager;
  });
  adminEmployees = normalizeReportingLines(adminEmployees);
  saveAdminEmployees();
  return employees.length;
}

function renderAssignmentRuleOptions() {
  const supervisorValue = ruleSupervisorInput?.value || "";
  const hrValue = ruleHrInput?.value || "";
  const managerValue = ruleManagerInput?.value || "";

  const activeEmployees = (adminEmployees || []).filter((e) => e.active !== false);

  const makeOptions = (employees, placeholder) => `
    <option value="">${placeholder}</option>
    ${employees
      .map((employee) => {
        const empId = employee.employeeId || employee.employee_id || employee.id || "";
        return `<option value="${employee.name}">${employee.name} ${empId ? `- ${empId}` : ""}</option>`;
      })
      .join("")}
  `;

  const supervisors = activeEmployees.filter((employee) => {
    const role = normalizeRoleForApi(employee.role);
    return ["supervisor", "manager", "hr", "admin"].includes(role);
  });

  const hrs = activeEmployees.filter((employee) => {
    const role = normalizeRoleForApi(employee.role);
    return ["hr", "admin"].includes(role);
  });

  const managers = activeEmployees.filter((employee) => {
    const role = normalizeRoleForApi(employee.role);
    return ["manager", "hr", "admin"].includes(role);
  });

  if (ruleSupervisorInput) {
    ruleSupervisorInput.innerHTML = makeOptions(supervisors, "Select supervisor");
    ruleSupervisorInput.value = supervisorValue;
  }

  if (ruleHrInput) {
    ruleHrInput.innerHTML = makeOptions(hrs, "Select HR");
    ruleHrInput.value = hrValue;
  }

  if (ruleManagerInput) {
    ruleManagerInput.innerHTML = makeOptions(managers, "Select manager");
    ruleManagerInput.value = managerValue;
  }
}

function renderAssignmentRules() {
  if (!assignmentRuleRows) return;

  assignmentRuleRows.classList.remove("hidden");

  if (assignmentRuleCount) {
    assignmentRuleCount.textContent = `${assignmentRules.length} rule${assignmentRules.length === 1 ? "" : "s"}`;
  }

  if (!assignmentRules.length) {
    assignmentRuleRows.innerHTML = `
      <div class="assignment-rule-card empty">
        <div class="rule-main">
          <strong>No assignment rules yet</strong>
          <small>Create project and location wise reporting mapping.</small>
        </div>
      </div>
    `;
    return;
  }

  assignmentRuleRows.innerHTML = assignmentRules
    .map((rule) => {
      const matchCount = matchingRuleEmployees(rule).length;

      return `
        <div class="assignment-rule-card" data-assignment-rule="${rule.id}">
          <div class="rule-main">
            <strong>${rule.project || "No project"}</strong>
            <small>${rule.location || "No location"}</small>
          </div>

          <div class="rule-meta">
            <span>Supervisor</span>
            <b>${rule.supervisor || "Not assigned"}</b>
          </div>

          <div class="rule-meta">
            <span>HR</span>
            <b>${rule.hr || "Not assigned"}</b>
          </div>

          <div class="rule-meta">
            <span>Manager</span>
            <b>${rule.manager || "Not assigned"}</b>
          </div>

          <div class="rule-meta">
            <span>Employees</span>
            <b>${matchCount}</b>
          </div>

          <div class="role-actions">
            <button type="button" data-rule-action="apply">Apply</button>
            <button type="button" data-rule-action="remove">Remove</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderAccessOptions(selectedEmployeeId = accessEmployeeInput.value) {
  if (!accessEmployeeInput || !accessSupervisorInput || !accessManagerInput) return;
  const currentSupervisor = accessSupervisorInput.value;
  const currentManager = accessManagerInput.value;
  const selectedPasswordResetEmployee = passwordResetEmployeeInput?.value || selectedEmployeeId;
  const employeeOptions = adminEmployees
    .map((employee) => `<option value="${employee.id}">${employee.name} - ${employee?.role || ""}</option>`)
    .join("");
  const selectedEmployee = adminEmployees.find((employee) => employee.id === selectedEmployeeId);
  const supervisorOptions = `<option value="">Not assigned</option>${supervisorCandidates()
    .filter((employee) => employee.id !== selectedEmployeeId)
    .map((employee) => `<option value="${employee.name}">${employee.name}</option>`)
    .join("")}`;
  const managerOptions = `<option value="">Not assigned</option>${managerCandidates()
    .filter((employee) => employee.id !== selectedEmployeeId)
    .map((employee) => `<option value="${employee.name}">${employee.name}</option>`)
    .join("")}`;
  accessEmployeeInput.innerHTML = employeeOptions;
  if (passwordResetEmployeeInput) passwordResetEmployeeInput.innerHTML = employeeOptions;
  if (selectedEmployee) accessEmployeeInput.value = selectedEmployee.id;
  if (passwordResetEmployeeInput) {
    passwordResetEmployeeInput.value = adminEmployees.some((employee) => employee.id === selectedPasswordResetEmployee)
      ? selectedPasswordResetEmployee
      : accessEmployeeInput.value;
  }
  accessSupervisorInput.innerHTML = supervisorOptions;
  accessManagerInput.innerHTML = managerOptions;
  accessSupervisorInput.value = isEligibleSupervisor(currentSupervisor, selectedEmployee.name) ? currentSupervisor : "";
  accessManagerInput.value = isEligibleManager(currentManager, selectedEmployee.name) ? currentManager : "";
}

function syncAccessFormFromEmployee() {
  const employee = adminEmployees.find((item) => item.id === accessEmployeeInput.value);
  if (!employee) return;
  renderAccessOptions(employee.id);
  if (passwordResetEmployeeInput) passwordResetEmployeeInput.value = employee.id;
  accessRoleInput.value = employee.role;
  accessSupervisorInput.value = isEligibleSupervisor(employee.supervisor, employee.name) ? employee.supervisor || "" : "";
  accessManagerInput.value = isEligibleManager(employee.manager, employee.name) ? employee.manager || "" : "";
}

function renderAccessAdmin() {
  if (!accessAdminRows) return;

  accessAdminRows.innerHTML = adminEmployees
    .map((employee) => {
      const role = employee?.role || "employee";
      const supervisor = employee.supervisor || "Not assigned";
      const manager = employee.manager || "Not assigned";

      return `
        <article class="access-card">
          <div class="access-person">
            <span class="access-avatar">${safeInitials(employee?.name || "Employee")}</span>
            <div>
              <strong>${employee?.name || "Employee"}</strong>
              <small>${employee?.email || "No email"}</small>
            </div>
          </div>

          <div class="access-meta">
            <div>
              <span>Role</span>
              <b>${role}</b>
            </div>
            <div>
              <span>Supervisor</span>
              <b>${supervisor}</b>
            </div>
            <div>
              <span>Manager</span>
              <b>${manager}</b>
            </div>
            <div>
              <span>Status</span>
              <b class="status ${employee.active ? "approved" : "revoked"}">
                ${employee.active ? "Active" : "Inactive"}
              </b>
            </div>
            <div>
              <span>Authenticator</span>
              <b>${employee.totpEnabled ? "Set up" : "Not set up"}</b>
            </div>
          </div>
        </article>
      `;
    })
    .join("") || `<div class="empty-state">No employees found.</div>`;
}

async function openRolesAccessAdmin() {
  rolesAccessPanel.classList.remove("hidden");

  try {
    await loadAdminDataFromApi();

    renderProjectLocationOptions();
    renderEmployeeManagerOptions();
    renderAssignmentRuleOptions();
    renderProjectLocationDropdowns();
    renderAccessOptions();
    syncAccessFormFromEmployee();
    renderAssignmentRules();
    renderAccessAdmin();
    renderEmployeeAdmin();
    renderTeamStatusBoard();


    scrollAdminPanelIntoView(rolesAccessPanel);
    showToast("Roles and access opened.");
  } catch (err) {
    showToast(err.message || "Roles and access could not be loaded.");
  }
}
function renderProjectLocationDropdowns() {
  const projects = [...new Set(adminEmployees.map(e => e.project).filter(Boolean))];
  const locations = [...new Set(adminEmployees.map(e => e.location).filter(Boolean))];

  ruleProjectInput.innerHTML = `
    <option value="">Select project</option>
    ${projects.map(p => `<option value="${p}">${p}</option>`).join("")}
  `;

  ruleLocationInput.innerHTML = `
    <option value="">Select location</option>
    ${locations.map(l => `<option value="${l}">${l}</option>`).join("")}
  `;
}
async function submitAccessAdmin(event) {
  event.preventDefault();

  const employee = adminEmployees.find((item) => item.id === accessEmployeeInput.value);
  if (!employee) return;

  const selectedManagerName = accessManagerInput.value || "";
  const reportsToId = selectedManagerName ? employeeIdByName(selectedManagerName) : null;

  if (selectedManagerName === employee.name || accessSupervisorInput.value === employee.name) {
    showToast("Employee cannot be their own supervisor or manager.");
    return;
  }

  if (!isEligibleSupervisor(accessSupervisorInput.value, employee.name)) {
    showToast("Supervisor must be an active supervisor, manager, HR, or admin.");
    accessSupervisorInput.focus();
    return;
  }

  if (!isEligibleManager(selectedManagerName, employee.name)) {
    showToast("Manager must be an active manager, HR, or admin.");
    accessManagerInput.focus();
    return;
  }

  try {
    const selectedRole = normalizeRoleForApi(accessRoleInput.value);
    const currentEmployeeRole = normalizeRoleForApi(employee.role);

    await fetchJson(`/api/v1/employees/${employee.id}`, {
      method: "PATCH",
      body: JSON.stringify({ reports_to_id: reportsToId }),
    });

    if (selectedRole && selectedRole !== currentEmployeeRole) {
      const users = await fetchJson("/api/v1/auth/users");
      const user = users.find((item) => Number(item.employee_id) === Number(employee.id));

      if (!user) {
        showToast("Reporting line updated, but user account was not found for role update.");
        return;
      }

      await fetchJson(`/api/v1/auth/users/${user.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: selectedRole }),
      });
    }

    await loadAdminDataFromApi();

    renderEmployeeAdmin();
    renderEmployeeManagerOptions();
    renderAccessOptions(employee.id);
    syncAccessFormFromEmployee();
    renderAssignmentRules();
    renderAccessAdmin();
    renderTeamStatusBoard();

    recordAudit("Access", `Updated access mapping for ${employee.name}`);
    showToast("Access mapping updated.");
  } catch (err) {
    showToast(err.message || "Access update failed.");
  }
}

async function submitPasswordResetAdmin(event) {
  event.preventDefault();

  const employee = adminEmployees.find((item) => item.id === passwordResetEmployeeInput?.value);
  const password = passwordResetInput?.value?.trim() || "";

  if (!employee) {
    showToast("Select an employee.");
    return;
  }

  if (password.length < 8) {
    showToast("Temporary password must be at least 8 characters.");
    passwordResetInput?.focus();
    return;
  }

  const button = passwordResetForm?.querySelector("button[type='submit']");
  const buttonText = button?.textContent || "Reset password";

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Resetting...";
    }

    await fetchJson(`/api/v1/auth/employees/${employee.id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({
        password,
        reset_authenticator: Boolean(passwordResetAuthenticatorInput?.checked),
      }),
    });

    if (passwordResetInput) passwordResetInput.value = "";
    await loadAdminDataFromApi();
    renderAccessOptions(employee.id);
    renderAccessAdmin();
    recordAudit("Access", `Reset password for ${employee.name}`);
    showToast(`Password reset for ${employee.name}.`);
  } catch (err) {
    showToast(err.message || "Password reset failed.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = buttonText;
    }
  }
}

function submitAssignmentRule(event) {
  event.preventDefault();

  const project = ruleProjectInput?.value?.trim() || "";
  const location = ruleLocationInput?.value?.trim() || "";
  const supervisor = ruleSupervisorInput?.value || "";
  const hr = ruleHrInput?.value || "";
  const manager = ruleManagerInput?.value || "";

  if (!project || !location) {
    showToast("Enter project and location.");
    return;
  }

  if (!supervisor || !hr || !manager) {
    showToast("Select supervisor, HR, and manager.");
    return;
  }

  const existingIndex = assignmentRules.findIndex((rule) =>
    safeText(rule.project).toLowerCase() === project.toLowerCase() &&
    safeText(rule.location).toLowerCase() === location.toLowerCase()
  );

  const newRule = {
    id: existingIndex >= 0 ? assignmentRules[existingIndex].id : `rule-${Date.now()}`,
    project,
    location,
    supervisor,
    hr,
    manager,
  };

  if (existingIndex >= 0) {
    assignmentRules.splice(existingIndex, 1, newRule);
  } else {
    assignmentRules = [newRule, ...assignmentRules];
  }

  saveAssignmentRules();
  setTimeout(() => {
    renderAssignmentRules();
  }, 0);
  const appliedCount = applyAssignmentRule(newRule);

  assignmentRuleForm.reset();

  renderAssignmentRuleOptions();
  renderAssignmentRules();
  renderAccessAdmin();
  renderEmployeeAdmin();
  renderEmployeeManagerOptions();
  renderTeamStatusBoard();

  requestAnimationFrame(() => {
    renderAssignmentRules();
    assignmentRuleRows?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  showToast(`Rule saved. ${appliedCount} employee(s) updated.`);
}

function handleAssignmentRuleAction(target) {
  const row = target.closest("[data-assignment-rule]");
  if (!row) return;

  const rule = assignmentRules.find((item) => String(item.id) === String(row.dataset.assignmentRule));
  if (!rule) return;

  if (target.dataset.ruleAction === "apply") {
    const appliedCount = applyAssignmentRule(rule);

    renderAssignmentRules();
    renderAccessAdmin();
    renderEmployeeAdmin();
    renderTeamStatusBoard();

    showToast(`${appliedCount} employee(s) updated.`);
    return;
  }

  if (target.dataset.ruleAction === "remove") {
    assignmentRules = assignmentRules.filter((item) => String(item.id) !== String(rule.id));
    saveAssignmentRules();
    renderAssignmentRules();
    showToast("Assignment rule removed.");
  }
}

function loadLeavePolicyState() {
  const fallback = {
    annual: 12,
    casual: 4,
    sick: 2,
    approvalFlow: "Supervisor then Manager",
    revokeRule: "Manager approval required",
    holidayCountry: "India",
    holidayLocation: "Hyderabad",
    leaveTypes: defaultLeaveTypes,
    holidays: defaultScopedHolidays,
  };
  try {
    const saved = localStorage.getItem("hrms_leave_policy");
    return normalizeLeavePolicyState(saved ? JSON.parse(saved) : fallback);
  } catch {
    return fallback;
  }
}

async function loadLeavePolicyStateFromBackend() {
  try {
    const policy = await fetchJson("/api/v1/leaves/policy");
    leavePolicyState = normalizeLeavePolicyState(policy);
    localStorage.setItem("hrms_leave_policy", JSON.stringify(leavePolicyState));
  } catch (error) {
    console.warn("Leave policy backend load failed. Using local fallback.", error);
    leavePolicyState = loadLeavePolicyState();
  }
}

function saveLeavePolicyState() {
  leavePolicyState = normalizeLeavePolicyState(leavePolicyState);
  localStorage.setItem("hrms_leave_policy", JSON.stringify(leavePolicyState));

  clearTimeout(leavePolicySaveTimer);
  leavePolicySaveTimer = setTimeout(async () => {
    try {
      const saved = await fetchJson("/api/v1/leaves/policy", {
        method: "PUT",
        body: JSON.stringify(leavePolicyState),
      });

      leavePolicyState = normalizeLeavePolicyState(saved);
      localStorage.setItem("hrms_leave_policy", JSON.stringify(leavePolicyState));
    } catch (error) {
      console.error("Leave policy backend save failed", error);
      showToast("Policy saved locally, but backend save failed.");
    }
  }, 250);
}

function normalizeLeavePolicyState(state = {}) {
  const country = state?.holidayCountry || "India";
  const location = state?.holidayLocation || "Hyderabad";
  const stateHolidays = Array.isArray(state?.holidays) ? state.holidays.filter(Boolean) : [];
  const holidays = mergeScopedHolidays(stateHolidays.map((holiday) => ({
    country: holiday?.country || country,
    location: holiday?.location || location,
    name: holiday?.name,
    date: holiday?.date,
    type: holiday?.type || "public",
  })));
  const savedLeaveTypes = Array.isArray(state?.leaveTypes) && state.leaveTypes.length
    ? state.leaveTypes
    : [
      { name: "Annual Leave", balance: safeNumber(state?.annual, 12), approvalFlow: state?.approvalFlow || "Manager then HR" },
      { name: "Casual Leave", balance: safeNumber(state?.casual, 4), approvalFlow: "Manager only" },
      { name: "Sick Leave", balance: safeNumber(state?.sick, 2), approvalFlow: "Manager only" },
    ];
  const leaveTypes = mergeLeaveTypes(savedLeaveTypes);
  return {
    annual: safeNumber(state?.annual ?? leaveTypes.find((type) => type.name === "Annual Leave")?.balance, 12),
    casual: safeNumber(state?.casual ?? leaveTypes.find((type) => type.name === "Casual Leave")?.balance, 4),
    sick: safeNumber(state?.sick ?? leaveTypes.find((type) => type.name === "Sick Leave")?.balance, 2),
    approvalFlow: state?.approvalFlow || "Supervisor then Manager",
    revokeRule: state?.revokeRule || "Manager approval required",
    holidayCountry: country,
    holidayLocation: location,
    leaveTypes,
    holidays,
  };
}

function mergeScopedHolidays(holidays = []) {
  const byScopeDate = new Map();
  [...defaultScopedHolidays, ...(Array.isArray(holidays) ? holidays : [])]
    .filter((holiday) => holiday?.name && holiday?.date)
    .forEach((holiday) => {
      const normalized = {
        country: holiday?.country || "India",
        location: holiday?.location || "Hyderabad",
        name: holiday?.name,
        date: holiday?.date,
        type: holiday?.type || "public",
      };
      if (isWeekendDate(normalized.date) && normalized.type === "public") {
        normalized.type = "optional";
      }
      const key = `${normalized.country}|${normalized.location}|${normalized.date}`;
      byScopeDate.set(key, normalized);
    });
  return [...byScopeDate.values()].sort((a, b) =>
    safeText(a?.country).localeCompare(safeText(b?.country)) ||
    safeText(a?.location).localeCompare(safeText(b?.location)) ||
    safeText(a?.date).localeCompare(safeText(b?.date))
  );
}

function activeLeaveTypes() {
  return ((leavePolicyState && Array.isArray(leavePolicyState.leaveTypes)) ? leavePolicyState.leaveTypes : defaultLeaveTypes)
    .filter((type) => type && type.name);
}

function normalizeLeaveType(type = {}) {
  const name = type?.name || "Leave";
  return {
    name,
    balance: safeNumber(type?.balance, 0),
    approvalFlow: type?.approvalFlow || approvalFlowForLeaveType(name),
  };
}

function mergeLeaveTypes(types = []) {
  const byName = new Map();
  [...defaultLeaveTypes, ...(Array.isArray(types) ? types : [])]
    .filter((type) => type && type.name)
    .map(normalizeLeaveType)
    .forEach((type) => byName.set(type.name.toLowerCase(), type));
  return [...byName.values()];
}

function approvalFlowForLeaveType(name = "") {
  const lower = name.toLowerCase();
  if (lower.includes("flexi") || lower.includes("optional")) return "No approval required";
  if (lower === "el" || lower.includes("earned") || lower.includes("maternity") || lower.includes("paternity") || lower.includes("bereavement")) return "Manager then HR";
  return "Manager only";
}

function leaveTypePolicy(name) {
  return activeLeaveTypes().find((type) => type.name === name) || { name, balance: 0, approvalFlow: approvalFlowForLeaveType(name) };
}

function approvalFlowOptions(selected = "Manager only") {
  return ["Manager only", "Manager then HR", "Supervisor then Manager", "No approval required"]
    .map((flow) => `<option value="${flow}" ${flow === selected ? "selected" : ""}>${flow}</option>`)
    .join("");
}

function syncCoreLeaveBalancesFromTypes() {
  const annual = activeLeaveTypes().find((type) => type.name === "Annual Leave");
  const casual = activeLeaveTypes().find((type) => type.name === "Casual Leave");
  const sick = activeLeaveTypes().find((type) => type.name === "Sick Leave");
  if (annual) leavePolicyState.annual = Number(annual.balance || 0);
  if (casual) leavePolicyState.casual = Number(casual.balance || 0);
  if (sick) leavePolicyState.sick = Number(sick.balance || 0);
}

function renderLeaveTypeOptions() {
  if (!leaveTypeInput) return;
  const types = activeLeaveTypes();
  const currentValue = leaveTypeInput.value;
  leaveTypeInput.innerHTML = types
    .map((type) => `<option value="${type.name}">${type.name}</option>`)
    .join("");
  leaveTypeInput.value = types.some((type) => type.name === currentValue)
    ? currentValue
    : (types[0]?.name || "");
}

function countryForLocation(location = "") {
  const found = Object.entries(holidayLocationsByCountry)
    .find(([, locations]) => locations.includes(location));
  return found?.[0] || leavePolicyState.holidayCountry || "India";
}

function currentEmployeeHolidayScope() {
  const email = window.currentUser?.email || "";

  const employee = (adminEmployees || []).find(
    (item) =>
      String(item?.email || "").toLowerCase() === email.toLowerCase()
  );

  return {
    country: employee?.country || "India",
    location: employee?.location || "Hyderabad",
  };
}

function scopedHolidaysFor(country, location) {
  const holidays = Array.isArray(leavePolicyState?.holidays) ? leavePolicyState.holidays.filter(Boolean) : [];
  const compareDates = (a, b) => safeText(a?.date).localeCompare(safeText(b?.date));
  const exact = holidays
    .filter((holiday) => holiday?.country === country && holiday?.location === location)
    .sort(compareDates);
  if (exact.length) return exact;
  return holidays
    .filter((holiday) => holiday?.country === country)
    .sort(compareDates);
}

function isWeekendDate(dateText) {
  const day = new Date(`${dateText}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

function hasHolidayOverlap(country, location, date, ignoredIndex = -1) {
  const holidays = Array.isArray(leavePolicyState?.holidays) ? leavePolicyState.holidays : [];
  return holidays.some((holiday, index) =>
    holiday &&
    index !== ignoredIndex &&
    holiday?.country === country &&
    holiday.location === location &&
    holiday?.date === date
  );
}

function activeHolidayLocations(country = leavePolicyState.holidayCountry) {
  return holidayLocationsByCountry[country] || [];
}

function selectedScopedHolidays() {
  const holidays = Array.isArray(leavePolicyState?.holidays) ? leavePolicyState.holidays.filter(Boolean) : [];
  return holidays
    .filter((holiday) => holiday?.country === leavePolicyState.holidayCountry && holiday?.location === leavePolicyState.holidayLocation)
    .sort((a, b) => safeText(a?.date).localeCompare(safeText(b?.date)));
}

function renderHolidayLocationOptions() {
  if (!holidayCountryInput || !holidayLocationInput) return;
  const locations = activeHolidayLocations(holidayCountryInput.value);
  holidayLocationInput.innerHTML = locations.map((location) => `<option value="${location}">${location}</option>`).join("");
  if (locations.includes(leavePolicyState.holidayLocation)) {
    holidayLocationInput.value = leavePolicyState.holidayLocation;
  } else {
    holidayLocationInput.value = locations[0] || "";
  }
}

function renderLeavePolicyAdmin() {
  if (!leavePolicyPanel) return;
  syncCoreLeaveBalancesFromTypes();
  annualBalanceInput.value = leavePolicyState.annual;
  casualBalanceInput.value = leavePolicyState.casual;
  sickBalanceInput.value = leavePolicyState.sick;
  approvalFlowInput.value = leavePolicyState.approvalFlow;
  revokeRuleInput.value = leavePolicyState.revokeRule;
  if (leaveTypePolicyList) {
    leaveTypePolicyList.innerHTML = activeLeaveTypes()
      .map((type, index) => `
        <div class="policy-list-row">
          <span><strong>${type.name}</strong><small>${Number(type.balance || 0)} days available - ${type.approvalFlow}</small></span>
          <div class="policy-row-actions">
            <select data-leave-flow-index="${index}" aria-label="Approval flow for ${type.name}">${approvalFlowOptions(type.approvalFlow)}</select>
            <button type="button" data-adjust-leave-type="${index}" data-adjust-delta="-1">-</button>
            <button type="button" data-adjust-leave-type="${index}" data-adjust-delta="1">+</button>
            <button type="button" data-remove-leave-type="${index}">Delete</button>
          </div>
        </div>`)
      .join("") || `<div class="empty-state">No leave types configured.</div>`;
  }
  renderLeaveTypeOptions();
  if (holidayCountryInput) holidayCountryInput.value = leavePolicyState.holidayCountry;
  renderHolidayLocationOptions();
  if (holidayLocationInput) holidayLocationInput.value = leavePolicyState.holidayLocation;
  const scopedHolidays = selectedScopedHolidays();
  holidayPolicyList.innerHTML = scopedHolidays
    .map((holiday) => {
      const realIndex = leavePolicyState.holidays.indexOf(holiday);
      const holidayTypeLabel = holiday?.type === "optional" ? "Optional holiday" : "Public holiday";

      return `
      <div class="holiday-policy-row">
        <div class="holiday-policy-info">
          <strong>${holiday?.name || "Holiday"}</strong>
          <small>
            ${holiday?.country || ""} / ${holiday?.location || ""} •
            ${formatDateText(holiday?.date, { month: "short", day: "numeric", year: "numeric" })} •
            ${holidayTypeLabel}
          </small>
        </div>

        <div class="holiday-policy-actions">
          <select data-holiday-type-index="${realIndex}" aria-label="Holiday type for ${holiday?.name || "holiday"}">
            <option value="public" ${holiday?.type === "public" ? "selected" : ""}>Public</option>
            <option value="optional" ${holiday?.type === "optional" ? "selected" : ""}>Optional</option>
          </select>

          <button type="button" class="holiday-remove-btn" data-remove-holiday="${realIndex}">
            Remove
          </button>
        </div>
      </div>
    `;
    })
    .join("") || `<div class="empty-state">No holidays configured for ${leavePolicyState.holidayCountry} / ${leavePolicyState.holidayLocation}.</div>`;
}

function openLeavePolicyAdmin() {
  leavePolicyPanel.classList.remove("hidden");
  renderLeavePolicyAdmin();
  scrollAdminPanelIntoView(leavePolicyPanel);
  showToast("Leave policies opened.");
}

function currentUserRoleValues() {
  return (window.currentUser?.roles || [currentRole])
    .map((role) => normalizeRoleForApi(role))
    .filter(Boolean);
}

function canActOnTeamLeave(request, action) {
  const roles = currentUserRoleValues();
  const status = safeStatus(request?.status).toLowerCase();
  if (roles.includes("admin")) return true;
  if (action === "supervisor-approve") {
    return status === "pending supervisor" && (roles.includes("supervisor") || roles.includes("manager"));
  }
  if (action === "manager-approve") {
    return status === "pending manager" && (roles.includes("manager") || roles.includes("hr"));
  }
  if (action === "reject") {
    return (status.startsWith("pending") || status.startsWith("revoke pending"))
      && (roles.includes("supervisor") || roles.includes("manager") || roles.includes("hr"));
  }
  return false;
}

async function loadTeamLeaveRequests() {
  const rows = await fetchJson("/api/v1/leaves/team");
  teamLeaveRequests = mapLeaveStateRequests(rows);
  renderTeamLeaveRequests();
}

function renderTeamLeaveRequests() {
  if (!teamLeaveRows) return;
  const pendingCount = teamLeaveRequests.filter((request) => safeStatus(request?.status).toLowerCase().startsWith("pending")).length;
  if (teamLeaveSummary) {
    teamLeaveSummary.innerHTML = `
      <span><strong>${teamLeaveRequests.length}</strong><small>visible requests</small></span>
      <span><strong>${pendingCount}</strong><small>waiting approval</small></span>
      <span><strong>${currentRoleProfile.label}</strong><small>current role</small></span>
    `;
  }
  teamLeaveRows.innerHTML = teamLeaveRequests.map((request) => {
    const employee = adminEmployees.find((item) => Number(item.id) === Number(request.employeeId));
    const requester = request.requesterName || employee?.name || "Employee";
    const requesterCode = request.requesterCode || employee?.employeeId || `#${request.employeeId || ""}`;
    const supervisorButton = canActOnTeamLeave(request, "supervisor-approve")
      ? `<button type="button" data-team-leave-action="supervisor-approve" data-team-leave-id="${request.id}">Supervisor approve</button>`
      : "";
    const managerButton = canActOnTeamLeave(request, "manager-approve")
      ? `<button type="button" data-team-leave-action="manager-approve" data-team-leave-id="${request.id}">Approve</button>`
      : "";
    const rejectButton = canActOnTeamLeave(request, "reject")
      ? `<button type="button" data-team-leave-action="reject" data-team-leave-id="${request.id}">Reject</button>`
      : "";
    return `
      <article class="team-leave-row">
        <div>
          <strong>${requester}</strong>
          <small>${requesterCode} - ${request.leaveId}</small>
        </div>
        <div>
          <span>${request.type}</span>
          <small>${formatDateRange(request.start, request.end)} - ${request.days} day${request.days === 1 ? "" : "s"}</small>
        </div>
        <p>${request.reason}</p>
        <span class="status ${statusClass(request.status)}">${request.status}</span>
        <div class="policy-row-actions">${supervisorButton}${managerButton}${rejectButton}</div>
      </article>`;
  }).join("") || `<div class="empty-state">No team leave requests are waiting for your role.</div>`;
}

async function openTeamLeaveAdmin() {
  teamLeavePanel?.classList.remove("hidden");
  try {
    await Promise.allSettled([loadAdminDataFromApi(), loadTeamLeaveRequests()]);
    renderTeamLeaveRequests();
    scrollAdminPanelIntoView(teamLeavePanel);
    showToast("Team leave requests opened.");
  } catch (err) {
    renderTeamLeaveRequests();
    showToast(err.message || "Team leave requests could not be loaded.");
  }
}

async function decideTeamLeaveRequest(requestId, action) {
  const route = action === "supervisor-approve"
    ? `/api/v1/leaves/${requestId}/supervisor-approve`
    : action === "manager-approve"
      ? `/api/v1/leaves/${requestId}/manager-approve`
      : `/api/v1/leaves/${requestId}/reject`;
  try {
    await fetchJson(route, { method: "POST", body: JSON.stringify({ note: "" }) });
    await Promise.allSettled([loadTeamLeaveRequests(), loadLeaveState(), loadNotificationState()]);
    showToast(action === "reject" ? "Leave request rejected." : "Leave request approved.");
  } catch (err) {
    showToast(err.message || "Leave request could not be updated.");
  }
}

function submitLeavePolicyAdmin(event) {
  event.preventDefault();
  const holidayCountry = holidayCountryInput.value || leavePolicyState.holidayCountry || "India";
  const holidayLocation = holidayLocationInput.value || leavePolicyState.holidayLocation || activeHolidayLocations(holidayCountry)[0] || "";
  const leaveTypes = activeLeaveTypes().map((type) => {
    if (type.name === "Annual Leave") return { ...type, balance: Number(annualBalanceInput.value || 0), approvalFlow: type.approvalFlow || approvalFlowInput.value };
    if (type.name === "Casual Leave") return { ...type, balance: Number(casualBalanceInput.value || 0) };
    if (type.name === "Sick Leave") return { ...type, balance: Number(sickBalanceInput.value || 0) };
    return type;
  });
  leavePolicyState = {
    ...leavePolicyState,
    annual: Number(annualBalanceInput.value || 0),
    casual: Number(casualBalanceInput.value || 0),
    sick: Number(sickBalanceInput.value || 0),
    approvalFlow: approvalFlowInput.value,
    revokeRule: revokeRuleInput.value,
    holidayCountry,
    holidayLocation,
    leaveTypes,
  };
  saveLeavePolicyState();
  renderLeavePolicyAdmin();
  renderTimesheetWorkspace();
  renderLeaveWorkspace();
  recordAudit("Policy", "Updated leave policy balances and approval rules");
  showToast("Leave policy saved.");
}

function submitLeaveTypeAdmin(event) {
  event.preventDefault();
  const name = leaveTypeNameInput.value.trim();
  const balance = Number(leaveTypeBalanceInput.value || 0);
  const approvalFlow = leaveTypeApprovalInput.value || approvalFlowForLeaveType(name);
  if (!name) {
    showToast("Enter a leave type name.");
    leaveTypeNameInput.focus();
    return;
  }
  if (activeLeaveTypes().some((type) => type.name.toLowerCase() === name.toLowerCase())) {
    showToast("Leave type already exists.");
    leaveTypeNameInput.focus();
    return;
  }
  leavePolicyState.leaveTypes = [...activeLeaveTypes(), { name, balance, approvalFlow }];
  syncCoreLeaveBalancesFromTypes();
  saveLeavePolicyState();
  leaveTypeAdminForm.reset();
  renderLeavePolicyAdmin();
  renderLeaveWorkspace();
  recordAudit("Policy", `Added leave type ${name}`);
  showToast(`${name} leave type added.`);
}

function adjustLeaveTypeBalance(index, delta) {
  const leaveTypes = activeLeaveTypes();
  const type = leaveTypes[index];
  if (!type) return;
  type.balance = Math.max(0, Number(type.balance || 0) + delta);
  leavePolicyState.leaveTypes = leaveTypes;
  syncCoreLeaveBalancesFromTypes();
  saveLeavePolicyState();
  renderLeavePolicyAdmin();
  renderLeaveWorkspace();
  showToast(`${type.name} balance updated to ${type.balance} days.`);
}

function updateLeaveTypeApprovalFlow(index, flow) {
  const leaveTypes = activeLeaveTypes();
  const type = leaveTypes[index];
  if (!type) return;
  type.approvalFlow = flow;
  leavePolicyState.leaveTypes = leaveTypes;
  saveLeavePolicyState();
  renderLeavePolicyAdmin();
  renderLeaveWorkspace();
  recordAudit("Policy", `Updated ${type.name} approval flow to ${flow}`);
  showToast(`${type.name} approval flow updated.`);
}

function removeLeaveType(index) {
  const leaveTypes = activeLeaveTypes();
  const removedType = leaveTypes[index];
  if (!removedType) return;
  if (leaveTypes.length <= 1) {
    showToast("At least one leave type is required.");
    return;
  }
  leavePolicyState.leaveTypes = leaveTypes.filter((_, itemIndex) => itemIndex !== index);
  syncCoreLeaveBalancesFromTypes();
  saveLeavePolicyState();
  renderLeavePolicyAdmin();
  renderLeaveWorkspace();
  recordAudit("Policy", `Deleted leave type ${removedType.name}`);
  showToast(`${removedType.name} deleted.`);
}

function submitHolidayAdmin(event) {
  event.preventDefault();
  const country = holidayCountryInput.value || leavePolicyState.holidayCountry;
  const location = holidayLocationInput.value || leavePolicyState.holidayLocation;
  const name = holidayNameInput.value.trim();
  const date = holidayDateInput.value;
  const type = holidayTypeInput.value || "public";
  if (!country || !location || !name || !date) {
    showToast("Select country, location, holiday name, and date.");
    return;
  }
  if (type === "public" && isWeekendDate(date)) {
    showToast("Public holiday date cannot be Saturday or Sunday. Add it as optional instead.");
    holidayDateInput.focus();
    return;
  }
  if (hasHolidayOverlap(country, location, date)) {
    showToast("A holiday already exists for this location and date.");
    holidayDateInput.focus();
    return;
  }
  leavePolicyState.holidayCountry = country;
  leavePolicyState.holidayLocation = location;
  leavePolicyState.holidays.push({ country, location, name, date, type });
  leavePolicyState.holidays.sort((a, b) => safeText(a?.date).localeCompare(safeText(b?.date)));
  saveLeavePolicyState();
  holidayAdminForm.reset();
  if (holidayCountryInput) holidayCountryInput.value = country;
  renderHolidayLocationOptions();
  if (holidayLocationInput) holidayLocationInput.value = location;
  renderLeavePolicyAdmin();
  renderTimesheetWorkspace();
  renderLeaveWorkspace();
  if (holidayTypeInput) holidayTypeInput.value = type;
  recordAudit("Policy", `Added ${country} / ${location} ${type} holiday ${name}`);
  showToast(`${name} added for ${country} / ${location}.`);
}

function removeHoliday(index) {
  const removedHoliday = leavePolicyState.holidays[index];
  leavePolicyState.holidays.splice(index, 1);
  saveLeavePolicyState();
  renderLeavePolicyAdmin();
  renderTimesheetWorkspace();
  renderLeaveWorkspace();
  recordAudit("Policy", `Removed holiday ${removedHoliday.name || "from leave policy"}`);
  showToast("Holiday removed.");
}

function updateHolidayType(index, type) {
  const holiday = (leavePolicyState?.holidays || [])[index];
  if (!holiday) return;
  if (type === "public" && isWeekendDate(holiday?.date)) {
    showToast("Weekend holidays can stay optional only.");
    renderLeavePolicyAdmin();
    return;
  }
  if (!holiday) return;
  holiday.type = type;
  saveLeavePolicyState();
  renderLeavePolicyAdmin();
  renderTimesheetWorkspace();
  renderLeaveWorkspace();
  recordAudit("Policy", `Marked ${holiday?.name} as ${type} for ${holiday?.country || ""} / ${holiday?.location || ""}`);
  showToast(`${holiday?.name} is now ${type === "public" ? "public" : "optional"}.`);
}

function loadTimesheetControlState() {
  try {
    const saved = localStorage.getItem("hrms_timesheet_control");
    return saved ? JSON.parse(saved) : {
      freezeHour: "11:00",
      freezeRule: "Next day",
      weekendEntry: "Not required",
      holidayEntry: "Not required",
      managerOverride: "Enabled",
    };
  } catch {
    return { freezeHour: "11:00", freezeRule: "Next day", weekendEntry: "Not required", holidayEntry: "Not required", managerOverride: "Enabled" };
  }
}

function saveTimesheetControlState() {
  localStorage.setItem("hrms_timesheet_control", JSON.stringify(timesheetControlState));
}

function renderTimesheetControlAdmin() {
  if (!timesheetControlPanel) return;
  freezeHourInput.value = timesheetControlState.freezeHour;
  freezeRuleInput.value = timesheetControlState.freezeRule;
  weekendEntryInput.value = timesheetControlState.weekendEntry;
  holidayEntryInput.value = timesheetControlState.holidayEntry;
  managerOverrideInput.value = timesheetControlState.managerOverride;
  timesheetControlSummary.innerHTML = `
    <div class="policy-list-row"><span><strong>Freeze rule</strong><small>${timesheetControlState.freezeRule} at ${timesheetControlState.freezeHour}</small></span></div>
    <div class="policy-list-row"><span><strong>Weekend entry</strong><small>${timesheetControlState.weekendEntry}</small></span></div>
    <div class="policy-list-row"><span><strong>Holiday entry</strong><small>${timesheetControlState.holidayEntry}</small></span></div>
    <div class="policy-list-row"><span><strong>Manager override</strong><small>${timesheetControlState.managerOverride}</small></span></div>`;
}

function openTimesheetControlAdmin() {
  timesheetControlPanel.classList.remove("hidden");
  renderTimesheetControlAdmin();
  scrollAdminPanelIntoView(timesheetControlPanel);
  showToast("Timesheet control opened.");
}

function submitTimesheetControlAdmin(event) {
  event.preventDefault();
  timesheetControlState = {
    freezeHour: freezeHourInput.value,
    freezeRule: freezeRuleInput.value,
    weekendEntry: weekendEntryInput.value,
    holidayEntry: holidayEntryInput.value,
    managerOverride: managerOverrideInput.value,
  };
  saveTimesheetControlState();
  renderTimesheetControlAdmin();
  recordAudit("Timesheet", `Updated timesheet freeze rule to ${timesheetControlState.freezeRule} at ${timesheetControlState.freezeHour}`);
  showToast("Timesheet control saved.");
}

async function openEmployeeAdmin() {
  employeeAdminPanel?.classList.remove("hidden");
  showToast("Loading employee management...");

  try {
    await loadAdminDataFromApi();
    renderDepartmentOptions();
    renderProjectLocationOptions();
    renderEmployeeManagerOptions();
    renderEmployeeAdmin();
    renderAccessOptions();
    renderAccessAdmin();
    renderTeamStatusBoard();
    scrollAdminPanelIntoView(employeeAdminPanel);
    showToast("Employee management loaded.");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Employee management could not be loaded.");
  }
}

async function submitEmployeeAdmin(event) {
  event.preventDefault();

  const name = employeeNameInput?.value.trim() || "";
  const email = employeeEmailInput?.value.trim().toLowerCase() || "";
  const jobTitle = employeeJobTitleInput?.value.trim() || "";
  const dateJoined = employeeJoinDateInput?.value || todayInputValue();
  const departmentId = Number(employeeDepartmentInput?.value || 0);
  const role = normalizeRoleForApi(employeeRoleInput?.value || "employee");
  const managerName = employeeManagerInput?.value || "";
  const reportsToId = managerName ? employeeIdByName(managerName) : null;

  if (!name || !email || !jobTitle || !departmentId) {
    showToast("Complete name, work email, job title, and department.");
    return;
  }

  if (!isValidMobile(employeeMobileInput?.value.trim() || "")) {
    showToast("Enter a valid mobile number with country code or digits.");
    employeeMobileInput?.focus();
    return;
  }

  if (!isEligibleManager(managerName, name)) {
    showToast("Select an active manager or leave manager as not assigned.");
    employeeManagerInput?.focus();
    return;
  }

  const { first_name, last_name } = splitFullName(name);
  const submitButton = employeeAdminForm?.querySelector('button[type="submit"]');
  const oldText = submitButton?.textContent || "Save employee";

  try {
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = employeeRecordId?.value ? "Updating..." : "Creating...";
    }

    if (employeeRecordId?.value) {
      await fetchJson(`/api/v1/employees/${employeeRecordId.value}`, {
        method: "PATCH",
        body: JSON.stringify({
          first_name,
          last_name,
          job_title: jobTitle,
          department_id: departmentId,
          reports_to_id: reportsToId,
        }),
      });
      recordAudit("Employee", `Updated employee record for ${name}`);
      showToast("Employee updated.");
    } else {
      const temporaryPassword = "Welcome@123";
      const created = await fetchJson("/api/v1/employees", {
        method: "POST",
        body: JSON.stringify({
          first_name,
          last_name,
          email,
          job_title: jobTitle,
          date_joined: dateJoined,
          department_id: departmentId,
          reports_to_id: reportsToId,
          role,
          password: temporaryPassword,
        }),
      });
      recordAudit("Employee", `Created employee ${name} (${created.employee_code})`);
      showEmployeeCredentialNotice({ name, email, password: temporaryPassword });
      showToast(`Employee created. Login: ${email} / Temporary password: ${temporaryPassword}`);
    }

    await loadAdminDataFromApi();
    if (employeeRecordId?.value) resetEmployeeForm();
    else {
      employeeAdminForm?.reset();
      if (employeeJobTitleInput) employeeJobTitleInput.value = "Employee";
      if (employeeEmploymentTypeInput) employeeEmploymentTypeInput.value = "Full-time";
      if (employeeJoinDateInput) employeeJoinDateInput.value = todayInputValue();
      if (employeeRoleInput) employeeRoleInput.value = "Employee";
      if (employeeManagerInput) employeeManagerInput.value = "";
    }
    renderDepartmentOptions();
    renderProjectLocationOptions();
    renderEmployeeManagerOptions();
    renderEmployeeAdmin();
    renderAccessOptions();
    renderAssignmentRules();
    renderAccessAdmin();
    renderTeamStatusBoard();
  } catch (err) {
    console.error(err);
    showToast(err.message || "Employee save failed.");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = oldText;
    }
  }
}

async function handleEmployeeAdminAction(target) {
  const row = target.closest("[data-employee-id]");
  if (!row) return;
  const employee = adminEmployees.find((item) => item.id === row.dataset.employeeId);
  if (!employee) return;

  if (target.dataset.employeeAction === "edit") {
    employeeRecordId.value = employee.id;
    employeeNameInput.value = employee.name;
    employeeEmailInput.value = employee.email;
    employeeEmailInput.disabled = true;
    if (employeeMobileInput) employeeMobileInput.value = employee.mobile || "";
    if (employeePersonalEmailInput) employeePersonalEmailInput.value = employee.personalEmail || "";
    if (employeeJobTitleInput) employeeJobTitleInput.value = employee.jobTitle || employee.role || "";
    if (employeeEmploymentTypeInput) employeeEmploymentTypeInput.value = employee.employmentType || "Full-time";
    if (employeeJoinDateInput) employeeJoinDateInput.value = employee.dateJoined || "";
    renderDepartmentOptions(employee.departmentId);
    renderProjectLocationOptions();
    if (employeeProjectInput) employeeProjectInput.value = employee.project || "";
    if (employeeLocationInput) employeeLocationInput.value = employee.location || "";
    if (employeeRoleInput) employeeRoleInput.value = employee.role || "employee";
    renderEmployeeManagerOptions(employee.manager || "", employee.id);
    employeeNameInput?.focus();
    showToast("Employee loaded for editing.");
    return;
  }

  if (target.dataset.employeeAction === "toggle") {
    try {
      await fetchJson(`/api/v1/employees/${employee.id}`, { method: "DELETE" });
      await loadAdminDataFromApi();
      renderEmployeeAdmin();
      renderEmployeeManagerOptions();
      renderAccessOptions();
      renderAssignmentRules();
      renderAccessAdmin();
      renderTeamStatusBoard();
      recordAudit("Employee", `Deactivated employee ${employee.name}`);
      showToast("Employee deactivated and login disabled.");
    } catch (err) {
      showToast(err.message || "Employee could not be deactivated.");
    }
  }
}
function handleRoleAction(action, target) {
  if (action === "open-employees") {
    openAdminModule(action);
    return;
  }
  if (action === "manage-roles") {
    openAdminModule(action);
    return;
  }
  if (action === "leave-policy") {
    openAdminModule(action);
    return;
  }
  if (action === "team-leaves") {
    openAdminModule(action);
    return;
  }
  if (action === "timesheet-freeze") {
    openAdminModule(action);
    return;
  }
  if (action === "audit-logs") {
    openAdminModule(action);
    return;
  }
  const messages = {
  };
  showToast(messages[action] || "Control is ready for backend integration.");
}

function refreshAttendanceDashboard() {
  renderStats();
  renderSessionStrip();
  renderFocusSummary();
  renderQuickActions();
  renderTeamStatusBoard();
  renderSchedule();
  renderAnnouncements();
  renderTimesheetWorkspace();
  renderLeaveWorkspace();
}
function parseAttendanceDate(value) {
  if (!value) return null;

  if (value instanceof Date) return value;

  const text = String(value);

  // Backend sends UTC time without Z sometimes.
  // This forces correct local conversion.
  const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(text);
  return new Date(hasTimezone ? text : `${text}Z`);
}

function isSameLocalDay(a, b = new Date()) {
  const left = parseAttendanceDate(a);
  const right = parseAttendanceDate(b);

  if (!left || Number.isNaN(left.getTime())) return false;

  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
function currentTimeLabel(value = new Date()) {
  const date = parseAttendanceDate(value) || new Date();

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatBreakType(value = attendanceState.activeBreakType) {
  const item = breakPolicyTypes.find(([, , type]) => type === value);
  return item?.[0] || String(value || "Break").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function currentBreakLimitMinutes(value = attendanceState.activeBreakType) {
  return breakPolicyMinutes[value] || 10;
}

function currentBreakElapsedMinutes(now = new Date()) {
  if (!attendanceState.breakStartedAt) return 0;
  return Math.max(0, Math.floor((now - new Date(attendanceState.breakStartedAt)) / 60000));
}

function currentBreakOverrun() {
  if (!attendanceState.activeBreakType || !attendanceState.breakStartedAt) return null;
  const elapsed = currentBreakElapsedMinutes();
  const limit = currentBreakLimitMinutes();
  const overBy = elapsed - limit;
  if (overBy <= 0) return null;
  return {
    elapsed,
    limit,
    overBy,
    label: formatBreakType(),
  };
}

function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earth = 6371e3;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function updateAttendancePriority() {
  if (!attendancePriority) return;
  const overrun = currentBreakOverrun();
  attendancePriority.classList.toggle("warning", Boolean(overrun));

  if (overrun) {
    attendancePriority.textContent = `${overrun.label} break exceeded by ${overrun.overBy} min`;
    return;
  }

  if (attendanceState.activeBreakType) {
    attendancePriority.textContent = `${formatBreakType()} break running`;
    return;
  }

  if (attendanceState.loggedIn) {
    attendancePriority.textContent = "Shift timer is running";
    return;
  }

  if (attendanceState.locationStatus === "outside") {
    attendancePriority.textContent = "Outside office - WFH tracking required";
    return;
  }

  if (attendanceState.locationStatus === "office") {
    attendancePriority.textContent = "Inside office - ready to start shift";
    return;
  }

  attendancePriority.textContent = "Location verification needed";
}

function renderBreakTypes() {
  if (!breakTypeGrid) return;
  breakTypeGrid.innerHTML = breakPolicyTypes
    .map(([label, note, value]) => `
      <button class="quick-action-card break-type-card" type="button" data-break-type="${value}">
        <strong>${label}</strong>
        <small>${note}</small>
      </button>`)
    .join("");
  breakTypeGrid.querySelectorAll("[data-break-type]").forEach((button) => {
    button.addEventListener("click", () => {
      attendanceState.activeBreakType = button.dataset.breakType;
      closeBreakTypeModal();
      captureAttendanceToBackend("break_start", {
        break_type: button.dataset.breakType,
      });
    });
  });
}

function openBreakTypeModal() {
  renderBreakTypes();
  breakModal.classList.remove("hidden");
}

function closeBreakTypeModal() {
  breakModal.classList.add("hidden");
}

function openWfhRequestModal() {
  wfhReason.value = attendanceState.wfhReason || "";
  wfhModal.classList.remove("hidden");
}

function closeWfhRequestModal() {
  wfhModal.classList.add("hidden");
}

function submitWfhDemoRequest() {
  const reason = wfhReason.value.trim();

  if (!reason) {
    showToast("Add a WFH reason.");
    return;
  }

  attendanceState.wfhReason = reason;
  attendanceState.wfhStatus = "requested";
  attendanceState.workMode = "wfh";
  attendanceState.wfhRequestedAt = new Date();

  closeWfhRequestModal();

  showToast("WFH request recorded for tracking.");
  updateAttendancePriority();
  refreshAttendanceDashboard();
}


function verifyLocation() {
  if (!navigator.geolocation) {
    showToast("Geolocation is not available in this browser.");
    return;
  }

  showToast("Checking office location...");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const distance = Math.round(
        getDistanceMeters(
          position.coords.latitude,
          position.coords.longitude,
          attendanceConfig.office.lat,
          attendanceConfig.office.lng,
        )
      );

      attendanceState.lastDistanceMeters = distance;

      if (distance <= attendanceConfig.office.radiusMeters) {
        attendanceState.locationStatus = "office";
        attendanceState.locationLabel = `Inside office - ${distance}m`;
        attendanceState.wfhStatus = "none";
        showToast("Office location confirmed.");
      } else {
        attendanceState.locationStatus = "outside";
        attendanceState.locationLabel = `Outside office - ${distance}m`;
        if (!attendanceState.loggedIn && attendanceState.wfhStatus !== "requested") {
          openWfhRequestModal();
        }
        showToast("Outside office. WFH can be raised for tracking.");
      }

      updateAttendancePriority();
      refreshAttendanceDashboard();
    },
    () => showToast("Location permission was denied."),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
  );
}

function handleQuickAction(action) {
  if (action === "verify-location") {
    verifyLocation();
    return;
  }

  if (action === "login") {
    if (attendanceState.loggedIn) {
      showToast("Work session is already active.");
      return;
    }
    captureAttendanceToBackend("login");
    return;
  }

  if (action === "logout") {
    captureAttendanceToBackend("logout");
    return;
  }

  if (action === "start-break") {
    if (!attendanceState.loggedIn) {
      showToast("Log in before starting a break.");
      return;
    }
    openBreakTypeModal();
    return;
  }

  if (action === "end-break") {
    captureAttendanceToBackend("break_end");
    return;
  }

  if (action === "raise-wfh") {
    openWfhRequestModal();
    return;
  }

  if (action === "leave") {
    navigateToView("leave", "leaveView", "Apply Leave");
  }
}

function openAssistShortcut() {
  navigateToView("chat", "chatView", "Chat");
  renderChatWorkspace();

  if (!activeConversationId && conversations.length) {
    const firstConversation = conversations[0];
    activeConversationId = String(firstConversation.id);
    activeRecipientId = Number(firstConversation.user_id || firstConversation.employee_id || firstConversation.id);
    renderChatList();
    renderThread();
    renderConversationMeta();
  }

  if (chatMessage) {
    if (!chatMessage.value.trim()) chatMessage.value = "Hi, I need help with ";
    chatMessage.focus();
    chatMessage.setSelectionRange(chatMessage.value.length, chatMessage.value.length);
  }

  showToast("Assist opened in chat.");
}

function openGuideShortcut() {
  navigateToView("activity", "activityView", "Activity");
  activeActivityFilter = "All";
  activityFilters?.querySelectorAll("[data-activity-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.activityFilter === "All");
  });
  renderActivityFeed();
  showToast("Guide opened activity updates.");
}

function autoAttendanceLogin() {
  if (attendanceInitialized || attendanceState.loggedIn) return;
  attendanceInitialized = true;

  captureAttendanceToBackend("login", { auto: true });
}

async function captureAttendanceToBackend(action, override = {}) {
  if (!navigator.geolocation) {
    showToast("Location permission is required for attendance.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const payload = {
          action,
          latitude: override.latitude ?? pos.coords.latitude,
          longitude: override.longitude ?? pos.coords.longitude,
          break_type: override.break_type || attendanceState.activeBreakType || null,
          note: override.note || attendanceState.wfhReason || null,
        };

        const res = await fetchJson("/api/v1/attendance/capture", {
          method: "POST",
          body: JSON.stringify(payload),
        });

        const capturedAt = parseAttendanceDate(res.captured_at) || new Date();

        attendanceState.lastDistanceMeters = Math.round(Number(res.distance_meters || 0));
        attendanceState.locationStatus = res.work_mode === "office" ? "office" : "outside";

        attendanceState.locationLabel =
          attendanceState.locationStatus === "office"
            ? `Inside office - ${attendanceState.lastDistanceMeters}m`
            : `Outside office - ${attendanceState.lastDistanceMeters}m`;

        if (action === "login") {
          attendanceState.loggedIn = true;
          attendanceState.loginAt = capturedAt;
          attendanceState.logoutAt = null;

          if (attendanceState.locationStatus === "office") {
            attendanceState.wfhStatus = "none";
            showToast("Logged in from office.");
          } else {
            const wfhAlreadyRequestedToday =
              attendanceState.wfhStatus === "requested" ||
              isSameLocalDay(attendanceState.wfhRequestedAt);

            if (!wfhAlreadyRequestedToday) {
              attendanceState.wfhStatus = "needed";
              openWfhRequestModal();
              showToast("Logged in from outside. Raise WFH for tracking.");
            } else {
              attendanceState.wfhStatus = "requested";
              showToast("Logged in from outside. WFH already recorded today.");
            }
          }
        }

        if (action === "logout") {
          if (attendanceState.loginAt) {
            const sessionMinutes = Math.max(
              0,
              Math.floor(
                (capturedAt.getTime() -
                  new Date(attendanceState.loginAt).getTime()) / 60000
              )
            );

            attendanceState.todayWorkedMinutes =
              Number(attendanceState.todayWorkedMinutes || 0) + sessionMinutes;

            attendanceState.lastSessionMinutes = sessionMinutes;
          }

          attendanceState.loggedIn = false;
          attendanceState.logoutAt = capturedAt;
          attendanceState.activeBreakType = null;
          attendanceState.breakStartedAt = null;

          showToast(`Logged out at ${currentTimeLabel(capturedAt)}.`);
        }

        if (action === "break_start") {
          attendanceState.activeBreakType = payload.break_type;
          attendanceState.breakStartedAt = capturedAt;
          showToast(`${formatBreakType()} started.`);
        }

        if (action === "break_end") {
          attendanceState.activeBreakType = null;
          attendanceState.breakStartedAt = null;
          showToast("Break ended.");
        }

        window.attendanceLogs = Array.isArray(window.attendanceLogs)
          ? [...window.attendanceLogs, res]
          : [res];

        applyAttendanceLogs(window.attendanceLogs);
        renderSchedule();

        updateAttendancePriority();
        refreshAttendanceDashboard();
        updateClock();
      } catch (e) {
        showToast(e.message || "Attendance save failed.");
      }
    },
    () => showToast("Location permission denied."),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
}

function recordLogout() {
  if (!attendanceState.loggedIn) {
    attendanceState.logoutAt = new Date();
    workState.classList.remove("active");
    workState.innerHTML = "<span></span>Already logged out";
    updateAttendancePriority();
    refreshAttendanceDashboard();
    showToast("No active work session to log out.");
    return;
  }
  attendanceState.loggedIn = false;
  attendanceState.logoutAt = new Date();
  attendanceState.activeBreakType = null;
  attendanceState.breakStartedAt = null;
  workState.classList.remove("active");
  workState.innerHTML = `<span></span>Logged out - ${currentTimeLabel(attendanceState.logoutAt)}`;
  updateAttendancePriority();
  refreshAttendanceDashboard();
  showToast("Logout recorded.");
}

function logoutToLogin() {
  recordLogout();
  fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" }).catch(() => { });
  try {
    localStorage.removeItem("access_token");
    localStorage.removeItem("hrms_token");
    sessionStorage.removeItem("hrms_access_token");
  } catch {
    // Storage can be unavailable in restricted browser modes.
  }
  window.setTimeout(() => {
    window.location.href = "/login";
  }, 450);
}

function renderSidebar() {
  const totalUnread = totalUnreadCount();
  const displayLabels = {
    Dashboard: "Dashboard",
    Chat: "Chat",
    Timesheet: "Timesheet",
    Leave: "Leave",
    "Apply Leave": "Apply Leave",
    "My Requests": "My Requests",
    "Expense Claims": "Expenses",
    Notifications: "Notifications",
    Settings: "Settings",
    Employees: "Employees",
    "Roles & Access": "Roles & Access",
    "Leave Policies": "Leave Settings",
    "Team Leaves": "Team Leave Requests",
    "Timesheet Control": "Timesheet Settings",
    "Audit Logs": "Audit Logs",
  };
  const displayHeadings = {
    "People Ops": "People",
    "Leave Management": "Leave",
    "Attendance & Time": "Attendance & Time",
    Requests: "Requests",
    Others: "More",
  };
  sidebarNav.innerHTML = currentRoleProfile.nav
    .map(([heading, items]) => `
      <div class="nav-group">
        ${heading ? `<p>${displayHeadings[heading] || heading}</p>` : ""}
        ${items.map(([label, icon, badge]) => {
      const dynamicBadge = label === "Chat" ? totalUnread : badge;
      const iconMap = {
        Dashboard: "D",
        Chat: "C",
        Timesheet: "T",
        Leave: "L",
        "Apply Leave": "+",
        "My Requests": "R",
        "Expense Claims": "$",
        Notifications: "!",
        Settings: "G",
        Employees: "E",
        "Roles & Access": "A",
        "Leave Policies": "L",
        "Team Leaves": "A",
        "Timesheet Control": "T",
        "Audit Logs": "G",
      };
      return `
          <button class="nav-item ${label === "Dashboard" ? "active" : ""}" type="button" data-label="${label}">
            <span>${iconMap[label] || icon}</span>
            <b>${displayLabels[label] || label}</b>
            ${dynamicBadge ? `<em>${dynamicBadge}</em>` : ""}
          </button>`;
    }).join("")}
      </div>`)
    .join("");

  sidebarNav.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      sidebarNav.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      const label = button.dataset.label || button.querySelector("b").textContent || "Dashboard";
      if (label === "Chat") {
        navigateToView("chat", "chatView", "Chat");
      } else if (label === "Timesheet") {
        navigateToView("timesheet", "timesheetView", "Timesheet");
      } else if (label === "Leave" || label === "Apply Leave" || label === "My Leaves" || label === "Leave Balance" || label === "Leave Calendar") {
        navigateToView("leave", "leaveView", label);
      } else if (label === "Calendar" || label === "Leave Calendar") {
        navigateToView("calendar", "calendarView", "Calendar");
      } else if (navTargets[label] === "profileView") {
        navigateToView("profile", "profileView", label);
      } else if (adminNavActions[label]) {
        if (adminNavActions[label] === "admin-console") {
          openAdminConsole();
        } else {
          openAdminModule(adminNavActions[label]);
        }
      } else {
        navigateToView("dashboard", navTargets[label] || "dashboardSection", label);
      }
    });
  });
}

function renderStats() {
  if (!statsGrid) return;

  statsGrid.innerHTML = "";
  statsGrid.classList.add("hidden");
}

function renderSessionStrip() {
  if (!sessionStrip) return;
  const sessionRows = [
    ["Shift", `${attendanceConfig.shiftName}<span>${attendanceConfig.shiftStart} - ${attendanceConfig.shiftEnd}</span>`, ""],
    ["Geo status", attendanceState.locationLabel, ""],
    [
      "Verify location",
      attendanceState.locationStatus === "office" ? "Office geofence confirmed" : "Check office geofence",
      "verify-location",
    ],
  ];
  sessionStrip.innerHTML = sessionRows
    .map(([label, value, action]) => `
      <${action ? "button" : "div"} ${action ? `type="button" data-quick-action="${action}"` : ""} class="${action ? "session-action" : ""}">
        <small>${label}</small>
        <strong>${value}</strong>
      </${action ? "button" : "div"}>`)
    .join("");
  sessionStrip.querySelectorAll("[data-quick-action]").forEach((button) => {
    button.addEventListener("click", () => handleQuickAction(button.dataset.quickAction));
  });
}

function renderFocusSummary() {
  if (!focusSummary) return;

  focusSummary.innerHTML = "";
  focusSummary.classList.add("hidden");
}

function renderQuickActions() {
  if (!quickActionsPanel) return;
  const overrun = currentBreakOverrun();
  const breakLabel = formatBreakType();
  const actionRows = [
    ["🚀 Log in", attendanceState.loggedIn ? `Running since ${attendanceState.loginAt ? currentTimeLabel(attendanceState.loginAt) : "now"}` : "Start shift time counting", "login", attendanceState.loggedIn],
    ["🌙 Log out", attendanceState.loggedIn ? "Close current work session" : "No active session", "logout", !attendanceState.loggedIn],
    ["☕ Start break", attendanceState.activeBreakType ? `${breakLabel} active` : "Choose break type", "start-break", Boolean(attendanceState.activeBreakType) || !attendanceState.loggedIn],
    ["✅ End break", overrun ? `Warning: ${overrun.overBy} min over policy` : attendanceState.activeBreakType ? `End ${breakLabel}` : "No break running", "end-break", !attendanceState.activeBreakType, Boolean(overrun)],
    [" Raise WFH", attendanceState.wfhStatus === "approved" ? "Approved for today" : "Required when outside office", "raise-wfh", attendanceState.wfhStatus === "approved"],
  ];
  quickActionsPanel.innerHTML = actionRows
    .map(([label, note, action, disabled, warning]) => `
      <button class="quick-action-card ${warning ? "warning" : ""}" type="button" data-quick-action="${action}" ${disabled ? "disabled" : ""}>
        <strong>${label}</strong>
        <small>${note}</small>
      </button>`)
    .join("");

  quickActionsPanel.querySelectorAll("[data-quick-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.quickAction;
      handleQuickAction(action);
    });
  });
}

function isPeopleManagerRole() {
  return currentRole === "manager" || currentRole === "supervisor" || currentRole === "admin";
}

function visibleTeamStatusEmployees() {
  const activeEmployees = adminEmployees.filter((employee) => employee.active);
  if (currentRole === "admin") return activeEmployees;
  if (currentRole === "manager" || currentRole === "supervisor") {
    return activeEmployees.filter((employee) =>
      employee.manager === currentRoleProfile.name ||
      employee.supervisor === currentRoleProfile.name
    );
  }
  return [];
}

function ensureTeamStatusEmployeesLoaded() {
  if (!isPeopleManagerRole() || adminEmployees.length || teamStatusLoadPromise) return;
  teamStatusLoadPromise = loadAdminDataFromApi()
    .then(() => renderTeamStatusBoard())
    .catch((error) => {
      console.error("Team status employees could not be loaded", error);
      if (teamStatusRows) {
        teamStatusRows.innerHTML = `<tr><td colspan="7">Team members could not be loaded.</td></tr>`;
      }
    })
    .finally(() => {
      teamStatusLoadPromise = null;
    });
}

function employeeDisplayId(employee, index = 0) {
  return employee.employeeId || formatEmployeeId(index + 1);
}

function filterTeamStatusEmployees(employees) {
  const query = (teamStatusSearch?.value || "").trim().toLowerCase();
  if (!query) return employees;
  return employees.filter((employee, index) => {
    const employeeId = employeeDisplayId(employee, index).toLowerCase();
    return [
      employeeId,
      employee.name,
      employee.email,
      employee.role,
      employee.department,
    ].some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function teamStatusForEmployee(employee, index) {
  const employeeUserId = Number(employee?.raw?.id || employee?.id || 0);
  const currentEmployeeId = Number(window.currentUser?.employee_id || 0);
  const isCurrentEmployee =
    currentEmployeeId && employeeUserId === currentEmployeeId
    || safeText(employee?.email).toLowerCase() === safeText(window.currentUser?.email).toLowerCase();

  if (isCurrentEmployee) {
    const overrun = currentBreakOverrun();
    const breakLabel = formatBreakType();
    const lastUpdate = attendanceState.activeBreakType
      ? attendanceState.breakStartedAt
      : attendanceState.loggedIn
        ? attendanceState.loginAt
        : attendanceState.logoutAt;
    return {
      session: attendanceState.loggedIn ? "Logged in" : "Logged out",
      mode: attendanceState.locationStatus === "office" ? "Office" : attendanceState.locationStatus === "outside" ? "WFH / outside" : "Pending",
      breakStatus: overrun
        ? `${breakLabel} break exceeded by ${overrun.overBy} min`
        : attendanceState.activeBreakType
          ? `${breakLabel} break active`
          : "No active break",
      presence: attendanceState.activeBreakType ? "Away" : attendanceState.loggedIn ? "Online" : "Offline",
      className: overrun ? "rejected" : attendanceState.loggedIn ? "approved" : "revoked",
      updated: lastUpdate ? currentTimeLabel(lastUpdate) : "No attendance yet",
    };
  }

  return {
    session: "No record",
    mode: "Not available",
    breakStatus: "Not available",
    presence: "No data",
    className: "no-record",
    updated: "No attendance data",
  };
}

function renderTeamStatusBoard() {
  if (!teamStatusSection || !teamStatusRows) return;
  const canViewTeam = isPeopleManagerRole();
  teamStatusSection.classList.toggle("hidden", !canViewTeam);
  if (!canViewTeam) return;

  if (!adminEmployees.length) {
    if (teamStatusScope) {
      const scopeLabel = currentRole === "admin" ? "All employees" : "My team";
      teamStatusScope.textContent = `${scopeLabel} - loading`;
    }
    teamStatusRows.innerHTML = `<tr><td colspan="7">Loading team members...</td></tr>`;
    ensureTeamStatusEmployeesLoaded();
    return;
  }

  const visibleEmployees = filterTeamStatusEmployees(visibleTeamStatusEmployees());
  if (teamStatusScope) {
    const scopeLabel = currentRole === "admin" ? "All employees" : "My team";
    teamStatusScope.textContent = `${scopeLabel} - ${visibleEmployees.length}`;
  }
  teamStatusRows.innerHTML = visibleEmployees
    .map((employee, index) => {
      const status = teamStatusForEmployee(employee, index);
      const employeeId = employeeDisplayId(employee, index);
      return `
        <tr>
          <td><strong>${employeeId}</strong></td>
          <td>
            <div class="team-member-cell">
              <span class="team-avatar">${safeInitial(employee?.name)}</span>
              <div>
                <strong>${employee?.name || "Employee"}</strong>
                <small>${employee?.email || ""}</small>
                <small>${employee?.role || ""} - ${employee?.department || ""}</small>
              </div>
            </div>
          </td>
          <td>${status.session}</td>
          <td>${status.mode}</td>
          <td>${status.breakStatus}</td>
          <td><span class="status ${status.className}">${status.presence}</span></td>
          <td>${status.updated}</td>
        </tr>`;
    })
    .join("") || `<tr><td colspan="7">No matching team members found.</td></tr>`;
}

function renderSchedule() {
  if (!scheduleTimeline) return;

  const logs = Array.isArray(window.attendanceLogs) ? window.attendanceLogs : [];

  const todayLogs = logs
    .map((log) => ({
      ...log,
      date: parseAttendanceDate(log.captured_at),
    }))
    .filter((log) => log.date && isSameLocalDay(log.date))
    .sort((a, b) => a.date - b.date);

  const latestLogs = todayLogs.slice(-5);

  if (!latestLogs.length) {
    scheduleTimeline.innerHTML = `
      <div class="timeline-row">
        <time>${attendanceConfig.shiftStart}</time>
        <span></span>
        <div>
          <strong>Shift not started</strong>
          <small>No attendance activity yet.</small>
        </div>
      </div>
    `;
    return;
  }

  scheduleTimeline.innerHTML = latestLogs
    .map((log) => {
      let title = "Attendance update";
      let detail = "";

      if (log.action === "login") {
        title = "Login";
        detail =
          log.work_mode === "office"
            ? "Logged in from office"
            : "Logged in from outside office";
      }

      if (log.action === "logout") {
        title = "Logout";
        detail = "Work session ended";
      }

      if (log.action === "break_start") {
        title = "Break started";
        detail = log.break_type
          ? `${String(log.break_type).replace(/_/g, " ")} break`
          : "Break started";
      }

      if (log.action === "break_end") {
        title = "Break ended";
        detail = "Back to work";
      }

      return `
        <div class="timeline-row">
          <time>${currentTimeLabel(log.date)}</time>
          <span></span>
          <div>
            <strong>${title}</strong>
            <small>${detail}</small>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderLeave() {
  if (!leaveLegend || !leaveTable) return;

  /* ===== SAFE DATA COLLECTION (handles all backend formats) ===== */
  const activeTypes = Array.isArray(activeLeaveTypes?.())
    ? activeLeaveTypes()
    : [];

  const requests = [
    ...(Array.isArray(leaveTrackerRequests) ? leaveTrackerRequests : []),
    ...(Array.isArray(window.leaveRequests) ? window.leaveRequests : []),
    ...(Array.isArray(window.myLeaveRequests) ? window.myLeaveRequests : []),
    ...(Array.isArray(window.leaveApplications) ? window.leaveApplications : []),
  ].filter(Boolean);

  /* ===== LEGEND (TOP CARDS) ===== */
  const balanceRows = leaveBalanceRows();
  leaveLegend.innerHTML = activeTypes.length
    ? `
      <div class="leave-hub-legend-grid">
        ${balanceRows
      .slice(0, 3)
      .map((item, index) => {
        const tones = ["approved", "pending", "rejected"];
        const name = item?.label || "Leave";
        const balance = Number(item?.remaining || 0);

        return `
              <div class="leave-hub-legend-card">
                <span class="leave-dot ${tones[index] || "approved"}"></span>
                <div class="leave-info">
                  <strong>${name}</strong>
                  <small>${balance} day${balance === 1 ? "" : "s"}</small>
                </div>
              </div>
            `;
      })
      .join("")}
      </div>
    `
    : `
      <div class="leave-hub-legend-empty">
        <strong>No leave types</strong>
        <small>Leave balances are not available.</small>
      </div>
    `;

  /* ===== TABLE (REQUESTS LIST) ===== */
  leaveTable.innerHTML = requests.length
    ? requests
      .slice(0, 6)
      .map((request) => {
        const type =
          request?.type ||
          request?.leave_type ||
          request?.leaveType ||
          "Leave";

        const status =
          request?.status ||
          request?.approval_status ||
          request?.state ||
          "Pending";

        const start =
          request?.start ||
          request?.start_date ||
          request?.from_date;

        const end =
          request?.end ||
          request?.end_date ||
          request?.to_date;

        const days = calculateLeaveDays(start, end);

        return `
            <tr>
              <td class="leave-type">${type}</td>
              <td class="leave-date">
                ${formatDateRange(start, end)}
              </td>
              <td class="leave-days">${days}</td>
              <td class="leave-status">
                <span class="status ${statusClass(status)}">${status}</span>
              </td>
            </tr>
          `;
      })
      .join("")
    : `
      <tr>
        <td colspan="4" class="empty-row">
          No leave requests yet.
        </td>
      </tr>
    `;
}
function calculateLeaveDays(start, end) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  return Math.max(1, Math.round((endDate - startDate) / 86400000) + 1);
}

function formatDateRange(start, end) {
  if (!start || !end) return "";
  const startText = formatDateText(start, { month: "short", day: "numeric", year: "numeric" });
  const endText = formatDateText(end, { month: "short", day: "numeric", year: "numeric" });
  return start === end ? startText : `${startText} - ${endText}`;
}

function statusClass(status = "") {
  return String(status).toLowerCase().replace(/[\s_]+/g, "-");
}

function renderAnnouncements() {
  if (!announcementsPanel) return;

  const notifications = Array.isArray(window.hrmsNotifications)
    ? window.hrmsNotifications
    : [];

  const dashboardNotifications = notifications
    .filter((item) => {
      const type = String(item.type || "").toLowerCase();
      const title = String(item.title || "").toLowerCase();

      // Do not show normal chat messages inside dashboard notification card
      if (type === "chat") return false;
      if (title === "new message") return false;

      return true;
    })
    .slice(0, 5);

  if (!dashboardNotifications.length) {
    announcementsPanel.innerHTML = `
      <div class="announcement">
        <strong>No HRMS alerts</strong>
        <p>Leave, attendance, timesheet and approval alerts will appear here.</p>
        <small>Live</small>
      </div>
    `;
    return;
  }

  announcementsPanel.innerHTML = dashboardNotifications
    .map((item) => {
      const copy = notificationDisplayCopy(item);

      return `
        <button class="announcement ${item.read_at ? "" : "warning"} ${item.type || ""}"
                type="button"
                data-dashboard-notification-id="${item.id || ""}">
          <strong>${escapeHtml(copy.title)}</strong>
          <p>${escapeHtml(copy.body)}</p>
          <small>${formatNotificationDate(item.created_at)}</small>
        </button>
      `;
    })
    .join("");

  announcementsPanel
    .querySelectorAll("[data-dashboard-notification-id]")
    .forEach((button) => {
      button.addEventListener("click", async () => {
        const id = Number(button.dataset.dashboardNotificationId);
        if (id && typeof markNotificationRead === "function") {
          await markNotificationRead(id);
        }
      });
    });
}

function formatDateText(dateText, options = {}) {
  return new Date(`${dateText}T00:00:00`).toLocaleDateString([], options);
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return date;
}

function weekDates(dateText) {
  const start = startOfWeek(dateText);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return localDateKey(date);
  });
}

function isWeekend(dateText) {
  const day = new Date(`${dateText}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

function holidayForDate(dateText) {
  const scope = currentEmployeeHolidayScope();
  return scopedHolidaysFor(scope.country, scope.location).find((item) => item.date === dateText) || null;
}

function publicHolidayForDate(dateKey) {
  const scope = currentEmployeeHolidayScope();

  return (defaultScopedHolidays || []).find((holiday) => {
    if (!holiday) return false;

    const sameDate = holiday?.date === dateKey;
    const sameCountry = !holiday?.country || holiday?.country === scope.country;
    const sameLocation = !holiday?.location || holiday?.location === scope.location;

    return sameDate && sameCountry && sameLocation;
  }) || null;
}

function leaveForDate(dateText) {
  return leaveTrackerRequests.find((item) => item.status !== "Revoked" && dateText >= item.start && dateText <= item.end) || null;
}

function nextDayCutoff(dateText) {
  const cutoff = new Date(`${dateText}T00:00:00`);
  cutoff.setDate(cutoff.getDate() + 1);
  cutoff.setHours(11, 0, 0, 0);
  return cutoff;
}

function isThursdayFridayWindow(dateText, now = new Date()) {
  const currentDay = now.getDay();
  if (currentDay !== 4 && currentDay !== 5) return false;
  const target = new Date(`${dateText}T00:00:00`);
  const week = weekDates(localDateKey(now));
  return (target.getDay() === 4 || target.getDay() === 5) && week.includes(dateText);
}

function timesheetEditState(dateText, now = new Date()) {
  const leave = leaveForDate(dateText);
  const holiday = holidayForDate(dateText);
  const publicHoliday = publicHolidayForDate(dateText);
  const entry = derivedTimesheetEntry(dateText);
  const today = localDateKey(now);

  if (leave?.status === "Approved") {
    return { editable: false, reason: `${leave.type} is approved for this date. Timesheet hours are not required.` };
  }
  if (leave?.status?.startsWith("Revoke Pending")) {
    return { editable: false, reason: `${leave.type} revoke is pending manager approval. Timesheet hours are not required until the request is resolved.` };
  }
  if (publicHoliday) {
    return { editable: false, reason: `${publicHoliday?.name || "Holiday"} is marked as a public holiday. Timesheet hours are not required.` };
  }
  if (isWeekend(dateText)) {
    return { editable: false, reason: "Saturday and Sunday are non-working days. Timesheet hours are not required." };
  }
  if (dateText > today) {
    return { editable: false, reason: "Future timesheet entries cannot be filled in advance." };
  }
  if (dateText === today || isThursdayFridayWindow(dateText, now)) {
    return { editable: true, reason: holiday?.type === "optional" ? `${holiday?.name} is optional for your location. Fill hours if you are working today.` : entry && safeNumber(entry?.hours, 0) > 0 ? "Timesheet entry is ready for review." : "Timesheet hours have not been entered for this date." };
  }
  if (now >= nextDayCutoff(dateText)) {
    return { editable: false, reason: "Timesheet is frozen. Please contact your manager to update this entry." };
  }
  return { editable: false, reason: "Only the current workday can be filled by employees. Please contact your manager for corrections." };
}

function derivedTimesheetEntry(dateText) {
  const explicit = timesheetEntries[dateText];
  if (explicit) return explicit;

  const leave = leaveForDate(dateText);
  if (leave?.status === "Approved") {
    return {
      task: `${leave.type} (${leave?.leaveId})`,
      hours: 0,
      notes: `Approved leave on this day.`,
      source: "leave",
      submitted: true,
    };
  }

  const holiday = holidayForDate(dateText);
  const publicHoliday = publicHolidayForDate(dateText);
  if (publicHoliday || isWeekend(dateText)) {
    return {
      task: publicHoliday ? publicHoliday.name : "Weekend",
      hours: 0,
      notes: publicHoliday ? "Public holiday. Timesheet hours are not required." : "Weekend. Add hours only if work was done.",
      source: publicHoliday ? "holiday" : "weekend",
      submitted: false,
    };
  }

  return null;
}

function timesheetStatusMessage(entry, leave, holiday) {
  if (leave?.status === "Approved") {
    return `${leave.type} is approved for this date. Timesheet hours are not required.`;
  }
  if (leave?.status?.startsWith("Revoke Pending")) {
    return `${leave.type} revoke is pending manager approval. Timesheet hours are not required until the request is resolved.`;
  }
  if (leave?.status?.startsWith("Pending")) {
    return `${leave.type} is pending approval. Timesheet hours can be updated after the request is resolved.`;
  }
  if (holiday) {
    return holiday?.type === "optional"
      ? `${holiday?.name || "Holiday"} is an optional holiday for your location. Fill hours if you are working today.`
      : `${holiday?.name || "Holiday"} is marked as a public holiday. Timesheet hours are not required.`;
  }
  if (!entry || safeNumber(entry?.hours, 0) <= 0) {
    return "Timesheet hours have not been entered for this date.";
  }
  if (entry?.source === "weekend") {
    return "This date falls on a weekend. Timesheet hours are optional unless work was assigned.";
  }
  if (!entry?.task) {
    return "Hours are recorded. Task details are still pending.";
  }
  return "Timesheet entry is ready for review.";
}

function weekHoursTotal() {
  return Object.values(timesheetEntries || {}).reduce((total, entry) => {
    return total + safeNumber(entry?.hours, 0);
  }, 0);
}

function weekStartForDate(dateText) {
  return weekDates(dateText)[0];
}

function hydrateTimesheetState(state, options = {}) {
  const { preserveCalendarMonth = false } = options;
  timesheetEntries = Object.fromEntries(
    (state.entries || []).map((entry) => [
      entry.entry_date,
      {
        task: entry.task,
        hours: safeNumber(entry?.hours, 0),
        notes: entry.notes || "",
        source: "manual",
        submitted: Boolean(entry.submitted),
      },
    ])
  );
  currentTimesheetWeekStart = state.week_start || null;
  if (Array.isArray(state.holidays)) {
    publicHolidays.length = 0;
    state.holidays.forEach((item) => publicHolidays.push({ date: item.date, name: item.name }));
  }
  if (!preserveCalendarMonth) {
    timesheetCalendarMonth = new Date(`${selectedTimesheetDate}T00:00:00`);
  }
}

function timesheetDayVisualState(dateText, entry, leave, holiday, today = localDateKey(new Date())) {
  const hasHours = safeNumber(entry?.hours, 0) > 0;
  const isPastWorkday = dateText < today && !isWeekend(dateText) && !holiday && !leave;
  const hoursLabel = `${safeNumber(entry?.hours, 0)}h`;

  if (leave?.status === "Approved") {
    return { className: "full-leave leave-approved", label: hoursLabel };
  }
  if (leave?.status?.startsWith("Pending") || leave?.status?.startsWith("Revoke Pending")) {
    return { className: "leave-pending", label: hoursLabel };
  }
  if (holiday) {
    return { className: "holiday", label: hoursLabel };
  }
  if (isWeekend(dateText)) {
    return { className: "weekend", label: hoursLabel };
  }
  if (hasHours) {
    return { className: "has-hours", label: hoursLabel };
  }
  if (isPastWorkday) {
    return { className: "missing-hours", label: "0h" };
  }
  return { className: "not-logged", label: "0h" };
}

function renderTimesheetWorkspace() {
  if (!timesheetDetailCard || !timesheetMiniCalendar) return;
  const week = weekDates(selectedTimesheetDate);
  const today = localDateKey(new Date());
  if (timesheetWeekGrid) {
    timesheetWeekGrid.innerHTML = week.map((dateText) => {
      const entry = derivedTimesheetEntry(dateText);
      const holiday = holidayForDate(dateText);
      const leave = leaveForDate(dateText);
      const visual = timesheetDayVisualState(dateText, entry, leave, holiday, today);
      const classes = [
        dateText === selectedTimesheetDate ? "active" : "",
        visual.className,
      ].join(" ");
      return `
      <button class="timesheet-day ${classes}" type="button" data-timesheet-date="${dateText}">
        <span class="timesheet-day-line"><small>${formatDateText(dateText, { weekday: "short" })}</small><strong>${formatDateText(dateText, { day: "numeric", month: "short" })}</strong></span>
        <small>${visual.label}</small>
      </button>`;
    }).join("");
  }

  const selectedEntry = derivedTimesheetEntry(selectedTimesheetDate) || { task: "", hours: "", notes: "", source: "manual", submitted: false };
  const selectedLeave = leaveForDate(selectedTimesheetDate);
  const selectedHoliday = holidayForDate(selectedTimesheetDate);
  const selectedTaskLabel = selectedHoliday ? (selectedHoliday?.name || "Holiday") : (selectedEntry?.task || "Not added");
  timesheetDetailHeading.textContent = formatDateText(selectedTimesheetDate, { weekday: "long", month: "long", day: "numeric" });
  if (timesheetDayState) timesheetDayState.textContent =
    selectedEntry?.source === "leave" ? `Approved leave - ${selectedLeave?.leaveId || ""}`
      : selectedEntry?.source === "holiday" ? "Public holiday"
        : selectedEntry?.source === "weekend" ? "Weekend"
          : selectedEntry?.submitted ? "Submitted"
            : "Manual draft";
  timesheetDayState?.classList.toggle("muted", selectedEntry?.source !== "leave");
  timesheetDetailCard.innerHTML = `
    ${selectedHoliday ? `<div class="timesheet-metric holiday-detail"><small>Public Holiday</small><span>${selectedHoliday?.name || "Holiday"}</span></div>` : ""}
    <div class="timesheet-metric status-message"><small>Status</small><span>${timesheetStatusMessage(selectedEntry, selectedLeave, selectedHoliday)}</span></div>
    <div class="timesheet-metric"><small>Hours</small><span>${safeNumber(selectedEntry?.hours, 0)}h</span></div>
    <div class="timesheet-metric"><small>Task</small><span>${selectedTaskLabel}</span></div>
    ${selectedLeave ? `<div class="timesheet-metric"><small>Leave ID</small><span>${selectedLeave.leaveId}</span></div>` : ""}
  `;
  timesheetTask.value = selectedEntry?.task || "";
  timesheetHours.value = selectedEntry?.hours ?? "";
  timesheetNotes.value = selectedEntry?.notes || "";
  const editState = timesheetEditState(selectedTimesheetDate);
  timesheetTask.disabled = !editState.editable;
  timesheetHours.disabled = !editState.editable;
  timesheetNotes.disabled = !editState.editable;
  saveTimesheetEntry.disabled = !editState.editable;
  clearTimesheetEntry.disabled = !editState.editable;

  const total = weekHoursTotal();
  timesheetSummaryChip.textContent = `${total}h logged`;
  timesheetSummaryList.innerHTML = `
    <div class="timesheet-summary-row">
      <small>Weekly total</small>
      <span>${total}h</span>
    </div>
    <div class="timesheet-summary-row">
      <small>Entries completed</small>
      <span>${week.filter((dateText) => safeNumber(derivedTimesheetEntry(dateText)?.hours, 0) > 0).length}/7</span>
    </div>
    <div class="timesheet-summary-row">
      <small>Entry rule</small>
      <span>Manual entry required</span>
    </div>
    <div class="timesheet-summary-row">
      <small>Work mode</small>
      <span>${attendanceState.locationStatus === "office" ? "Office" : attendanceState.wfhStatus === "approved" ? "WFH" : "Pending"}</span>
    </div>
  `;

  const first = new Date(timesheetCalendarMonth.getFullYear(), timesheetCalendarMonth.getMonth(), 1);
  const monthYear = first.toLocaleDateString([], { month: "long", year: "numeric" });
  const startDay = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = ["M", "T", "W", "T", "F", "S", "S"].map((label) => `<span>${label}</span>`);
  for (let i = 0; i < startDay; i += 1) cells.push(`<span></span>`);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = localDateKey(new Date(first.getFullYear(), first.getMonth(), day));
    const entry = derivedTimesheetEntry(date);
    const leave = leaveForDate(date);
    const holiday = holidayForDate(date);
    const editState = timesheetEditState(date);
    const visual = timesheetDayVisualState(date, entry, leave, holiday, today);
    const classes = [
      date === today ? "today" : "",
      date === selectedTimesheetDate ? "active" : "",
      visual.className,
      !editState.editable ? "locked" : "",
    ].join(" ");
    let subLabel = leave?.status === "Approved"
      ? `${leave.leaveId || "Leave"} · ${safeNumber(entry?.hours, 0)}h`
      : leave?.status?.startsWith("Pending")
        ? `${leave.leaveId || "Leave"} · Pending`
        : leave?.status?.startsWith("Revoke Pending")
          ? `${leave.leaveId || "Leave"} · Revoke pending`
          : holiday
            ? holiday?.type === "optional" ? "Optional" : "Holiday"
            : entry
              ? `${safeNumber(entry?.hours, 0)}h`
              : "0h";
    subLabel = visual.label;
    cells.push(`<button class="${classes}" type="button" data-timesheet-date="${date}"><b>${day}</b><small>${subLabel}</small></button>`);
  }
  timesheetMiniCalendar.innerHTML = `<div class="calendar-caption"><strong>${monthYear}</strong><small>Hours / leave status</small></div>${cells.join("")}`;
}

function saveCurrentTimesheetEntry() {
  persistTimesheetEntry().catch((error) => {
    showToast(error.message || "Timesheet entry could not be saved.");
  });
}

function clearCurrentTimesheetEntry() {
  const editState = timesheetEditState(selectedTimesheetDate);
  if (!editState.editable) {
    showToast(editState.reason);
    return;
  }
  fetchJson(`/api/v1/timesheets/entries/${selectedTimesheetDate}`, {
    method: "DELETE",
  })
    .then(() => loadTimesheetState(selectedTimesheetDate, { preserveCalendarMonth: true }))
    .then(() => {
      renderTimesheetWorkspace();
      showToast("Day entry cleared.");
    })
    .catch((error) => {
      showToast(error.message || "Day entry could not be cleared.");
    });
}

function submitWeeklyTimesheetAction() {
  submitTimesheetWeekToBackend().catch(() => {
    showToast("Weekly timesheet could not be submitted.");
  });
}

function leaveDaysInclusive(start, end) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const diff = Math.round((endDate - startDate) / 86400000);
  return diff + 1;
}

function isDateInRange(dateText, start, end) {
  return start && end && dateText >= start && dateText <= end;
}

function selectLeaveDate(dateText) {
  if (!leaveRangeAnchor || (leaveStartInput.value && leaveEndInput.value)) {
    leaveRangeAnchor = dateText;
    leaveStartInput.value = dateText;
    leaveEndInput.value = "";
  } else {
    const start = leaveRangeAnchor <= dateText ? leaveRangeAnchor : dateText;
    const end = leaveRangeAnchor <= dateText ? dateText : leaveRangeAnchor;
    leaveStartInput.value = start;
    leaveEndInput.value = end;
    leaveRangeAnchor = null;
  }
  renderLeaveWorkspace();
}

function syncLeaveRangeFromInputs() {
  leaveRangeAnchor = leaveStartInput.value && !leaveEndInput.value ? leaveStartInput.value : null;
  renderLeaveWorkspace();
}

function leaveStepsFor(request) {
  if (request?.stage === "auto_approved" || request?.status === "Auto Approved") {
    return [
      ["Submitted", "done"],
      ["No approval", "done"],
      ["Approved", "done"],
    ];
  }
  if (request?.stage === "hr" || request?.stage === "manager_hr") {
    return [
      ["Manager", request?.stage === "manager_hr" ? "current" : "done"],
      ["HR", request?.stage === "hr" ? "current" : ""],
      ["Approval", ""],
    ];
  }
  if (request?.status === "Revoked") {
    return [
      ["Submitted", "done"],
      ["Revoked", "rejected"],
      ["Closed", "rejected"],
    ];
  }
  if (request?.status?.startsWith("Revoke Pending")) {
    return [
      ["Approved", "done"],
      ["Revoke review", "current"],
      [request?.stage === "revoke_supervisor" ? "Supervisor" : "Manager", "current"],
    ];
  }
  if (request?.status === "Rejected") {
    return [
      ["Supervisor", "done"],
      ["Manager", "rejected"],
      ["Closed", "rejected"],
    ];
  }
  if (request?.status === "Approved") {
    return [
      ["Supervisor", "done"],
      ["Manager", "done"],
      ["Approved", "done"],
    ];
  }
  return [
    ["Supervisor", request?.stage === "supervisor" ? "current" : "done"],
    ["Manager", request?.stage === "manager" ? "current" : request?.stage === "completed" ? "done" : ""],
    ["Approval", ""],
  ];
}

function statusClassName(status) {
  return safeStatus(status).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function approvalStageForFlow(flow = "Manager only") {
  if (flow === "No approval required") return { status: "Approved", stage: "auto_approved", message: "Leave approved automatically. No approval required." };
  if (flow === "Manager then HR") return { status: "Pending HR", stage: "hr", message: "Leave request submitted for Manager and HR approval." };
  if (flow === "Supervisor then Manager") return { status: "Pending Supervisor", stage: "supervisor", message: "Leave request submitted for Supervisor and Manager approval." };
  return { status: "Pending Manager", stage: "manager", message: "Leave request submitted for Manager approval." };
}

function canRevokeLeave(request) {
  return safeStatus(request?.status) !== "Revoked" && !safeStatus(request?.status).startsWith("Revoke Pending");
}

function leaveStatusConsumesBalance(status = "") {
  const clean = safeStatus(status).toLowerCase();
  return (
    clean.startsWith("pending") ||
    clean === "approved" ||
    clean.startsWith("revoke pending")
  );
}

function leaveUsageByType() {
  const usage = new Map();
  (leaveTrackerRequests || [])
    .filter((request) => leaveStatusConsumesBalance(request?.status))
    .forEach((request) => {
      const type = normalizeLeaveTypeKey(request?.type || "Leave");
      usage.set(type, (usage.get(type) || 0) + Number(request?.days || 0));
    });
  return usage;
}

function normalizeLeaveTypeKey(value = "") {
  return safeText(value, "Leave")
    .replace(/\s+Leave$/i, "")
    .trim()
    .toLowerCase();
}

function leaveBalanceRows() {
  const usage = leaveUsageByType();
  return activeLeaveTypes().map((type) => {
    const allocated = Number(type.balance || 0);
    const typeKey = normalizeLeaveTypeKey(type.name);
    const used = usage.get(typeKey) || 0;
    return {
      label: type.name.replace(/\s+Leave$/i, ""),
      name: type.name,
      key: typeKey,
      allocated,
      used,
      remaining: Math.max(0, allocated - used),
    };
  });
}

function revokeLeaveRequest(requestId) {
  const request = leaveTrackerRequests.find((item) => String(item.id) === String(requestId));
  if (!request) {
    showToast("Leave request could not be found. Refresh and try again.");
    return;
  }
  if (!canRevokeLeave(request)) {
    showToast(request?.status === "Revoked" ? "This leave request is already revoked." : "Revoke approval is already pending.");
    return;
  }
  showToast("Processing revoke request...");
  fetchJson(`/api/v1/leaves/request/${requestId}`, { method: "DELETE" })
    .then(() => loadLeaveState())
    .then(() => {
      renderLeave();
      renderLeaveWorkspace();
      const updated = leaveTrackerRequests.find((item) => String(item.id) === String(requestId));
      showToast(safeStatus(updated?.status).startsWith("Revoke Pending") ? "Revoke request sent for manager approval." : "Leave request marked as revoked.");
    })
    .catch((error) => {
      showToast(error.message || "Leave request could not be revoked.");
    });
}

function cleanLeaveReason(rawReason) {
  if (!rawReason) return "";

  if (typeof rawReason === "object") {
    return rawReason.reason || rawReason.notes || rawReason.comment || "";
  }

  const text = String(rawReason).trim();

  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const parsed = JSON.parse(text);
      return parsed.reason || parsed.notes || parsed.comment || "";
    } catch {
      return text;
    }
  }

  return text;
}

function mapLeaveStateRequests(state) {
  const rows = Array.isArray(state) ? state : (state?.requests || []);

  return rows.filter(Boolean).map((item) => {
    const parsedReason = cleanLeaveReason(item?.reason);

    return {
      id: item?.id,
      employeeId: item?.employee_id,
      requesterName: item?.requester_name || "",
      requesterCode: item?.requester_employee_code || "",
      leaveId: item?.leave_id || formatLeaveRequestId(item),
      type: item?.leave_type || "Leave",
      start: item?.start_date || "",
      end: item?.end_date || "",
      days: item?.start_date && item?.end_date ? leaveDaysInclusive(item.start_date, item.end_date) : 0,
      reason: parsedReason || "No reason added",
      status: String(item?.status || "").replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase()),
      stage: item?.stage || String(item?.status || ""),
    };
  });
}

function formatLeaveRequestId(item = {}) {
  const rawId = Number(item?.id || 0);
  const requestYear = safeText(item?.start_date || item?.created_at || new Date().toISOString()).slice(0, 4);
  const paddedId = rawId > 0 ? String(rawId).padStart(5, "0") : "00000";
  return `WVL-LV-${requestYear}-${paddedId}`;
}

function leaveCalendarTag(request, holiday, dateText) {
  if (request?.status === "Approved") return request.leaveId || "Approved";
  if (request?.status?.startsWith("Pending")) return "Pending";
  if (request?.status?.startsWith("Revoke Pending")) return "Revoke pending";
  if (request?.status === "Revoked") return "Revoked";
  if (holiday) return holiday.name || "Holiday";
  if (isWeekend(dateText)) return "Weekend";
  return "";
}

function renderLeaveWorkspace() {
  if (!leaveRequestList || !leaveBalanceGrid) return;
  renderLeaveTypeOptions();
  const pendingRequests = (leaveTrackerRequests || []).filter((item) => safeStatus(item?.status).startsWith("Pending") || safeStatus(item?.status).startsWith("Revoke Pending"));
  const pendingCount = pendingRequests.length;
  const pendingDays = pendingRequests.reduce((sum, item) => sum + Number(item?.days || 0), 0);
  leavePendingChip.textContent = `${pendingCount} pending`;
  const selectedStart = leaveStartInput.value;
  const selectedEnd = leaveEndInput.value;
  const selectedDays = selectedStart && selectedEnd && selectedEnd >= selectedStart ? leaveDaysInclusive(selectedStart, selectedEnd) : 0;
  if (leaveSelectionSummary) {
    leaveSelectionSummary.innerHTML = `
      <div>
        <small>Selected range</small>
        <span>${selectedStart ? formatDateText(selectedStart, { month: "short", day: "numeric" }) : "Start date"}${selectedEnd ? ` - ${formatDateText(selectedEnd, { month: "short", day: "numeric" })}` : ""}</span>
      </div>
      <div>
        <small>Leave days</small>
        <span>${selectedDays || "--"}</span>
      </div>`;
  }
  leaveBalanceGrid.innerHTML = [
    ...leaveBalanceRows().map((type) => [
      type.label,
      type.remaining,
      `${type.used}/${type.allocated} days used`,
    ]),
    ["Pending", pendingDays, "days in approval"],
  ].map(([label, value, note]) => `
    <div class="leave-balance-item">
      <strong>${label}</strong>
      <span>${value}</span>
      <small>${note}</small>
    </div>`).join("");

  leaveRequestList.innerHTML = (leaveTrackerRequests || [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => safeText(b?.start).localeCompare(safeText(a?.start)))
    .map((request) => `
      <article class="leave-request-card">
        <div class="leave-request-head">
          <div>
            <strong>${request?.type || "Leave"}</strong>
            <small>${request?.leaveId || ""} - ${formatDateText(request.start, { month: "short", day: "numeric" })} – ${formatDateText(request.end, { month: "short", day: "numeric" })}</small>
          </div>
          <span class="status ${statusClassName(request?.status)}">${request?.status}</span>
        </div>
        <div class="leave-request-meta">
          <span>${request?.days || 0} day(s)</span>
          <span>${request?.reason || ""}</span>
        </div>
        <div class="leave-request-steps">
          ${leaveStepsFor(request).map(([label, state]) => `<span class="leave-step ${state}">${label}</span>`).join("")}
        </div>
        <div class="leave-request-actions">
          <button class="revoke-leave-button" type="button" data-revoke-leave="${request?.id || ""}" ${canRevokeLeave(request) ? "" : "disabled"}>${request?.status === "Revoked" ? "Revoked" : request?.status?.startsWith("Revoke Pending") ? "Pending approval" : "Revoke leave"}</button>
        </div>
      </article>`).join("");
  const requestRows = (leaveTrackerRequests || [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => safeText(b?.start).localeCompare(safeText(a?.start)))
    .map((request) => `
      <tr>
        <td><div class="leave-type-cell"><strong>${request?.type || "Leave"}</strong><small>${request?.leaveId || ""}</small></div></td>
        <td>${formatDateText(request?.start, { month: "short", day: "numeric" })} - ${formatDateText(request?.end, { month: "short", day: "numeric" })}</td>
        <td>${request?.days || 0}</td>
        <td>${request?.reason || ""}</td>
        <td><span class="status ${statusClassName(request?.status)}">${request?.status}</span></td>
        <td><button class="revoke-leave-button" type="button" data-revoke-leave="${request?.id || ""}" ${canRevokeLeave(request) ? "" : "disabled"}>${request?.status === "Revoked" ? "Revoked" : request?.status?.startsWith("Revoke Pending") ? "Pending approval" : "Revoke"}</button></td>
      </tr>`).join("");
  leaveRequestList.innerHTML = `
    <table class="leave-request-table">
      <thead>
        <tr>
          <th>Type</th>
          <th>Dates</th>
          <th>Days</th>
          <th>Reason</th>
          <th>Status</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>${requestRows || `<tr><td colspan="6">No leave requests yet.</td></tr>`}</tbody>
    </table>`;

  const monthDate = leaveCalendarMonth;
  leaveMonthLabel.textContent = monthDate.toLocaleDateString([], { month: "long", year: "numeric" });
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startWeekday = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const calendarCells = ["M", "T", "W", "T", "F", "S", "S"].map((label) => `<span>${label}</span>`);
  for (let i = 0; i < startWeekday; i += 1) calendarCells.push("<span></span>");
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateText = localDateKey(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));
    const request = leaveForDate(dateText);
    const holiday = holidayForDate(dateText);
    const classes = [
      dateText === localDateKey(new Date()) ? "today" : "",
      leaveRangeAnchor === dateText ? "range-anchor" : "",
      (selectedStart === dateText || selectedEnd === dateText) ? "range-edge" : "",
      isDateInRange(dateText, selectedStart, selectedEnd) ? "range-selected" : "",
      request?.status === "Approved" ? "leave-approved" : "",
      (request?.status?.startsWith("Pending") || request?.status?.startsWith("Revoke Pending")) ? "leave-pending" : "",
      request?.status === "Revoked" ? "leave-revoked" : "",
      holiday ? "holiday" : "",
      isWeekend(dateText) && !holiday ? "weekend" : "",
    ].join(" ");
    const tag = leaveCalendarTag(request, holiday, dateText);
    calendarCells.push(`<button class="${classes}" type="button" data-leave-date="${dateText}"><b>${day}</b>${tag ? `<small>${tag}</small>` : ""}</button>`);
  }
  leaveCalendarGrid.innerHTML = calendarCells.join("");
}

function submitLeaveApplication() {
  if (!leaveTypeInput.value || !leaveStartInput.value || !leaveEndInput.value || !leaveReasonCategoryInput.value) {
    showToast("Complete leave type, dates and reason.");
    return;
  }

  if (leaveEndInput.value < leaveStartInput.value) {
    showToast("End date should be after start date.");
    return;
  }

  const selectedDays = leaveDaysInclusive(leaveStartInput.value, leaveEndInput.value);
  const selectedLeaveTypeKey = normalizeLeaveTypeKey(leaveTypeInput.value);
  const selectedBalance = leaveBalanceRows().find((item) => item.key === selectedLeaveTypeKey);
  if (selectedBalance && selectedDays > selectedBalance.remaining) {
    showToast(`${leaveTypeInput.value} has only ${selectedBalance.remaining} day(s) available.`);
    return;
  }

  submitLeaveRequest.disabled = true;
  submitLeaveRequest.textContent = "Submitting...";

  fetchJson("/api/v1/leaves", {
    method: "POST",
    body: JSON.stringify({
      leave_type: leaveTypeInput.value,
      start_date: leaveStartInput.value,
      end_date: leaveEndInput.value,
      reason: leaveReasonInput.value.trim()
        ? `${leaveReasonCategoryInput.value}: ${leaveReasonInput.value.trim()}`
        : leaveReasonCategoryInput.value,
    }),
  })
    .then(() => loadLeaveState())
    .then(() => {
      resetLeaveApplicationForm();
      renderLeave();
      renderLeaveWorkspace();
      showToast("Leave request submitted.");
    })
    .catch((error) => {
      showToast(error.message || "Leave request could not be saved.");
    })
    .finally(() => {
      submitLeaveRequest.disabled = false;
      submitLeaveRequest.textContent = "Submit leave request";
    });
}

function resetLeaveApplicationForm() {
  renderLeaveTypeOptions();
  leaveTypeInput.value = activeLeaveTypes()[0].name || "";
  leaveReasonCategoryInput.value = "Family event";
  leaveStartInput.value = "";
  leaveEndInput.value = "";
  leaveReasonInput.value = "";
  leaveRangeAnchor = null;
  renderLeaveWorkspace();
}

let currentTimesheetStatus = "draft";
let currentTimesheetId = null;

function hydrateTimesheetFromApi(timesheet) {
  timesheetEntries = {};

  if (!timesheet) {
    currentTimesheetId = null;
    currentTimesheetStatus = "draft";
    currentTimesheetWeekStart = weekStartForDate(selectedTimesheetDate);
    return;
  }

  currentTimesheetId = timesheet.id;
  currentTimesheetStatus = timesheet.status || "draft";
  currentTimesheetWeekStart = timesheet.week_start;

  (timesheet.entries || []).forEach((entry) => {
    timesheetEntries[entry.entry_date] = {
      task: entry.task || "",
      hours: safeNumber(entry.hours, 0),
      notes: entry.notes || "",
      source: "manual",
      submitted: currentTimesheetStatus !== "draft",
    };
  });
}

async function loadTimesheetState(targetDate = selectedTimesheetDate, options = {}) {
  selectedTimesheetDate = targetDate || selectedTimesheetDate || localDateKey(new Date());

  if (!options.preserveCalendarMonth) {
    timesheetCalendarMonth = new Date(`${selectedTimesheetDate}T00:00:00`);
  }

  const weekStart = weekStartForDate(selectedTimesheetDate);
  const timesheets = await fetchJson("/api/v1/timesheets");
  const current = (timesheets || []).find((item) => item.week_start === weekStart);

  hydrateTimesheetFromApi(current || null);
  renderTimesheetWorkspace();
}

function selectTimesheetDate(dateText) {
  selectedTimesheetDate = dateText || selectedTimesheetDate;
  timesheetCalendarMonth = new Date(`${selectedTimesheetDate}T00:00:00`);

  const selectedWeekStart = weekStartForDate(selectedTimesheetDate);

  if (currentTimesheetWeekStart === selectedWeekStart) {
    renderTimesheetWorkspace();
    return;
  }

  loadTimesheetState(selectedTimesheetDate, { preserveCalendarMonth: true }).catch((error) => {
    showToast(error.message || "Timesheet week could not be loaded.");
  });
}

async function persistTimesheetEntry() {
  if (currentTimesheetStatus !== "draft") {
    showToast("Submitted timesheet cannot be edited.");
    return;
  }

  const editState = timesheetEditState(selectedTimesheetDate);
  if (!editState.editable) {
    showToast(editState.reason);
    return;
  }

  const task = timesheetTask.value.trim();
  const hours = Number(timesheetHours.value || 0);
  const notes = timesheetNotes.value.trim();

  if (!task) {
    showToast("Task is required.");
    timesheetTask.focus();
    return;
  }

  if (Number.isNaN(hours) || hours <= 0 || hours > 24) {
    showToast("Enter valid hours between 0.25 and 24.");
    timesheetHours.focus();
    return;
  }

  const updated = await fetchJson("/api/v1/timesheets/entries", {
    method: "POST",
    body: JSON.stringify({
      entry_date: selectedTimesheetDate,
      task,
      hours,
      notes: notes || null,
    }),
  });

  hydrateTimesheetFromApi(updated);
  renderTimesheetWorkspace();
  showToast("Timesheet day saved.");
}

function saveCurrentTimesheetEntry() {
  persistTimesheetEntry().catch((error) => {
    showToast(error.message || "Timesheet entry could not be saved.");
  });
}

function clearCurrentTimesheetEntry() {
  if (currentTimesheetStatus !== "draft") {
    showToast("Submitted timesheet cannot be edited.");
    return;
  }

  const editState = timesheetEditState(selectedTimesheetDate);
  if (!editState.editable) {
    showToast(editState.reason);
    return;
  }

  fetchJson(`/api/v1/timesheets/entries/${selectedTimesheetDate}`, {
    method: "DELETE",
  })
    .then(() => loadTimesheetState(selectedTimesheetDate, { preserveCalendarMonth: true }))
    .then(() => {
      timesheetTask.value = "";
      timesheetHours.value = "";
      timesheetNotes.value = "";
      showToast("Day entry cleared.");
    })
    .catch((error) => {
      showToast(error.message || "Day entry could not be cleared.");
    });
}

async function submitTimesheetWeekToBackend() {
  const weekDatesList = weekDates(selectedTimesheetDate);
  const totalHours = weekDatesList.reduce(
    (sum, dateText) => sum + safeNumber(timesheetEntries[dateText]?.hours, 0),
    0
  );

  if (totalHours <= 0) {
    showToast("Add at least one day before submitting.");
    return;
  }

  const updated = await fetchJson("/api/v1/timesheets/submit-week", {
    method: "POST",
    body: JSON.stringify({ week_start: weekStartForDate(selectedTimesheetDate) }),
  });

  hydrateTimesheetFromApi(updated);
  renderTimesheetWorkspace();
  showToast("Timesheet week submitted.");
}

function submitWeeklyTimesheetAction() {
  submitTimesheetWeekToBackend().catch((error) => {
    showToast(error.message || "Weekly timesheet could not be submitted.");
  });
}

async function loadLeaveState() {
  try {
    const state = await fetchJson("/api/v1/leaves");

    leaveTrackerRequests = mapLeaveStateRequests(state);

    renderLeave();
    renderLeaveWorkspace();
  } catch (error) {
    console.error("Leave state load failed", error);
    leaveTrackerRequests = [];

    renderLeave();
    renderLeaveWorkspace();
  }
}

function filteredActivityItems() {
  return activityItems.filter((item) => {
    if (activeActivityFilter === "All") return true;
    if (activeActivityFilter === "Unread") return item.unread;
    if (activeActivityFilter === "Mentions") return item.title.toLowerCase().includes("mentioned") || item.category === "chat";
    if (activeActivityFilter === "Calendar") return item.category === "calendar";
    return true;
  });
}

function renderActivityFeed() {
  const items = filteredActivityItems();
  activityList.innerHTML = items.length
    ? items.map((item) => {
      const copy = notificationDisplayCopy(item);

      return `
        <button class="activity-item ${item.unread ? "unread" : ""}" type="button" data-activity-id="${item.id}" data-activity-target="${item.target || ""}">
          <span class="activity-pill ${item.category}">${item.category}</span>
          <strong>${escapeHtml(copy.title)}</strong>
          <p>${escapeHtml(copy.body)}</p>
          <div>
            <small>${escapeHtml(item.actor || "Activity")}</small>
            <time>${new Date(item.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
          </div>
        </button>`;
    }).join("")
    : `<div class="empty-state">No activity items match this filter.</div>`;

  activityList.querySelectorAll("[data-activity-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = activityItems.find((entry) => entry.id === button.dataset.activityId);
      if (!item) return;
      if (item.unread) {
        try {
          await fetchJson(`/api/v1/activity/feed/${encodeURIComponent(item.id)}/read`, { method: "POST" });
          item.unread = false;
          renderActivityFeed();
        } catch (error) {
          showToast("Activity item could not be marked read.");
        }
      }
      if (button.dataset.activityTarget === "calendar") {
        navigateToView("calendar", "calendarView", "Calendar");
      } else if (button.dataset.activityTarget === "chat") {
        navigateToView("chat", "chatView", "Chat");
      } else {
        navigateToView("dashboard", "dashboardSection", "Dashboard");
      }
    });
  });
}

function formatCalendarMonth(date) {
  return date.toLocaleString([], { month: "long", year: "numeric" });
}

function toLocalInputValue(date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function calendarEventsForDate(dateText) {
  return calendarEvents
    .filter((event) => localDateKey(new Date(event.start_at)) === dateText)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
}

function calendarParticipantUsers() {
  const currentId = Number(window.currentUser?.id);
  return (chatUsers || [])
    .filter((user) => Number(user.id) !== currentId)
    .sort((a, b) => displayUserName(a).localeCompare(displayUserName(b)));
}

function renderCalendarAttendeePicker(selectedUserIds = []) {
  if (!calendarAttendees) return;
  const selected = new Set((selectedUserIds || []).map((id) => String(id)));
  const users = calendarParticipantUsers();

  if (!users.length) {
    calendarAttendees.innerHTML = "<small>No other active users found.</small>";
    return;
  }

  calendarAttendees.innerHTML = `
    <small>Choose who should see this meeting.</small>
    <div class="participant-list">
      ${users.map((user) => {
        const userId = String(user.id);
        const name = displayUserName(user);
        const detail = user.employee_code || user.email || user.job_title || "User";

        return `
          <label class="participant-option">
            <input type="checkbox" value="${userId}" ${selected.has(userId) ? "checked" : ""} />
            <span>
              <strong>${escapeHtml(name)}</strong>
              <small>${escapeHtml(detail)}</small>
            </span>
          </label>`;
      }).join("")}
    </div>
  `;
}

function selectedCalendarAttendeeIds() {
  if (!calendarAttendees) return [];
  return [...calendarAttendees.querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => Number(input.value))
    .filter(Boolean);
}

function calendarMeetingLink(event = {}) {
  return (
    event.meeting_link ||
    event.meetingLink ||
    event.online_link ||
    event.join_url ||
    event.joinUrl ||
    ""
  ).trim();
}

function isOnlineMeeting(event = {}) {
  const link = calendarMeetingLink(event);
  const type = String(event.event_type || event.type || "").toLowerCase();
  const location = String(event.location || "").toLowerCase();

  return Boolean(
    link ||
    type.includes("meeting") ||
    location.includes("meet.google.com") ||
    location.includes("teams.microsoft.com") ||
    location.includes("zoom.us")
  );
}

function joinMeeting(link) {
  const cleanLink = String(link || "").trim();

  if (!cleanLink || cleanLink === "null" || cleanLink === "undefined") {
    showToast("No meeting link available for this event.");
    return;
  }

  window.open(cleanLink, "_blank", "noopener,noreferrer");
}

function eventParticipantLabel(event = {}) {
  const attendeeIds = Array.isArray(event.attendee_user_ids) ? event.attendee_user_ids : [];
  if (!attendeeIds.length) return "Only you";
  const names = attendeeIds
    .map((userId) => findChatUser(userId))
    .filter(Boolean)
    .map(displayUserName)
    .filter(Boolean);

  if (!names.length) return `${attendeeIds.length} participant${attendeeIds.length === 1 ? "" : "s"}`;
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

function calendarMeetingLink(event = {}) {
  return String(
    event.meeting_link ||
    event.meetingLink ||
    event.online_link ||
    event.join_url ||
    event.joinUrl ||
    event.location ||
    ""
  ).trim();
}

function joinMeeting(link) {
  const cleanLink = String(link || "").trim();

  if (!cleanLink || cleanLink === "null" || cleanLink === "undefined") {
    showToast("No meeting link available for this event.");
    return;
  }

  window.open(cleanLink, "_blank", "noopener,noreferrer");
}

function renderCalendar() {
  calendarGrid.innerHTML = "";

  const selectedDate = selectedCalendarDate || localDateKey(new Date());

  calendarMonthLabel.textContent = new Date(`${selectedDate}T00:00:00`).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const dayEvents = calendarEventsForDate(selectedDate);

  const dayShell = document.createElement("div");
  dayShell.className = "teams-day-calendar";

  for (let hour = 0; hour < 24; hour += 1) {
    const slot = document.createElement("div");
    slot.className = "teams-time-slot";

    const label = new Date(2026, 0, 1, hour, 0).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const eventsAtHour = dayEvents.filter((event) => {
      const start = new Date(event.start_at);
      return start.getHours() === hour;
    });

    slot.innerHTML = `
      <div class="teams-time-label">${label}</div>
      <div class="teams-slot-body"></div>
    `;

    const body = slot.querySelector(".teams-slot-body");

    eventsAtHour.forEach((event) => {
      const link = calendarMeetingLink(event);

      const card = document.createElement("article");
      card.className = "teams-meeting-card";

      card.innerHTML = `
        <div>
          <strong>${event.title}</strong>
          <span>${new Date(event.start_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })} - ${new Date(event.end_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}</span>
          <small>${event.description || event.location || "Meeting"}</small>
          <small>Participants: ${escapeHtml(eventParticipantLabel(event))}</small>
        </div>

        <div class="meeting-actions">
          ${link
          ? `<button class="join-btn" type="button" data-join-link="${link}">Join</button>`
          : `<button class="join-btn" type="button" disabled>No link</button>`
        }

          <button class="calendar-delete" type="button" data-delete-event="${event.id}">
            Remove
          </button>
        </div>
      `;

      body.appendChild(card);
    });

    dayShell.appendChild(slot);
  }

  calendarGrid.appendChild(dayShell);

  calendarGrid.querySelectorAll("[data-join-link]").forEach((button) => {
    button.addEventListener("click", () => joinMeeting(button.dataset.joinLink));
  });

  calendarGrid.querySelectorAll("[data-delete-event]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Remove this calendar event?")) return;

      await fetchJson(`/api/v1/calendar/events/${button.dataset.deleteEvent}`, {
        method: "DELETE",
      });

      calendarEvents = calendarEvents.filter(
        (event) => String(event.id) !== String(button.dataset.deleteEvent)
      );

      renderCalendar();
      renderMeetingList();
      showToast("Event removed.");
    });
  });

  renderMeetingList();
}

function renderMeetingList() {
  const events = calendarEventsForDate(selectedCalendarDate);

  const heading = new Date(`${selectedCalendarDate}T00:00:00`).toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  meetingList.innerHTML = `
    <div class="meeting-list-head">
      <strong>${heading}</strong>
      <span>${events.length} scheduled</span>
    </div>

    ${events.length
      ? events.map((event) => {
        const link = calendarMeetingLink(event);
        const start = event.all_day
          ? "All day"
          : new Date(event.start_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });

        const end = event.all_day
          ? ""
          : new Date(event.end_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });

        return `
              <article class="meeting-card">
                <time>${start}${end ? ` - ${end}` : ""}</time>
                <div>
                  <strong>${event.title}</strong>
                  <span>${event.description || event.location || event.event_type || "Calendar event"}</span>
                  <small>Participants: ${escapeHtml(eventParticipantLabel(event))}</small>

                  <div class="meeting-actions">
                    ${link
            ? `<button class="join-btn" type="button" data-join-link="${link}">Join</button>`
            : `<button class="join-btn" type="button" disabled>No link</button>`
          }

                    <button class="calendar-delete" type="button" data-delete-event="${event.id}">
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            `;
      }).join("")
      : `<div class="empty-state">No events planned for this day.</div>`
    }
  `;

  meetingList.querySelectorAll("[data-join-link]").forEach((button) => {
    button.addEventListener("click", () => {
      joinMeeting(button.dataset.joinLink);
    });
  });

  meetingList.querySelectorAll("[data-delete-event]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Remove this calendar event?")) return;

      try {
        await fetchJson(`/api/v1/calendar/events/${button.dataset.deleteEvent}`, {
          method: "DELETE",
        });

        calendarEvents = calendarEvents.filter(
          (event) => String(event.id) !== String(button.dataset.deleteEvent)
        );

        renderCalendar();
        showToast("Event removed.");
      } catch {
        showToast("Event could not be removed.");
      }
    });
  });
}

async function openCalendarModal() {
  const baseDate = selectedCalendarDate || localDateKey(new Date());
  if (!chatUsers.length) {
    await loadChatUsers();
  }
  calendarTitle.value = "";
  calendarType.value = "meeting";
  calendarLocation.value = "";
  calendarVisibility.value = "personal";
  calendarDescription.value = "";
  calendarStart.value = `${baseDate}T09:00`;
  calendarEnd.value = `${baseDate}T09:30`;
  renderCalendarAttendeePicker();
  calendarModal.classList.remove("hidden");
}

function closeCalendarEventModal() {
  calendarModal.classList.add("hidden");
}

async function saveCalendarReminder() {
  if (!calendarTitle.value.trim()) {
    showToast("Add an event title.");
    return;
  }
  try {
    const events = await fetchJson("/api/v1/calendar/events", {
      method: "POST",
      body: JSON.stringify({
        title: calendarTitle.value.trim(),
        description: calendarDescription.value.trim() || null,
        location: calendarLocation.value.trim() || null,
        start_at: new Date(calendarStart.value).toISOString(),
        end_at: new Date(calendarEnd.value).toISOString(),
        event_type: calendarType.value,
        visibility: calendarVisibility.value,
        attendee_user_ids: selectedCalendarAttendeeIds(),
        all_day: false,
      }),
    });
    calendarEvents = events || [];
    selectedCalendarDate = calendarStart.value.slice(0, 10);
    calendarMonth = new Date(`${selectedCalendarDate}T00:00:00`);
    closeCalendarEventModal();
    renderCalendar();
    showToast("Calendar event saved.");
  } catch (error) {
    showToast("Event could not be saved.");
  }
}

function totalUnreadCount() {
  return Object.values(unreadState).reduce((sum, count) => sum + Number(count || 0), 0);
}

function isChannelConversation(item) {
  const role = String(item.role || "").toLowerCase();
  const section = String(item.section || "").toLowerCase();
  return role.includes("channel") || section.includes("channel");
}

function syncChatFilterButtons() {
  document.querySelectorAll(".rail-filter button").forEach((button) => {
    const label = button.textContent.trim();
    button.classList.toggle("active", label === activeChatFilter);
    button.setAttribute("aria-pressed", label === activeChatFilter ? "true" : "false");
  });
}

function syncUnreadState() {
  conversations.forEach((item) => {
    item.unread = unreadState[item.id] ? String(unreadState[item.id]) : "";
  });
  const chatRailButton = document.querySelector('.teams-app-rail [data-app="Chat"] em');
  if (chatRailButton) {
    const total = totalUnreadCount();
    chatRailButton.textContent = total;
    chatRailButton.classList.toggle("hidden", total === 0);
  }
  syncPulseSuiteNav();
  const notificationBadge = notificationToggle.querySelector("span");
  if (notificationBadge) {
    const badgeCount = Math.max(unreadNotificationCount, totalUnreadCount());
    notificationBadge.textContent = String(badgeCount);
    notificationBadge.classList.toggle("hidden", badgeCount <= 0);
  }
  const sidebarChat = [...sidebarNav.querySelectorAll(".nav-item")].find((button) => button.dataset.label === "Chat");
  if (sidebarChat) {
    let badge = sidebarChat.querySelector("em");
    const total = totalUnreadCount();
    if (total && !badge) {
      badge = document.createElement("em");
      sidebarChat.appendChild(badge);
    }
    if (badge) {
      badge.textContent = total;
      badge.classList.toggle("hidden", total === 0);
    }
  }
}

async function markConversationRead(conversationId) {
  const unreadMessages = (conversationMessages[conversationId] || [])
    .filter((m) => m.side === "left" && !m.read && m.id)
    .map((m) => Number(m.id))
    .filter((id) => Number.isFinite(id));
  if (!unreadMessages.length) {
    unreadState[conversationId] = 0;
    syncUnreadState();
    return;
  }
  try {
    await fetchJson("/api/v1/chat/messages/read", {
      method: "POST",
      body: JSON.stringify({ message_ids: unreadMessages }),
    });
    (conversationMessages[conversationId] || []).forEach((m) => {
      if (unreadMessages.includes(Number(m.id))) m.read = true;
    });
  } catch (error) {
    console.error("Mark read failed", error);
  } finally {
    unreadState[conversationId] = 0;
    syncUnreadState();
  }
}

function normalizeMessage(message) {
  if (Array.isArray(message)) {
    const [side, name, body, time] = message;
    return { side, name, body, time, mentions: [] };
  }
  return { mentions: [], ...message };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMessageBody(body, mentions = []) {
  let safe = escapeHtml(body);
  mentions.forEach((person) => {
    const label = `@${person?.name || "User"}`;
    safe = safe.replaceAll(escapeHtml(label), `<span class="mention-token">${escapeHtml(label)}</span>`);
  });
  safe = safe.replace(/\*\*(.+x)\*\*/g, "<strong>$1</strong>");
  safe = safe.replace(/(^|[\s(])\*(x!\*)([^*]+)\*(x=[\s).,!x:;]|$)/g, "$1<em>$2</em>");
  safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
  safe = safe
    .split("\n")
    .map((line) => line.startsWith("- ") ? `<span class="bullet-line">${line.slice(2)}</span>` : line)
    .join("<br>");
  return `<span class="formatted-text">${safe}</span>`;
}

function formatBytes(bytes = 0) {
  if (!bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function attachmentTypeLabel(attachment) {
  const labels = {
    image: "Image",
    pdf: "PDF document",
    word: "Word document",
    sheet: "Spreadsheet",
    slides: "Presentation",
    file: "File",
  };
  return labels[attachment.kind] || "File";
}

function attachmentBadgeLabel(attachment) {
  const labels = {
    image: "IMG",
    pdf: "PDF",
    word: "DOC",
    sheet: "XLS",
    slides: "PPT",
    file: "FILE",
  };
  return labels[attachment.kind] || "FILE";
}

function closeComposerPopovers() {
  formatPicker.classList.add("hidden");
  emojiPicker.classList.add("hidden");
}

function renderEmojiPicker() {
  emojiPicker.innerHTML = emojiPalette
    .map((emoji) => `<button type="button" data-emoji="${emoji}" aria-label="Insert ${emoji}">${emoji}</button>`)
    .join("");
  emojiPicker.querySelectorAll("[data-emoji]").forEach((button) => {
    button.addEventListener("click", () => {
      insertAtCursor(button.dataset.emoji);
      closeComposerPopovers();
      chatMessage.focus();
    });
  });
}

function insertAtCursor(value) {
  const start = chatMessage.selectionStart ?? chatMessage.value.length;
  const end = chatMessage.selectionEnd ?? chatMessage.value.length;
  chatMessage.value = `${chatMessage.value.slice(0, start)}${value}${chatMessage.value.slice(end)}`;
  const next = start + value.length;
  chatMessage.focus();
  chatMessage.setSelectionRange(next, next);
}

function wrapSelection(prefix, suffix = prefix) {
  const start = chatMessage.selectionStart - 0;
  const end = chatMessage.selectionEnd - 0;
  const selected = chatMessage.value.slice(start, end) || "text";
  const insert = `${prefix}${selected}${suffix}`;
  chatMessage.value = `${chatMessage.value.slice(0, start)}${insert}${chatMessage.value.slice(end)}`;
  chatMessage.focus();
  chatMessage.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
}

function bulletSelection() {
  const start = chatMessage.selectionStart - 0;
  const end = chatMessage.selectionEnd - 0;
  const selected = chatMessage.value.slice(start, end) || "List item";
  const bulleted = selected
    .split("\n")
    .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
    .join("\n");
  chatMessage.value = `${chatMessage.value.slice(0, start)}${bulleted}${chatMessage.value.slice(end)}`;
  chatMessage.focus();
  chatMessage.setSelectionRange(start, start + bulleted.length);
}

function applyFormat(action) {
  if (action === "bold") wrapSelection("**");
  if (action === "italic") wrapSelection("*");
  if (action === "code") wrapSelection("`");
  if (action === "bullet") bulletSelection();
  closeComposerPopovers();
}

function renderAttachmentTray() {
  if (!pendingAttachments.length) {
    attachmentTray.classList.add("hidden");
    attachmentTray.innerHTML = "";
    return;
  }

  attachmentTray.classList.remove("hidden");
  attachmentTray.innerHTML = pendingAttachments
    .map((attachment) => `
      <div class="attachment-chip">
        ${attachment.kind === "image"
        ? `<img src="${attachment.data_url}" alt="${escapeHtml(attachment.name)}" />`
        : `<span class="attachment-thumb attachment-icon">${attachmentBadgeLabel(attachment)}</span>`}
        <span>
          <strong>${escapeHtml(attachment.name)}</strong>
          <small>${attachmentTypeLabel(attachment)} - ${formatBytes(attachment.size)}</small>
        </span>
        <button class="attachment-remove" type="button" data-remove-attachment="${attachment.id}" aria-label="Remove attachment">×</button>
      </div>`)
    .join("");

  attachmentTray.querySelectorAll("[data-remove-attachment]").forEach((button) => {
    button.addEventListener("click", () => {
      pendingAttachments = pendingAttachments.filter((attachment) => attachment.id !== button.dataset.removeAttachment);
      renderAttachmentTray();
      syncViewportLayout();
    });
  });
}

function fileToAttachment(file, kind = "file") {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      kind: kind === "image" ? "image" : inferAttachmentKind(file.name, file.type || ""),
      mime_type: file.type || (kind === "image" ? "image/*" : "application/octet-stream"),
      size: file.size || 0,
      data_url: String(reader.result || ""),
    });
    reader.onerror = () => reject(new Error("Attachment read failed"));
    reader.readAsDataURL(file);
  });
}

async function queueAttachments(fileList, kind = "file") {
  const files = [...(fileList || [])];
  if (!files.length) return;
  try {
    const attachments = await Promise.all(files.map((file) => fileToAttachment(file, kind)));
    pendingAttachments = [...pendingAttachments, ...attachments];
    renderAttachmentTray();
    syncViewportLayout();
    showToast(`${attachments.length} ${kind === "image" ? "image" : "file"}${attachments.length > 1 ? "s" : ""} ready to send.`);
  } catch (error) {
    showToast("Attachment could not be prepared.");
  }
}

function attachmentPreviewLabel(attachments, body) {
  if (!attachments.length) return body || "Message sent";
  const base = attachments.length === 1
    ? `${attachmentTypeLabel(attachments[0])}: ${attachments[0].name}`
    : `${attachments.length} attachments`;
  return body ? `${base} - ${body}` : base;
}

function renderMessageAttachments(attachments = []) {
  if (!attachments.length) return "";
  return `
    <div class="message-attachments">
      ${attachments.map((attachment) => {
    if (attachment.kind === "image") {
      return `
            <button class="image-attachment" type="button" data-image-preview="${attachment.data_url}" data-image-name="${escapeHtml(attachment.name)}">
              <img src="${attachment.data_url}" alt="${escapeHtml(attachment.name)}" />
              <span><strong>${escapeHtml(attachment.name)}</strong><small>${formatBytes(attachment.size)}</small></span>
            </button>`;
    }
    return `
          <a class="attachment-card" href="${attachment.data_url}" download="${escapeHtml(attachment.name)}">
            <div>
              <span class="attachment-icon ${attachment.kind}">${attachmentBadgeLabel(attachment)}</span>
              <span>
                <strong>${escapeHtml(attachment.name)}</strong>
                <small>${attachmentTypeLabel(attachment)} - ${formatBytes(attachment.size)}</small>
                <em>Open preview</em>
              </span>
            </div>
          </a>`;
  }).join("")}
    </div>`;
}

function filteredConversations() {
  const query = (globalSearch.value || "").trim().toLowerCase();

  syncUnreadState();

  return conversations.filter((item) => {
    const userText = chatUserSearchText(item.user_id || item.id);

    const matchesSearch =
      !query ||
      [
        item.id,
        item.user_id,
        item.employee_id,
        item.name,
        item.email,
        item.preview,
        item.role,
        userText,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);

    const matchesFilter =
      activeChatFilter === "Unread"
        ? Boolean(item.unread)
        : activeChatFilter === "Chats"
          ? !isChannelConversation(item)
          : activeChatFilter === "Channels" || activeChatFilter === "Groups"
            ? isChannelConversation(item)
            : true;

    return matchesSearch && matchesFilter;
  });
}

function searchableUsersForQuery(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  const existing = new Set(conversations.map((c) => Number(c.user_id || c.id)));
  return (chatUsers || [])
    .filter((u) => Number(u.id) !== Number(window.currentUser?.id))
    .filter((u) => !existing.has(Number(u.id)))
    .filter((u) => {
      const text = [u.id, u.employee_id, u.employee_code, u.email, u.name, u.full_name, u.job_title].filter(Boolean).join(" ").toLowerCase();
      return text.includes(q);
    })
    .slice(0, 12);
}

function renderChatList() {
  syncChatFilterButtons();
  const visible = filteredConversations();
  const query = (globalSearch?.value || "").trim();
  const userSuggestions = searchableUsersForQuery(query);
  const sections = [...new Set(visible.map((item) => item?.section || "Chats"))];
  chatList.innerHTML = sections
    .map((section) => `
      <div class="conversation-section">
        <p>${section}</p>
        ${visible
        .filter((item) => (item?.section || "Chats") === section)
        .map((item) => `
            <button class="chat-person ${item.id === activeConversationId ? "active" : ""}" type="button" data-conversation="${item.id}">
              <span class="chat-avatar ${item.online ? "online" : ""}" data-avatar-conversation="${item.id}">${safeInitial(item?.name)}</span>
              <span><strong>${item?.name || "User"}</strong><small>${item?.online ? "Online" : "Away"} - ${item?.preview || ""}</small></span>
              <span class="chat-meta">
                <time>${item?.time || ""}</time>
                ${item?.unread ? `<em>${item.unread}</em>` : ""}
              </span>
            </button>`)
        .join("")}
      </div>`)
    .join("");

  if (!chatList.innerHTML) {
    chatList.innerHTML = `<div class="empty-state">No conversations match this view.</div>`;
  }

  if (userSuggestions.length) {
    chatList.innerHTML += `
      <div class="conversation-section">
        <p>Matching users</p>
        ${userSuggestions.map((u) => `
          <button class="chat-person" type="button" data-start-chat="${u.id}">
            <span class="chat-avatar online">${displayUserName(u).slice(0, 1).toUpperCase()}</span>
            <span><strong>${displayUserName(u)}</strong><small>${u.email} - ID ${u.employee_code || u.id}</small></span>
            <span class="chat-meta"><time>New</time></span>
          </button>
        `).join("")}
      </div>`;
  }

  chatList.querySelectorAll("[data-avatar-conversation]").forEach((avatar) => {
    avatar.addEventListener("click", (event) => {
      event.stopPropagation();
      const conversation = conversations.find((item) => item.id === avatar.dataset.avatarConversation);
      openConversationAvatarPreview(conversation);
    });
  });

  chatList.querySelectorAll("[data-conversation]").forEach((button) => {
    button.addEventListener("click", async () => {
      activeConversationId = button.dataset.conversation;
      activeRecipientId = Number(activeConversationId);
      await markConversationRead(activeConversationId);
      renderChatList();
      renderThread();
      renderConversationMeta();
    });
  });

  chatList.querySelectorAll("[data-start-chat]").forEach((button) => {
    button.addEventListener("click", () => {
      const userId = Number(button.dataset.startChat);
      activeConversationId = String(userId);
      activeRecipientId = userId;
      draftConversationIds.add(String(userId));
      if (!conversationMessages[activeConversationId]) conversationMessages[activeConversationId] = [];
      if (!conversations.some((c) => String(c.id) === String(userId))) {
        const user = findChatUser(userId);
        conversations.unshift({
          id: String(userId),
          user_id: userId,
          section: "Chats",
          name: displayUserName(user) || `User ${userId}`,
          role: user?.roles?.[0] || "User",
          preview: "Start a conversation",
          time: "",
          unread: "",
          online: onlineUserIds.has(userId),
          members: 2,
          details: [user?.email || "", user?.roles?.join(", ") || "Team", "0 messages"],
          email: user?.email || "",
          employee_id: userId,
        });
      }
      renderChatList();
      renderThread();
      renderConversationMeta();
      chatMessage.focus();
    });
  });
}

function renderThread() {
  if (!activeConversationId) {
    chatThread.innerHTML = `<div class="empty-state">No conversation selected.</div>`;
    return;
  }
  if (activeThreadTab === "Shared") {
    renderShared();
    return;
  }
  const messages = (conversationMessages[activeConversationId] || []).map(normalizeMessage);
  if (!messages.length) {
    chatThread.innerHTML = `<div class="empty-state">No messages yet. Send the first message.</div>`;
    return;
  }
  chatThread.innerHTML = `<div class="day-divider">Conversation</div>` + messages
    .map(({ side, name, body, time, mentions = [], read = true, attachments = [] }) => `
      <div class="bubble ${side}">
        ${side === "left" ? `<span class="message-avatar">${name.slice(0, 1)}</span>` : ""}
        <strong>${name}</strong>
        ${body ? `<p>${formatMessageBody(body, mentions)}</p>` : ""}
        ${renderMessageAttachments(attachments)}
        <time>${time}${side === "right" ? ` - ${read ? "Read" : "Sent"}` : ""}</time>
        ${typeof body === "string" && body.toLowerCase().includes("great") ? `<span class="reaction">Heart 1</span>` : ""}
      </div>`)
    .join("");
  chatThread.querySelectorAll("[data-image-preview]").forEach((button) => {
    button.addEventListener("click", () => openImagePreview(button.dataset.imagePreview, button.dataset.imageName));
  });
  chatThread.scrollTop = chatThread.scrollHeight;
}

function openImagePreview(src, name) {
  imagePreviewContent.src = src || "";
  imagePreviewContent.alt = name || "Image preview";
  imagePreviewTitle.textContent = name || "Image preview";
  imagePreviewDownload.href = src || "#";
  imagePreviewDownload.download = name || "image";
  imagePreviewModal.classList.remove("hidden");
}

function closeImagePreviewModal() {
  imagePreviewModal.classList.add("hidden");
  imagePreviewContent.src = "";
  imagePreviewDownload.href = "#";
}

function activeConversation() {
  if (!activeConversationId) return null;
  return conversations.find((item) => item.id === activeConversationId) || null;
}

function activeMembers() {
  return conversationMembers[activeConversationId] || [currentUserId];
}

function memberProfiles() {
  return activeMembers()
    .map((id) => {
      const byDirectory = directory.find((person) => String(person.id) === String(id));
      if (byDirectory) return byDirectory;
      const byUser = findChatUser(Number(id));
      if (!byUser) return null;
      return {
        id: String(byUser.id),
        name: byUser.name || byUser.full_name || byUser.email || `User ${byUser.id}`,
        email: byUser.email || "",
        department: byUser.department || "Team",
        role: byUser.roles?.[0] || "User",
        online: true,
      };
    })
    .filter(Boolean);
}

function renderConversationMeta() {
  const active = activeConversation();
  if (!active) {
    document.querySelector("#threadName").textContent = "Select a conversation";
    document.querySelector("#threadRole").textContent = "Start by selecting a user.";
    chatMessage.placeholder = "Type a message...";
    return;
  }
  const isSelf = Number(active.user_id || active.id) === Number(window.currentUser?.id);
  const displayName = isSelf ? `You (${currentUserDisplayName()})` : active.name;
  const members = memberProfiles();
  active.members = members.length;
  const roleLabel = String(active.role || "user");
  const roleText = roleLabel.charAt(0).toUpperCase() + roleLabel.slice(1);
  document.querySelector("#threadName").textContent = displayName;
  document.querySelector("#threadRole").textContent = `${active.online ? "Online" : "Away"} - ${isSelf ? "You" : roleText}`;
  threadAvatar.textContent = displayName.slice(0, 1);
  threadAvatar.classList.toggle("online", active.online);
  threadAvatar.dataset.avatarConversation = active.id;
  detailAvatar.textContent = displayName.split(" ").map((part) => part[0]).join("").slice(0, 2);
  detailAvatar.dataset.avatarConversation = active.id;
  document.querySelector("#detailName").textContent = displayName;
  document.querySelector("#detailRole").textContent = isSelf ? "You" : roleText;
  document.querySelector("#detailPresence").innerHTML = `<span></span>${active.online ? "Available" : "Away"}`;
  document.querySelector("#detailList").innerHTML = active.details
    .map((value, index) => `<div><strong>${["Email", "Team", "Shared"][index]}</strong><span>${value}</span></div>`)
    .join("");
  renderProfileHoverCard(active);
  chatMessage.placeholder = `Type a message to ${isSelf ? "yourself" : active.name}...`;
  renderCallControls();
}

function renderProfileHoverCard(active = activeConversation()) {
  if (!profileHoverCard || !active) return;
  profileHoverCard.innerHTML = `
    <div class="hover-profile-head">
      <span class="profile-photo small">${safeInitials(active?.name)}</span>
      <div>
        <strong>${active.name}</strong>
        <small>${active.role}</small>
      </div>
    </div>
    <div class="presence"><span></span>${active.online ? "Available" : "Away"}</div>
    <div class="hover-profile-list">
      ${active.details
      .map((value, index) => `<div><b>${["Email", "Team", "Shared"][index]}</b><span>${value}</span></div>`)
      .join("")}
    </div>`;
}

function renderCallControls() {
  const active = activeConversation();
  if (!active) {
    if (callControls) callControls.innerHTML = "";
    return;
  }
  const role = safeText(active.role).toLowerCase();
  const isOneToOne = active.members <= 2 && !role.includes("group") && !role.includes("channel");
  callControls.innerHTML = isOneToOne
    ? `
      <button class="call-button" type="button" data-call-action="audio"><svg class="ui-icon"><use href="#icon-phone"></use></svg>Call</button>
      <button class="call-button" type="button" data-call-action="video"><svg class="ui-icon"><use href="#icon-video"></use></svg>Video call</button>`
    : `
      <button class="meet-now" type="button" data-call-action="meet"><svg class="ui-icon"><use href="#icon-video"></use></svg>Meet now</button>
      <div class="participants-wrap">
        <button class="participants" type="button" data-call-action="participants"><svg class="ui-icon"><use href="#icon-users"></use></svg>+${Math.max(active.members - 1, 1)}</button>
        <div class="members-popover hidden" id="membersPopover"></div>
      </div>`;
  renderMembersPopover();
  bindCallButtons();
}

function renderMembersPopover() {
  const popover = document.querySelector("#membersPopover");
  if (!popover) return;
  const active = activeConversation();
  if (!active) {
    popover.innerHTML = "";
    return;
  }
  popover.innerHTML = `
    <strong>${active.name} members</strong>
    <div class="member-list">
      ${memberProfiles().map((person) => `
        <div>
          <span class="mini-avatar ${person.online ? "online" : ""}">${safeInitial(person?.name)}</span>
          <span><b>${person.name}</b><small>${person.role} - ${person.department}</small></span>
        </div>`).join("")}
    </div>`;
}

function renderShared() {
  const active = activeConversation();
  if (!active) {
    chatThread.innerHTML = `<div class="empty-state">No conversation selected.</div>`;
    return;
  }
  chatThread.innerHTML = `
    <div class="shared-grid">
      <article><strong>LT Planning Agenda.docx</strong><span>Shared by ${active.name} - 10:42</span></article>
      <article><strong>Leave Workflow Notes.pdf</strong><span>People Ops - Yesterday</span></article>
      <article><strong>Backlog Intake.xlsx</strong><span>Product Team - Monday</span></article>
    </div>`;
}

async function sendMessage() {
  const body = chatMessage.value.trim();
  const attachmentsToSend = pendingAttachments.map((attachment) => ({ ...attachment }));
  if (!body && !attachmentsToSend.length) {
    showToast("Type a message or attach a file before sending.");
    return;
  }

  if (!activeRecipientId) {
    showToast("No chat selected. Create or receive a message first.");
    return;
  }

  try {
    const optimisticConversationId = String(activeRecipientId);
    const optimisticMessage = {
      id: `tmp-${Date.now()}`,
      side: "right",
      name: "You",
      body,
      time: formatChatTime(new Date().toISOString()),
      created_at: new Date().toISOString(),
      read: false,
      mentions: [],
      attachments: attachmentsToSend,
    };
    if (!conversationMessages[optimisticConversationId]) conversationMessages[optimisticConversationId] = [];
    conversationMessages[optimisticConversationId].push(optimisticMessage);
    renderThread();

    await fetchJson("/api/v1/chat/messages", {
      method: "POST",
      body: JSON.stringify({
        recipient_id: Number(activeRecipientId),
        body,
        attachments: attachmentsToSend,
      }),
    });
    draftConversationIds.delete(String(activeRecipientId));

    chatMessage.value = "";
    pendingAttachments = [];
    renderAttachmentTray();

    await loadPresenceState();
    await loadChatState();
    if (activeConversationId) await markConversationRead(activeConversationId);
    showToast("Message sent.");
  } catch (err) {
    console.error("Send message failed", err);
    showToast("Message failed to send.");
  }
}

function extractMentions(body) {
  const lowerBody = body.toLowerCase();
  return memberProfiles()
    .filter((person) => person.id !== "you" && lowerBody.includes(`@${person.name.toLowerCase()}`))
    .map((person) => ({ id: person.id, name: person.name }));
}

function setActiveThreadTab() {
  document.querySelectorAll(".thread-tabs button").forEach((button) => {
    button.classList.toggle("active", button.textContent.trim() === activeThreadTab);
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 2200);
}

function openPeopleModal() {
  pendingPeople = new Set();
  peopleSearch.value = "";
  peopleModal.classList.remove("hidden");
  renderPeoplePicker();
  peopleSearch.focus();
}

function closeModal() {
  peopleModal.classList.add("hidden");
}

function detectMentionQuery() {
  const cursor = chatMessage.selectionStart || chatMessage.value.length;
  const beforeCursor = chatMessage.value.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)@([A-Za-z0-9 ._-]*)$/);
  if (!match) {
    closeMentionPicker();
    return;
  }
  mentionStart = cursor - match[2].length - 1;
  mentionQuery = match[2].toLowerCase();
  renderMentionPicker();
}

function closeMentionPicker() {
  mentionQuery = null;
  mentionStart = -1;
  mentionPicker.classList.add("hidden");
  mentionPicker.innerHTML = "";
}

function mentionResults() {
  const members = memberProfiles().filter((person) => String(person.id) !== String(currentUserId));
  return members.filter((person) => {
    const haystack = `${person?.name || ""} ${person?.email || ""} ${person?.role || ""} ${person?.department || ""}`.toLowerCase();
    return !mentionQuery || haystack.includes(mentionQuery);
  });
}

function renderMentionPicker() {
  const results = mentionResults();
  mentionPicker.innerHTML = results
    .map((person) => `
      <button type="button" data-mention="${person.id}">
        <span class="mini-avatar ${person.online ? "online" : ""}">${safeInitial(person?.name)}</span>
        <span><strong>${person.name}</strong><small>${person.role} - ${person.department}</small></span>
      </button>`)
    .join("") || `<div class="mention-empty">No matching members</div>`;
  mentionPicker.classList.remove("hidden");
  mentionPicker.querySelectorAll("[data-mention]").forEach((button) => {
    button.addEventListener("click", () => insertMention(button.dataset.mention));
  });
}

function insertMention(personId) {
  const person = memberProfiles().find((item) => String(item.id) === String(personId));
  if (!person || mentionStart < 0) return;
  const cursor = chatMessage.selectionStart || chatMessage.value.length;
  const before = chatMessage.value.slice(0, mentionStart);
  const after = chatMessage.value.slice(cursor);
  const inserted = `@${person?.name || "User"} `;
  chatMessage.value = `${before}${inserted}${after}`;
  const nextPosition = before.length + inserted.length;
  chatMessage.focus();
  chatMessage.setSelectionRange(nextPosition, nextPosition);
  closeMentionPicker();
}

function renderPeoplePicker() {
  const query = (peopleSearch?.value || "").trim().toLowerCase();
  const existing = new Set(activeMembers().map((id) => String(id)));
  const results = (chatUsers || [])
    .filter((user) => String(user?.id) !== String(window.currentUser?.id))
    .filter((user) => !existing.has(String(user.id)))
    .filter((user) => {
      const haystack = `${user?.id || ""} ${user?.email || ""} ${user?.name || ""} ${user?.full_name || ""} ${user?.employee_id || ""} ${user?.employee_code || ""}`.toLowerCase();
      return !query || haystack.includes(query);
    })
    .map((user) => ({
      id: String(user.id),
      name: user.name || user.full_name || user?.email || `User ${user.id}`,
      email: user?.email || "",
      department: user.department || "Team",
      role: user?.roles?.[0] || "User",
      online: true,
    }));

  selectedPeople.innerHTML = [...pendingPeople]
    .map((id) => {
      const person = results.find((item) => item.id === id)
        || memberProfiles().find((item) => String(item.id) === String(id));
      return person ? `<button type="button" data-remove-person="${person.id}">${person.name} x</button>` : "";
    })
    .join("") || `<span>No people selected</span>`;

  peopleResults.innerHTML = results
    .map((person) => `
      <button class="person-result ${pendingPeople.has(person.id) ? "selected" : ""}" type="button" data-person="${person.id}">
        <span class="mini-avatar ${person.online ? "online" : ""}">${safeInitial(person?.name)}</span>
        <span><strong>${person.name}</strong><small>${person.email} - ${person.department}</small></span>
        <em>${person.role}</em>
      </button>`)
    .join("") || `<div class="empty-state">No people found.</div>`;

  selectedPeople.querySelectorAll("[data-remove-person]").forEach((button) => {
    button.addEventListener("click", () => {
      pendingPeople.delete(button.dataset.removePerson);
      renderPeoplePicker();
    });
  });

  peopleResults.querySelectorAll("[data-person]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.person;
      if (pendingPeople.has(id)) pendingPeople.delete(id);
      else pendingPeople.add(id);
      renderPeoplePicker();
    });
  });
}

async function confirmAddPeople() {
  if (!pendingPeople.size) {
    showToast("Select at least one person.");
    return;
  }
  try {
    const memberIds = [...pendingPeople]
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id));
    if (activeRecipientId && !memberIds.includes(Number(activeRecipientId))) {
      memberIds.unshift(Number(activeRecipientId));
    }
    if (!memberIds.length) {
      showToast("No valid people selected.");
      return;
    }
    await fetchJson("/api/v1/chat/groups", {
      method: "POST",
      body: JSON.stringify({
        name: `Group ${new Date().toLocaleTimeString()}`,
        member_user_ids: memberIds,
      }),
    });
    closeModal();
    await loadChatState();
    renderChatWorkspace();
    showToast("Group conversation created.");
  } catch (error) {
    showToast(error.message || "People could not be added.");
  }
}

function closeHeaderDropdowns() {
  notificationDropdown?.classList.remove("open");
  profileDropdown?.classList.remove("open");
}

function bindInteractions() {
  notificationToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    notificationDropdown.classList.toggle("open");
    profileDropdown.classList.remove("open");
    loadNotificationState();
    document.querySelector("#markAllNotificationsRead")?.addEventListener("click", async (event) => {
      event.stopPropagation();
      await markAllNotificationsRead();
    });
  });

  notificationDropdown?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  profileToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    profileDropdown.classList.toggle("open");
    notificationDropdown.classList.remove("open");
  });
  profileDropdown?.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  document.addEventListener("click", closeHeaderDropdowns);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeHeaderDropdowns();
  });
  profileHeaderAvatar?.addEventListener("click", (event) => {
    event.stopPropagation();
    openProfilePhotoPreview();
  });

  profileDropdown?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-profile-action]");
    if (!button) return;
    handleProfileMenuAction(button.dataset.profileAction);
  });
  profilePhotoInput?.addEventListener("change", () => {
    updateProfilePhotoPreview(profilePhotoInput.files?.[0]);
  });
  profilePhotoUpload?.addEventListener("click", () => {
    profilePhotoInput.click();
  });
  profilePhotoPreview?.addEventListener("click", openProfilePhotoPreview);
  threadAvatar?.addEventListener("click", () => openConversationAvatarPreview());
  detailAvatar?.addEventListener("click", () => openConversationAvatarPreview());
  saveProfileButton?.addEventListener("click", saveProfileDetails);
  savePasswordButton?.addEventListener("click", savePasswordChanges);

  themeToggle?.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark-mode");
    localStorage.setItem("hrms_theme", isDark ? "dark" : "light");
    syncThemeToggleLabel();
  });

  globalSearch?.addEventListener("input", () => {
    if (!chatView.classList.contains("hidden")) renderChatList();
  });

  timesheetWeekGrid?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-timesheet-date]");
    if (!button) return;
    selectTimesheetDate(button.dataset.timesheetDate);
  });
  timesheetMiniCalendar?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-timesheet-date]");
    if (!button) return;
    selectTimesheetDate(button.dataset.timesheetDate);
  });
  saveTimesheetEntry?.addEventListener("click", saveCurrentTimesheetEntry);
  clearTimesheetEntry?.addEventListener("click", clearCurrentTimesheetEntry);
  submitWeeklyTimesheet?.addEventListener("click", submitWeeklyTimesheetAction);
  timesheetMonthPrev?.addEventListener("click", () => {
    timesheetCalendarMonth = new Date(timesheetCalendarMonth.getFullYear(), timesheetCalendarMonth.getMonth() - 1, 1);
    renderTimesheetWorkspace();
  });
  timesheetMonthNext?.addEventListener("click", () => {
    timesheetCalendarMonth = new Date(timesheetCalendarMonth.getFullYear(), timesheetCalendarMonth.getMonth() + 1, 1);
    renderTimesheetWorkspace();
  });
  leaveCalendarGrid?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-leave-date]");
    if (!button) return;
    selectLeaveDate(button.dataset.leaveDate);
  });
  leaveRequestList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-revoke-leave]");
    if (!button) return;
    revokeLeaveRequest(button.dataset.revokeLeave);
  });
  refreshTeamLeaveRequests?.addEventListener("click", () => {
    loadTeamLeaveRequests().then(() => showToast("Team leave requests refreshed.")).catch((err) => {
      showToast(err.message || "Team leave requests could not be refreshed.");
    });
  });
  teamLeaveRows?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-team-leave-action]");
    if (!button) return;
    decideTeamLeaveRequest(button.dataset.teamLeaveId, button.dataset.teamLeaveAction);
  });
  leaveStartInput?.addEventListener("change", syncLeaveRangeFromInputs);
  leaveEndInput?.addEventListener("change", syncLeaveRangeFromInputs);
  submitLeaveRequest?.addEventListener("click", submitLeaveApplication);
  resetLeaveForm?.addEventListener("click", resetLeaveApplicationForm);
  leaveMonthPrev?.addEventListener("click", () => {
    leaveCalendarMonth = new Date(leaveCalendarMonth.getFullYear(), leaveCalendarMonth.getMonth() - 1, 1);
    renderLeaveWorkspace();
  });
  leaveMonthNext?.addEventListener("click", () => {
    leaveCalendarMonth = new Date(leaveCalendarMonth.getFullYear(), leaveCalendarMonth.getMonth() + 1, 1);
    renderLeaveWorkspace();
  });

  addCalendarEvent?.addEventListener("click", openCalendarModal);
  closeCalendarModal?.addEventListener("click", closeCalendarEventModal);
  cancelCalendarModal?.addEventListener("click", closeCalendarEventModal);
  saveCalendarEvent?.addEventListener("click", async () => {
    const startDate = new Date(calendarStart.value);
    const endDate = new Date(calendarEnd.value);

    if (!calendarTitle.value.trim()) {
      showToast("Meeting title is required.");
      calendarTitle.focus();
      return;
    }

    if (!calendarStart.value || !calendarEnd.value) {
      showToast("Start and end time are required.");
      return;
    }

    if (endDate < startDate) {
      showToast("End time must be after start time.");
      calendarEnd.focus();
      return;
    }

    const payload = {
      title: calendarTitle.value.trim(),
      event_type: calendarType.value || "meeting",
      location: calendarLocation.value.trim(),
      visibility: calendarVisibility.value || "personal",
      start_at: startDate.toISOString(),
      end_at: endDate.toISOString(),
      description: calendarDescription.value.trim(),
      all_day: false,
      meeting_link: calendarLocation.value.trim().startsWith("http")
        ? calendarLocation.value.trim()
        : "",
      attendee_user_ids: selectedCalendarAttendeeIds(),
    };

    try {
      saveCalendarEvent.disabled = true;
      saveCalendarEvent.textContent = "Saving...";

      const createdEvent = await fetchJson("/api/v1/calendar/events", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      calendarModal.classList.add("hidden");

      const createdDate = new Date(createdEvent.start_at || payload.start_at);
      calendarMonth = new Date(createdDate.getFullYear(), createdDate.getMonth(), 1);
      selectedCalendarDate = localDateKey(createdDate);

      await loadCalendarEvents();

      renderCalendar();
      showToast("Meeting created.");
    } catch (error) {
      console.error("Calendar save failed:", error);
      showToast(error.message || "Meeting could not be saved.");
    } finally {
      saveCalendarEvent.disabled = false;
      saveCalendarEvent.textContent = "Save event";
    }
  });
  calendarPrev?.addEventListener("click", () => {
    const current = new Date(`${selectedCalendarDate || localDateKey(new Date())}T00:00:00`);
    current.setDate(current.getDate() - 1);

    selectedCalendarDate = localDateKey(current);
    calendarMonth = new Date(current.getFullYear(), current.getMonth(), 1);

    renderCalendar();
  });

  calendarNext?.addEventListener("click", () => {
    const current = new Date(`${selectedCalendarDate || localDateKey(new Date())}T00:00:00`);
    current.setDate(current.getDate() + 1);

    selectedCalendarDate = localDateKey(current);
    calendarMonth = new Date(current.getFullYear(), current.getMonth(), 1);

    renderCalendar();
  });
  calendarModal?.addEventListener("click", (event) => {
    if (event.target === calendarModal) closeCalendarEventModal();
  });

  activityFilters.querySelectorAll("[data-activity-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      activeActivityFilter = button.dataset.activityFilter;
      activityFilters.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      renderActivityFeed();
    });
  });

  chatMessage?.addEventListener("input", detectMentionQuery);

  renderEmojiPicker();

  formatToggle?.addEventListener("click", () => {
    emojiPicker.classList.add("hidden");
    formatPicker.classList.toggle("hidden");
  });

  emojiToggle?.addEventListener("click", () => {
    formatPicker.classList.add("hidden");
    emojiPicker.classList.toggle("hidden");
  });

  mediaToggle?.addEventListener("click", () => imageUpload.click());
  fileToggle?.addEventListener("click", () => fileUpload.click());
  imageUpload?.addEventListener("change", async () => {
    await queueAttachments(imageUpload.files, "image");
    imageUpload.value = "";
  });
  fileUpload?.addEventListener("change", async () => {
    await queueAttachments(fileUpload.files, "file");
    fileUpload.value = "";
  });

  formatPicker.querySelectorAll("[data-format-action]").forEach((button) => {
    button.addEventListener("click", () => applyFormat(button.dataset.formatAction));
  });

  document.querySelectorAll(".rail-filter button").forEach((button) => {
    button.addEventListener("click", () => {
      activeChatFilter = button.textContent.trim();
      renderChatList();
    });
  });

  document.querySelectorAll(".thread-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      const label = button.textContent.trim();
      if (label === "+") {
        showToast("Tab picker opened.");
        return;
      }
      activeThreadTab = label;
      setActiveThreadTab();
      renderThread();
    });
  });

  document.querySelectorAll(".teams-app-rail button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".teams-app-rail button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      const label = button.dataset.app || button.querySelector("small").textContent || "";
      if (label === "Calendar") {
        navigateToView("calendar", "calendarView", "Calendar");
      } else if (label === "Activity") {
        navigateToView("activity", "activityView", "Activity");
      } else if (label === "Chat") {
        navigateToView("chat", "chatView", "Chat");
        showToast("Chat opened.");
      } else {
        showToast(`${label} is ready for integration.`);
      }
    });
  });

  pulseSuiteNav.querySelectorAll("[data-suite-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.suiteView;
      if (document.body.dataset.view === view) {
        navigateToView("dashboard", "dashboardSection", "Dashboard");
        return;
      }
      if (view === "chat") {
        navigateToView("chat", "chatView", "Chat");
      } else if (view === "activity") {
        navigateToView("activity", "activityView", "Activity");
      } else if (view === "calendar") {
        navigateToView("calendar", "calendarView", "Calendar");
      }
    });
  });

  document.querySelectorAll(".rail-shortcuts button").forEach((button) => {
    button.addEventListener("click", () => {
      const label = button.textContent.toLowerCase();
      if (label.includes("assist")) {
        openAssistShortcut();
        return;
      }
      if (label.includes("guide")) {
        openGuideShortcut();
        return;
      }
      showToast(`${button.textContent} opened.`);
    });
  });

  logoutButton?.addEventListener("click", () => {
    logoutToLogin();
  });
  backButton?.addEventListener("click", () => {
    window.history.back();
  });
  forwardButton?.addEventListener("click", () => {
    window.history.forward();
  });
  teamStatusSearch?.addEventListener("input", renderTeamStatusBoard);
  document.querySelectorAll("[data-role-action]").forEach((button) => {
    button.addEventListener("click", () => handleRoleAction(button.dataset.roleAction, button));
  });
  employeeAdminForm?.addEventListener("submit", submitEmployeeAdmin);
  newEmployeeButton?.addEventListener("click", () => {
    resetEmployeeForm();
    employeeNameInput.focus();
  });
  resetEmployeeFormButton?.addEventListener("click", resetEmployeeForm);
  addDepartmentButton?.addEventListener("click", addAdminDepartment);
  newDepartmentInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addAdminDepartment();
    }
  });
  employeeAdminRows?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-employee-action]");
    if (!button) return;
    handleEmployeeAdminAction(button);
  });
  accessEmployeeInput?.addEventListener("change", syncAccessFormFromEmployee);
  accessAdminForm?.addEventListener("submit", submitAccessAdmin);
  passwordResetForm?.addEventListener("submit", submitPasswordResetAdmin);
  assignmentRuleForm?.addEventListener("submit", submitAssignmentRule);
  assignmentRuleRows?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-rule-action]");
    if (!button) return;
    handleAssignmentRuleAction(button);
  });
auditFilterInput?.addEventListener("change", async () => {
  try {
    await loadAuditLogsFromApi();
    renderAuditLogs();
  } catch (err) {
    auditLogRows.innerHTML = `<tr><td colspan="4">${err.message || "Audit logs could not be loaded."}</td></tr>`;
  }
});
  leavePolicyForm?.addEventListener("submit", submitLeavePolicyAdmin);
  leaveTypeAdminForm?.addEventListener("submit", submitLeaveTypeAdmin);
  leaveTypePolicyList?.addEventListener("click", (event) => {
    const adjustButton = event.target.closest("[data-adjust-leave-type]");
    if (adjustButton) {
      adjustLeaveTypeBalance(Number(adjustButton.dataset.adjustLeaveType), Number(adjustButton.dataset.adjustDelta || 0));
      return;
    }
    const button = event.target.closest("[data-remove-leave-type]");
    if (!button) return;
    removeLeaveType(Number(button.dataset.removeLeaveType));
  });
  leaveTypePolicyList?.addEventListener("change", (event) => {
    const select = event.target.closest("[data-leave-flow-index]");
    if (!select) return;
    updateLeaveTypeApprovalFlow(Number(select.dataset.leaveFlowIndex), select.value);
  });
  holidayCountryInput?.addEventListener("change", () => {
    leavePolicyState.holidayCountry = holidayCountryInput.value;
    leavePolicyState.holidayLocation = activeHolidayLocations(leavePolicyState.holidayCountry)[0] || "";
    renderHolidayLocationOptions();
    saveLeavePolicyState();
    renderLeavePolicyAdmin();
    renderTimesheetWorkspace();
    renderLeaveWorkspace();
    showToast(`Holiday calendar changed to ${leavePolicyState.holidayCountry}.`);
  });
  holidayLocationInput?.addEventListener("change", () => {
    leavePolicyState.holidayLocation = holidayLocationInput.value;
    saveLeavePolicyState();
    renderLeavePolicyAdmin();
    renderTimesheetWorkspace();
    renderLeaveWorkspace();
    showToast(`Timesheet holidays now use ${leavePolicyState.holidayCountry} / ${leavePolicyState.holidayLocation}.`);
  });
  holidayAdminForm?.addEventListener("submit", submitHolidayAdmin);
  holidayPolicyList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-holiday]");
    if (!button) return;
    removeHoliday(Number(button.dataset.removeHoliday));
  });
  holidayPolicyList?.addEventListener("change", (event) => {
    const select = event.target.closest("[data-holiday-type-index]");
    if (!select) return;
    updateHolidayType(Number(select.dataset.holidayTypeIndex), select.value);
  });
  timesheetControlForm?.addEventListener("submit", submitTimesheetControlAdmin);

  addPeople?.addEventListener("click", openPeopleModal);
  closePeopleModal?.addEventListener("click", closeModal);
  cancelPeople?.addEventListener("click", closeModal);
  confirmPeople?.addEventListener("click", confirmAddPeople);
  peopleSearch?.addEventListener("input", renderPeoplePicker);
  peopleModal?.addEventListener("click", (event) => {
    if (event.target === peopleModal) closeModal();
  });
  closeImagePreview?.addEventListener("click", closeImagePreviewModal);
  imagePreviewModal?.addEventListener("click", (event) => {
    if (event.target === imagePreviewModal) closeImagePreviewModal();
  });
  closeBreakModal?.addEventListener("click", closeBreakTypeModal);
  cancelBreakModal?.addEventListener("click", closeBreakTypeModal);
  breakModal?.addEventListener("click", (event) => {
    if (event.target === breakModal) closeBreakTypeModal();
  });
  closeWfhModal?.addEventListener("click", closeWfhRequestModal);
  cancelWfhModal?.addEventListener("click", closeWfhRequestModal);
  submitWfhRequest?.addEventListener("click", submitWfhDemoRequest);
  wfhModal?.addEventListener("click", (event) => {
    if (event.target === wfhModal) closeWfhRequestModal();
  });

  moreCall?.addEventListener("click", () => {
    callMenu.classList.toggle("hidden");
  });

  callMenu.querySelectorAll("[data-call-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const active = activeConversation();
      const message = button.dataset.callAction === "audio-all"
        ? `Ringing ${active.members} members in ${active.name}`
        : `Starting video ring for ${active.members} members in ${active.name}`;
      showToast(message);
      callMenu.classList.add("hidden");
    });
  });

  document.addEventListener("click", (event) => {
    if (!moreCall.contains(event.target) && !callMenu.contains(event.target)) callMenu.classList.add("hidden");
    const openPopover = document.querySelector(".members-popover:not(.hidden)");
    if (openPopover && !event.target.closest(".participants-wrap")) openPopover.classList.add("hidden");
    if (!event.target.closest(".composer-box")) closeMentionPicker();
    if (!event.target.closest(".composer-tools")) closeComposerPopovers();
  });

  sendChat?.addEventListener("click", sendMessage);

  chatMessage?.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !breakModal.classList.contains("hidden")) {
      closeBreakTypeModal();
      return;
    }
    if (event.key === "Escape" && !wfhModal.classList.contains("hidden")) {
      closeWfhRequestModal();
      return;
    }
    if (event.key === "Escape" && !imagePreviewModal.classList.contains("hidden")) {
      closeImagePreviewModal();
      return;
    }
    if (event.key === "Escape" && !mentionPicker.classList.contains("hidden")) {
      closeMentionPicker();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  document.getElementById("newChatBtn")?.addEventListener("click", openNewChat);

}
async function openNewChat() {
  try {
    const users = await fetchJson("/api/v1/auth/directory");

    const otherUsers = users.filter((u) => u.id !== window.currentUser?.id);

    if (!otherUsers.length) {
      showToast("No other users found.");
      return;
    }

    const list = otherUsers.map((u) => `${u.id} - ${u.email}`).join("\n");
    const selected = prompt("Select user by ID:\n" + list);

    if (!selected) return;

    const userId = Number(selected.split(" - ")[0].trim());
    const user = otherUsers.find((u) => u.id === userId);

    if (!user) {
      showToast("Invalid user selected.");
      return;
    }

    activeConversationId = String(user.id);
    activeRecipientId = user.id;

    if (!conversationMessages[activeConversationId]) {
      conversationMessages[activeConversationId] = [];
    }

    if (!conversations.some((c) => String(c.id) === String(user.id))) {
      conversations.unshift({
        id: String(user.id),
        name: user?.email,
        preview: "",
        time: "",
        unread: "",
        online: true,
      });
    }

    renderChatList();
    renderThread();
    renderConversationMeta();
  } catch (err) {
    console.error("New chat failed", err);
    showToast("Failed to load users.");
  }
}
function bindCallButtons() {
  callControls.querySelectorAll("[data-call-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const active = activeConversation();
      const action = button.dataset.callAction;
      if (action === "participants") {
        document.querySelector("#membersPopover").classList.toggle("hidden");
        return;
      }
      const message =
        action === "audio"
          ? `Calling ${active.name}`
          : action === "video"
            ? `Starting video call with ${active.name}`
            : `Meeting started for ${active.name}. Members can join now.`;
      showToast(message);
    });
  });
}
function workedMinutesToday(now = new Date()) {
  const completedMinutes = Number(attendanceState.todayWorkedMinutes || 0);

  if (!attendanceState.loggedIn || !attendanceState.loginAt) {
    return completedMinutes;
  }

  const runningMinutes = Math.max(
    0,
    Math.floor((now.getTime() - new Date(attendanceState.loginAt).getTime()) / 60000)
  );

  return completedMinutes + runningMinutes;
}

function formatWorkedDuration(minutes) {
  const safeMinutes = Math.max(0, Math.floor(Number(minutes || 0)));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${hours}h ${String(mins).padStart(2, "0")}m`;
}

function dashboardGreeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

function updateClock() {
  const now = new Date();
  const greeting = document.querySelector("#dashboardGreeting");
  if (greeting) {
    greeting.textContent = dashboardGreeting(now);
  }

  liveClock.textContent = now.toLocaleString([], {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  const totalToday = workedMinutesToday(now);

  if (attendanceState.loggedIn && attendanceState.loginAt) {
    const currentSessionMinutes = Math.max(
      0,
      Math.floor((now.getTime() - new Date(attendanceState.loginAt).getTime()) / 60000)
    );

    workState.classList.add("active");
    workState.innerHTML = `<span></span>Logged in - Today ${formatWorkedDuration(totalToday)} - Session ${formatWorkedDuration(currentSessionMinutes)}`;
  } else if (workState) {
    workState.classList.remove("active");

    if (attendanceState.logoutAt) {
      workState.innerHTML = `<span></span>Logged out - Today ${formatWorkedDuration(totalToday)}`;
    } else {
      workState.innerHTML = "<span></span>Not logged in";
    }
  }

  if (!timesheetView.classList.contains("hidden") || attendanceState.loggedIn) {
    renderTimesheetWorkspace();
  }
}

renderSidebar();
bindSidebarReveal();
restoreProfilePhoto();
updateAttendancePriority();
refreshAttendanceDashboard();
renderLeave();
renderAnnouncements();
resetLeaveApplicationForm();
bindInteractions();
routeFromCurrentPath(false);
updateClock();
syncViewportLayout();
updateHistoryControls();
window.addEventListener("popstate", () => {
  if (!routeFromCurrentPath(false)) {
    navigateToView("dashboard", "dashboardSection", "Dashboard", false);
  }
  updateHistoryControls();
});
window.addEventListener("resize", syncViewportLayout);
setInterval(updateClock, 30000);
setInterval(() => {
  loadPresenceState();
  loadChatState();
  loadNotificationState();
}, 3000);
setInterval(() => {
  if (attendanceState.activeBreakType) {
    updateAttendancePriority();
    renderQuickActions();
    renderTeamStatusBoard();
    renderSchedule();
    renderAnnouncements();
  }
}, 60000);





