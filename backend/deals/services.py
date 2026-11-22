from __future__ import annotations

from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.transaction import TransactionManagementError
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

# Stages that move a deal towards a sale. Once a property has a closed deal, no other deal may enter one of them (and no new offer is taken).
SALE_STAGES = (Deal.Stage.OFFER_MADE, Deal.Stage.NEGOTIATION, Deal.Stage.UNDER_CONTRACT, Deal.Stage.CLOSED)
SOLD_MESSAGE = "This property has already been sold in another deal."
LOCK_ATTEMPTS = 3
CLOSED_DEAL_INDEX = "uniq_closed_deal_per_property"  # the partial unique index (deals.0003): one closed deal per property


class DealMoved(Exception):
    """Internal: the deal was moved to another property while its locks were being taken; the attempt is rolled back and repeated."""


def lock_deal(deal: Deal, extra_property_ids=()) -> Property:
    """Take the row locks a sale-related change needs, in ONE fixed order, then re-read under them. Call it first, inside a transaction.

    Order: Property rows (ascending id), then the Deal row. (Lead and Commission rows are only ever touched afterwards, never while waiting for
    a Property or Deal lock.) Because every path that changes a deal's stage or a property's status takes the same order, two of them can queue
    behind each other but can never wait on each other in a circle.

    `deal` is refreshed in place from the locked row, with `deal.property` set to the freshly locked property, so every decision after this call
    is made on current data, not on what the request loaded earlier. A deal that was moved to another property meanwhile is detected and retried.

    Each attempt runs in its own savepoint, so a retry never holds a lock of the attempt before it (a plain loop would: it would then ask for a
    lower property id while holding a higher one, which can deadlock with another request locking the same two rows in the right order).
    Entered with no property or deal row lock held, except the nested call (submit_offer -> move_stage), where the deal row is already ours and
    cannot have moved, so no new property lock is requested. Outside a transaction it raises instead of silently locking nothing.
    """
    if not transaction.get_connection().in_atomic_block:
        raise TransactionManagementError("lock_deal must run inside a transaction.")
    for _ in range(LOCK_ATTEMPTS):
        try:
            property_id = Deal.objects.values_list("property_id", flat=True).get(pk=deal.pk)
        except Deal.DoesNotExist:
            raise BusinessRuleViolation("This deal no longer exists.") from None
        wanted = sorted({property_id, *extra_property_ids})
        try:
            # One attempt = one savepoint. If the deal turns out to have moved, leaving the savepoint with an exception gives back EVERY lock this
            # attempt took (the property rows and the deal row), so the next attempt starts from nothing and can never take a lower property id
            # while still holding a higher one, nor a property row while holding the deal row.
            with transaction.atomic():
                locked = {p.pk: p for p in Property.objects.select_for_update().filter(pk__in=wanted).order_by("pk")}
                try:
                    fresh = Deal.objects.select_for_update().get(pk=deal.pk)
                except Deal.DoesNotExist:
                    raise BusinessRuleViolation("This deal no longer exists.") from None
                if fresh.property_id != property_id:
                    raise DealMoved
        except DealMoved:
            continue
        deal.refresh_from_db()
        deal.property = locked[property_id]
        return locked[property_id]
    raise BusinessRuleViolation("This deal was changed by someone else at the same time. Please try again.")


def sold_in_another_deal(prop: Property, deal: Deal | None = None) -> bool:
    """True when the property already has a closed deal (other than `deal`). Only meaningful under the property's row lock."""
    sold = Deal.objects.filter(property_id=prop.pk, stage=Deal.Stage.CLOSED)
    if deal is not None:
        sold = sold.exclude(pk=deal.pk)
    return sold.exists()


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


@transaction.atomic
def on_viewing_scheduled(viewing, actor) -> None:
    deal, _ = get_or_create_open_deal(viewing.lead, viewing.property, actor, assigned_to=viewing.assigned_to)
    lock_deal(deal)  # decide on the current stage, not on what was read a moment ago
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
    # Property row, then Deal row, then everything is decided on the re-read data (see lock_deal).
    prop = lock_deal(deal)
    if deal.stage == Deal.Stage.CLOSED:
        if stage == Deal.Stage.CLOSED:
            if sale_price is not None and sale_price != deal.sale_price:
                raise BusinessRuleViolation("This deal is already closed; its sale price cannot be changed.")
            return deal  # the same closing sent again (retry, double click): already done, nothing more to do
        raise BusinessRuleViolation("A closed deal cannot be moved.")
    if deal.stage == stage:
        return deal
    if stage == Deal.Stage.LOST and not lost_reason.strip():
        raise BusinessRuleViolation("A reason is required to mark a deal as lost.")
    if stage in SALE_STAGES and sold_in_another_deal(prop, deal):
        raise BusinessRuleViolation(SOLD_MESSAGE)
    if stage == Deal.Stage.CLOSED:
        price = sale_price or deal.offer_amount
        if not price:
            raise BusinessRuleViolation("Record an offer amount (or sale price) before closing the deal.")

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
    try:
        with transaction.atomic():  # a savepoint: a refusal by the database leaves nothing half-written
            deal.save(update_fields=update_fields)
    except IntegrityError as error:
        # The locks above make this unreachable between requests that use this service; it is the answer for a writer that skipped them (the
        # partial unique index uniq_closed_deal_per_property is the net): the same clear 400 as the application's own check, not a 500.
        if getattr(getattr(error.__cause__, "diag", None), "constraint_name", None) == CLOSED_DEAL_INDEX:  # exactly this index, nothing else
            raise BusinessRuleViolation(SOLD_MESSAGE) from None
        raise

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
            prop.status = Property.Status.UNDER_OFFER
        match_status(LeadProperty.Status.OFFER_MADE)
        lead_services.advance_lead_status(lead, Lead.Status.OFFER_MADE, actor)
    elif deal.stage == Deal.Stage.CLOSED:
        Property.objects.filter(pk=prop.pk).update(status=Property.Status.SOLD)
        prop.status = Property.Status.SOLD
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
            prop.status = Property.Status.AVAILABLE
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
    prop = lock_deal(deal)  # before the Offer INSERT, which would otherwise take weaker locks on the same rows first
    if not deal.is_open:
        raise BusinessRuleViolation("Offers can only be recorded on open deals.")
    if sold_in_another_deal(prop, deal):
        raise BusinessRuleViolation(SOLD_MESSAGE + " No new offers can be recorded on it.")
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
    deal = offer.deal
    prop = lock_deal(deal)
    if deal.stage == Deal.Stage.CLOSED:
        raise BusinessRuleViolation("The deal is closed; its offers can no longer be changed.")
    if status == Offer.Status.ACCEPTED and sold_in_another_deal(prop, deal):
        raise BusinessRuleViolation(SOLD_MESSAGE + " An offer on it can no longer be accepted.")
    offer.refresh_from_db()
    offer.status = status
    offer.save(update_fields=["status", "updated_at"])
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
