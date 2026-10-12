from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone

from commissions.models import Commission
from core.permissions import scope_to_user
from deals.models import Deal, Offer
from leads.models import Lead
from users.models import User
from viewings.models import Viewing


@dataclass
class Filters:
    date_from: date | None = None
    date_to: date | None = None
    salesperson: int | None = None
    property: int | None = None
    source: str | None = None
    location: str | None = None
    deal_status: str | None = None  # open | closed | lost | a stage name


def _aware(d: date, end: bool = False) -> datetime:
    return timezone.make_aware(datetime.combine(d, time.max if end else time.min))


def period_filters(days: int) -> Filters:
    if days and days > 0:
        return Filters(date_from=timezone.localdate() - timedelta(days=days))
    return Filters()


def querysets(user, f: Filters) -> dict:
    leads = scope_to_user(Lead.objects.all(), user)
    deals = scope_to_user(Deal.objects.select_related("lead", "property"), user)
    viewings = scope_to_user(Viewing.objects.all(), user)
    offers = scope_to_user(Offer.objects.all(), user, "deal__assigned_to")
    commissions = scope_to_user(Commission.objects.all(), user, "salesperson")

    if f.salesperson:
        leads = leads.filter(assigned_to_id=f.salesperson)
        deals = deals.filter(assigned_to_id=f.salesperson)
        viewings = viewings.filter(assigned_to_id=f.salesperson)
        offers = offers.filter(deal__assigned_to_id=f.salesperson)
        commissions = commissions.filter(salesperson_id=f.salesperson)
    if f.property:
        leads = leads.filter(property_matches__property_id=f.property).distinct()
        deals = deals.filter(property_id=f.property)
        viewings = viewings.filter(property_id=f.property)
        offers = offers.filter(property_id=f.property)
        commissions = commissions.filter(deal__property_id=f.property)
    if f.source:
        leads = leads.filter(source=f.source)
        deals = deals.filter(lead__source=f.source)
        viewings = viewings.filter(lead__source=f.source)
        offers = offers.filter(lead__source=f.source)
        commissions = commissions.filter(deal__lead__source=f.source)
    if f.location:
        leads = leads.filter(preferred_location__icontains=f.location)
        deals = deals.filter(property__city__icontains=f.location)
        viewings = viewings.filter(property__city__icontains=f.location)
        offers = offers.filter(property__city__icontains=f.location)
        commissions = commissions.filter(deal__property__city__icontains=f.location)
    if f.deal_status:
        if f.deal_status == "open":
            deals = deals.exclude(stage__in=Deal.TERMINAL_STAGES)
        else:
            deals = deals.filter(stage=f.deal_status)
        deal_ids = deals.values("id")
        offers = offers.filter(deal_id__in=deal_ids)
        commissions = commissions.filter(deal_id__in=deal_ids)

    return {"leads": leads, "deals": deals, "viewings": viewings, "offers": offers, "commissions": commissions}


def _in_range(qs, field: str, f: Filters):
    if f.date_from:
        qs = qs.filter(**{f"{field}__gte": _aware(f.date_from)})
    if f.date_to:
        qs = qs.filter(**{f"{field}__lte": _aware(f.date_to, end=True)})
    return qs


def metrics(qs: dict, f: Filters) -> dict:
    leads = _in_range(qs["leads"], "created_at", f)
    total_leads = leads.count()
    closed_leads = leads.filter(status=Lead.Status.CLOSED).count()
    closed_deals = _in_range(qs["deals"].filter(stage=Deal.Stage.CLOSED), "closed_at", f)
    closed_ids = closed_deals.values("id")
    sales = closed_deals.aggregate(v=Sum("sale_price"))["v"] or Decimal("0")
    commission = qs["commissions"].filter(deal_id__in=closed_ids).aggregate(v=Sum("net_commission"))["v"] or Decimal("0")
    viewings = _in_range(qs["viewings"].exclude(status=Viewing.Status.CANCELLED), "start_at", f)
    return {
        "total_leads": total_leads,
        "new_leads": leads.filter(status=Lead.Status.NEW).count(),
        "qualified_leads": leads.filter(status=Lead.Status.QUALIFIED).count(),
        "active_deals": qs["deals"].exclude(stage__in=Deal.TERMINAL_STAGES).count(),
        "viewings": viewings.count(),
        "offers": _in_range(qs["offers"], "created_at", f).count(),
        "closed_deals": closed_deals.count(),
        "sales_value": sales,
        "commission": commission,
        "conversion_rate": round(closed_leads / total_leads * 100, 1) if total_leads else 0.0,
    }


def pipeline_overview(deals_qs) -> list[dict]:
    rows = {
        r["stage"]: r
        for r in deals_qs.values("stage").annotate(n=Count("id"), value=Sum("offer_amount")).order_by()
    }
    out = []
    for stage in Deal.PIPELINE_ORDER + ["lost"]:
        row = rows.get(stage, {})
        out.append(
            {
                "stage": stage,
                "label": Deal.Stage(stage).label,
                "count": row.get("n", 0),
                "value": row.get("value") or Decimal("0"),
            }
        )
    return out


def leaderboard(qs: dict, f: Filters, user) -> list[dict]:
    people = User.objects.filter(is_active=True, role__in=["salesperson", "manager"])
    if user.role == "salesperson":
        people = people.filter(pk=user.pk)
    if f.salesperson:
        people = people.filter(pk=f.salesperson)
    leads = _in_range(qs["leads"], "created_at", f)
    closed = _in_range(qs["deals"].filter(stage=Deal.Stage.CLOSED), "closed_at", f)
    viewings = _in_range(qs["viewings"].exclude(status=Viewing.Status.CANCELLED), "start_at", f)
    offers = _in_range(qs["offers"], "created_at", f)
    lead_n = {r["assigned_to"]: r["n"] for r in leads.values("assigned_to").annotate(n=Count("id", distinct=True)).order_by()}
    view_n = {r["assigned_to"]: r["n"] for r in viewings.values("assigned_to").annotate(n=Count("id")).order_by()}
    offer_n = {
        r["deal__assigned_to"]: r["n"] for r in offers.values("deal__assigned_to").annotate(n=Count("id")).order_by()
    }
    closed_rows = {
        r["assigned_to"]: r
        for r in closed.values("assigned_to").annotate(n=Count("id"), value=Sum("sale_price")).order_by()
    }
    comm = {
        r["salesperson"]: r["v"]
        for r in qs["commissions"].filter(deal_id__in=closed.values("id")).values("salesperson")
        .annotate(v=Sum("net_commission")).order_by()
    }
    rows = []
    for p in people:
        c = closed_rows.get(p.pk, {})
        rows.append(
            {
                "user_id": p.pk,
                "name": p.full_name,
                "leads": lead_n.get(p.pk, 0),
                "viewings": view_n.get(p.pk, 0),
                "offers": offer_n.get(p.pk, 0),
                "closed_deals": c.get("n", 0),
                "sales_value": c.get("value") or Decimal("0"),
                "commission": comm.get(p.pk) or Decimal("0"),
            }
        )
    rows.sort(key=lambda r: (r["sales_value"], r["closed_deals"], r["leads"]), reverse=True)
    return rows


def series(qs: dict, f: Filters) -> dict:
    leads = _in_range(qs["leads"], "created_at", f)
    funnel = {s: 0 for s, _ in Lead.Status.choices}
    for r in leads.values("status").annotate(n=Count("id", distinct=True)).order_by():
        funnel[r["status"]] = r["n"]

    sources = {s: {"source": s, "label": label, "leads": 0, "closed": 0} for s, label in Lead.Source.choices}
    for r in leads.values("source", "status").annotate(n=Count("id", distinct=True)).order_by():
        sources[r["source"]]["leads"] += r["n"]
        if r["status"] == Lead.Status.CLOSED:
            sources[r["source"]]["closed"] += r["n"]

    month_start = timezone.localdate().replace(day=1)
    default_from = month_start - timedelta(days=31 * 5)
    ranged = Filters(**{**f.__dict__, "date_from": f.date_from or default_from.replace(day=1)})
    created = {
        timezone.localtime(r["m"]).strftime("%Y-%m"): r["n"]
        for r in _in_range(qs["leads"], "created_at", ranged)
        .annotate(m=TruncMonth("created_at")).values("m").annotate(n=Count("id", distinct=True)).order_by()
    }
    closed = {
        timezone.localtime(r["m"]).strftime("%Y-%m"): r
        for r in _in_range(qs["deals"].filter(stage=Deal.Stage.CLOSED), "closed_at", ranged)
        .annotate(m=TruncMonth("closed_at")).values("m").annotate(n=Count("id"), v=Sum("sale_price")).order_by()
    }
    months = sorted(set(created) | set(closed))
    monthly = [
        {
            "month": m,
            "leads": created.get(m, 0),
            "closed_deals": closed.get(m, {}).get("n", 0),
            "sales_value": closed.get(m, {}).get("v") or Decimal("0"),
        }
        for m in months
    ]
    return {"funnel": funnel, "sources": list(sources.values()), "monthly": monthly}
