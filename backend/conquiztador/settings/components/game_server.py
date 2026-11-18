from os import environ

# Shared secret the Node game server sends (X-Game-Server-Secret) to call
# game-server-only endpoints: question decks with solutions, awarding points.
# Empty means those endpoints refuse every request (fail closed).
GAME_SERVER_SECRET = environ.get("GAME_SERVER_SECRET", "")
