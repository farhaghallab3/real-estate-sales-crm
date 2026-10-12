"""Seed realistic demo data by driving the real service layer, then spreading timestamps over time."""
from __future__ import annotations

import os
import random
from datetime import timedelta
from decimal import Decimal

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from commissions import services as commission_services
from commissions.models import Commission
from core.models import Activity
from deals import services as deal_services
from deals.models import Deal, Offer
from documents.models import Document
from leads import services as lead_services
from leads.models import Lead, LeadProperty
from notifications.services import notify_overdue_tasks
from properties.models import Property
from tasks.models import Task
from users.models import Role, User
from viewings import services as viewing_services
from viewings.models import Viewing

LOCATIONS = ["Midtown", "Riverside", "Harbor District", "Lakeview", "Westfield Heights", "Old Town", "Northgate"]
BUILDINGS = {
    "Midtown": ["Parkline Residences", "The Meridian", "Elm Court"],
    "Riverside": ["Riverside Lofts", "Willow Bend", "The Quay"],
    "Harbor District": ["Anchor Point", "Pier 9 Towers", "Marlow Wharf"],
    "Lakeview": ["Lakeview Terraces", "Birchwood Estate", "Cedar Shore"],
    "Westfield Heights": ["Westfield Grove", "Hilltop Villas", "Summit Row"],
    "Old Town": ["Cobblestone Mews", "The Foundry", "Guild Hall Flats"],
    "Northgate": ["Northgate Commons", "Aspen Park", "Fieldstone Homes"],
}
PEOPLE = [
    ("Olivia", "Hartman"), ("Noah", "Whitfield"), ("Amara", "Okonkwo"), ("Liam", "Castellano"),
    ("Mei", "Tanaka"), ("Ethan", "Brooks"), ("Isabella", "Moreau"), ("Lucas", "Fernandes"),
    ("Hannah", "Lindqvist"), ("Omar", "Haddad"), ("Chloe", "Fitzgerald"), ("Mateo", "Vargas"),
    ("Grace", "Nakamura"), ("Jonas", "Weber"), ("Zara", "Qureshi"), ("Caleb", "Sutherland"),
    ("Nina", "Petrov"), ("Samuel", "Adeyemi"), ("Lena", "Hoffmann"), ("Rafael", "Duarte"),
    ("Evelyn", "Cho"), ("Victor", "Almeida"), ("Priscilla", "Ng"), ("Henry", "Calloway"),
    ("Tessa", "Brandt"), ("Arjun", "Mehta"), ("Fiona", "McAllister"), ("Diego", "Santoro"),
    ("Camille", "Laurent"), ("Wesley", "Ortiz"), ("Yasmin", "Farouk"), ("Patrick", "Doyle"),
    ("Sienna", "Rossi"), ("Gabriel", "Nwosu"), ("Ingrid", "Solberg"), ("Kenji", "Watanabe"),
    ("Layla", "Mansour"), ("Oscar", "Lindgren"), ("Bianca", "Ferreira"), ("Theo", "Bennett"),
    ("Anika", "Sharma"), ("Felix", "Kruger"), ("Rosa", "Delgado"), ("Idris", "Campbell"),
    ("Mara", "Voss"), ("Declan", "Murphy"),
]
REJECT_REASONS = ["Too expensive", "Wrong neighbourhood", "Too small", "Needs major renovation", "Noisy street"]
LOST_REASONS = ["Bought elsewhere", "Financing fell through", "Decided to keep renting", "Stopped responding"]
FEEDBACK = [
    ("Loved the natural light, concerned about parking.", 4),
    ("Layout works well. Wants a second opinion on the kitchen.", 4),
    ("Too dark and smaller than expected.", 2),
    ("Very interested — asked about offer process.", 5),
    ("Good location but above budget.", 3),
]


class Command(BaseCommand):
    help = "Seed demo users, leads, properties, viewings, deals and commissions (no-op if data exists)."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Seed even if leads already exist")

    @transaction.atomic
    def handle(self, *args, **options):
        from django.conf import settings

        if not settings.DEBUG and not options["force"]:
            self.stderr.write("Refusing to seed demo data outside DEBUG mode (use --force to override).")
            return
        if Lead.objects.exists() and not options["force"]:
            self.stdout.write("Demo data already present — skipping.")
            return
        self.rng = random.Random(7)
        self.now = timezone.now()
        password = os.environ.get("DEMO_PASSWORD") or "ChangeMe123!"
        self.users = self._users(password)
        self.sales = [u for u in self.users if u.role == Role.SALESPERSON]
        self.manager = next(u for u in self.users if u.role == Role.MANAGER)
        self.props = self._properties()
        self._leads()
        self._finalize()
        self.stdout.write(self.style.SUCCESS(
            f"Seeded {User.objects.count()} users, {Property.objects.count()} properties, {Lead.objects.count()} "
            f"leads, {Deal.objects.count()} deals."
        ))
        self.stdout.write("Demo logins (password from DEMO_PASSWORD): " + ", ".join(u.email for u in self.users))

    # ---- builders -------------------------------------------------------------------------------------
    def _users(self, password: str) -> list[User]:
        spec = [
            ("admin@crm.local", "Elena", "Marsh", Role.ADMIN, "Operations Director", 0),
            ("manager@crm.local", "Daniel", "Okafor", Role.MANAGER, "Head of Sales", 0),
            ("sofia@crm.local", "Sofia", "Reyes", Role.SALESPERSON, "Senior Sales Consultant", 55),
            ("marcus@crm.local", "Marcus", "Lee", Role.SALESPERSON, "Sales Consultant", 50),
            ("priya@crm.local", "Priya", "Natarajan", Role.SALESPERSON, "Sales Consultant", 50),
            ("tom@crm.local", "Tom", "Becker", Role.SALESPERSON, "Junior Sales Consultant", 45),
        ]
        users = []
        for email, first, last, role, title, split in spec:
            user, _ = User.objects.get_or_create(
                email=email,
                defaults=dict(
                    first_name=first, last_name=last, role=role, job_title=title,
                    phone=f"+1 555 010{len(users)}", is_staff=role == Role.ADMIN,
                    commission_split=Decimal(split or 50), is_superuser=role == Role.ADMIN,
                ),
            )
            user.set_password(password)
            user.save()
            users.append(user)
        return users

    def _properties(self) -> list[Property]:
        r = self.rng
        kinds = [
            ("apartment", [1, 2, 2, 3], (240_000, 520_000), (48, 120)),
            ("townhouse", [3, 3, 4], (480_000, 880_000), (130, 220)),
            ("villa", [4, 5, 5], (850_000, 2_200_000), (240, 480)),
            ("penthouse", [3, 4], (1_200_000, 3_200_000), (180, 320)),
            ("land", [0], (150_000, 520_000), (400, 1500)),
            ("commercial", [0], (600_000, 1_900_000), (120, 600)),
        ]
        weights = [8, 6, 5, 3, 2, 2]
        props = []
        for i in range(32):
            ptype, beds, (lo, hi), (a_lo, a_hi) = r.choices(kinds, weights)[0]
            loc = r.choice(LOCATIONS)
            building = r.choice(BUILDINGS[loc])
            bedrooms = r.choice(beds)
            title = (
                f"{bedrooms}BR {ptype.title()} · {building}" if bedrooms else f"{ptype.title()} plot · {building}"
            )
            prop = Property.objects.create(
                title=title,
                address=f"{r.randint(3, 480)} {r.choice(['Oak', 'Harbor', 'Linden', 'Mercer', 'Alder', 'Crescent'])} "
                f"{r.choice(['Street', 'Avenue', 'Lane', 'Boulevard'])}",
                city=loc,
                price=Decimal(round(r.uniform(lo, hi) / 5000) * 5000),
                property_type=ptype,
                bedrooms=bedrooms,
                bathrooms=max(1, bedrooms - r.choice([0, 1])) if bedrooms else 0,
                area_sqm=Decimal(r.randint(a_lo, a_hi)),
                description="Well-maintained property with strong demand in the area. Viewings by appointment.",
                assigned_to=r.choice(self.sales),
            )
            props.append(prop)
        for prop in r.sample(props, 2):
            Property.objects.filter(pk=prop.pk).update(status=Property.Status.INACTIVE)
        for prop in r.sample(props, 3):
            Property.objects.filter(pk=prop.pk).update(status=Property.Status.RESERVED)
        return props

    def _leads(self) -> None:
        r = self.rng
        plan = (
            ["new"] * 11 + ["contacted"] * 8 + ["qualified"] * 9 + ["viewing"] * 7 + ["offer_made"] * 4
            + ["negotiation"] * 2 + ["under_contract"] * 2 + ["closed"] * 4 + ["lost"] * 3
        )
        sources = [s for s, _ in Lead.Source.choices]
        per_stage: dict[str, int] = {}
        for idx, stage in enumerate(plan):
            first, last = PEOPLE[idx % len(PEOPLE)]
            n = per_stage[stage] = per_stage.get(stage, -1) + 1
            owner = self.sales[(n + idx // 17) % len(self.sales)]  # every stage spread across the team
            loc = r.choice(LOCATIONS)
            lead = Lead.objects.create(
                first_name=first, last_name=last, phone=f"+1 555 {r.randint(100, 999)} {r.randint(1000, 9999)}",
                email=f"{first.lower()}.{last.lower()}@example.com", source=r.choice(sources),
                budget=Decimal(r.choice([280, 350, 420, 520, 650, 780, 950, 1200, 1600])) * 1000,
                preferred_location=loc, assigned_to=owner,
            )
            lead_services.after_lead_created(lead, self.manager)
            age = (
                r.randint(0, 12) if stage == "new" else r.randint(90, 150) if stage in ("closed", "lost")
                else r.randint(8, 80)
            )
            created = self.now - timedelta(days=age, hours=r.randint(0, 8))
            Lead.objects.filter(pk=lead.pk).update(created_at=created)
            lead.created_at = created
            self._advance(lead, stage, owner, loc)

    def _pick_property(self, loc: str, exclude: list[Property], fresh: bool = False) -> Property:
        """Random sellable property, preferring the lead's location. `fresh` avoids ones already under offer."""
        allowed = [Property.Status.AVAILABLE, Property.Status.RESERVED]
        if not fresh:
            allowed.append(Property.Status.UNDER_OFFER)
        taken = {p.pk for p in exclude}
        candidates = [p for p in Property.objects.filter(status__in=allowed) if p.pk not in taken]
        local = [p for p in candidates if p.city == loc]
        return self.rng.choice(local or candidates)

    def _task(self, lead: Lead, owner: User, title: str, kind: str, days: float, done: bool = False) -> Task:
        due = self.now + timedelta(days=days)
        task = Task.objects.create(
            title=title, type=kind, due_at=due, assigned_to=owner, created_by=owner, lead=lead,
            status=Task.Status.COMPLETED if done else Task.Status.PENDING,
            completed_at=due if done else None,
        )
        return task

    def _advance(self, lead: Lead, stage: str, owner: User, loc: str) -> None:
        r = self.rng
        if stage == "new":
            self._task(lead, owner, f"Intro call with {lead.first_name}", "call", r.choice([-2, -1, 0, 0, 0.1, 1]))
            return
        lead_services.change_status(lead, Lead.Status.CONTACTED, owner)
        lead_services.add_note(
            lead, r.choice([
                "Spoke on the phone. Relocating for work, wants to move within 3 months.",
                "Prefers a quiet street, needs a home office. Pre-approved with the bank.",
                "First-time buyer, cautious about budget. Wants to see a few options.",
                "Investor profile — looking for rental yield over 5%.",
            ]), owner,
        )
        self._task(lead, owner, "Qualification call", "call", -r.randint(8, 20), done=True)
        if stage == "contacted":
            self._task(lead, owner, f"Send listings to {lead.first_name}", "email", r.choice([-1, 0, 0.2, 2]))
            return
        lead_services.change_status(lead, Lead.Status.QUALIFIED, owner)
        prop = self._pick_property(loc, [], fresh=stage in ("offer_made", "negotiation", "under_contract", "closed"))
        extra = self._pick_property(loc, [prop])
        lead_services.link_property(lead, extra, owner, LeadProperty.Status.SUGGESTED)
        rejected = self._pick_property(loc, [prop, extra])
        match = lead_services.link_property(lead, rejected, owner, LeadProperty.Status.SUGGESTED)
        lead_services.set_match_status(match, LeadProperty.Status.REJECTED, owner, r.choice(REJECT_REASONS))
        if stage == "qualified":
            lead_services.link_property(lead, prop, owner, LeadProperty.Status.INTERESTED)
            if r.random() < 0.6:
                deal_services.get_or_create_open_deal(lead, prop, owner, assigned_to=owner)
            self._task(lead, owner, "Book viewing", "viewing", r.choice([-1, 0, 1, 3]))
            return

        # Viewing (past, completed with feedback) for every later stage
        past_days = r.randint(2, 10)
        start = (self.now - timedelta(days=past_days)).replace(minute=0, second=0, microsecond=0)
        viewing = Viewing.objects.create(
            lead=lead, property=prop, assigned_to=owner, start_at=start, end_at=start + timedelta(hours=1)
        )
        viewing_services.after_viewing_scheduled(viewing, owner)
        feedback, rating = r.choice(FEEDBACK)
        viewing_services.complete_viewing(viewing, owner, feedback, rating)
        followup = {"due_at": start + timedelta(days=1)}
        if r.random() < 0.75:  # most follow-ups were already done
            followup.update(status=Task.Status.COMPLETED, completed_at=start + timedelta(days=1, hours=2))
        Task.objects.filter(lead=lead, title__startswith="Follow up after viewing").update(**followup)
        if stage == "viewing":
            nxt = (self.now + timedelta(days=r.randint(1, 6))).replace(hour=r.choice([9, 11, 14, 16]), minute=0,
                                                                        second=0, microsecond=0)
            second = self._pick_property(loc, [prop, extra, rejected])
            future = Viewing.objects.create(
                lead=lead, property=second, assigned_to=owner, start_at=nxt, end_at=nxt + timedelta(hours=1)
            )
            viewing_services.after_viewing_scheduled(future, owner)
            return

        deal, _ = deal_services.get_or_create_open_deal(lead, prop, owner, assigned_to=owner)
        asking = prop.price
        amount = (asking * Decimal(str(r.uniform(0.92, 0.99)))).quantize(Decimal("1000"))
        deal_services.submit_offer(deal, amount, owner, conditions="Subject to financing and inspection")
        Deal.objects.filter(pk=deal.pk).update(
            expected_close_date=(self.now + timedelta(days=r.randint(10, 60))).date()
        )
        deal.refresh_from_db()
        if stage == "offer_made":
            self._task(lead, owner, "Chase seller response", "follow_up", r.choice([-1, 0, 1]))
            return
        if stage == "negotiation":
            deal_services.move_stage(deal, Deal.Stage.NEGOTIATION, owner)
            self._task(lead, owner, "Counter-offer call", "call", r.choice([0, 1]))
            return
        if stage == "lost":
            deal_services.move_stage(deal, Deal.Stage.LOST, owner, lost_reason=r.choice(LOST_REASONS))
            lead_services.change_status(lead, Lead.Status.LOST, owner, lost_reason="Deal lost")
            return
        offer = deal.offers.first()
        deal_services.set_offer_status(offer, Offer.Status.ACCEPTED, owner)
        deal.refresh_from_db()
        self._documents(deal, owner, count=r.randint(1, 3))
        if stage == "under_contract":
            self._task(lead, owner, "Collect signed agreement", "document", r.choice([-1, 1, 2]))
            return
        self._documents(deal, owner, count=4)
        deal_services.move_stage(deal, Deal.Stage.CLOSED, owner)

    def _documents(self, deal: Deal, owner: User, count: int) -> None:
        categories = ["offer", "identification", "contract", "agreement", "inspection_report"]
        for category in categories[:count]:
            label = category.replace("_", " ").title()
            Document.objects.create(
                deal=deal, category=category, name=f"{label} – {deal.lead.name}.txt",
                file=ContentFile(f"Sample {label} for {deal.lead.name}".encode(), name="sample.txt"),
                size=48, content_type="text/plain", uploaded_by=owner,
            )

    # ---- timestamps & statuses ------------------------------------------------------------------------
    def _finalize(self) -> None:
        r = self.rng
        # Closed deals: spread close dates, then settle commission statuses.
        closed = list(Deal.objects.filter(stage=Deal.Stage.CLOSED).select_related("lead"))
        for i, deal in enumerate(closed):
            when = deal.lead.created_at + timedelta(days=r.randint(25, 60))
            when = min(when, self.now - timedelta(days=1 + i * 9))
            Deal.objects.filter(pk=deal.pk).update(closed_at=when)
            Commission.objects.filter(deal=deal).update(created_at=when)
        commissions = list(Commission.objects.order_by("created_at"))
        for i, commission in enumerate(commissions):
            if i == 0:
                commission_services.update_terms(commission, self.manager, deductions=Decimal("250"))
            if i < len(commissions) - 1:
                commission_services.approve(commission, self.manager)
            if i < len(commissions) - 2:
                commission_services.mark_paid(commission, self.manager)

        # Spread activity timestamps across each lead's lifetime (keeps order).
        for lead in Lead.objects.all():
            acts = list(Activity.objects.filter(lead=lead).order_by("id"))
            if not acts:
                continue
            end = self.now - timedelta(hours=r.randint(1, 20))
            span = max((end - lead.created_at).total_seconds(), 3600)
            for i, act in enumerate(acts):
                ts = lead.created_at + timedelta(seconds=span * (i + 1) / (len(acts) + 1))
                Activity.objects.filter(pk=act.pk).update(created_at=ts)
            Lead.objects.filter(pk=lead.pk).update(last_activity_at=lead.created_at + timedelta(seconds=span * 0.95))
            for note in lead.notes.all():
                type(note).objects.filter(pk=note.pk).update(
                    created_at=lead.created_at + timedelta(seconds=span * 0.2)
                )

        # Property price change demo, then overdue notifications.
        prop = Property.objects.filter(status=Property.Status.AVAILABLE).first()
        if prop:
            from properties.services import record_price_change

            old = prop.price
            prop.price = (old * Decimal("0.97")).quantize(Decimal("1000"))
            prop.save(update_fields=["price"])
            record_price_change(prop, old, self.manager)
        notify_overdue_tasks()
