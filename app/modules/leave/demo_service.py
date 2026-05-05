from __future__ import annotations

from datetime import date
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status

from app.modules.chat.demo_service import DemoChatService
from app.modules.leave.models import LeaveRequest, LeaveStatus
from app.modules.leave.schemas import DemoLeaveApply, DemoLeaveRequestState, DemoLeaveState
from app.modules.timesheets.demo_service import DemoTimesheetService


class DemoLeaveService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.current_key = "you"

    async def bootstrap(self) -> DemoLeaveState:
        user_map = await DemoChatService(self.db)._ensure_demo_users()
        await DemoTimesheetService(self.db)._ensure_demo_employees(user_map)
        await self._seed_requests(user_map[self.current_key].employee_id)
        return await self._build_state(user_map[self.current_key].employee_id)

    async def create_request(self, payload: DemoLeaveApply) -> DemoLeaveState:
        user_map = await DemoChatService(self.db)._ensure_demo_users()
        await DemoTimesheetService(self.db)._ensure_demo_employees(user_map)
        employee_id = user_map[self.current_key].employee_id
        leave = LeaveRequest(
            employee_id=employee_id,
            start_date=payload.start_date,
            end_date=payload.end_date,
            reason=json.dumps({"leave_type": payload.leave_type, "reason": payload.reason}),
            status=LeaveStatus.pending_supervisor,
        )
        self.db.add(leave)
        await self.db.commit()
        return await self._build_state(employee_id)

    async def revoke_request(self, leave_id: int) -> DemoLeaveState:
        user_map = await DemoChatService(self.db)._ensure_demo_users()
        await DemoTimesheetService(self.db)._ensure_demo_employees(user_map)
        employee_id = user_map[self.current_key].employee_id
        result = await self.db.execute(
            select(LeaveRequest).where(
                LeaveRequest.id == leave_id,
                LeaveRequest.employee_id == employee_id,
            )
        )
        leave = result.scalar_one_or_none()
        if not leave:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found.")
        if leave.status == LeaveStatus.approved:
            leave.status = LeaveStatus.revoke_pending_manager
            leave.decision_note = "Revoke requested by employee. Manager approval required."
        elif leave.status in {LeaveStatus.revoke_pending_supervisor, LeaveStatus.revoke_pending_manager}:
            leave.decision_note = "Revoke request is already pending approval."
        elif leave.status == LeaveStatus.revoked:
            leave.decision_note = "Leave request has already been revoked."
        else:
            leave.status = LeaveStatus.revoked
            leave.decision_note = "Revoked by employee before final approval."
        await self.db.commit()
        return await self._build_state(employee_id)

    async def manager_revoke_request(self, leave_id: int) -> DemoLeaveState:
        user_map = await DemoChatService(self.db)._ensure_demo_users()
        await DemoTimesheetService(self.db)._ensure_demo_employees(user_map)
        employee_id = user_map[self.current_key].employee_id
        result = await self.db.execute(
            select(LeaveRequest).where(
                LeaveRequest.id == leave_id,
                LeaveRequest.employee_id == employee_id,
            )
        )
        leave = result.scalar_one_or_none()
        if not leave:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found.")
        leave.status = LeaveStatus.revoked
        leave.decision_note = "Revoked with manager approval."
        await self.db.commit()
        return await self._build_state(employee_id)

    async def _build_state(self, employee_id: int) -> DemoLeaveState:
        result = await self.db.execute(
            select(LeaveRequest)
            .where(LeaveRequest.employee_id == employee_id)
            .order_by(LeaveRequest.created_at.desc())
        )
        requests = [self._to_state(item) for item in result.scalars().all()]
        return DemoLeaveState(requests=requests)

    def _to_state(self, item: LeaveRequest) -> DemoLeaveRequestState:
        leave_type = "Leave"
        reason = item.reason
        try:
            payload = json.loads(item.reason)
            leave_type = payload.get("leave_type", leave_type)
            reason = payload.get("reason", reason)
        except Exception:
            pass

        stage = {
            LeaveStatus.pending_supervisor: "supervisor",
            LeaveStatus.pending_manager: "manager",
            LeaveStatus.approved: "completed",
            LeaveStatus.rejected: "rejected",
            LeaveStatus.revoke_pending_supervisor: "revoke_supervisor",
            LeaveStatus.revoke_pending_manager: "revoke_manager",
            LeaveStatus.revoked: "revoked",
        }[item.status]

        status_label = {
            LeaveStatus.pending_supervisor: "Pending Supervisor",
            LeaveStatus.pending_manager: "Pending Manager",
            LeaveStatus.approved: "Approved",
            LeaveStatus.rejected: "Rejected",
            LeaveStatus.revoke_pending_supervisor: "Revoke Pending Supervisor",
            LeaveStatus.revoke_pending_manager: "Revoke Pending Manager",
            LeaveStatus.revoked: "Revoked",
        }[item.status]

        return DemoLeaveRequestState(
            id=item.id,
            leave_id=f"LV-{item.id:05d}",
            leave_type=leave_type,
            start_date=item.start_date,
            end_date=item.end_date,
            reason=reason,
            status=status_label,
            stage=stage,
            created_at=item.created_at,
        )

    async def _seed_requests(self, employee_id: int) -> None:
        result = await self.db.execute(select(LeaveRequest.id).where(LeaveRequest.employee_id == employee_id))
        if result.first():
            return
        seed = [
            LeaveRequest(
                employee_id=employee_id,
                start_date=date(2026, 5, 10),
                end_date=date(2026, 5, 12),
                reason=json.dumps({"leave_type": "Annual Leave", "reason": "Family event"}),
                status=LeaveStatus.pending_manager,
            ),
            LeaveRequest(
                employee_id=employee_id,
                start_date=date(2026, 4, 18),
                end_date=date(2026, 4, 18),
                reason=json.dumps({"leave_type": "Casual Leave", "reason": "Personal work"}),
                status=LeaveStatus.approved,
            ),
            LeaveRequest(
                employee_id=employee_id,
                start_date=date(2026, 3, 28),
                end_date=date(2026, 3, 29),
                reason=json.dumps({"leave_type": "Sick Leave", "reason": "Recovery"}),
                status=LeaveStatus.approved,
            ),
        ]
        self.db.add_all(seed)
        await self.db.commit()
