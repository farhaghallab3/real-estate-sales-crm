from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from core.exceptions import BusinessRuleViolation
from core.models import Activity
from core.services import log_activity
from leads import services as lead_services
from leads.models import Lead, LeadProperty
from notifications.models import Notification
from notifications.services import notify
from properties.models import Property
from users.models import User

from .models import Deal, Offer

STAGE_ORDER = {s: i for i, s in enumerate(Deal.PIPELINE_ORDER)}


def _managers():
    return list(User.objects.filter(role__in=["admin", "manager"], is_active=True))


def get_or_create_open_deal(lead: Lead, prop: Property, actor, assigned_to=None) -> tuple[Deal, bool]:
    deal = Deal.objects.filter(lead=lead, property=prop).exclude(stage__in=Deal.TERMINAL_STAGES).first()
    if deal:
        return deal, False
    deal = Deal.objects.create(
        lead=lead,
        property=prop,
        assigned_to=assigned_to or lead.assigned_to or actor,
        stage=Deal.Stage.INTERESTED,
    )
    log_activity(
        actor=actor,
        kind=Activity.Kind.DEAL_CREATED,
        message=f"Deal opened: {lead.name} · {prop.title}",
        deal=deal,
    )
    match, created = LeadProperty.objects.get_or_create(lead=lead, property=prop, defaults={"added_by": actor})
    if not created and match.status in (LeadProperty.Status.SUGGESTED, LeadProperty.Status.REJECTED):
        lead_services.set_match_status(match, LeadProperty.Status.INTERESTED, actor)
    return deal, True


def on_viewing_scheduled(viewing, actor) -> None:
    deal, _ = get_or_create_open_deal(viewing.lead, viewing.property, actor, assigned_to=viewing.assigned_to)
    if deal.stage == Deal.Stage.INTERESTED:
        move_stage(deal, Deal.Stage.VIEWING, actor)


@transaction.atomic
def move_stage(
    deal: Deal,
    stage: str,
    actor,
    *,
    lost_reason: str = "",
    sale_price: Decimal | None = None,
) -> Deal:
    if stage not in Deal.Stage.values:
        raise BusinessRuleViolation(f"Unknown stage '{stage}'.")
    if deal.stage == Deal.Stage.CLOSED:
        raise BusinessRuleViolation("A closed deal cannot be moved.")
    if deal.stage == stage:
        return deal
    if stage == Deal.Stage.LOST and not lost_reason.strip():
        raise BusinessRuleViolation("A reason is required to mark a deal as lost.")
    if stage in (Deal.Stage.CLOSED,):
        price = sale_price or deal.offer_amount
        if not price:
            raise BusinessRuleViolation("Record an offer amount (or sale price) before closing the deal.")
        # Another open deal may not already own the property.
        if Deal.objects.filter(property=deal.property, stage=Deal.Stage.CLOSED).exclude(pk=deal.pk).exists():
            raise BusinessRuleViolation("This property has already been sold in another deal.")

    old_label = deal.get_stage_display()
    deal.stage = stage
    update_fields = ["stage", "updated_at"]

    if stage == Deal.Stage.CLOSED:
        deal.sale_price = sale_price or deal.offer_amount
        deal.closed_at = timezone.now()
        deal.lost_reason = ""
        update_fields += ["sale_price", "closed_at", "lost_reason"]
    elif stage == Deal.Stage.LOST:
        deal.lost_reason = lost_reason.strip()
        deal.closed_at = timezone.now()
        update_fields += ["lost_reason", "closed_at"]
    else:
        deal.closed_at = None
        deal.lost_reason = ""
        update_fields += ["closed_at", "lost_reason"]
    deal.save(update_fields=update_fields)

    _sync_related(deal, actor)

    kind = {
        Deal.Stage.CLOSED: Activity.Kind.DEAL_CLOSED,
        Deal.Stage.LOST: Activity.Kind.DEAL_LOST,
    }.get(stage, Activity.Kind.DEAL_MOVED)
    log_activity(
        actor=actor,
        kind=kind,
        message=f"{deal.lead.name} · {deal.property.title}: {old_label} → {deal.get_stage_display()}",
        deal=deal,
    )
    notify(
        [deal.assigned_to] + _managers(),
        kind=Notification.Kind.DEAL_STATUS,
        title=f"Deal moved to {deal.get_stage_display()}",
        body=f"{deal.lead.name} · {deal.property.title}",
        link=f"/deals/{deal.pk}",
        actor=actor,
    )
    if stage == Deal.Stage.UNDER_CONTRACT:
        _warn_missing_documents(deal, actor)
    return deal


def _sync_related(deal: Deal, actor) -> None:
    """Keep property, lead and match statuses consistent with the deal stage."""
    prop, lead = deal.property, deal.lead
    match = LeadProperty.objects.filter(lead=lead, property=prop).first()

    def match_status(status):
        if match and match.status != status:
            lead_services.set_match_status(match, status, actor, deal.lost_reason if status == "rejected" else "")

    if deal.stage in (Deal.Stage.OFFER_MADE, Deal.Stage.NEGOTIATION, Deal.Stage.UNDER_CONTRACT):
        if prop.status in (Property.Status.AVAILABLE, Property.Status.RESERVED):
            Property.objects.filter(pk=prop.pk).update(status=Property.Status.UNDER_OFFER)
        match_status(LeadProperty.Status.OFFER_MADE)
        lead_services.advance_lead_status(lead, Lead.Status.OFFER_MADE, actor)
    elif deal.stage == Deal.Stage.CLOSED:
        Property.objects.filter(pk=prop.pk).update(status=Property.Status.SOLD)
        match_status(LeadProperty.Status.PURCHASED)
        lead_services.change_status(lead, Lead.Status.CLOSED, actor)
        from commissions.services import create_for_deal

        create_for_deal(deal, actor)
    elif deal.stage == Deal.Stage.LOST:
        match_status(LeadProperty.Status.REJECTED)
        others = Deal.objects.filter(property=prop).exclude(pk=deal.pk).exclude(stage__in=Deal.TERMINAL_STAGES)
        later = others.filter(stage__in=["offer_made", "negotiation", "under_contract"]).exists()
        if prop.status == Property.Status.UNDER_OFFER and not later:
            Property.objects.filter(pk=prop.pk).update(status=Property.Status.AVAILABLE)
    elif deal.stage == Deal.Stage.VIEWING:
        match_status(LeadProperty.Status.VIEWING_SCHEDULED)
        lead_services.advance_lead_status(lead, Lead.Status.VIEWING, actor)
    elif deal.stage == Deal.Stage.INTERESTED:
        if match and match.status in (LeadProperty.Status.SUGGESTED, LeadProperty.Status.REJECTED):
            match_status(LeadProperty.Status.INTERESTED)


def _warn_missing_documents(deal: Deal, actor) -> None:
    from documents.services import missing_categories

    missing = missing_categories(deal)
    if missing:
        notify(
            [deal.assigned_to],
            kind=Notification.Kind.DOCUMENT_MISSING,
            title=f"Required documents missing: {deal.property.title}",
            body=", ".join(label for _, label in missing),
            link=f"/deals/{deal.pk}",
            actor=actor,
        )


@transaction.atomic
def submit_offer(deal: Deal, amount: Decimal, actor, conditions: str = "", notes: str = "") -> Offer:
    if not deal.is_open:
        raise BusinessRuleViolation("Offers can only be recorded on open deals.")
    offer = Offer.objects.create(
        deal=deal, lead=deal.lead, property=deal.property, amount=amount, conditions=conditions, notes=notes,
        submitted_by=actor,
    )
    deal.offer_amount = amount
    deal.save(update_fields=["offer_amount", "updated_at"])
    log_activity(
        actor=actor,
        kind=Activity.Kind.OFFER_SUBMITTED,
        message=f"Offer of {amount:,.0f} submitted by {deal.lead.name} for {deal.property.title}",
        deal=deal,
    )
    if STAGE_ORDER[deal.stage] < STAGE_ORDER[Deal.Stage.OFFER_MADE]:
        move_stage(deal, Deal.Stage.OFFER_MADE, actor)
    return offer


@transaction.atomic
def set_offer_status(offer: Offer, status: str, actor) -> Offer:
    offer.status = status
    offer.save(update_fields=["status", "updated_at"])
    deal = offer.deal
    if status == Offer.Status.ACCEPTED:
        deal.offer_amount = offer.amount
        deal.save(update_fields=["offer_amount", "updated_at"])
        if STAGE_ORDER.get(deal.stage, 99) < STAGE_ORDER[Deal.Stage.UNDER_CONTRACT]:
            move_stage(deal, Deal.Stage.UNDER_CONTRACT, actor)
    log_activity(
        actor=actor,
        kind=Activity.Kind.OFFER_SUBMITTED,
        message=f"Offer of {offer.amount:,.0f} marked {offer.get_status_display().lower()}",
        deal=deal,
    )
    return offer
