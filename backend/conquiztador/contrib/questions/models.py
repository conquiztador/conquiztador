import uuid

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models
from django.urls import reverse
from django.utils.translation import gettext_lazy as _

from conquiztador.models import TimestampedModel

from . import managers

UserModel = get_user_model()


def language_field():
    return models.CharField(
        _("Language"),
        max_length=8,
        choices=settings.LANGUAGES,
        default=settings.GAME_LANGUAGE_DEFAULT,
        db_index=True,
    )


class Category(TimestampedModel):
    uuid = models.UUIDField(default=uuid.uuid4, primary_key=True)
    name = models.CharField(_("Name"), max_length=254)
    language = language_field()

    class Meta:
        verbose_name = _("Category")
        verbose_name_plural = _("Categories")

    def __str__(self):
        return self.name

    def get_absolute_url(self):
        return reverse("category:detail", kwargs={"pk": self.pk})


class Question(TimestampedModel):
    class Kind(models.TextChoices):
        MULTIPLE_CHOICE = "multiple_choice", _("Multiple choice")
        NUMERIC = "numeric", _("Numeric")

    uuid = models.UUIDField(default=uuid.uuid4, primary_key=True)
    text = models.CharField(_("Text"), max_length=254)
    language = language_field()
    kind = models.CharField(
        _("Kind"),
        max_length=32,
        choices=Kind.choices,
        default=Kind.MULTIPLE_CHOICE,
    )
    numeric_answer = models.FloatField(
        _("Numeric answer"),
        blank=True,
        null=True,
        help_text=_("The correct value for numeric questions."),
    )
    author = models.ForeignKey(
        UserModel, related_name="questions", on_delete=models.CASCADE
    )
    categories = models.ManyToManyField(
        Category,
        related_name="questions",
        verbose_name=_("Category"),
    )

    objects = managers.QuestionManager()

    class Meta:
        verbose_name = _("Question")
        verbose_name_plural = _("Questions")

    def __str__(self):
        return self.text

    def get_absolute_url(self):
        return reverse("questions:detail", kwargs={"pk": self.pk})

    def clean(self):
        if self.kind == self.Kind.NUMERIC and self.numeric_answer is None:
            raise ValidationError(
                {"numeric_answer": _("Numeric questions need a numeric answer.")}
            )

    @property
    def correct_answer(self):
        return self.answers.filter(is_correct=True).first()


class Answer(TimestampedModel):
    uuid = models.UUIDField(default=uuid.uuid4, primary_key=True)
    text = models.CharField(_("Text"), max_length=254)
    author = models.ForeignKey(
        UserModel, related_name="answers", on_delete=models.CASCADE
    )
    question = models.ForeignKey(
        Question,
        related_name="answers",
        on_delete=models.CASCADE,
        verbose_name=_("Category"),
        blank=True,
        null=True,
    )
    is_correct = models.BooleanField(_("Is correct"), default=False)

    class Meta:
        ordering = ["created_at"]
        verbose_name = _("Answer")
        verbose_name_plural = _("Answers")

    def __str__(self):
        return self.text

    def get_absolute_url(self):
        return reverse("questions:detail", kwargs={"pk": self.pk})

    def save(self, *args, **kwargs):
        if self.is_correct and self.question.correct_answer:
            raise ValueError(_("A question can only have a single correct answer"))

        return super().save(*args, **kwargs)
