import json
import uuid
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from conquiztador.contrib.questions.models import Answer, Category, Question

SEED_FILE = Path(__file__).resolve().parents[2] / "fixtures" / "seed_questions.json"
# Stable ids: re-running the command updates seeded rows instead of duplicating.
NAMESPACE = uuid.UUID("6f3b8f0e-6a0e-4f6c-9d3e-2a1f4b9c7e10")
SEED_AUTHOR_EMAIL = "questions@conquiztador.local"


def seed_uuid(*parts):
    return uuid.uuid5(NAMESPACE, ":".join(parts))


class Command(BaseCommand):
    help = (
        "Create or update the built-in question set (all languages). "
        "In the seed file the first answer of a multiple-choice question is "
        "the correct one."
    )

    def add_arguments(self, parser):
        parser.add_argument("--file", default=str(SEED_FILE))

    @transaction.atomic
    def handle(self, *args, **options):
        data = json.loads(Path(options["file"]).read_text(encoding="utf-8"))
        author = self.seed_author()
        created = updated = 0

        for item in data["questions"]:
            category, _ = Category.objects.update_or_create(
                uuid=seed_uuid("category", item["language"], item["category"]),
                defaults={"name": item["category"], "language": item["language"]},
            )
            question, was_created = Question.objects.update_or_create(
                uuid=seed_uuid("question", item["id"]),
                defaults={
                    "text": item["text"],
                    "language": item["language"],
                    "kind": item["kind"],
                    "numeric_answer": item.get("numeric_answer"),
                    "author": author,
                },
            )
            question.categories.set([category])

            # Replace answers wholesale so edits to the seed file apply cleanly.
            question.answers.all().delete()
            for index, text in enumerate(item.get("answers", [])):
                Answer.objects.create(
                    uuid=seed_uuid("answer", item["id"], str(index)),
                    question=question,
                    text=text,
                    is_correct=index == 0,
                    author=author,
                )

            created += was_created
            updated += not was_created

        self.stdout.write(
            self.style.SUCCESS(f"Seeded questions: {created} created, {updated} updated")
        )

    def seed_author(self):
        UserModel = get_user_model()
        author = UserModel.objects.filter(email=SEED_AUTHOR_EMAIL).first()
        if author is None:
            author = UserModel.objects.create_user(email=SEED_AUTHOR_EMAIL, password=None)
        return author
