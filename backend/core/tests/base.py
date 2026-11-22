import os
import shutil
import tempfile
import unittest
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from commissions import services as commission_services
from deals.models import Deal
from documents.models import Document
from leads.models import Lead
from properties.models import Property
from tasks.models import Task
from users.models import Role, User
from viewings.models import Viewing

PASSWORD = "Correct-Horse-9-Battery!"
# A refusal is any 4xx that is not a "not found for a different reason"; a 5xx or a 2xx is never a refusal.
DENIED = {400, 403, 404, 405, 409, 422}


def known_gap(reason: str):
    """Marks a test that asserts the DESIRED behaviour for a gap that exists today.

    It is an expected failure, so the suite stays green and the gap is visible in the report. When the gap is fixed the
    test passes, the runner reports an "unexpected success" (a failure) and the marker must be removed.
    Set RUN_KNOWN_GAPS=1 to run these as ordinary tests and see the raw failures.
    """

    def decorator(fn):
        fn.__doc__ = f"KNOWN GAP: {reason}"
        return fn if os.environ.get("RUN_KNOWN_GAPS") == "1" else unittest.expectedFailure(fn)

    return decorator


def known_bug(reason: str):
    """Like known_gap, for a functional bug (not a permission hole) that makes the test fail for an unrelated reason."""

    def decorator(fn):
        fn.__doc__ = f"KNOWN BUG: {reason}"
        return fn if os.environ.get("RUN_KNOWN_GAPS") == "1" else unittest.expectedFailure(fn)

    return decorator


def make_user(email: str, role: str, **extra) -> User:
    extra.setdefault("first_name", email.split("@")[0].title())
    return User.objects.create_user(email, PASSWORD, role=role, **extra)


def results(response):
    data = response.json()
    return data["results"] if isinstance(data, dict) and "results" in data else data


def ids(response):
    return {row["id"] for row in results(response)}


_MEDIA = tempfile.mkdtemp(prefix="crm-test-media-")


@override_settings(MEDIA_ROOT=_MEDIA)
class ApiTestCase(APITestCase):
    """Three roles, two salespeople, and helpers to build records owned by a given user."""

    @classmethod
    def setUpTestData(cls):
        cls.admin = make_user("admin@t.test", Role.ADMIN)
        cls.manager = make_user("manager@t.test", Role.MANAGER)
        cls.sales_a = make_user("sales.a@t.test", Role.SALESPERSON, commission_split=Decimal("40.00"))
        cls.sales_b = make_user("sales.b@t.test", Role.SALESPERSON)

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(_MEDIA, ignore_errors=True)

    def _pre_setup(self):
        super()._pre_setup()
        cache.clear()  # the login throttle (20/min) lives in the cache and would otherwise leak between tests

    # --- helpers -------------------------------------------------------------------------------------------------
    def as_user(self, user):
        self.client.force_authenticate(user=user)
        return self.client

    def assertDenied(self, response, msg=None):
        self.assertIn(
            response.status_code, DENIED, msg or f"expected a refusal, got {response.status_code}: {response.content[:200]!r}"
        )

    # --- factories -----------------------------------------------------------------------------------------------
    def lead(self, owner, **kw):
        kw.setdefault("first_name", "Lead")
        kw.setdefault("last_name", f"of-{owner.first_name if owner else 'nobody'}")
        kw.setdefault("phone", "0100000000")
        return Lead.objects.create(assigned_to=owner, **kw)

    def prop(self, owner=None, **kw):
        kw.setdefault("title", "Flat")
        kw.setdefault("address", "1 Test St")
        kw.setdefault("city", "Cairo")
        kw.setdefault("price", Decimal("1000000"))
        return Property.objects.create(assigned_to=owner, **kw)

    def deal(self, owner, lead=None, prop=None, **kw):
        kw.setdefault("offer_amount", Decimal("900000"))
        return Deal.objects.create(
            lead=lead or self.lead(owner), property=prop or self.prop(), assigned_to=owner, **kw
        )

    def task(self, owner, lead=None, **kw):
        kw.setdefault("title", "Call back")
        kw.setdefault("due_at", timezone.now() + timedelta(days=1))
        return Task.objects.create(assigned_to=owner, created_by=owner, lead=lead, **kw)

    def viewing(self, owner, lead=None, prop=None, **kw):
        start = timezone.now() + timedelta(days=2)
        kw.setdefault("start_at", start)
        kw.setdefault("end_at", start + timedelta(hours=1))
        return Viewing.objects.create(
            lead=lead or self.lead(owner), property=prop or self.prop(), assigned_to=owner, **kw
        )

    def closed_deal_with_commission(self, owner):
        deal = self.deal(owner, stage=Deal.Stage.CLOSED, sale_price=Decimal("900000"), closed_at=timezone.now())
        return deal, commission_services.create_for_deal(deal, owner)

    def document(self, deal, uploader, name="contract.pdf"):
        return Document.objects.create(
            deal=deal, category=Document.Category.CONTRACT, name=name, uploaded_by=uploader, size=12,
            content_type="application/pdf", file=SimpleUploadedFile(name, b"%PDF-1.4 test", "application/pdf"),
        )
