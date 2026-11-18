DEBUG = True
ALLOWED_HOSTS = ["*"]
INTERNAL_IPS = ["127.0.0.1"]
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
SECRET_KEY = "SECRET_KEY"

# Matches the game server's development default (server/src/config.ts).
GAME_SERVER_SECRET = GAME_SERVER_SECRET or "dev-game-server-secret"  # noqa: F821
