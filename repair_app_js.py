from pathlib import Path

p = Path("app/static/app.js")
s = p.read_text(encoding="utf-8")


def replace_func(src, name, body):
    marker = f"function {name}("
    start = src.find(marker)
    if start < 0:
        raise RuntimeError(f"missing {name}")
    brace = src.find("{", start)
    depth = 0
    i = brace
    in_str = None
    esc = False
    in_line = False
    in_block = False
    while i < len(src):
        ch = src[i]
        nxt = src[i + 1] if i + 1 < len(src) else ""
        if in_line:
            if ch == "\n":
                in_line = False
        elif in_block:
            if ch == "*" and nxt == "/":
                in_block = False
                i += 1
        elif in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == in_str:
                in_str = None
        else:
            if ch in ('"', "'", "`"):
                in_str = ch
            elif ch == "/" and nxt == "/":
                in_line = True
                i += 1
            elif ch == "/" and nxt == "*":
                in_block = True
                i += 1
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return src[:start] + body.strip() + src[i + 1 :]
        i += 1
    raise RuntimeError(f"unclosed {name}")


s = replace_func(s, "renderEmployeeAdmin", r'''
function renderEmployeeAdmin() {
  if (!employeeAdminRows) return;
  employeeAdminRows.innerHTML = adminEmployees
    .map((employee) => `
      <tr class="employee-row" data-employee-id="${employee.id}">
        <td><span class="employee-id-pill">${employee.employeeId}</span></td>
        <td>
          <div class="employee-person">
            <span class="employee-avatar">${employee.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
            <span><strong>${employee.name}</strong><small>${employee.email}</small></span>
          </div>
        </td>
        <td><strong>${employee.mobile || "Not added"}</strong><small>${employee.personalEmail || "No personal email"}</small></td>
        <td><strong>${employee.jobTitle || employee.role}</strong><small>${employee.employmentType || "Full-time"}${employee.dateJoined ? ` - Joined ${employee.dateJoined}` : ""}</small></td>
        <td><span class="soft-chip">${employee.department}</span></td>
        <td><span class="project-chip">${employee.project || "Not assigned"}</span></td>
        <td><span class="location-chip">${employee.location || "Not assigned"}</span></td>
        <td><span class="role-chip">${employee.role}</span></td>
        <td>${employee.manager || "Not assigned"}</td>
        <td><span class="status ${employee.active ? "approved" : "revoked"}">${employee.active ? "Active" : "Inactive"}</span></td>
        <td class="role-actions">
          <button type="button" data-employee-action="edit">Edit</button>
          <button type="button" data-employee-action="toggle">${employee.active ? "Deactivate" : "Reactivate"}</button>
        </td>
      </tr>`)
    .join("");
}
''')

s = replace_func(s, "normalizeLeavePolicyState", r'''
function normalizeLeavePolicyState(state) {
  const country = state.holidayCountry || "India";
  const location = state.holidayLocation || "Hyderabad";
  const stateHolidays = Array.isArray(state.holidays) ? state.holidays : [];
  const holidays = mergeScopedHolidays(stateHolidays.map((holiday) => ({
    country: holiday.country || country,
    location: holiday.location || location,
    name: holiday.name,
    date: holiday.date,
    type: holiday.type || "public",
  })));
  const savedLeaveTypes = Array.isArray(state.leaveTypes) && state.leaveTypes.length
    ? state.leaveTypes
    : [
      { name: "Annual Leave", balance: Number(state.annual ?? 12), approvalFlow: state.approvalFlow || "Manager then HR" },
      { name: "Casual Leave", balance: Number(state.casual ?? 4), approvalFlow: "Manager only" },
      { name: "Sick Leave", balance: Number(state.sick ?? 2), approvalFlow: "Manager only" },
    ];
  const leaveTypes = mergeLeaveTypes(savedLeaveTypes);
  return {
    annual: Number(state.annual ?? leaveTypes.find((type) => type.name === "Annual Leave")?.balance ?? 12),
    casual: Number(state.casual ?? leaveTypes.find((type) => type.name === "Casual Leave")?.balance ?? 4),
    sick: Number(state.sick ?? leaveTypes.find((type) => type.name === "Sick Leave")?.balance ?? 2),
    approvalFlow: state.approvalFlow || "Supervisor then Manager",
    revokeRule: state.revokeRule || "Manager approval required",
    holidayCountry: country,
    holidayLocation: location,
    leaveTypes,
    holidays,
  };
}
''')

s = replace_func(s, "renderSchedule", r'''
function renderSchedule() {
  if (!scheduleTimeline) return;
  const overrun = currentBreakOverrun();
  const shiftTimeline = [
    [attendanceConfig.shiftStart, "Shift launch", `Admin-managed ${attendanceConfig.shiftName}`],
    ["11:00", "Team sync", "Meeting with product and delivery leads"],
    ["13:15", attendanceState.activeBreakType ? `${formatBreakType()} break` : "Break window", overrun ? `Policy warning: exceeded by ${overrun.overBy} min.` : attendanceState.activeBreakType ? "Break is currently active." : "Select break type before pausing."],
    ["16:30", "Focus review", "Timesheet, blockers, and handoff notes"],
    [attendanceConfig.shiftEnd, "Shift close", "Log out before final handoff."],
  ];
  scheduleTimeline.innerHTML = shiftTimeline
    .map(([time, title, detail]) => `
      <div class="timeline-row">
        <time>${time}</time>
        <span></span>
        <div><strong>${title}</strong><small>${detail}</small></div>
      </div>`)
    .join("");
}
''')

s = replace_func(s, "renderAnnouncements", r'''
function renderAnnouncements() {
  if (!announcementsPanel) return;
  const overrun = currentBreakOverrun();
  const items = [
    ["Shift reminder", `${attendanceConfig.shiftStart} to ${attendanceConfig.shiftEnd} is assigned by admin.`],
    ["WFH rule", attendanceState.locationStatus === "outside" ? "You are outside office geofence. Raise WFH before logging in." : "Office geofence check is required before login."],
    ["Break audit", overrun ? `${overrun.label} break exceeded the ${overrun.limit} min policy by ${overrun.overBy} min.` : attendanceState.activeBreakType ? `Current break: ${formatBreakType()}.` : "Break type selection is mandatory for tracking."],
  ];
  announcementsPanel.innerHTML = items
    .map(([title, body], index) => `
      <div class="announcement ${title === "Break audit" && overrun ? "warning" : ""}">
        <strong>${title}</strong>
        <p>${body}</p>
        <small>${index === 0 ? "Due today" : index === 1 ? "Optional event" : "Updated this week"}</small>
      </div>`)
    .join("");
}
''')

s = replace_func(s, "renderChatList", r'''
function renderChatList() {
  syncChatFilterButtons();
  const visible = filteredConversations();
  const query = (globalSearch?.value || "").trim();
  const userSuggestions = searchableUsersForQuery(query);
  const sections = [...new Set(visible.map((item) => item.section))];
  chatList.innerHTML = sections
    .map((section) => `
      <div class="conversation-section">
        <p>${section}</p>
        ${visible
        .filter((item) => item.section === section)
        .map((item) => `
            <button class="chat-person ${item.id === activeConversationId ? "active" : ""}" type="button" data-conversation="${item.id}">
              <span class="chat-avatar ${item.online ? "online" : ""}" data-avatar-conversation="${item.id}">${item.name.slice(0, 1)}</span>
              <span><strong>${item.name}</strong><small>${item.online ? "Online" : "Away"} - ${item.preview}</small></span>
              <span class="chat-meta">
                <time>${item.time}</time>
                ${item.unread ? `<em>${item.unread}</em>` : ""}
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
''')

s = replace_func(s, "renderThread", r'''
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
''')

s = replace_func(s, "renderConversationMeta", r'''
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
''')

s = replace_func(s, "renderCallControls", r'''
function renderCallControls() {
  const active = activeConversation();
  if (!active) {
    callControls.innerHTML = "";
    return;
  }
  const role = active.role.toLowerCase();
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
''')

for a, b in {
    'return found.[0] || leavePolicyState.holidayCountry || "India";': 'return found?.[0] || leavePolicyState.holidayCountry || "India";',
    '${flow === selected  "selected" : ""}': '${flow === selected ? "selected" : ""}',
    'user.roles.[0]': 'user.roles?.[0]',
    'byUser.roles.[0]': 'byUser.roles?.[0]',
    'person.online  "online" : ""': 'person.online ? "online" : ""',
    'active.online  "Available" : "Away"': 'active.online ? "Available" : "Away"',
    'return body - `${base} · ${body}` : base;': 'return body ? `${base} - ${body}` : base;',
    'return body - `${base} - ${body}` : base;': 'return body ? `${base} - ${body}` : base;',
    'button.setAttribute("aria-pressed", label === activeChatFilter - "true" : "false");': 'button.setAttribute("aria-pressed", label === activeChatFilter ? "true" : "false");',
    'item.unread = unreadState[item.id] - String(unreadState[item.id]) : "";': 'item.unread = unreadState[item.id] ? String(unreadState[item.id]) : "";',
}.items():
    s = s.replace(a, b)

for a, b in {
    "Â·": "-",
    "Â": "",
    "âœ¦": "",
    "â–¶": "",
    "â˜•": "",
    "ðŸŒ…": "",
    "ðŸŽ¯": "",
    "ðŸ“Œ": "",
    "ðŸŒ™": "",
    "ðŸ§­": "",
    "ðŸŸ¢": "",
    "ðŸ’¬": "",
    "âœ¨": "",
}.items():
    s = s.replace(a, b)

p.write_text(s, encoding="utf-8")
print("repaired app.js", len(s))
