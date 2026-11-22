"""A completed sale (a closed deal, its commission, offers, documents and history) is never deleted by accident or by a cascade.

Layers, from the outside in:
  * API: deleting a property, a lead, a deal or a document that belongs to a closed deal is refused with a clear message. The refusal is decided
    under the same row locks a closing takes (property rows by id, then the deal rows), so a deletion and a closing that arrive together are
    ordered: either the closing wins (the deletion is refused) or the deletion wins (the closing finds the deal gone).
  * Django admin: the same records cannot be deleted there (single or bulk), see ClosedSaleDeleteGuard and the Deal/Offer/Document admins.
  * ORM: Commission.deal is PROTECT (any deletion that reaches a deal with a commission raises ProtectedError), and a pre_delete guard on Deal
    covers a closed deal whose commission is missing (old or hand-made data). Both are ProtectedError, which the API reports as a 400.
Not covered by design: raw SQL and QuerySet._raw_delete, which skip every Django check.
"""
from django.db import transaction
from django.db.models import ProtectedError

from core.exceptions import BusinessRuleViolation
from properties.models import Property

from .models import Deal
from .services import LOCK_ATTEMPTS, DealMoved

SALE_RECORD_MESSAGE = "This record is linked to a completed sale and cannot be deleted."


def refuse_closed_deal_deletion(deal: Deal, using: str) -> None:
    """pre_delete guard. Reads the CURRENT stage under row locks, taken in the closing's order (the deal's property row, then the deal row): a copy
    loaded before the closing must not be deletable, and a closing that is committing right now is waited for instead of raced.

    The property comes first on purpose. Django's collector locks the deals from here and deletes the property row afterwards; a closing holds the
    property row and then wants a deal. Locking the deal first here would let the two wait on each other (PostgreSQL: "deadlock detected"). The
    collector sorts the deals of one deletion by id, but this guard does not rely on that for safety: every lock it takes follows property, then deal.
    """
    for _ in range(LOCK_ATTEMPTS):
        property_id = Deal.objects.using(using).filter(pk=deal.pk).values_list("property_id", flat=True).first()
        if property_id is None:  # already gone
            return
        try:
            # A savepoint per attempt, inside the collector's own transaction: a retry gives back what the attempt took (the locks the deals of
            # this same deletion took before this one are not touched: they were taken in earlier calls, outside this savepoint).
            with transaction.atomic(using=using):
                Property.objects.using(using).select_for_update().filter(pk=property_id).first()
                row = Deal.objects.using(using).select_for_update().filter(pk=deal.pk).values_list("property_id", "stage").first()
                if row is None:  # deleted meanwhile
                    return
                if row[0] != property_id:  # moved to another property meanwhile
                    raise DealMoved
        except DealMoved:
            continue
        if row[1] == Deal.Stage.CLOSED:
            raise ProtectedError(SALE_RECORD_MESSAGE, {deal})
        return
    raise BusinessRuleViolation("This deal was changed by someone else at the same time. Please try again.")


def lock_sale_records(*, property_id: int | None = None, lead_id: int | None = None) -> list[Deal]:
    """Lock what a deletion of this property (or lead) would cascade into, in the closing's order: the property rows (by id), then the deals.
    Returns the locked deals. Call inside a transaction, before deciding anything."""
    deals = Deal.objects.filter(property_id=property_id) if property_id is not None else Deal.objects.filter(lead_id=lead_id)
    for _ in range(LOCK_ATTEMPTS):
        property_ids = set(deals.values_list("property_id", flat=True))
        if property_id is not None:
            property_ids.add(property_id)
        try:
            # A savepoint per attempt: if a deal turns out to have moved to a property that was not locked, the attempt (property rows AND
            # deal rows) is given back and repeated from nothing, never extended while holding a higher id or the deal rows.
            with transaction.atomic():
                list(Property.objects.select_for_update().filter(pk__in=sorted(property_ids)).order_by("pk"))
                locked = list(deals.select_for_update().order_by("pk"))
                if not {d.property_id for d in locked} <= property_ids:
                    raise DealMoved
        except DealMoved:
            continue
        return locked
    raise BusinessRuleViolation("These records were changed by someone else at the same time. Please try again.")


def refuse_if_sold(deals: list[Deal]) -> None:
    if any(d.stage == Deal.Stage.CLOSED for d in deals):
        raise BusinessRuleViolation(SALE_RECORD_MESSAGE)


class ClosedSaleDeleteGuard:
    """Admin mixin for Property and Lead: no deletion (single or bulk) while one of its deals is closed."""

    def has_delete_permission(self, request, obj=None):
        if obj is not None and obj.deals.filter(stage=Deal.Stage.CLOSED).exists():
            return False
        return super().has_delete_permission(request, obj)
