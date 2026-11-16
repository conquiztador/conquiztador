import random

from django.db import models


class QuestionManager(models.Manager):
    def get_random(self, category=None, kind=None, language=None):
        queryset = self.all()

        if language is not None:
            queryset = queryset.filter(language=language)

        if kind is not None:
            queryset = queryset.filter(kind=kind)

        if category is not None:
            queryset = queryset.filter(categories=category)

        if not queryset.exists():
            raise models.ObjectDoesNotExist("No question matches the given filters.")

        return queryset.order_by("?").first()
