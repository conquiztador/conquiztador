import hmac

from django.conf import settings
from rest_framework import permissions

GAME_SERVER_HEADER = "X-Game-Server-Secret"


class IsGameServer(permissions.BasePermission):
    """
    Only the Node game server, identified by the shared GAME_SERVER_SECRET.
    Denies everything when no secret is configured.
    """

    message = "Game server only."

    def has_permission(self, request, view):
        secret = settings.GAME_SERVER_SECRET
        provided = request.headers.get(GAME_SERVER_HEADER, "")
        return bool(secret) and hmac.compare_digest(
            provided.encode(), secret.encode()
        )
