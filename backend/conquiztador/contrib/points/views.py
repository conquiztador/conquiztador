from django.contrib.auth import get_user_model
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from conquiztador.permissions import IsGameServer

from . import serializers, services
from .models import PointsEntry

UserModel = get_user_model()


class PointsViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """
    GET  /api/points/        the current user's ledger (newest first)
    POST /api/points/award/  credit a match's points (game server only)
    """

    serializer_class = serializers.PointsEntrySerializer
    permission_classes = (permissions.IsAuthenticated,)

    def get_queryset(self):
        return PointsEntry.objects.filter(user=self.request.user)

    @action(
        detail=False,
        methods=("post",),
        url_path="award",
        permission_classes=(IsGameServer,),
        authentication_classes=(),
    )
    def award(self, request):
        serializer = serializers.AwardSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            balances = services.award_match_points(
                serializer.validated_data["match_id"],
                serializer.validated_data["players"],
            )
        except UserModel.DoesNotExist as error:
            return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"balances": balances})
