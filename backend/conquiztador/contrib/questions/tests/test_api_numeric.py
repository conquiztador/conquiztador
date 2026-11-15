from django.urls import reverse
from rest_framework.test import APITestCase

from conquiztador.contrib.questions.models import Question
from conquiztador.mixins import TestMixin


class NumericQuestionTestCase(APITestCase, TestMixin):
    def setUp(self):
        self.user = self.create_user()
        self.numeric = self.create_question(
            text="How many provinces does Bulgaria have?",
            kind=Question.Kind.NUMERIC,
            numeric_answer=28,
        )
        self.mcq = self.create_question(text="Multiple choice question")
        self.create_answer(question=self.mcq, text="Yes", is_correct=True)

    def test_random_filters_by_kind(self):
        url = reverse("question-get-random")
        for _ in range(5):
            response = self.client.get(url, {"kind": "numeric"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["uuid"], str(self.numeric.pk))
            self.assertNotIn("numeric_answer", response.json())

    def test_random_rejects_unknown_kind(self):
        response = self.client.get(reverse("question-get-random"), {"kind": "x"})
        self.assertEqual(response.status_code, 400)

    def test_random_without_matches_returns_404(self):
        Question.objects.filter(kind=Question.Kind.NUMERIC).delete()
        response = self.client.get(
            reverse("question-get-random"), {"kind": "numeric"}
        )
        self.assertEqual(response.status_code, 404)

    def test_validate_numeric_answer(self):
        url = reverse("question-validate-answer", args=[self.numeric.pk])
        response = self.client.post(url, format="json", data={"value": 25})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"is_correct": False, "correct_value": 28.0, "difference": 3.0},
        )

    def test_validate_numeric_answer_requires_value(self):
        url = reverse("question-validate-answer", args=[self.numeric.pk])
        response = self.client.post(url, format="json", data={})
        self.assertEqual(response.status_code, 400)
