import uuid

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _


class PointsEntry(models.Model):
    """
    One line in a player's points ledger. The user's `points` balance is the
    sum of their entries; it is only changed together with a new entry
    (see services.award_match_points).
    """

    class Reason(models.TextChoices):
        CORRECT_ANSWER = "correct_answer", _("Correct answer")
        TIEBREAKER_WIN = "tiebreaker_win", _("Tie-breaker won")
        REGION_TAKEN = "region_taken", _("Region taken")
        CAPITAL_HIT = "capital_hit", _("Capital hit")
        CAPITAL_CAPTURED = "capital_captured", _("Capital captured")
        VICTORY = "victory", _("Victory")

    uuid = models.UUIDField(default=uuid.uuid4, primary_key=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="points_entries",
        on_delete=models.CASCADE,
    )
    match_id = models.UUIDField(_("Match"), db_index=True)
    reason = models.CharField(_("Reason"), max_length=32, choices=Reason.choices)
    count = models.PositiveIntegerField(
        _("Count"), help_text=_("How many times it happened in the match.")
    )
    amount = models.IntegerField(_("Amount"))
    created_at = models.DateTimeField(_("Created at"), auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = _("Points entry")
        verbose_name_plural = _("Points entries")
        constraints = [
            # A match credits each reason to a player at most once, so a
            # retried award request can't pay out twice.
            models.UniqueConstraint(
                fields=["user", "match_id", "reason"],
                name="points_once_per_match_reason",
            )
        ]

    def __str__(self):
        return f"{self.user} {self.amount:+d} ({self.reason})"
