"""Distributing work is a manager/admin job. Salespeople never reassign anything and never attach records to leads
that are not theirs. Tests marked @known_gap assert the desired rule for a hole that exists today."""
from datetime import timedelta

from django.utils import timezone

from deals.models import Deal
from leads.models import Lead
from properties.models import Property
from tasks.models import Task
from viewings.models import Viewing

from .base import ApiTestCase


def when(days=1):
    return (timezone.now() + timedelta(days=days)).isoformat()


class LeadAssignmentTests(ApiTestCase):
    def test_salesperson_creating_a_lead_always_owns_it(self):
        response = self.as_user(self.sales_a).post(
            "/api/leads/", {"first_name": "Dina", "phone": "0101", "assigned_to_id": self.sales_b.pk}, format="json"
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Lead.objects.get(pk=response.json()["id"]).assigned_to, self.sales_a)

    def test_manager_and_admin_can_create_a_lead_for_anyone(self):
        for actor in (self.manager, self.admin):
            response = self.as_user(actor).post(
                "/api/leads/", {"first_name": "Dina", "phone": "0101", "assigned_to_id": self.sales_b.pk}, format="json"
            )
            self.assertEqual(response.status_code, 201, response.content)
            self.assertEqual(Lead.objects.get(pk=response.json()["id"]).assigned_to, self.sales_b)

    def test_salesperson_cannot_reassign_own_lead(self):
        lead = self.lead(self.sales_a)
        response = self.as_user(self.sales_a).patch(
            f"/api/leads/{lead.pk}/", {"assigned_to_id": self.sales_b.pk}, format="json"
        )
        self.assertDenied(response)
        lead.refresh_from_db()
        self.assertEqual(lead.assigned_to, self.sales_a)

    def test_salesperson_cannot_reassign_own_lead_via_put_either(self):
        lead = self.lead(self.sales_a)
        body = {"first_name": lead.first_name, "phone": lead.phone, "assigned_to_id": self.sales_b.pk}
        response = self.as_user(self.sales_a).put(f"/api/leads/{lead.pk}/", body, format="json")
        self.assertDenied(response)
        lead.refresh_from_db()
        self.assertEqual(lead.assigned_to, self.sales_a)

    def test_salesperson_cannot_use_the_assign_action(self):
        lead = self.lead(self.sales_a)
        response = self.as_user(self.sales_a).post(
            f"/api/leads/{lead.pk}/assign/", {"assigned_to_id": self.sales_b.pk}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        lead.refresh_from_db()
        self.assertEqual(lead.assigned_to, self.sales_a)

    def test_manager_and_admin_can_reassign(self):
        for actor in (self.manager, self.admin):
            lead = self.lead(self.sales_a)
            response = self.as_user(actor).post(
                f"/api/leads/{lead.pk}/assign/", {"assigned_to_id": self.sales_b.pk}, format="json"
            )
            self.assertEqual(response.status_code, 200, response.content)
            lead.refresh_from_db()
            self.assertEqual(lead.assigned_to, self.sales_b)

    def test_only_managers_and_admins_can_delete_leads(self):
        lead = self.lead(self.sales_a)
        self.assertEqual(self.as_user(self.sales_a).delete(f"/api/leads/{lead.pk}/").status_code, 403)
        self.assertTrue(Lead.objects.filter(pk=lead.pk).exists())
        self.assertEqual(self.as_user(self.manager).delete(f"/api/leads/{lead.pk}/").status_code, 204)


class DealAssignmentTests(ApiTestCase):
    """Deal editing used to crash with KeyError('stage') (HTTP 500) and, behind that crash, would let a salesperson
    reassign a deal or attach it to a lead they do not own. All of it is covered here."""

    def setUp(self):
        self.lead_a, self.lead_b = self.lead(self.sales_a), self.lead(self.sales_b)
        self.deal_a = self.deal(self.sales_a, lead=self.lead_a)

    def patch(self, actor, body, deal=None):
        return self.as_user(actor).patch(f"/api/deals/{(deal or self.deal_a).pk}/", body, format="json")

    # ---- create ----
    def test_salesperson_cannot_open_a_deal_on_someone_elses_lead(self):
        response = self.as_user(self.sales_a).post(
            "/api/deals/", {"lead_id": self.lead_b.pk, "property_id": self.prop().pk}, format="json"
        )
        self.assertDenied(response)
        self.assertFalse(Deal.objects.filter(lead=self.lead_b).exists())

    def test_salesperson_deal_is_always_assigned_to_themselves_on_create(self):
        response = self.as_user(self.sales_a).post(
            "/api/deals/",
            {"lead_id": self.lead_a.pk, "property_id": self.prop().pk, "assigned_to_id": self.sales_b.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Deal.objects.get(pk=response.json()["id"]).assigned_to, self.sales_a)

    def test_duplicate_open_deal_is_refused_on_create(self):
        response = self.as_user(self.sales_a).post(
            "/api/deals/", {"lead_id": self.lead_a.pk, "property_id": self.deal_a.property_id}, format="json"
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(Deal.objects.filter(lead=self.lead_a, property=self.deal_a.property).count(), 1)

    # ---- the crash ----
    def test_every_role_can_edit_the_fields_the_deal_page_saves(self):
        """The deal detail page PATCHes expected_close_date and notes. This returned 500 for everyone."""
        for actor in (self.sales_a, self.manager, self.admin):
            with self.subTest(actor=actor.role):
                response = self.patch(actor, {"expected_close_date": "2027-01-31", "notes": f"by {actor.role}"})
                self.assertEqual(response.status_code, 200, response.content)
                self.deal_a.refresh_from_db()
                self.assertEqual(
                    (str(self.deal_a.expected_close_date), self.deal_a.notes), ("2027-01-31", f"by {actor.role}")
                )

    def test_put_with_a_full_payload_also_works(self):
        body = {"lead_id": self.lead_a.pk, "property_id": self.deal_a.property_id, "notes": "full update"}
        response = self.as_user(self.sales_a).put(f"/api/deals/{self.deal_a.pk}/", body, format="json")
        self.assertEqual(response.status_code, 200, response.content)

    def test_stage_cannot_be_changed_through_patch(self):
        """Removing the auto-validator must not make `stage` writable: stages move only through /move/."""
        response = self.patch(self.sales_a, {"stage": "closed", "sale_price": "1", "notes": "x"})
        self.assertEqual(response.status_code, 200, response.content)
        self.deal_a.refresh_from_db()
        self.assertEqual(self.deal_a.stage, Deal.Stage.INTERESTED)
        self.assertIsNone(self.deal_a.sale_price)

    # ---- reassignment ----
    def test_manager_and_admin_can_reassign_a_deal(self):
        for actor in (self.manager, self.admin):
            with self.subTest(actor=actor.role):
                Deal.objects.filter(pk=self.deal_a.pk).update(assigned_to=self.sales_a)
                response = self.patch(actor, {"assigned_to_id": self.sales_b.pk})
                self.assertEqual(response.status_code, 200, response.content)
                self.deal_a.refresh_from_db()
                self.assertEqual(self.deal_a.assigned_to, self.sales_b)

    def test_salesperson_cannot_reassign_a_deal_via_patch_or_put(self):
        response = self.patch(self.sales_a, {"assigned_to_id": self.sales_b.pk})
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("Only managers can reassign", response.content.decode())
        body = {"lead_id": self.lead_a.pk, "property_id": self.deal_a.property_id, "assigned_to_id": self.sales_b.pk}
        put = self.as_user(self.sales_a).put(f"/api/deals/{self.deal_a.pk}/", body, format="json")
        self.assertEqual(put.status_code, 400)
        self.deal_a.refresh_from_db()
        self.assertEqual(self.deal_a.assigned_to, self.sales_a)

    def test_salesperson_may_resend_their_own_assignment_unchanged(self):
        """A client that echoes assigned_to_id back must not be punished for it."""
        self.assertEqual(self.patch(self.sales_a, {"assigned_to_id": self.sales_a.pk, "notes": "n"}).status_code, 200)

    def test_salesperson_cannot_edit_someone_elses_deal_at_all(self):
        response = self.patch(self.sales_b, {"notes": "hijack"})
        self.assertEqual(response.status_code, 404)
        self.deal_a.refresh_from_db()
        self.assertNotEqual(self.deal_a.notes, "hijack")

    # ---- re-linking a deal to another lead ----
    def test_salesperson_cannot_point_a_deal_at_someone_elses_lead(self):
        response = self.patch(self.sales_a, {"lead_id": self.lead_b.pk})
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("your own leads", response.content.decode())
        self.deal_a.refresh_from_db()
        self.assertEqual(self.deal_a.lead, self.lead_a)

    def test_salesperson_may_point_a_deal_at_another_of_their_own_leads(self):
        other_own = self.lead(self.sales_a, first_name="Other")
        self.assertEqual(self.patch(self.sales_a, {"lead_id": other_own.pk}).status_code, 200)
        self.deal_a.refresh_from_db()
        self.assertEqual(self.deal_a.lead, other_own)

    def test_manager_and_admin_may_point_a_deal_at_any_lead(self):
        for actor in (self.manager, self.admin):
            with self.subTest(actor=actor.role):
                Deal.objects.filter(pk=self.deal_a.pk).update(lead=self.lead_a)
                self.assertEqual(self.patch(actor, {"lead_id": self.lead_b.pk}).status_code, 200)

    def test_relinking_cannot_create_a_duplicate_open_deal(self):
        """Without the explicit check this would hit the database constraint and return 500."""
        other_own = self.lead(self.sales_a, first_name="Other")
        self.deal(self.sales_a, lead=other_own, prop=self.deal_a.property)
        response = self.patch(self.sales_a, {"lead_id": other_own.pk})
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("already an open deal", response.content.decode())
        self.deal_a.refresh_from_db()
        self.assertEqual(self.deal_a.lead, self.lead_a)

    def test_changing_the_property_cannot_create_a_duplicate_open_deal(self):
        second = self.prop(title="Second")
        self.deal(self.sales_a, lead=self.lead_a, prop=second)
        response = self.patch(self.sales_a, {"property_id": second.pk})
        self.assertEqual(response.status_code, 400, response.content)

    def test_the_database_still_enforces_one_open_deal_per_lead_and_property(self):
        from django.db import IntegrityError, transaction

        with self.assertRaises(IntegrityError), transaction.atomic():
            Deal.objects.create(lead=self.lead_a, property=self.deal_a.property, assigned_to=self.sales_a)

    # ---- delete and closed deals ----
    def test_only_managers_and_admins_can_delete_deals(self):
        self.assertEqual(self.as_user(self.sales_a).delete(f"/api/deals/{self.deal_a.pk}/").status_code, 403)
        self.assertTrue(Deal.objects.filter(pk=self.deal_a.pk).exists())
        self.assertEqual(self.as_user(self.manager).delete(f"/api/deals/{self.deal_a.pk}/").status_code, 204)

    def test_closed_deals_are_read_only_for_everyone(self):
        closed = self.deal(self.sales_a, stage=Deal.Stage.CLOSED, sale_price=1, closed_at=timezone.now())
        for actor in (self.sales_a, self.manager, self.admin):
            with self.subTest(actor=actor.role):
                response = self.patch(actor, {"notes": "edit"}, deal=closed)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("can no longer be edited", response.content.decode())


class TaskAssignmentTests(ApiTestCase):
    """A task belongs to one salesperson. Only managers and admins hand tasks to others, and a salesperson may only
    link a task to a lead or a deal that is theirs. Checked on create, PATCH and PUT."""

    def setUp(self):
        self.own_lead, self.foreign_lead = self.lead(self.sales_a), self.lead(self.sales_b)
        self.own_deal, self.foreign_deal = self.deal(self.sales_a), self.deal(self.sales_b)
        self.task_a = self.task(self.sales_a, lead=self.own_lead)

    def body(self, **extra):
        return {"title": "Call", "due_at": when(), "type": "call", **extra}

    def patch(self, actor, body, task=None):
        return self.as_user(actor).patch(f"/api/tasks/{(task or self.task_a).pk}/", body, format="json")

    def put(self, actor, body, task=None):
        return self.as_user(actor).put(f"/api/tasks/{(task or self.task_a).pk}/", body, format="json")

    # ---- create ----
    def test_salesperson_task_is_always_assigned_to_themselves(self):
        response = self.as_user(self.sales_a).post("/api/tasks/", self.body(assigned_to_id=self.sales_b.pk), format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Task.objects.get(pk=response.json()["id"]).assigned_to, self.sales_a)

    def test_salesperson_cannot_create_a_task_on_someone_elses_lead_or_deal(self):
        client = self.as_user(self.sales_a)
        self.assertDenied(client.post("/api/tasks/", self.body(lead_id=self.foreign_lead.pk), format="json"))
        self.assertDenied(client.post("/api/tasks/", self.body(deal_id=self.foreign_deal.pk), format="json"))
        self.assertEqual(Task.objects.filter(assigned_to=self.sales_a).count(), 1)  # only the one from setUp

    def test_salesperson_can_create_a_task_on_their_own_lead_and_deal(self):
        response = self.as_user(self.sales_a).post(
            "/api/tasks/", self.body(lead_id=self.own_lead.pk, deal_id=self.own_deal.pk), format="json"
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_manager_and_admin_can_create_a_task_for_anyone_on_any_lead_or_deal(self):
        for actor in (self.manager, self.admin):
            with self.subTest(actor=actor.role):
                response = self.as_user(actor).post(
                    "/api/tasks/",
                    self.body(assigned_to_id=self.sales_b.pk, lead_id=self.foreign_lead.pk, deal_id=self.foreign_deal.pk),
                    format="json",
                )
                self.assertEqual(response.status_code, 201, response.content)
                self.assertEqual(Task.objects.get(pk=response.json()["id"]).assigned_to, self.sales_b)

    # ---- reassignment on update ----
    def test_salesperson_cannot_reassign_a_task_via_patch_or_put(self):
        for method, call in (("PATCH", self.patch), ("PUT", self.put)):
            with self.subTest(method=method):
                body = {"assigned_to_id": self.sales_b.pk} if method == "PATCH" else self.body(assigned_to_id=self.sales_b.pk)
                response = call(self.sales_a, body)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("Only managers can reassign tasks", response.content.decode())
        self.task_a.refresh_from_db()
        self.assertEqual(self.task_a.assigned_to, self.sales_a)

    def test_salesperson_may_resend_their_own_assignment_unchanged(self):
        self.assertEqual(self.patch(self.sales_a, {"assigned_to_id": self.sales_a.pk, "title": "t"}).status_code, 200)

    def test_manager_and_admin_can_reassign_a_task(self):
        for actor in (self.manager, self.admin):
            with self.subTest(actor=actor.role):
                Task.objects.filter(pk=self.task_a.pk).update(assigned_to=self.sales_a)
                self.assertEqual(self.patch(actor, {"assigned_to_id": self.sales_b.pk}).status_code, 200)
                self.task_a.refresh_from_db()
                self.assertEqual(self.task_a.assigned_to, self.sales_b)

    # ---- linking on update ----
    def test_salesperson_cannot_link_a_task_to_someone_elses_lead_via_patch_or_put(self):
        for method, call in (("PATCH", self.patch), ("PUT", self.put)):
            with self.subTest(method=method):
                body = {"lead_id": self.foreign_lead.pk} if method == "PATCH" else self.body(lead_id=self.foreign_lead.pk)
                response = call(self.sales_a, body)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("your own leads", response.content.decode())
        self.task_a.refresh_from_db()
        self.assertEqual(self.task_a.lead, self.own_lead)

    def test_salesperson_cannot_link_a_task_to_someone_elses_deal_via_patch_or_put(self):
        for method, call in (("PATCH", self.patch), ("PUT", self.put)):
            with self.subTest(method=method):
                body = {"deal_id": self.foreign_deal.pk} if method == "PATCH" else self.body(deal_id=self.foreign_deal.pk)
                response = call(self.sales_a, body)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("your own deals", response.content.decode())
        self.task_a.refresh_from_db()
        self.assertIsNone(self.task_a.deal)

    def test_salesperson_can_still_relink_unlink_and_resend_their_own_links(self):
        other_own = self.lead(self.sales_a, first_name="Other")
        self.assertEqual(self.patch(self.sales_a, {"lead_id": other_own.pk}).status_code, 200)
        self.assertEqual(self.patch(self.sales_a, {"lead_id": other_own.pk, "title": "same lead again"}).status_code, 200)
        self.assertEqual(self.patch(self.sales_a, {"lead_id": None}).status_code, 200)
        self.assertEqual(self.patch(self.sales_a, {"deal_id": self.own_deal.pk}).status_code, 200)
        self.task_a.refresh_from_db()
        self.assertEqual((self.task_a.lead, self.task_a.deal), (None, self.own_deal))

    def test_a_task_already_linked_by_a_manager_stays_editable_by_its_salesperson(self):
        """The task form re-sends lead_id/deal_id unchanged on every save; that must not be refused."""
        task = self.task(self.sales_a, lead=self.foreign_lead, deal=self.foreign_deal)
        response = self.patch(self.sales_a, {"lead_id": self.foreign_lead.pk, "deal_id": self.foreign_deal.pk, "title": "t2"}, task)
        self.assertEqual(response.status_code, 200, response.content)

    def test_manager_and_admin_can_link_a_task_to_any_lead_or_deal(self):
        for actor in (self.manager, self.admin):
            with self.subTest(actor=actor.role):
                body = {"lead_id": self.foreign_lead.pk, "deal_id": self.foreign_deal.pk}
                self.assertEqual(self.patch(actor, body).status_code, 200)

    def test_ordinary_task_edits_and_completion_still_work_for_the_owner(self):
        self.assertEqual(self.patch(self.sales_a, {"title": "Renamed", "due_at": when(3)}).status_code, 200)
        self.assertEqual(self.as_user(self.sales_a).post(f"/api/tasks/{self.task_a.pk}/complete/").status_code, 200)
        self.assertEqual(self.as_user(self.sales_a).post(f"/api/tasks/{self.task_a.pk}/reopen/").status_code, 200)

    def test_salesperson_cannot_touch_someone_elses_task(self):
        theirs = self.task(self.sales_b)
        for call, body in ((self.patch, {"title": "x"}), (self.put, self.body())):
            self.assertEqual(call(self.sales_a, body, theirs).status_code, 404)


class ViewingAssignmentTests(ApiTestCase):
    """Checked on create, PATCH and PUT. Rescheduling and property changes stay open to the viewing's owner."""

    def setUp(self):
        self.own_lead, self.foreign_lead = self.lead(self.sales_a), self.lead(self.sales_b)
        self.viewing_a = self.viewing(self.sales_a, lead=self.own_lead)

    def slot(self, days=5):
        start = timezone.now() + timedelta(days=days)
        return {"start_at": start.isoformat(), "end_at": (start + timedelta(hours=1)).isoformat()}

    def put_body(self, **extra):
        return {"lead_id": self.own_lead.pk, "property_id": self.viewing_a.property_id, **self.slot(), **extra}

    def patch(self, actor, body, viewing=None):
        return self.as_user(actor).patch(f"/api/viewings/{(viewing or self.viewing_a).pk}/", body, format="json")

    def put(self, actor, body, viewing=None):
        return self.as_user(actor).put(f"/api/viewings/{(viewing or self.viewing_a).pk}/", body, format="json")

    def test_salesperson_cannot_schedule_a_viewing_for_someone_elses_lead(self):
        response = self.as_user(self.sales_a).post(
            "/api/viewings/", {"lead_id": self.foreign_lead.pk, "property_id": self.prop().pk, **self.slot(3)}, format="json"
        )
        self.assertDenied(response)
        self.assertFalse(Viewing.objects.filter(lead=self.foreign_lead).exists())

    def test_salesperson_viewing_is_always_assigned_to_themselves_on_create(self):
        response = self.as_user(self.sales_a).post(
            "/api/viewings/",
            {"lead_id": self.own_lead.pk, "property_id": self.prop().pk, "assigned_to_id": self.sales_b.pk, **self.slot(3)},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Viewing.objects.get(pk=response.json()["id"]).assigned_to, self.sales_a)

    def test_salesperson_cannot_reassign_a_viewing_via_patch_or_put(self):
        for method, call in (("PATCH", self.patch), ("PUT", self.put)):
            with self.subTest(method=method):
                body = {"assigned_to_id": self.sales_b.pk} if method == "PATCH" else self.put_body(assigned_to_id=self.sales_b.pk)
                response = call(self.sales_a, body)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("Only managers can reassign viewings", response.content.decode())
        self.viewing_a.refresh_from_db()
        self.assertEqual(self.viewing_a.assigned_to, self.sales_a)

    def test_salesperson_cannot_point_a_viewing_at_someone_elses_lead_via_patch_or_put(self):
        for method, call in (("PATCH", self.patch), ("PUT", self.put)):
            with self.subTest(method=method):
                body = {"lead_id": self.foreign_lead.pk}
                if method == "PUT":
                    body = {**self.put_body(), "lead_id": self.foreign_lead.pk}
                response = call(self.sales_a, body)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("your own leads", response.content.decode())
        self.viewing_a.refresh_from_db()
        self.assertEqual(self.viewing_a.lead, self.own_lead)

    def test_salesperson_can_still_reschedule_change_property_and_resend_unchanged_values(self):
        new_prop = self.prop(title="Other flat")
        self.assertEqual(self.patch(self.sales_a, self.slot(7)).status_code, 200)
        self.assertEqual(self.patch(self.sales_a, {"property_id": new_prop.pk}).status_code, 200)
        self.assertEqual(
            self.patch(self.sales_a, {"assigned_to_id": self.sales_a.pk, "lead_id": self.own_lead.pk, **self.slot(8)}).status_code,
            200,
        )
        other_own = self.lead(self.sales_a, first_name="Other")
        self.assertEqual(self.patch(self.sales_a, {"lead_id": other_own.pk}).status_code, 200)
        self.assertEqual(self.put(self.sales_a, self.put_body(lead_id=other_own.pk, assigned_to_id=self.sales_a.pk)).status_code, 200)

    def test_manager_and_admin_can_reassign_and_relink_a_viewing(self):
        for actor in (self.manager, self.admin):
            with self.subTest(actor=actor.role):
                Viewing.objects.filter(pk=self.viewing_a.pk).update(assigned_to=self.sales_a, lead=self.own_lead)
                body = {"assigned_to_id": self.sales_b.pk, "lead_id": self.foreign_lead.pk}
                self.assertEqual(self.patch(actor, body).status_code, 200)
                self.viewing_a.refresh_from_db()
                self.assertEqual((self.viewing_a.assigned_to, self.viewing_a.lead), (self.sales_b, self.foreign_lead))

    def test_salesperson_cannot_touch_someone_elses_viewing(self):
        theirs = self.viewing(self.sales_b)
        self.assertEqual(self.patch(self.sales_a, self.slot(9), theirs).status_code, 404)
        self.assertEqual(self.put(self.sales_a, self.put_body(), theirs).status_code, 404)

    def test_completed_viewings_still_cannot_be_rescheduled(self):
        done = self.viewing(self.sales_a, status=Viewing.Status.COMPLETED)
        self.assertEqual(self.patch(self.sales_a, self.slot(9), done).status_code, 400)


class PropertyPermissionTests(ApiTestCase):
    """Properties are a shared catalogue. Salespeople add and edit them, but only managers and admins decide who owns
    one. Checked on create, PATCH and PUT, including clearing the owner."""

    PAYLOAD = {"title": "Villa", "address": "2 Palm St", "city": "Giza", "price": "2500000"}

    def patch(self, actor, prop, body):
        return self.as_user(actor).patch(f"/api/properties/{prop.pk}/", body, format="json")

    def put(self, actor, prop, body):
        return self.as_user(actor).put(f"/api/properties/{prop.pk}/", {**self.PAYLOAD, **body}, format="json")

    def test_every_role_can_see_the_shared_catalogue(self):
        prop = self.prop(self.sales_b)
        for actor in (self.sales_a, self.manager, self.admin):
            self.assertEqual(self.as_user(actor).get(f"/api/properties/{prop.pk}/").status_code, 200)

    def test_salesperson_edits_only_unassigned_or_own_properties(self):
        own, unassigned, foreign = self.prop(self.sales_a), self.prop(None), self.prop(self.sales_b)
        self.assertEqual(self.patch(self.sales_a, own, {"title": "x"}).status_code, 200)
        self.assertEqual(self.patch(self.sales_a, unassigned, {"title": "x"}).status_code, 200)
        self.assertEqual(self.patch(self.sales_a, foreign, {"title": "x"}).status_code, 403)
        self.assertEqual(self.put(self.sales_a, foreign, {"title": "x"}).status_code, 403)

    def test_only_managers_and_admins_can_delete_properties(self):
        prop = self.prop(self.sales_a)
        self.assertEqual(self.as_user(self.sales_a).delete(f"/api/properties/{prop.pk}/").status_code, 403)
        self.assertEqual(self.as_user(self.manager).delete(f"/api/properties/{prop.pk}/").status_code, 204)

    # ---- create ----
    def test_a_property_added_by_a_salesperson_is_always_theirs(self):
        for extra in ({}, {"assigned_to_id": self.sales_a.pk}, {"assigned_to_id": self.sales_b.pk}, {"assigned_to_id": None}):
            with self.subTest(extra=extra):
                response = self.as_user(self.sales_a).post("/api/properties/", {**self.PAYLOAD, **extra}, format="json")
                self.assertEqual(response.status_code, 201, response.content)
                self.assertEqual(Property.objects.get(pk=response.json()["id"]).assigned_to, self.sales_a)

    def test_manager_and_admin_choose_the_owner_of_a_new_property(self):
        for actor in (self.manager, self.admin):
            with self.subTest(actor=actor.role):
                chosen = self.as_user(actor).post("/api/properties/", {**self.PAYLOAD, "assigned_to_id": self.sales_b.pk}, format="json")
                self.assertEqual(Property.objects.get(pk=chosen.json()["id"]).assigned_to, self.sales_b)
                unassigned = self.as_user(actor).post("/api/properties/", self.PAYLOAD, format="json")
                self.assertIsNone(Property.objects.get(pk=unassigned.json()["id"]).assigned_to)

    # ---- update ----
    def test_salesperson_cannot_reassign_unassign_or_claim_a_property_via_patch_or_put(self):
        own, unassigned = self.prop(self.sales_a), self.prop(None)
        attempts = [(own, {"assigned_to_id": self.sales_b.pk}), (own, {"assigned_to_id": None}),
                    (unassigned, {"assigned_to_id": self.sales_a.pk})]
        for prop, body in attempts:
            for name, call in (("PATCH", self.patch), ("PUT", self.put)):
                with self.subTest(method=name, body=body):
                    before = prop.assigned_to
                    response = call(self.sales_a, prop, body)
                    self.assertEqual(response.status_code, 400, response.content)
                    self.assertIn("Only managers can reassign properties", response.content.decode())
                    prop.refresh_from_db()
                    self.assertEqual(prop.assigned_to, before)

    def test_salesperson_may_resend_the_current_owner_and_edit_other_fields(self):
        own = self.prop(self.sales_a)
        self.assertEqual(self.patch(self.sales_a, own, {"assigned_to_id": self.sales_a.pk, "price": "3000000"}).status_code, 200)
        self.assertEqual(self.put(self.sales_a, own, {"assigned_to_id": self.sales_a.pk, "city": "Cairo"}).status_code, 200)
        unassigned = self.prop(None)
        self.assertEqual(self.patch(self.sales_a, unassigned, {"assigned_to_id": None, "title": "t"}).status_code, 200)
        own.refresh_from_db()
        self.assertEqual(str(own.price), "2500000.00")  # the PUT payload's price won; both edits applied

    def test_manager_and_admin_can_reassign_unassign_and_assign_a_property(self):
        for actor in (self.manager, self.admin):
            with self.subTest(actor=actor.role):
                prop = self.prop(self.sales_a)
                self.assertEqual(self.patch(actor, prop, {"assigned_to_id": self.sales_b.pk}).status_code, 200)
                prop.refresh_from_db()
                self.assertEqual(prop.assigned_to, self.sales_b)
                self.assertEqual(self.patch(actor, prop, {"assigned_to_id": None}).status_code, 200)
                prop.refresh_from_db()
                self.assertIsNone(prop.assigned_to)
                self.assertEqual(self.put(actor, prop, {"assigned_to_id": self.sales_a.pk}).status_code, 200)
