"""Company settings: public branding config, admin-only management, base-currency lock and logo validation."""
import struct
import zlib
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile

from core.company import InvalidImage, financial_data_exists, sniff_image
from core.company import CurrencyLocked
from core.demo import _BLOCKED
from core.models import CompanySettings

from .base import ApiTestCase

CONFIG = "/api/config/"
SETTINGS = "/api/company/settings/"
LOGO = "/api/company/settings/logo/"
PUBLIC_KEYS = {"company_name", "workspace_label", "currency_code", "locale", "language", "direction", "logo_url"}


def _chunk(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)


def png(width=8, height=8) -> bytes:
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00" + b"\x10\x20\x30" * width)
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")


def jpeg(width=8, height=8) -> bytes:
    sof = b"\xff\xc0\x00\x0b\x08" + struct.pack(">HH", height, width) + b"\x01\x01\x11\x00"
    return b"\xff\xd8" + sof + b"\xff\xd9"


def webp(width=8, height=8) -> bytes:
    body = b"WEBPVP8X" + struct.pack("<I", 10) + b"\x00\x00\x00\x00" + (width - 1).to_bytes(3, "little") + (height - 1).to_bytes(3, "little")
    return b"RIFF" + struct.pack("<I", len(body)) + body


def upload(data: bytes, name="logo.png", content_type="image/png"):
    return SimpleUploadedFile(name, data, content_type)


class SniffTests(ApiTestCase):
    def test_valid_formats_are_identified_by_content(self):
        self.assertEqual(sniff_image(png(10, 20))[:1] + sniff_image(png(10, 20))[2:], ("image/png", 10, 20))
        self.assertEqual(sniff_image(jpeg(30, 40))[0], "image/jpeg")
        self.assertEqual(sniff_image(webp(50, 60))[2:], (50, 60))

    def test_rejected_content(self):
        bad = {
            "empty": b"",
            "svg": b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            "svg with xml header": b'<?xml version="1.0"?><svg/>',
            "html": b"<html><body>hi</body></html>",
            "gif": b"GIF89a" + b"\x00" * 40,
            "pdf": b"%PDF-1.4 something",
            "png signature only": b"\x89PNG\r\n\x1a\n",
            "png with trailing data": png() + b"trailing",
            "png with script appended inside": png() + b"<script>x</script>",
            "truncated jpeg": jpeg()[:-2],
            "webp with wrong size": webp()[:-1],
            "zero dimension png": png(0, 5),
            "huge dimension png": png(9000, 9000),
            "polyglot (valid png + html)": png()[:-12] + _chunk(b"tEXt", b"<html><script>x</script>") + png()[-12:],
        }
        for label, data in bad.items():
            with self.subTest(label):
                with self.assertRaises(InvalidImage):
                    sniff_image(data)


class PublicConfigTests(ApiTestCase):
    def test_defaults_match_the_interface_before_this_feature(self):
        body = self.client.get(CONFIG).json()
        self.assertEqual(
            body,
            {
                "company_name": "Keystone",
                "workspace_label": "Sales workspace",
                "currency_code": "USD",
                "locale": "en-US",
                "language": "en",
                "direction": "ltr",
                "logo_url": None,
            },
        )

    def test_public_and_only_branding_keys(self):
        response = self.client.get(CONFIG)  # anonymous
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), PUBLIC_KEYS)
        self.assertEqual(response["Cache-Control"], "public, max-age=60")

    def test_leaks_nothing_operational_even_with_data_and_logo(self):
        self.prop(self.sales_a)
        self.as_user(self.admin).post(LOGO, {"logo": upload(png())}, format="multipart")
        self.client.force_authenticate(user=None)
        raw = self.client.get(CONFIG).content.decode()
        for needle in ("@", "postgres", "SECRET", "token", "bucket", "r2.", "amazonaws", "admin", "version", "count", "media/"):
            self.assertNotIn(needle.lower(), raw.lower(), needle)
        self.assertEqual(set(self.client.get(CONFIG).json()), PUBLIC_KEYS)

    def test_config_is_read_only_for_everyone(self):
        for user in (None, self.admin):
            self.client.force_authenticate(user=user)
            for method in ("post", "put", "patch", "delete"):
                self.assertEqual(getattr(self.client, method)(CONFIG, {}).status_code, 405, (user, method))

    def test_public_logo_404_without_logo(self):
        self.assertEqual(self.client.get(CONFIG + "logo/").status_code, 404)


class SettingsPermissionTests(ApiTestCase):
    def test_only_company_admin_reads_and_writes(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(SETTINGS).status_code, 401)
        self.assertEqual(self.client.patch(SETTINGS, {"company_name": "X"}, format="json").status_code, 401)
        for user in (self.manager, self.sales_a):
            self.as_user(user)
            self.assertEqual(self.client.get(SETTINGS).status_code, 403)
            self.assertEqual(self.client.patch(SETTINGS, {"company_name": "Hacked"}, format="json").status_code, 403)
            self.assertEqual(self.client.post(LOGO, {"logo": upload(png())}, format="multipart").status_code, 403)
            self.assertEqual(self.client.delete(LOGO).status_code, 403)
        self.assertEqual(CompanySettings.load().company_name, "Keystone")

    def test_admin_updates_branding_and_it_shows_in_public_config(self):
        self.as_user(self.admin)
        response = self.client.patch(
            SETTINGS,
            {"company_name": "  Acme   Realty ", "workspace_label": "Acme desk", "locale": "en-GB", "currency_code": "EGP"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["company_name"], "Acme Realty")
        self.client.force_authenticate(user=None)
        body = self.client.get(CONFIG).json()
        self.assertEqual((body["company_name"], body["workspace_label"], body["locale"], body["currency_code"]), ("Acme Realty", "Acme desk", "en-GB", "EGP"))
        self.assertEqual(CompanySettings.objects.get().updated_by, self.admin)

    def test_validation(self):
        self.as_user(self.admin)
        for payload in (
            {"company_name": ""},
            {"company_name": "   "},
            {"company_name": "x" * 121},
            {"workspace_label": "x" * 61},
            {"currency_code": "XXX"},
            {"currency_code": "usd"},
            {"locale": "klingon"},
            {"language": "fr"},
        ):
            with self.subTest(payload):
                self.assertEqual(self.client.patch(SETTINGS, payload, format="json").status_code, 400)
        self.assertEqual(CompanySettings.load().company_name, "Keystone")

    def test_unknown_and_protected_fields_are_ignored(self):
        self.as_user(self.admin)
        self.client.patch(SETTINGS, {"logo_version": 99, "defaults_applied_at": "2020-01-01T00:00:00Z", "id": 7, "logo_content_type": "text/html"}, format="json")
        cfg = CompanySettings.load()
        self.assertEqual((cfg.pk, cfg.logo_version, cfg.logo_content_type), (1, 0, ""))
        self.assertIsNone(cfg.defaults_applied_at)


    def test_demo_mode_blocks_settings_writes(self):
        matching = [methods for pattern, methods in _BLOCKED if pattern.match("/api/company/settings/logo/")]
        self.assertTrue(matching and {"POST", "PATCH", "DELETE"} <= matching[0])
        self.assertTrue(any(p.match("/api/company/settings/") for p, _ in _BLOCKED))


class CurrencyLockTests(ApiTestCase):
    def patch_currency(self, code):
        return self.as_user(self.admin).patch(SETTINGS, {"currency_code": code}, format="json")

    def test_currency_can_change_while_there_is_no_financial_data(self):
        self.assertFalse(financial_data_exists())
        self.assertEqual(self.patch_currency("EGP").status_code, 200)
        self.assertFalse(self.as_user(self.admin).get(SETTINGS).json()["currency_locked"])
        self.assertEqual(self.patch_currency("EUR").status_code, 200)

    def assertLocked(self):
        self.assertTrue(financial_data_exists())
        self.assertTrue(self.as_user(self.admin).get(SETTINGS).json()["currency_locked"])
        before = CompanySettings.load().currency_code
        response = self.patch_currency("EGP" if before != "EGP" else "USD")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("currency_code", response.json())
        self.assertEqual(CompanySettings.load().currency_code, before)
        # the model refuses too, whatever the caller
        cfg = CompanySettings.load()
        cfg.currency_code = "EGP" if before != "EGP" else "USD"
        with self.assertRaises(CurrencyLocked):
            cfg.save()
        self.assertEqual(CompanySettings.objects.get().currency_code, before)
        # same currency and other fields stay editable
        self.assertEqual(self.patch_currency(before).status_code, 200)
        self.assertEqual(self.client.patch(SETTINGS, {"company_name": "Renamed"}, format="json").status_code, 200)

    def test_locked_by_a_property(self):
        self.prop(self.sales_a)
        self.assertLocked()

    def test_locked_by_a_lead_budget(self):
        self.lead(self.sales_a, budget=Decimal("500000"))
        self.assertLocked()

    def test_lead_without_budget_does_not_lock(self):
        self.lead(self.sales_a)
        self.assertFalse(financial_data_exists())
        self.assertEqual(self.patch_currency("EGP").status_code, 200)

    def test_locked_by_a_deal(self):
        self.deal(self.sales_a)
        self.assertLocked()

    def test_locked_by_a_commission(self):
        self.closed_deal_with_commission(self.sales_a)
        self.assertLocked()

    def test_future_financial_migration_can_override_explicitly(self):
        self.prop(self.sales_a)
        cfg = CompanySettings.load()
        cfg.currency_code = "EUR"
        cfg.save(allow_currency_change=True)
        self.assertEqual(CompanySettings.objects.get().currency_code, "EUR")

    def test_unlocking_after_all_data_is_removed_is_possible(self):
        prop = self.prop(self.sales_a)
        self.assertEqual(self.patch_currency("EGP").status_code, 400)
        prop.delete()
        self.assertEqual(self.patch_currency("EGP").status_code, 200)

    def test_singleton_cannot_be_duplicated(self):
        from django.db import IntegrityError, transaction

        CompanySettings.load()
        with self.assertRaises(IntegrityError), transaction.atomic():
            CompanySettings.objects.bulk_create([CompanySettings(pk=2)])
        self.assertEqual(CompanySettings.objects.count(), 1)


class LogoTests(ApiTestCase):
    def post(self, data, name="logo.png", content_type="image/png"):
        return self.as_user(self.admin).post(LOGO, {"logo": upload(data, name, content_type)}, format="multipart")

    def test_valid_formats_are_accepted_and_served(self):
        for data, mime in ((png(), "image/png"), (jpeg(), "image/jpeg"), (webp(), "image/webp")):
            with self.subTest(mime):
                response = self.post(data, "whatever.bin", "application/octet-stream")
                self.assertEqual(response.status_code, 201, response.content)
                self.client.force_authenticate(user=None)
                served = self.client.get(CONFIG + "logo/")
                self.assertEqual(served.status_code, 200)
                self.assertEqual(served["Content-Type"], mime)
                self.assertEqual(served["X-Content-Type-Options"], "nosniff")
                self.assertIn("sandbox", served["Content-Security-Policy"])
                self.assertEqual(served.content, data)

    def test_content_decides_not_content_type_or_extension(self):
        self.assertEqual(self.post(png(), "evil.svg", "image/svg+xml").status_code, 201)
        self.assertEqual(CompanySettings.load().logo_content_type, "image/png")
        self.assertTrue(CompanySettings.load().logo.name.endswith(".png"))
        for data in (b"<svg xmlns='http://www.w3.org/2000/svg'/>", b"<html>x</html>", b"not an image at all", b"GIF89a" + b"\x00" * 30):
            with self.subTest(data[:12]):
                self.assertEqual(self.post(data, "logo.png", "image/png").status_code, 400)

    def test_svg_is_always_rejected(self):
        svg = b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>'
        self.assertEqual(self.post(svg, "logo.svg", "image/svg+xml").status_code, 400)
        self.assertEqual(self.post(svg, "logo.png", "image/png").status_code, 400)
        self.assertEqual(CompanySettings.load().logo.name, "")

    def test_size_limit(self):
        padding = b"\x00" * (1024 * 1024)
        big = png()[:-12] + _chunk(b"zTXt", padding) + png()[-12:]
        self.assertGreater(len(big), 1024 * 1024)
        self.assertEqual(self.post(big).status_code, 400)
        self.assertEqual(CompanySettings.load().logo.name, "")

    def test_missing_file(self):
        self.assertEqual(self.as_user(self.admin).post(LOGO, {}, format="multipart").status_code, 400)

    def test_generated_name_ignores_the_client_name(self):
        self.post(png(), "../../etc/passwd.png")
        name = CompanySettings.load().logo.name
        self.assertTrue(name.startswith("company/logo-") and ".." not in name, name)

    def test_replace_removes_the_old_file_and_bumps_the_version(self):
        self.post(png())
        first = CompanySettings.load()
        storage, first_name = first.logo.storage, first.logo.name
        self.assertTrue(storage.exists(first_name))
        self.post(jpeg())
        second = CompanySettings.load()
        self.assertNotEqual(second.logo.name, first_name)
        self.assertFalse(storage.exists(first_name))
        self.assertEqual(second.logo_version, first.logo_version + 1)
        self.assertIn(f"v={second.logo_version}", self.client.get(CONFIG).json()["logo_url"])

    def test_remove_logo_falls_back_to_no_logo(self):
        self.post(png())
        name = CompanySettings.load().logo.name
        storage = CompanySettings.load().logo.storage
        response = self.as_user(self.admin).delete(LOGO)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["logo_url"])
        self.assertFalse(storage.exists(name))
        self.client.force_authenticate(user=None)
        self.assertIsNone(self.client.get(CONFIG).json()["logo_url"])
        self.assertEqual(self.client.get(CONFIG + "logo/").status_code, 404)

    def test_missing_file_in_storage_degrades_to_404(self):
        self.post(png())
        cfg = CompanySettings.load()
        cfg.logo.storage.delete(cfg.logo.name)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(CONFIG + "logo/").status_code, 404)
        self.assertEqual(self.client.get(CONFIG).status_code, 200)


class MigrationAndDefaultsTests(ApiTestCase):
    def test_load_creates_the_single_row_with_old_ui_values(self):
        CompanySettings.objects.all().delete()
        cfg = CompanySettings.load()
        self.assertEqual((cfg.pk, cfg.company_name, cfg.workspace_label, cfg.currency_code, cfg.locale), (1, "Keystone", "Sales workspace", "USD", "en-US"))
        self.assertEqual(CompanySettings.load().pk, 1)
        self.assertEqual(CompanySettings.objects.count(), 1)


class InstanceDefaultsTests(ApiTestCase):
    """COMPANY_* from the instance environment apply once, at creation; a redeploy must never revert company settings."""

    def run_defaults(self, **env):
        from io import StringIO
        from unittest import mock

        from django.core.management import call_command

        out = StringIO()
        with mock.patch.dict("os.environ", {k: v for k, v in env.items()}, clear=False):
            call_command("apply_instance_defaults", stdout=out)
        return out.getvalue()

    def test_applies_on_a_fresh_instance(self):
        self.run_defaults(COMPANY_NAME="Globex Homes", COMPANY_CURRENCY="AED", COMPANY_LOCALE="en-GB")
        cfg = CompanySettings.load()
        self.assertEqual((cfg.company_name, cfg.currency_code, cfg.locale), ("Globex Homes", "AED", "en-GB"))
        self.assertIsNotNone(cfg.defaults_applied_at)

    def test_second_run_after_admin_edit_never_reverts(self):
        self.run_defaults(COMPANY_NAME="Globex Homes", COMPANY_CURRENCY="AED")
        self.as_user(self.admin).patch(SETTINGS, {"company_name": "Globex Realty", "currency_code": "SAR", "locale": "ar-SA"}, format="json")
        out = self.run_defaults(COMPANY_NAME="Globex Homes", COMPANY_CURRENCY="AED", COMPANY_LOCALE="en-GB")  # a redeploy
        cfg = CompanySettings.load()
        self.assertEqual((cfg.company_name, cfg.currency_code, cfg.locale), ("Globex Realty", "SAR", "ar-SA"))
        self.assertIn("already applied", out)

    def test_changed_environment_after_creation_is_ignored(self):
        self.run_defaults(COMPANY_NAME="First")
        self.run_defaults(COMPANY_NAME="Second")
        self.assertEqual(CompanySettings.load().company_name, "First")

    def test_existing_customized_instance_is_not_overwritten(self):
        self.as_user(self.admin).patch(SETTINGS, {"company_name": "Already Mine"}, format="json")
        out = self.run_defaults(COMPANY_NAME="From Env", COMPANY_CURRENCY="EUR")
        cfg = CompanySettings.load()
        self.assertEqual((cfg.company_name, cfg.currency_code), ("Already Mine", "USD"))
        self.assertIn("NOT applied", out)
        self.assertIsNotNone(cfg.defaults_applied_at)

    def test_unset_environment_keeps_the_defaults_and_marks_applied(self):
        from unittest import mock

        with mock.patch.dict("os.environ", {}, clear=False):
            for key in ("COMPANY_NAME", "COMPANY_CURRENCY", "COMPANY_LOCALE"):
                __import__("os").environ.pop(key, None)
            self.run_defaults()
        cfg = CompanySettings.load()
        self.assertEqual((cfg.company_name, cfg.currency_code), ("Keystone", "USD"))
        self.assertIsNotNone(cfg.defaults_applied_at)

    def test_invalid_values_are_refused_without_changes(self):
        from django.core.management.base import CommandError

        for env in ({"COMPANY_CURRENCY": "XXX"}, {"COMPANY_LOCALE": "nope"}, {"COMPANY_NAME": "x" * 121}):
            with self.subTest(env), self.assertRaises(CommandError):
                self.run_defaults(**env)
        self.assertIsNone(CompanySettings.load().defaults_applied_at)
