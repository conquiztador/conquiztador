from rest_framework import serializers

from .models import Answer, Category, Question


class AnswerInlineSerializer(serializers.ModelSerializer):
    class Meta:
        model = Answer
        fields = (
            "uuid",
            "text",
        )


class AnswerValidationSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()


class NumericAnswerValidationSerializer(serializers.Serializer):
    value = serializers.FloatField()


class AnswerWithCorrectnessSerializer(serializers.ModelSerializer):
    class Meta:
        model = Answer
        fields = (
            "uuid",
            "text",
            "is_correct",
        )


class CategoryInlineSerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = (
            "uuid",
            "name",
        )


class QuestionSerializer(serializers.HyperlinkedModelSerializer):
    answers = AnswerInlineSerializer(many=True, read_only=True)
    categories = CategoryInlineSerializer(many=True, read_only=True)

    class Meta:
        model = Question
        fields = (
            "url",
            "uuid",
            "text",
            "language",
            "kind",
            "answers",
            "categories",
            "created_at",
            "updated_at",
        )


class DeckQuestionSerializer(serializers.ModelSerializer):
    """
    A question *with* its solution, for clients that run the game engine
    themselves (single-player). Multiplayer must not use this: the server
    has to keep answers secret there.
    """

    answers = AnswerWithCorrectnessSerializer(many=True, read_only=True)
    categories = CategoryInlineSerializer(many=True, read_only=True)

    class Meta:
        model = Question
        fields = (
            "uuid",
            "text",
            "language",
            "kind",
            "numeric_answer",
            "answers",
            "categories",
        )


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = (
            "url",
            "uuid",
            "name",
            "language",
            "created_at",
            "updated_at",
        )
