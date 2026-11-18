import uuid

from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from conquiztador.contrib.points.models import PointsEntry
from conquiztador.mixins import TestMixin

SECRET = "test-secret"


@override_settings(GAME_SERVER_SECRET=SECRET)
class AwardPointsTestCase(APITestCase, TestMixin):
    def setUp(self):
        self.alice = self.create_user(email="alice@example.com")
        self.bob = self.create_user(email="bob@example.com")
        self.match_id = str(uuid.uuid4())
        self.url = reverse("points-award")

    def payload(self, **overrides):
        data = {
            "match_id": self.match_id,
            "players": [
                {
                    "user": str(self.alice.uuid),
                    "entries": [
                        {"reason": "correct_answer", "count": 3, "amount": 30},
                        {"reason": "victory", "count": 1, "amount": 200},
                    ],
                },
                {
                    "user": str(self.bob.uuid),
                    "entries": [{"reason": "region_taken", "count": 2, "amount": 50}],
                },
            ],
        }
        data.update(overrides)
        return data

    def award(self, data, secret=SECRET):
        headers = {"HTTP_X_GAME_SERVER_SECRET": secret} if secret else {}
        return self.client.post(self.url, data, format="json", **headers)

    def test_awards_points_and_updates_balances(self):
        response = self.award(self.payload())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["balances"],
            {str(self.alice.uuid): 230, str(self.bob.uuid): 50},
        )
        self.alice.refresh_from_db()
        self.assertEqual(self.alice.points, 230)
        self.assertEqual(PointsEntry.objects.filter(user=self.alice).count(), 2)

    def test_retrying_the_same_match_pays_once(self):
        self.award(self.payload())
        response = self.award(self.payload())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["balances"][str(self.alice.uuid)], 230)
        self.assertEqual(PointsEntry.objects.count(), 3)

    def test_requires_the_game_server_secret(self):
        self.assertEqual(self.award(self.payload(), secret=None).status_code, 403)
        self.assertEqual(self.award(self.payload(), secret="wrong").status_code, 403)
        self.assertEqual(PointsEntry.objects.count(), 0)

    def test_players_cannot_award_themselves(self):
        self.client.force_authenticate(self.alice)
        response = self.client.post(self.url, self.payload(), format="json")
        self.assertEqual(response.status_code, 403)

    @override_settings(GAME_SERVER_SECRET="")
    def test_refuses_everything_without_a_configured_secret(self):
        self.assertEqual(self.award(self.payload(), secret="").status_code, 403)

    def test_rejects_unknown_users_without_partial_awards(self):
        data = self.payload()
        data["players"].append(
            {"user": str(uuid.uuid4()), "entries": [{"reason": "victory", "count": 1, "amount": 200}]}
        )
        self.assertEqual(self.award(data).status_code, 400)
        self.assertEqual(PointsEntry.objects.count(), 0)

    def test_rejects_negative_amounts_and_duplicate_reasons(self):
        bad = self.payload(players=[{"user": str(self.alice.uuid), "entries": [{"reason": "victory", "count": 1, "amount": -5}]}])
        self.assertEqual(self.award(bad).status_code, 400)
        dup = self.payload(players=[{"user": str(self.alice.uuid), "entries": [
            {"reason": "victory", "count": 1, "amount": 200},
            {"reason": "victory", "count": 1, "amount": 200},
        ]}])
        self.assertEqual(self.award(dup).status_code, 400)


@override_settings(GAME_SERVER_SECRET=SECRET)
class LedgerAndMeTestCase(APITestCase, TestMixin):
    def setUp(self):
        self.user = self.create_user(email="carol@example.com")
        self.other = self.create_user(email="dave@example.com")
        for user, reason in [(self.user, "victory"), (self.other, "region_taken")]:
            self.client.post(
                reverse("points-award"),
                {"match_id": str(uuid.uuid4()), "players": [{"user": str(user.uuid), "entries": [{"reason": reason, "count": 1, "amount": 100}]}]},
                format="json",
                HTTP_X_GAME_SERVER_SECRET=SECRET,
            )

    def test_ledger_lists_only_my_entries(self):
        self.client.force_authenticate(self.user)
        response = self.client.get(reverse("points-list"))
        self.assertEqual(response.status_code, 200)
        reasons = [e["reason"] for e in response.json()["results"]]
        self.assertEqual(reasons, ["victory"])

    def test_ledger_requires_login(self):
        self.assertIn(self.client.get(reverse("points-list")).status_code, (401, 403))

    def test_me_returns_display_name_and_balance(self):
        self.user.refresh_from_db()  # balance was updated in the database
        self.client.force_authenticate(self.user)
        response = self.client.get(reverse("user-me"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "uuid": str(self.user.uuid),
                "email": "carol@example.com",
                "username": None,
                "display_name": "carol",
                "points": 100,
            },
        )

    def test_me_accepts_token_auth(self):
        from rest_framework.authtoken.models import Token

        token = Token.objects.create(user=self.user)
        response = self.client.get(reverse("user-me"), HTTP_AUTHORIZATION=f"Token {token.key}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["display_name"], "carol")
        # DRF answers 403 (not 401) because session auth is listed first;
        # the game server treats both as an invalid token.
        bad = self.client.get(reverse("user-me"), HTTP_AUTHORIZATION="Token nope")
        self.assertIn(bad.status_code, (401, 403))
