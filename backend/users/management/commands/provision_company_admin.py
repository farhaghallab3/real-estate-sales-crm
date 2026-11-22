"""Create the first Company Admin of a deployment: an ordinary account (never staff, never superuser).

Run it on the server, once per customer deployment, from a real terminal:

    docker compose run --rm --no-deps backend python manage.py provision_company_admin --email owner@company.com

Password handling (the password is NEVER an argument, so it cannot land in shell history, `ps` or logs):
  * interactive terminal: hidden prompt, asked twice
  * --password-stdin: read one line from standard input (for scripted use through a secret store)
  * --generate: a random temporary password is generated and printed ONCE on standard output

The account must choose its own password at first sign-in (enforced by the API, not just the screen).
"""
import getpass
import secrets
import string
import sys

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email
from django.contrib.auth.password_validation import validate_password
from django.db import transaction

from users.accounts import company_users
from users.models import Role, User

MIN_PASSWORD_LENGTH = 12


def generate_password(length: int = 20) -> str:
    alphabet = string.ascii_letters + string.digits + "-_!#%+="
    while True:
        candidate = "".join(secrets.choice(alphabet) for _ in range(length))
        if any(c.islower() for c in candidate) and any(c.isupper() for c in candidate) and any(c.isdigit() for c in candidate):
            return candidate


class Command(BaseCommand):
    help = "Create the first Company Admin (role=admin, not staff, not superuser) with a temporary password."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--first-name", default="")
        parser.add_argument("--last-name", default="")
        source = parser.add_mutually_exclusive_group()
        source.add_argument("--password-stdin", action="store_true", help="Read the temporary password from standard input")
        source.add_argument("--generate", action="store_true", help="Generate a temporary password and print it once")
        parser.add_argument(
            "--allow-additional", action="store_true",
            help="Explicitly allow creating another Company Admin when an active one already exists",
        )
        parser.add_argument("--dry-run", action="store_true", help="Validate everything and create nothing")
        # Refused on purpose: a password given as an argument would be visible in history, `ps` and logs.
        parser.add_argument("--password", help=argparse_suppress())

    def handle(self, *args, **options):
        if options.get("password") is not None:
            raise CommandError(
                "Passing a password as an argument is not allowed (it would end up in shell history and logs). "
                "Use the interactive prompt, --password-stdin or --generate."
            )
        email = self._clean_email(options["email"])
        self._refuse_existing_email(email)
        self._refuse_second_admin(options["allow_additional"])
        password, generated = self._obtain_password(options, email)

        if options["dry_run"]:
            self.stdout.write(f"Dry run: would create Company Admin {email}. Nothing was created.")
            return
        with transaction.atomic():
            user = User(
                email=email, first_name=options["first_name"].strip(), last_name=options["last_name"].strip(),
                role=Role.ADMIN, is_staff=False, is_superuser=False, is_active=True, must_change_password=True,
            )
            user.set_password(password)
            user.save()
        self.stdout.write(self.style.SUCCESS(
            f"Created Company Admin {user.email} (id {user.pk}). They must choose a new password at first sign-in."
        ))
        if generated:
            self.stdout.write("Temporary password (shown once, share it through a private channel):")
            self.stdout.write(password)

    # ---- checks ------------------------------------------------------------------------------------------------
    def _clean_email(self, raw: str) -> str:
        email = raw.strip().lower()
        try:
            validate_email(email)
        except ValidationError:
            raise CommandError(f"'{raw}' is not a valid email address.")
        return email

    def _refuse_existing_email(self, email: str) -> None:
        # Includes technical accounts on purpose: the email must be unique across the whole database.
        if User.objects.filter(email__iexact=email).exists():
            raise CommandError("An account with this email already exists. Nothing was created.")

    def _refuse_second_admin(self, allowed: bool) -> None:
        if allowed:
            return
        if company_users().filter(role=Role.ADMIN, is_active=True).exists():
            raise CommandError(
                "A Company Admin already exists on this deployment. Nothing was created. "
                "Re-run with --allow-additional only with explicit approval."
            )

    def _obtain_password(self, options, email: str) -> tuple[str, bool]:
        if options["generate"]:
            return generate_password(), True
        if options["password_stdin"]:
            password = sys.stdin.readline().rstrip("\r\n")
        elif sys.stdin.isatty():
            password = getpass.getpass("Temporary password: ")
            if getpass.getpass("Repeat it: ") != password:
                raise CommandError("The two passwords differ. Nothing was created.")
        else:
            raise CommandError("No password source: run from a terminal, or use --password-stdin or --generate.")
        self._validate_password(password, email)
        return password, False

    def _validate_password(self, password: str, email: str) -> None:
        if len(password) < MIN_PASSWORD_LENGTH:
            raise CommandError(f"The temporary password must be at least {MIN_PASSWORD_LENGTH} characters. Nothing was created.")
        try:
            validate_password(password, User(email=email))
        except ValidationError as exc:
            raise CommandError("Weak password: " + " ".join(exc.messages) + " Nothing was created.")


def argparse_suppress():
    import argparse

    return argparse.SUPPRESS
