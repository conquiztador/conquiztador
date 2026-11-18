from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from conquiztador.permissions import IsGameServer

from . import models, serializers

LANGUAGE_CODES = [code for code, _ in settings.LANGUAGES]
DECK_MAX_SIZE = 200


def language_param(request):
    """
    Reads `?language=`. Returns (language or None, error response or None).
    """
    language = request.query_params.get("language")
    if language is not None and language not in LANGUAGE_CODES:
        return None, Response(
            {"language": f"Must be one of {LANGUAGE_CODES}"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return language, None


def kind_param(request):
    kind = request.query_params.get("kind")
    if kind is not None and kind not in models.Question.Kind.values:
        return None, Response(
            {"kind": f"Must be one of {models.Question.Kind.values}"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return kind, None


class QuestionViewSet(
    mixins.RetrieveModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = serializers.QuestionSerializer
    http_method_names = ("get", "post")
    queryset = models.Question.objects.all()

    def get_serializer_class(self):
        if self.action == "validate_answer":
            return serializers.AnswerValidationSerializer

        return super().get_serializer_class()

    def get_queryset(self):
        queryset = super().get_queryset()

        categories = models.Category.objects.filter(
            pk=self.request.query_params.get("category")
        )

        if categories:
            queryset = queryset.filter(categories__in=categories)

        language = self.request.query_params.get("language")
        if language in LANGUAGE_CODES:
            queryset = queryset.filter(language=language)

        return queryset

    @action(detail=False, methods=("get",), url_path="random")
    def get_random(self, request, pk=None):
        categoryName = self.request.query_params.get("category")

        if categoryName:
            category = models.Category.objects.filter(pk=categoryName).first()
        else:
            category = None

        kind, error = kind_param(request)
        if error:
            return error
        language, error = language_param(request)
        if error:
            return error

        try:
            question = models.Question.objects.get_random(category, kind, language)
        except ObjectDoesNotExist as error:
            return Response({"detail": str(error)}, status=status.HTTP_404_NOT_FOUND)

        serializer = serializers.QuestionSerializer(
            question, context={"request": request}, many=False
        )

        return Response(serializer.data)

    @action(
        detail=False,
        methods=("get",),
        url_path="deck",
        permission_classes=(IsGameServer,),
        authentication_classes=(),
    )
    def get_deck(self, request):
        """
        A shuffled batch of questions with their solutions, for one match:
        `?language=bg&kind=numeric&count=50`. Game server only: the
        solutions must never reach a browser (agents.md §3.1).
        """
        kind, error = kind_param(request)
        if error:
            return error
        language, error = language_param(request)
        if error:
            return error
        try:
            count = int(request.query_params.get("count", 50))
        except ValueError:
            return Response(
                {"count": "Must be an integer"}, status=status.HTTP_400_BAD_REQUEST
            )
        count = max(1, min(count, DECK_MAX_SIZE))

        queryset = models.Question.objects.prefetch_related("answers", "categories")
        if language:
            queryset = queryset.filter(language=language)
        if kind:
            queryset = queryset.filter(kind=kind)
        questions = queryset.order_by("?")[:count]

        serializer = serializers.DeckQuestionSerializer(questions, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=("post",), url_path="validate-answer")
    def validate_answer(self, request, pk=None):
        question = self.get_object()

        if question.kind == models.Question.Kind.NUMERIC:
            serializer = serializers.NumericAnswerValidationSerializer(
                data=request.data
            )
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

            value = serializer.validated_data["value"]
            return Response(
                {
                    "is_correct": value == question.numeric_answer,
                    "correct_value": question.numeric_answer,
                    "difference": abs(value - question.numeric_answer),
                }
            )

        serializer = serializers.AnswerValidationSerializer(data=request.data)

        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        is_correct = question.correct_answer.uuid == serializer.validated_data.get(
            "uuid"
        )

        return Response({"is_correct": is_correct})


class CategoryViewSet(
    mixins.RetrieveModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = serializers.CategorySerializer
    http_method_names = ("get",)
    queryset = models.Category.objects.all()

    def get_queryset(self):
        queryset = super().get_queryset()
        language = self.request.query_params.get("language")
        if language in LANGUAGE_CODES:
            queryset = queryset.filter(language=language)
        return queryset
