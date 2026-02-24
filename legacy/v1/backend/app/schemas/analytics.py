from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import Field

from app.models.enums import ServiceLine
from app.schemas.base import ORMModel


class AnalyticsOverview(ORMModel):
    period_start: datetime
    period_end: datetime
    assignments: int = 0
    billed: Decimal = Decimal("0.00")
    collected: Decimal = Decimal("0.00")
    outstanding: Decimal = Decimal("0.00")


class AnalyticsTrendPoint(ORMModel):
    period: str
    assignments: int = 0
    revenue: Decimal = Decimal("0.00")


class AnalyticsSignal(ORMModel):
    level: str
    message: str
    source_key: Optional[str] = None
    source_type: Optional[str] = None
    source_name: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[int] = None
    reason_code: Optional[str] = None
    recommended_action: Optional[str] = None
    observed_value: Optional[str] = None
    expected_value: Optional[str] = None
    follow_up_task_id: Optional[int] = None


class AnalyticsSourceRow(ORMModel):
    source_key: str
    source_type: str
    source_name: str
    source_detail: Optional[str] = None
    case_type: Optional[str] = None
    service_line: Optional[ServiceLine] = None
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    client_id: Optional[int] = None
    client_label: Optional[str] = None

    assignments: int = 0
    assignments_change_pct: Optional[float] = None
    revenue: Decimal = Decimal("0.00")
    revenue_change_pct: Optional[float] = None
    collected: Decimal = Decimal("0.00")
    outstanding: Decimal = Decimal("0.00")
    avg_per_assignment: Decimal = Decimal("0.00")
    status: str = "STABLE"
    last_assignment_at: Optional[datetime] = None


class AnalyticsResponse(ORMModel):
    overview: AnalyticsOverview
    sources: List[AnalyticsSourceRow] = Field(default_factory=list)
    trends: List[AnalyticsTrendPoint] = Field(default_factory=list)
    signals: List[AnalyticsSignal] = Field(default_factory=list)


class ForecastSummary(ORMModel):
    period: str
    expected_assignments: int = 0
    expected_assignments_low: int = 0
    expected_assignments_high: int = 0
    expected_billed: Decimal = Decimal("0.00")
    expected_billed_low: Decimal = Decimal("0.00")
    expected_billed_high: Decimal = Decimal("0.00")
    expected_collected: Optional[Decimal] = None
    expected_collected_low: Optional[Decimal] = None
    expected_collected_high: Optional[Decimal] = None
    observed_assignments: int = 0
    observed_billed: Decimal = Decimal("0.00")


class ForecastV2Response(ORMModel):
    entity_type: str
    entity_id: Optional[int] = None
    entity_label: str
    period_start: datetime
    period_end: datetime
    monthly: List[AnalyticsTrendPoint] = Field(default_factory=list)
    quarterly: List[AnalyticsTrendPoint] = Field(default_factory=list)
    seasonality: List[AnalyticsTrendPoint] = Field(default_factory=list)
    forecast: ForecastSummary
    confidence_note: Optional[str] = None


class WeeklyDigestItem(ORMModel):
    entity_type: str
    entity_id: Optional[int] = None
    entity_label: str
    health_label: str
    health_score: int
    assignments_change_pct: Optional[float] = None
    billed_change_pct: Optional[float] = None
    last_assignment_at: Optional[datetime] = None
    health_reasons: List[str] = Field(default_factory=list)


class WeeklyDigestResponse(ORMModel):
    period_start: datetime
    period_end: datetime
    total_at_risk: int = 0
    total_watch: int = 0
    summary: Optional[str] = None
    items: List[WeeklyDigestItem] = Field(default_factory=list)


class VisitReminderRequest(ORMModel):
    entity_type: str
    entity_id: Optional[int] = None
    entity_label: str
    scheduled_for: Optional[date] = None
    note: Optional[str] = None
    assigned_to_user_id: Optional[int] = None
    assigned_user_ids: List[int] = Field(default_factory=list)
    notify: bool = True


class VisitReminderResponse(ORMModel):
    event_id: int
    title: str
    start_at: datetime
    end_at: datetime


class AnalyticsEntityRow(ORMModel):
    entity_type: str
    entity_id: Optional[int] = None
    entity_key: str
    entity_label: str
    parent_id: Optional[int] = None
    assignments: int = 0
    assignments_change_pct: Optional[float] = None
    billed: Decimal = Decimal("0.00")
    billed_change_pct: Optional[float] = None
    collected: Decimal = Decimal("0.00")
    collected_change_pct: Optional[float] = None
    outstanding: Decimal = Decimal("0.00")
    avg_per_assignment: Decimal = Decimal("0.00")
    last_assignment_at: Optional[datetime] = None
    monthly: List[AnalyticsTrendPoint] = Field(default_factory=list)
    health_score: int = 100
    health_label: str = "Healthy"
    health_reasons: List[str] = Field(default_factory=list)
    forecast: Optional[ForecastSummary] = None
    children: List["AnalyticsEntityRow"] = Field(default_factory=list)


class AnalyticsOverviewV2(ORMModel):
    period_start: datetime
    period_end: datetime
    assignments: int = 0
    billed: Decimal = Decimal("0.00")
    collected: Decimal = Decimal("0.00")
    outstanding: Decimal = Decimal("0.00")


class AnalyticsBankResponse(ORMModel):
    overview: AnalyticsOverviewV2
    banks: List[AnalyticsEntityRow] = Field(default_factory=list)
    non_bank_sources: List[AnalyticsEntityRow] = Field(default_factory=list)


class AnalyticsSegmentResponse(ORMModel):
    overview: AnalyticsOverviewV2
    rows: List[AnalyticsEntityRow] = Field(default_factory=list)


class AnalyticsSettingsBase(ORMModel):
    time_window_days: int = 90
    decline_threshold_count: Decimal = Decimal("0.30")
    decline_threshold_revenue: Decimal = Decimal("0.25")
    inactivity_days: int = 21
    baseline_min_count: int = 3
    baseline_min_revenue: Decimal = Decimal("50000.00")
    followup_cooldown_days: int = 21
    outstanding_threshold: Decimal = Decimal("0.00")


class AnalyticsSettingsUpdate(ORMModel):
    time_window_days: Optional[int] = None
    decline_threshold_count: Optional[Decimal] = None
    decline_threshold_revenue: Optional[Decimal] = None
    inactivity_days: Optional[int] = None
    baseline_min_count: Optional[int] = None
    baseline_min_revenue: Optional[Decimal] = None
    followup_cooldown_days: Optional[int] = None
    outstanding_threshold: Optional[Decimal] = None


class AnalyticsSettingsRead(AnalyticsSettingsBase):
    id: int


class AnalyticsSettingsResponse(ORMModel):
    settings: AnalyticsSettingsRead
    recommended: AnalyticsSettingsBase
    recommended_note: Optional[str] = None


class FollowUpTaskRead(ORMModel):
    id: int
    entity_type: str
    entity_id: Optional[int] = None
    entity_label: str
    reason_code: str
    status: str
    severity: str
    title: str
    description: Optional[str] = None
    assigned_to_user_id: Optional[int] = None
    due_at: Optional[datetime] = None
    payload: Optional[dict] = None
    created_at: datetime


class FollowUpTaskUpdate(ORMModel):
    status: Optional[str] = None
    assigned_to_user_id: Optional[int] = None
    due_at: Optional[datetime] = None


class RelationshipLogRead(ORMModel):
    id: int
    entity_type: str
    entity_id: Optional[int] = None
    entity_label: str
    note: str
    next_follow_up_date: Optional[date] = None
    created_by_user_id: int
    created_at: datetime


class RelationshipLogCreate(ORMModel):
    entity_type: str
    entity_id: Optional[int] = None
    entity_label: str
    note: str
    next_follow_up_date: Optional[date] = None


AnalyticsEntityRow.model_rebuild()
