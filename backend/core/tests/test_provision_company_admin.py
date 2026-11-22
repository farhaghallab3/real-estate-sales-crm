"""The provision_company_admin command: safe first-admin creation for a customer deployment."""
import io
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

from django.contrib.auth.password_validation import validate_password
from django.core.management import call_command
from django.core.management.base import CommandError
from rest_framework.test import APIClient

from users.models import Role, User

from .base import PASSWORD, ApiTestCase, make_user

GOOD = "Owner-Temp-Pass-2026!"


def run(*args, stdin=None, tty=False, getpass_values=()):
    out, err = io.StringIO(), io.StringIO()
    fake_stdin = io.StringIO(stdin or "")
    fake_stdin.isatty = lambda: tty  # type: ignore[method-assign]
    with mock.patch("sys.stdin", fake_stdin), mock.patch("getpass.getpass", side_effect=list(getpass_values)), \
            redirect_stdout(out), redirect_stderr(err):
        call_command("provision_company_admin", *args, stdout=out, stderr=err)
    return out.getvalue() + err.getvalue()


def attempt(*args, **kwargs):
    """(created?, message) without raising: CommandError text is what an operator would see."""
    try:
        return True, run(*args, **kwargs)
    except CommandError as exc:
        return False, str(exc)


class ProvisionCompanyAdminTests(ApiTestCase):
    def setUp(self):
        # a deployment with no Company Admin yet (only company staff and a technical account)
        User.objects.filter(role=Role.ADMIN).update(role=Role.MANAGER)
        self.tech = User.objects.create_superuser("tech@t.test", PASSWORD)

    def new(self, email="owner@company.test"):
        return User.objects.get(email=email)

    # ---- the account that is created ----
    def test_creates_an_ordinary_company_admin_with_a_temporary_password(self):
        output = run("--email", "Owner@Company.Test ", "--first-name", "Ola", "--last-name", "Owner", "--password-stdin", stdin=GOOD + "\n")
        user = self.new()
        self.assertEqual((user.role, user.is_staff, user.is_superuser, user.is_active), (Role.ADMIN, False, False, True))
        self.assertTrue(user.must_change_password)
        self.assertTrue(user.check_password(GOOD))
        self.assertEqual((user.first_name, user.last_name), ("Ola", "Owner"))
        self.assertIn("must choose a new password", output)

    def test_the_password_never_appears_in_the_output_or_the_database_in_clear(self):
        output = run("--email", "owner@company.test", "--password-stdin", stdin=GOOD + "\n")
        self.assertNotIn(GOOD, output)
        self.assertNotIn(GOOD, self.new().password)
        self.assertTrue(self.new().password.startswith("pbkdf2_") or "$" in self.new().password)

    def test_interactive_prompt_asks_twice_and_checks_they_match(self):
        run("--email", "owner@company.test", tty=True, getpass_values=[GOOD, GOOD])
        self.assertTrue(self.new().check_password(GOOD))
        User.objects.filter(email="owner@company.test").delete()
        created, message = attempt("--email", "owner@company.test", tty=True, getpass_values=[GOOD, GOOD + "x"])
        self.assertFalse(created)
        self.assertIn("differ", message)
        self.assertFalse(User.objects.filter(email="owner@company.test").exists())

    def test_generate_prints_a_strong_one_time_password_that_works(self):
        output = run("--email", "owner@company.test", "--generate")
        password = output.strip().splitlines()[-1]
        self.assertGreaterEqual(len(password), 20)
        validate_password(password)  # satisfies the project's validators
        self.assertTrue(self.new().check_password(password))
        self.assertTrue(self.new().must_change_password)
        # and a second run produces a different password
        User.objects.filter(email="owner@company.test").delete()
        self.assertNotEqual(run("--email", "owner@company.test", "--generate").strip().splitlines()[-1], password)

    # ---- the password is never an argument ----
    def test_a_password_argument_is_refused_before_anything_happens(self):
        created, message = attempt("--email", "owner@company.test", "--password", GOOD)
        self.assertFalse(created)
        self.assertIn("not allowed", message)
        self.assertNotIn(GOOD, message)
        self.assertFalse(User.objects.filter(email="owner@company.test").exists())

    def test_no_password_source_is_an_error_not_a_default(self):
        created, message = attempt("--email", "owner@company.test", tty=False)
        self.assertFalse(created)
        self.assertIn("No password source", message)

    def test_weak_passwords_are_refused(self):
        for bad in ("short", "password1234", "12345678901234", "owner@company.test"):
            with self.subTest(bad=bad):
                created, message = attempt("--email", "owner@company.test", "--password-stdin", stdin=bad + "\n")
                self.assertFalse(created)
        self.assertFalse(User.objects.filter(email="owner@company.test").exists())

    # ---- no duplicates, no second admin without explicit approval ----
    def test_an_existing_email_is_refused_in_any_letter_case_and_nothing_changes(self):
        before = User.objects.count()
        for email in ("sales.a@t.test", "SALES.A@T.TEST", "tech@t.test", "Tech@T.test"):
            with self.subTest(email=email):
                created, message = attempt("--email", email, "--password-stdin", stdin=GOOD + "\n")
                self.assertFalse(created)
                self.assertIn("already exists", message)
        self.assertEqual(User.objects.count(), before)
        self.assertEqual(User.objects.get(email="sales.a@t.test").role, Role.SALESPERSON)

    def test_a_second_company_admin_is_refused_unless_explicitly_allowed(self):
        run("--email", "owner@company.test", "--password-stdin", stdin=GOOD + "\n")
        created, message = attempt("--email", "second@company.test", "--password-stdin", stdin=GOOD + "\n")
        self.assertFalse(created)
        self.assertIn("--allow-additional", message)
        self.assertFalse(User.objects.filter(email="second@company.test").exists())
        run("--email", "second@company.test", "--password-stdin", "--allow-additional", stdin=GOOD + "\n")
        self.assertEqual(User.objects.filter(role=Role.ADMIN, is_superuser=False, is_active=True).count(), 2)

    def test_technical_and_inactive_admins_do_not_count_as_an_existing_company_admin(self):
        make_user("old.admin@t.test", Role.ADMIN, is_active=False)
        self.assertTrue(attempt("--email", "owner@company.test", "--password-stdin", stdin=GOOD + "\n")[0])

    # ---- validation and safety ----
    def test_invalid_emails_are_refused(self):
        for bad in ("not-an-email", "a@", "@b.com", ""):
            with self.subTest(bad=bad):
                self.assertFalse(attempt("--email", bad, "--password-stdin", stdin=GOOD + "\n")[0])

    def test_dry_run_validates_but_creates_nothing(self):
        output = run("--email", "owner@company.test", "--password-stdin", "--dry-run", stdin=GOOD + "\n")
        self.assertIn("Nothing was created", output)
        self.assertFalse(User.objects.filter(email="owner@company.test").exists())
        # a dry run still refuses bad input
        self.assertFalse(attempt("--email", "owner@company.test", "--password-stdin", "--dry-run", stdin="weak\n")[0])

    # ---- what the new Company Admin can and cannot do ----
    def test_the_new_company_admin_signs_in_changes_the_password_then_manages_staff_but_not_django_admin(self):
        run("--email", "owner@company.test", "--password-stdin", stdin=GOOD + "\n")
        tokens = APIClient().post("/api/auth/login/", {"email": "owner@company.test", "password": GOOD}, format="json").json()
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        self.assertEqual(client.get("/api/users/").status_code, 403)  # blocked until the password is changed
        changed = client.post("/api/auth/change-password/", {"current_password": GOOD, "new_password": "Owner-Chosen-Pass-9!"}, format="json")
        self.assertEqual(changed.status_code, 200, changed.content)
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {changed.json()['access']}")
        # manages employees: sees the team, creates and edits users, changes roles
        listed = client.get("/api/users/")
        self.assertEqual(listed.status_code, 200)
        self.assertNotIn("tech@t.test", listed.content.decode())
        created = client.post("/api/users/", {"email": "emp@company.test", "first_name": "E", "last_name": "M", "role": "salesperson", "password": "Initial-Pass-12!"}, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        emp = User.objects.get(email="emp@company.test")
        self.assertEqual(client.patch(f"/api/users/{emp.pk}/", {"role": "manager"}, format="json").status_code, 200)
        # but cannot touch the technical account or use the Django admin site
        self.assertEqual(client.patch(f"/api/users/{self.tech.pk}/", {"password": "Taken-Over-By-Admin-1!"}, format="json").status_code, 404)
        owner = self.new()
        from django.contrib import admin
        from django.test import RequestFactory

        request = RequestFactory().get("/django-admin/")
        request.user = owner
        self.assertFalse(admin.site.has_permission(request))
        self.client.force_login(owner)
        self.assertEqual(self.client.get("/django-admin/").status_code, 302)

    def test_the_provisioned_admin_is_protected_as_the_last_company_admin(self):
        run("--email", "owner@company.test", "--password-stdin", stdin=GOOD + "\n")
        owner = self.new()
        User.objects.filter(pk=owner.pk).update(must_change_password=False)
        response = self.as_user(owner).patch(f"/api/users/{owner.pk}/", {"role": "manager"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("At least one active Company Admin", response.content.decode())
