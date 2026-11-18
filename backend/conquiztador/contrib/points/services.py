from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import F

from .models import PointsEntry

UserModel = get_user_model()


@transaction.atomic
def award_match_points(match_id, players):
    """
    Credit a finished (or left) match's points.

    `players` is a list of {"user": <uuid>, "entries": [{"reason", "count",
    "amount"}, ...]}. Idempotent per (user, match, reason): entries that
    already exist are skipped, so the game server can safely retry.
    Returns {user uuid: new balance}.
    """
    users = {
        str(u.uuid): u
        for u in UserModel.objects.select_for_update().filter(
            uuid__in=[p["user"] for p in players]
        )
    }
    missing = {str(p["user"]) for p in players} - users.keys()
    if missing:
        raise UserModel.DoesNotExist(f"Unknown users: {sorted(missing)}")

    for player in players:
        user = users[str(player["user"])]
        for entry in player["entries"]:
            if entry["amount"] == 0:
                continue
            _, created = PointsEntry.objects.get_or_create(
                user=user,
                match_id=match_id,
                reason=entry["reason"],
                defaults={"count": entry["count"], "amount": entry["amount"]},
            )
            if created:
                UserModel.objects.filter(pk=user.pk).update(
                    points=F("points") + entry["amount"]
                )

    return {
        str(u.uuid): u.points
        for u in UserModel.objects.filter(pk__in=[u.pk for u in users.values()])
    }
