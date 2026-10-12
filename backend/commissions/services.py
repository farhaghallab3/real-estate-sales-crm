from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.utils import timezone

from core.exceptions import BusinessRuleViolation
from core.models import Activity
from core.services import log_activity
from notifications.models import Notification
from notifications.services import notify

from .models import Commission

CENT = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def calculate(sale_price: Decimal, rate: Decimal, split: Decimal, deductions: Decimal) -> dict[str, Decimal]:
    """gross = price × rate; agent = gross × split; net = agent − deductions (never negative)."""
    gross = _money(sale_price * rate / Decimal(100))
    agent = _money(gross * split / Decimal(100))
    net = max(_money(agent - deductions), Decimal("0.00"))
    return {"gross_commission": gross, "agent_commission": agent, "net_commission": net}


def recalculate(commission: Commission) -> Commission:
    for field, value in calculate(
        commission.sale_price, commission.commission_rate, commission.agent_split, commission.deductions
    ).items():
        setattr(commission, field, value)
    return commission


def create_for_deal(deal, actor) -> Commission:
    salesperson = deal.assigned_to
    split = salesperson.commission_split if salesperson else Decimal("50")
    commission = Commission(
        deal=deal,
        salesperson=salesperson,
        sale_price=deal.sale_price,
        commission_rate=Decimal(str(settings.DEFAULT_COMMISSION_RATE)),
        agent_split=split,
        deductions=Decimal("0"),
    )
    recalculate(commission)
    commission.save()
    log_activity(
        actor=actor,
        kind=Activity.Kind.COMMISSION,
        message=f"Commission of {commission.net_commission:,.2f} generated for {deal.property.title}",
        deal=deal,
    )
    notify(
        [salesperson],
        kind=Notification.Kind.COMMISSION,
        title="Commission generated",
        body=f"{deal.property.title} · net {commission.net_commission:,.2f}",
        link="/commissions",
        actor=actor,
    )
    return commission


def update_terms(commission: Commission, actor, **changes) -> Commission:
    if commission.status == Commission.Status.PAID:
        raise BusinessRuleViolation("Paid commissions can no longer be changed.")
    for key, value in changes.items():
        setattr(commission, key, value)
    recalculate(commission)
    if commission.deductions > commission.agent_commission:
        raise BusinessRuleViolation("Deductions cannot exceed the agent commission.")
    commission.save()
    return commission


def approve(commission: Commission, actor) -> Commission:
    if commission.status != Commission.Status.PENDING:
        raise BusinessRuleViolation("Only pending commissions can be approved.")
    commission.status = Commission.Status.APPROVED
    commission.approved_by = actor
    commission.approved_at = timezone.now()
    commission.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
    _notify_status(commission, actor, "approved")
    return commission


def mark_paid(commission: Commission, actor) -> Commission:
    if commission.status != Commission.Status.APPROVED:
        raise BusinessRuleViolation("Commission must be approved before it can be paid.")
    commission.status = Commission.Status.PAID
    commission.paid_at = timezone.now()
    commission.save(update_fields=["status", "paid_at", "updated_at"])
    _notify_status(commission, actor, "paid")
    return commission


def _notify_status(commission: Commission, actor, label: str) -> None:
    log_activity(
        actor=actor,
        kind=Activity.Kind.COMMISSION,
        message=f"Commission for {commission.deal.property.title} {label}",
        deal=commission.deal,
    )
    notify(
        [commission.salesperson],
        kind=Notification.Kind.COMMISSION,
        title=f"Commission {label}",
        body=f"{commission.deal.property.title} · net {commission.net_commission:,.2f}",
        link="/commissions",
        actor=actor,
    )
