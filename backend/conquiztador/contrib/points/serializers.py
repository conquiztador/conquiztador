from rest_framework import serializers

from .models import PointsEntry


class PointsEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = PointsEntry
        fields = ("uuid", "match_id", "reason", "count", "amount", "created_at")


class AwardEntrySerializer(serializers.Serializer):
    reason = serializers.ChoiceField(choices=PointsEntry.Reason.choices)
    count = serializers.IntegerField(min_value=0)
    amount = serializers.IntegerField(min_value=0)


class AwardPlayerSerializer(serializers.Serializer):
    user = serializers.UUIDField()
    entries = AwardEntrySerializer(many=True)

    def validate_entries(self, entries):
        reasons = [e["reason"] for e in entries]
        if len(reasons) != len(set(reasons)):
            raise serializers.ValidationError("Each reason may appear once.")
        return entries


class AwardSerializer(serializers.Serializer):
    match_id = serializers.UUIDField()
    players = AwardPlayerSerializer(many=True)
