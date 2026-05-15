from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
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
        initial_status = LeaveStatus.pending_supervisor
        if approval_flow == "No approval required":
            initial_status = LeaveStatus.approved
        elif approval_flow in {"Manager only", "Manager then HR"}:
            initial_status = LeaveStatus.pending_manager

        leave = LeaveRequest(
            employee_id=employee.id,
            leave_type=leave_type,
            start_date=payload.start_date,
            end_date=payload.end_date,
            reason=payload.reason,
            status=initial_status,
            supervisor_id=supervisor_user.id if supervisor_user else None,
        )
        self.db.add(leave)
        await self.db.commit()
        await self.db.refresh(leave)

        if leave.supervisor_id and leave.status == LeaveStatus.pending_supervisor:
            await self._notify(
                leave.supervisor_id,
                "Leave approval required",
                f"Leave request #{leave.id} is pending.",
            )

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
        if leave.status != LeaveStatus.pending_supervisor:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Leave is not pending supervisor approval",
            )
        leave.supervisor_id = approver.id
        leave.status = LeaveStatus.pending_manager
        leave.decision_note = payload.note
        await self.db.commit()
        await self.db.refresh(leave)

        requester = await self._user_for_employee(leave.employee_id)
        if requester:
            await self._notify(
                requester.id,
                "Leave escalated",
                f"Leave request #{leave.id} moved to manager approval.",
            )

        return leave

    async def manager_approve(
        self, leave_id: int, approver: User, payload: LeaveDecision
    ) -> LeaveRequest:
        leave = await self._leave(leave_id)
        if leave.status not in {
            LeaveStatus.pending_supervisor,
            LeaveStatus.pending_manager,
        }:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Leave is already decided"
            )
        leave.manager_id = approver.id
        leave.status = LeaveStatus.approved
        leave.decision_note = payload.note
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
        leave.manager_id = approver.id
        leave.status = LeaveStatus.rejected
        leave.decision_note = payload.note
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

        if leave.status in {LeaveStatus.rejected, LeaveStatus.revoked}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Leave cannot be revoked"
            )

        leave.status = LeaveStatus.revoked
        await self.db.commit()
        await self.db.refresh(leave)
        return leave

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
