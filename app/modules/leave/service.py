from datetime import date, datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import Role, RoleModel, User
from app.modules.employees.models import Employee
from app.modules.leave.models import LeavePolicySetting, LeaveRequest, LeaveStatus
from app.modules.leave.schemas import LeaveApply, LeaveDecision, LeavePolicyState
from app.modules.notifications.models import NotificationType
from app.modules.notifications.schemas import NotificationCreate
from app.modules.notifications.service import NotificationService

DEFAULT_LEAVE_POLICY = {
    "annual": 12,
    "casual": 4,
    "sick": 2,
    "approvalFlow": "Supervisor then Manager",
    "revokeRule": "Manager approval required",
    "holidayCountry": "India",
    "holidayLocation": "Hyderabad",
    "leaveTypes": [
        {"name": "Sick Leave", "balance": 8, "approvalFlow": "Manager only"},
        {"name": "Casual Leave", "balance": 6, "approvalFlow": "Manager only"},
        {"name": "EL", "balance": 12, "approvalFlow": "Manager then HR"},
        {
            "name": "Flexi (Optional Holiday)",
            "balance": 2,
            "approvalFlow": "No approval required",
        },
        {"name": "Comp Off", "balance": 3, "approvalFlow": "Manager only"},
        {"name": "Bereavement Leave", "balance": 5, "approvalFlow": "Manager then HR"},
        {"name": "Maternity Leave", "balance": 90, "approvalFlow": "Manager then HR"},
        {"name": "Paternity Leave", "balance": 10, "approvalFlow": "Manager then HR"},
    ],
    "holidays": [],
}

APPROVAL_FLOW_STEPS = {
    "No approval required": [],
    "Manager only": ["manager"],
    "Supervisor then Manager": ["supervisor", "manager"],
    "Manager then HR": ["manager", "hr"],
}

STEP_STATUS = {
    "supervisor": LeaveStatus.pending_supervisor,
    "manager": LeaveStatus.pending_manager,
    "hr": LeaveStatus.pending_hr,
}

REVOKE_STEP_STATUS = {
    "supervisor": LeaveStatus.revoke_pending_supervisor,
    "manager": LeaveStatus.revoke_pending_manager,
    "hr": LeaveStatus.revoke_pending_manager,
}


class LeaveService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_policy(self) -> dict:
        result = await self.db.execute(
            select(LeavePolicySetting).where(LeavePolicySetting.key == "global")
        )
        setting = result.scalar_one_or_none()
        return setting.data if setting and setting.data else DEFAULT_LEAVE_POLICY

    async def update_policy(self, payload: LeavePolicyState) -> dict:
        data = payload.model_dump()

        result = await self.db.execute(
            select(LeavePolicySetting).where(LeavePolicySetting.key == "global")
        )
        setting = result.scalar_one_or_none()

        if setting:
            setting.data = data
        else:
            setting = LeavePolicySetting(key="global", data=data)
            self.db.add(setting)

        await self.db.commit()
        await self.db.refresh(setting)
        return setting.data

    async def apply(self, current_user: User, payload: LeaveApply) -> LeaveRequest:
        if not current_user.employee_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is not linked to an employee",
            )
        try:
            employee = await self._employee(current_user.employee_id)
        except HTTPException as exc:
            if exc.status_code == status.HTTP_404_NOT_FOUND:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="User is linked to a missing employee record. Please fix employee mapping.",
                ) from exc
            raise

        supervisor_user = (
            await self._user_for_employee(employee.reports_to_id)
            if employee.reports_to_id
            else None
        )
        leave_type = payload.leave_type.strip()
        if not leave_type:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Leave type is required",
            )

        requested_days = leave_days_inclusive(payload.start_date, payload.end_date)
        available_days = await self.available_balance(employee.id, leave_type)
        if requested_days > available_days:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Insufficient {leave_type} balance. "
                    f"Requested {requested_days}, available {available_days}."
                ),
            )

        approval_flow = await self.approval_flow_for_type(leave_type)
        workflow_steps = workflow_steps_for_flow(approval_flow)
        current_step = workflow_steps[0] if workflow_steps else None
        initial_status = status_for_workflow_step(current_step) if current_step else LeaveStatus.approved

        leave = LeaveRequest(
            employee_id=employee.id,
            leave_type=leave_type,
            start_date=payload.start_date,
            end_date=payload.end_date,
            reason=payload.reason,
            status=initial_status,
            supervisor_id=supervisor_user.id if supervisor_user else None,
            approval_flow=approval_flow,
            current_step=current_step,
            workflow_steps=workflow_steps,
            approval_history=[
                workflow_event("submitted", "employee", current_user.id, payload.reason)
            ],
        )
        self.db.add(leave)
        await self.db.commit()
        await self.db.refresh(leave)

        await self._notify_current_reviewer(leave)

        return leave

    async def list(self, current_user: User) -> list[LeaveRequest]:
        query = select(LeaveRequest).order_by(LeaveRequest.created_at.desc())
        if current_user.employee_id:
            query = query.where(LeaveRequest.employee_id == current_user.employee_id)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def list_team(self, current_user: User) -> list[LeaveRequest]:
        role_values = {
            getattr(role.name, "value", role.name)
            for role in (getattr(current_user, "roles", None) or [])
        }
        query = (
            select(LeaveRequest, Employee)
            .join(Employee, LeaveRequest.employee_id == Employee.id)
            .order_by(LeaveRequest.created_at.desc())
        )

        if "admin" in role_values or "hr" in role_values:
            pass
        elif "manager" in role_values:
            manager_conditions = [
                LeaveRequest.manager_id == current_user.id,
                LeaveRequest.supervisor_id == current_user.id,
            ]
            if current_user.employee_id:
                manager_conditions.append(Employee.reports_to_id == current_user.employee_id)
            query = query.where(or_(*manager_conditions))
        elif "supervisor" in role_values:
            supervisor_conditions = [
                LeaveRequest.supervisor_id == current_user.id,
                LeaveRequest.supervisor_id.is_(None),
            ]
            if current_user.employee_id:
                supervisor_conditions.append(Employee.reports_to_id == current_user.employee_id)
            query = query.where(or_(*supervisor_conditions))
        else:
            return []

        result = await self.db.execute(query)
        leaves: list[LeaveRequest] = []
        for leave, employee in result.all():
            leave.requester_name = (
                f"{employee.first_name or ''} {employee.last_name or ''}".strip()
                or f"Employee {employee.id}"
            )
            leave.requester_employee_code = employee.employee_code
            leaves.append(leave)
        return leaves

    async def supervisor_approve(
        self, leave_id: int, approver: User, payload: LeaveDecision
    ) -> LeaveRequest:
        leave = await self._leave(leave_id)
        leave = self._approve_current_step(leave, approver, payload, "supervisor")
        await self.db.commit()
        await self.db.refresh(leave)

        requester = await self._user_for_employee(leave.employee_id)
        if requester:
            await self._notify(
                requester.id,
                "Leave escalated",
                f"Leave request #{leave.id} moved to manager approval.",
            )
        await self._notify_current_reviewer(leave)

        return leave

    async def manager_approve(
        self, leave_id: int, approver: User, payload: LeaveDecision
    ) -> LeaveRequest:
        leave = await self._leave(leave_id)
        leave = self._approve_current_step(leave, approver, payload, "manager")
        await self.db.commit()
        await self.db.refresh(leave)

        requester = await self._user_for_employee(leave.employee_id)
        if requester:
            is_forwarded_to_hr = safe_status_value(leave.status) == "pending_hr"
            await self._notify(
                requester.id,
                "Leave moved to HR" if is_forwarded_to_hr else "Leave approved",
                (
                    f"Leave request #{leave.id} was approved by manager and moved to HR."
                    if is_forwarded_to_hr
                    else f"Leave request #{leave.id} was approved."
                ),
            )
        await self._notify_current_reviewer(leave)

        return leave

    async def hr_approve(
        self, leave_id: int, approver: User, payload: LeaveDecision
    ) -> LeaveRequest:
        leave = await self._leave(leave_id)
        leave = self._approve_current_step(leave, approver, payload, "hr")
        await self.db.commit()
        await self.db.refresh(leave)

        requester = await self._user_for_employee(leave.employee_id)
        if requester:
            await self._notify(
                requester.id,
                "Leave approved",
                f"Leave request #{leave.id} was approved.",
            )

        return leave

    async def reject(
        self, leave_id: int, approver: User, payload: LeaveDecision
    ) -> LeaveRequest:
        leave = await self._leave(leave_id)
        self._record_approver(leave, normalized_role_step(approver), approver.id)
        leave.status = LeaveStatus.rejected
        leave.current_step = None
        leave.decision_note = payload.note
        leave.approval_history = [
            *(leave.approval_history or []),
            workflow_event("rejected", normalized_role_step(approver), approver.id, payload.note),
        ]
        await self.db.commit()
        await self.db.refresh(leave)

        requester = await self._user_for_employee(leave.employee_id)
        if requester:
            await self._notify(
                requester.id,
                "Leave rejected",
                f"Leave request #{leave.id} was rejected.",
            )

        return leave

    async def revoke(self, leave_id: int, current_user: User) -> LeaveRequest:
        if not current_user.employee_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is not linked to an employee",
            )

        leave = await self._leave(leave_id)

        if leave.employee_id != current_user.employee_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot revoke another employee leave",
            )

        if leave.status in {LeaveStatus.rejected, LeaveStatus.revoked, LeaveStatus.cancelled}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Leave cannot be revoked"
            )

        if safe_status_value(leave.status).startswith("pending"):
            leave.status = LeaveStatus.cancelled
            leave.current_step = None
            leave.decision_note = "Cancelled by employee before approval."
            leave.approval_history = [
                *(leave.approval_history or []),
                workflow_event("cancelled", "employee", current_user.id, None),
            ]
            await self.db.commit()
            await self.db.refresh(leave)
            return leave

        today = date.today()
        if leave.start_date < today:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Past leave cannot be revoked. Contact HR.",
            )

        policy = await self.get_policy()
        revoke_rule = policy.get("revokeRule") or "Manager approval required"
        revoke_steps = revoke_steps_for_rule(revoke_rule)
        leave.revoke_rule = revoke_rule
        leave.approval_flow = leave.approval_flow or await self.approval_flow_for_type(leave.leave_type)
        leave.workflow_steps = revoke_steps
        leave.current_step = revoke_steps[0] if revoke_steps else None
        leave.approval_history = [
            *(leave.approval_history or []),
            workflow_event("revoke_requested", "employee", current_user.id, None),
        ]
        leave.status = (
            revoke_status_for_step(leave.current_step)
            if leave.current_step
            else LeaveStatus.revoked
        )
        await self.db.commit()
        await self.db.refresh(leave)
        await self._notify_current_reviewer(leave)
        return leave

    def _approve_current_step(
        self,
        leave: LeaveRequest,
        approver: User,
        payload: LeaveDecision,
        expected_step: str,
    ) -> LeaveRequest:
        current_step = leave.current_step or inferred_current_step(leave.status)
        workflow_steps = list(leave.workflow_steps or fallback_steps_for_status(leave.status))

        if current_step != expected_step:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Leave is not pending {expected_step} approval",
            )

        is_revoke = safe_status_value(leave.status).startswith("revoke_pending")
        self._record_approver(leave, expected_step, approver.id)
        leave.decision_note = payload.note
        leave.approval_history = [
            *(leave.approval_history or []),
            workflow_event("approved", expected_step, approver.id, payload.note),
        ]

        try:
            current_index = workflow_steps.index(current_step)
        except ValueError:
            current_index = -1

        next_step = workflow_steps[current_index + 1] if current_index + 1 < len(workflow_steps) else None
        leave.current_step = next_step
        leave.workflow_steps = workflow_steps
        if next_step:
            leave.status = revoke_status_for_step(next_step) if is_revoke else status_for_workflow_step(next_step)
        else:
            leave.status = LeaveStatus.revoked if is_revoke else LeaveStatus.approved
        return leave

    @staticmethod
    def _record_approver(leave: LeaveRequest, step: str, approver_id: int) -> None:
        if step == "supervisor":
            leave.supervisor_id = approver_id
        elif step in {"manager", "hr"}:
            leave.manager_id = approver_id

    async def _leave(self, leave_id: int) -> LeaveRequest:
        result = await self.db.execute(
            select(LeaveRequest).where(LeaveRequest.id == leave_id)
        )
        leave = result.scalar_one_or_none()
        if not leave:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found"
            )
        return leave

    async def _employee(self, employee_id: int) -> Employee:
        result = await self.db.execute(
            select(Employee).where(Employee.id == employee_id)
        )
        employee = result.scalar_one_or_none()
        if not employee:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found"
            )
        return employee

    async def _user_for_employee(self, employee_id: int | None) -> User | None:
        if not employee_id:
            return None
        result = await self.db.execute(
            select(User).where(User.employee_id == employee_id)
        )
        return result.scalar_one_or_none()

    async def _notify(self, recipient_user_id: int, title: str, body: str) -> None:
        await NotificationService(self.db).create(
            NotificationCreate(
                recipient_user_id=recipient_user_id,
                type=NotificationType.leave,
                title=title,
                body=body,
            )
        )

    async def _notify_current_reviewer(self, leave: LeaveRequest) -> None:
        step = leave.current_step or inferred_current_step(leave.status)
        if step in {"supervisor", "manager"}:
            requester = await self._employee(leave.employee_id)
            reviewer = (
                await self._user_for_employee(requester.reports_to_id)
                if requester.reports_to_id
                else None
            )
            if reviewer:
                await self._notify(
                    reviewer.id,
                    "Leave approval required",
                    f"Leave request #{leave.id} is pending {step} approval.",
                )
            return

        if step == "hr":
            result = await self.db.execute(
                select(User)
                .join(User.roles)
                .where(RoleModel.name == Role.hr, User.is_active.is_(True))
            )
            for reviewer in result.scalars().unique().all():
                await self._notify(
                    reviewer.id,
                    "Leave approval required",
                    f"Leave request #{leave.id} is pending HR approval.",
                )

    async def approval_flow_for_type(self, leave_type: str) -> str:
        policy = await self.get_policy()
        target_type = normalize_leave_type_key(leave_type)
        for item in policy.get("leaveTypes", []):
            if normalize_leave_type_key(item.get("name", "")) == target_type:
                return item.get("approvalFlow") or policy.get("approvalFlow") or "Manager only"
        return policy.get("approvalFlow") or "Manager only"

    async def policy_balance_for_type(self, leave_type: str) -> int:
        policy = await self.get_policy()
        target_type = normalize_leave_type_key(leave_type)
        for item in policy.get("leaveTypes", []):
            if normalize_leave_type_key(item.get("name", "")) == target_type:
                return int(item.get("balance") or 0)
        return 0

    async def available_balance(self, employee_id: int, leave_type: str) -> int:
        allocated = await self.policy_balance_for_type(leave_type)
        result = await self.db.execute(
            select(LeaveRequest).where(
                LeaveRequest.employee_id == employee_id,
                LeaveRequest.status.in_(
                    [
                        LeaveStatus.pending_supervisor,
                        LeaveStatus.pending_manager,
                        LeaveStatus.pending_hr,
                        LeaveStatus.approved,
                        LeaveStatus.revoke_pending_supervisor,
                        LeaveStatus.revoke_pending_manager,
                    ]
                ),
            )
        )
        target_type = normalize_leave_type_key(leave_type)
        used = sum(
            leave_days_inclusive(item.start_date, item.end_date)
            for item in result.scalars().all()
            if normalize_leave_type_key(item.leave_type) == target_type
        )
        return max(0, allocated - used)


def leave_days_inclusive(start_date: date, end_date: date) -> int:
    return max(1, (end_date - start_date).days + 1)


def normalize_leave_type_key(value: object) -> str:
    text_value = str(value or "Leave").strip().lower()
    if text_value.endswith(" leave"):
        return text_value[: -len(" leave")].strip()
    return text_value


def workflow_steps_for_flow(flow: str | None) -> list[str]:
    return list(APPROVAL_FLOW_STEPS.get(flow or "", APPROVAL_FLOW_STEPS["Manager only"]))


def revoke_steps_for_rule(rule: str | None) -> list[str]:
    normalized = str(rule or "").strip().lower()
    if "auto" in normalized:
        return []
    if "supervisor" in normalized:
        return ["supervisor"]
    return ["manager"]


def status_for_workflow_step(step: str | None) -> LeaveStatus:
    if not step:
        return LeaveStatus.approved
    return STEP_STATUS.get(step, LeaveStatus.pending_manager)


def revoke_status_for_step(step: str | None) -> LeaveStatus:
    if not step:
        return LeaveStatus.revoked
    return REVOKE_STEP_STATUS.get(step, LeaveStatus.revoke_pending_manager)


def inferred_current_step(status_value: LeaveStatus | str | None) -> str | None:
    clean = safe_status_value(status_value)
    if clean in {"pending_supervisor", "revoke_pending_supervisor"}:
        return "supervisor"
    if clean in {"pending_manager", "revoke_pending_manager"}:
        return "manager"
    if clean == "pending_hr":
        return "hr"
    return None


def fallback_steps_for_status(status_value: LeaveStatus | str | None) -> list[str]:
    clean = safe_status_value(status_value)
    if clean == "pending_supervisor":
        return ["supervisor", "manager"]
    if clean == "pending_manager":
        return ["manager"]
    if clean == "pending_hr":
        return ["hr"]
    if clean == "revoke_pending_supervisor":
        return ["supervisor"]
    if clean == "revoke_pending_manager":
        return ["manager"]
    return []


def safe_status_value(status_value: LeaveStatus | str | None) -> str:
    value = getattr(status_value, "value", status_value)
    return str(value or "").strip().lower()


def normalized_role_step(user: User) -> str:
    role_values = {
        getattr(role.name, "value", role.name)
        for role in (getattr(user, "roles", None) or [])
    }
    if "hr" in role_values:
        return "hr"
    if "manager" in role_values:
        return "manager"
    if "supervisor" in role_values:
        return "supervisor"
    if "admin" in role_values:
        return "admin"
    return "reviewer"


def workflow_event(action: str, step: str, user_id: int | None, note: str | None) -> dict:
    return {
        "action": action,
        "step": step,
        "user_id": user_id,
        "note": note,
        "at": datetime.now(timezone.utc).isoformat(),
    }
