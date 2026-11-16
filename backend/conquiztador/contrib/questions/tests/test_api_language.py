from io import StringIO

from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APITestCase

from conquiztador.contrib.questions.models import Question
from conquiztador.mixins import TestMixin


class QuestionLanguageTestCase(APITestCase, TestMixin):
    def setUp(self):
        self.user = self.create_user()
        self.en = self.create_question(text="Capital of Bulgaria?", language="en")
        self.create_answer(question=self.en, text="Sofia", is_correct=True)
        self.create_answer(question=self.en, text="Varna")
        self.bg = self.create_question(text="Столица на България?", language="bg")
        self.create_answer(question=self.bg, text="София", is_correct=True)
        self.bg_numeric = self.create_question(
            text="Колко области има България?",
            language="bg",
            kind=Question.Kind.NUMERIC,
            numeric_answer=28,
        )

    def test_random_filters_by_language(self):
        url = reverse("question-get-random")
        for _ in range(5):
            response = self.client.get(
                url, {"language": "bg", "kind": "multiple_choice"}
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["uuid"], str(self.bg.pk))
            self.assertEqual(response.json()["language"], "bg")

    def test_random_rejects_unknown_language(self):
        response = self.client.get(reverse("question-get-random"), {"language": "xx"})
        self.assertEqual(response.status_code, 400)

    def test_list_filters_by_language(self):
        response = self.client.get(reverse("question-list"), {"language": "en"})
        self.assertEqual(response.status_code, 200)
        uuids = [q["uuid"] for q in response.json()["results"]]
        self.assertEqual(uuids, [str(self.en.pk)])

    def test_deck_returns_solutions_in_one_language(self):
        response = self.client.get(reverse("question-get-deck"), {"language": "bg"})
        self.assertEqual(response.status_code, 200)
        deck = response.json()
        self.assertEqual(
            {q["uuid"] for q in deck}, {str(self.bg.pk), str(self.bg_numeric.pk)}
        )
        by_id = {q["uuid"]: q for q in deck}
        self.assertEqual(by_id[str(self.bg_numeric.pk)]["numeric_answer"], 28.0)
        self.assertEqual(
            by_id[str(self.bg.pk)]["answers"],
            [
                {
                    "uuid": str(self.bg.answers.first().pk),
                    "text": "София",
                    "is_correct": True,
                }
            ],
        )

    def test_deck_filters_by_kind_and_limits_count(self):
        url = reverse("question-get-deck")
        response = self.client.get(url, {"language": "bg", "kind": "numeric"})
        self.assertEqual([q["uuid"] for q in response.json()], [str(self.bg_numeric.pk)])
        response = self.client.get(url, {"count": 1})
        self.assertEqual(len(response.json()), 1)

    def test_deck_rejects_bad_params(self):
        url = reverse("question-get-deck")
        self.assertEqual(self.client.get(url, {"language": "xx"}).status_code, 400)
        self.assertEqual(self.client.get(url, {"kind": "x"}).status_code, 400)
        self.assertEqual(self.client.get(url, {"count": "many"}).status_code, 400)


class SeedQuestionsTestCase(APITestCase):
    def test_seed_is_idempotent_and_covers_both_languages(self):
        call_command("seed_questions", stdout=StringIO())
        first = Question.objects.count()
        call_command("seed_questions", stdout=StringIO())
        self.assertEqual(Question.objects.count(), first)

        for language in ("en", "bg"):
            questions = Question.objects.filter(language=language)
            self.assertTrue(questions.filter(kind=Question.Kind.NUMERIC).exists())
            mcq = questions.filter(kind=Question.Kind.MULTIPLE_CHOICE)
            self.assertTrue(mcq.exists())
            for question in mcq:
                self.assertEqual(question.answers.filter(is_correct=True).count(), 1)
                self.assertEqual(question.categories.get().language, language)
        self.assertEqual(
            Question.objects.filter(language="en").count(),
            Question.objects.filter(language="bg").count(),
        )
