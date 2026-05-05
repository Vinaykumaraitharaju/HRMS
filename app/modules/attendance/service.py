from math import asin, cos, radians, sin, sqrt

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.modules.attendance.models import AttendanceLog
from app.modules.attendance.schemas import AttendanceCapture
from app.modules.auth.models import User


class AttendanceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def capture(
        self, current_user: User, payload: AttendanceCapture
    ) -> AttendanceLog:
        if not current_user.employee_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is not linked to an employee",
            )

        distance = self._distance_meters(
            payload.latitude,
            payload.longitude,
            settings.office_latitude,
            settings.office_longitude,
        )

        is_office = distance <= settings.office_radius_meters

        log = AttendanceLog(
            employee_id=current_user.employee_id,
            action=payload.action,
            latitude=payload.latitude,
            longitude=payload.longitude,
            distance_meters=distance,
            work_mode="office" if is_office else "wfh",
            break_type=payload.break_type,
            note=payload.note,
        )

        self.db.add(log)
        await self.db.commit()
        await self.db.refresh(log)
        return log

    async def list_for_current_user(self, current_user: User) -> list[AttendanceLog]:
        if not current_user.employee_id:
            return []

        result = await self.db.execute(
            select(AttendanceLog)
            .where(AttendanceLog.employee_id == current_user.employee_id)
            .order_by(AttendanceLog.captured_at.desc())
        )
        return list(result.scalars().all())

    def _distance_meters(
        self, lat1: float, lon1: float, lat2: float, lon2: float
    ) -> float:
        earth_radius_meters = 6_371_000
        dlat = radians(lat2 - lat1)
        dlon = radians(lon2 - lon1)
        a = (
            sin(dlat / 2) ** 2
            + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
        )
        return 2 * earth_radius_meters * asin(sqrt(a))