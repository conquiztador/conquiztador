# Internationalization
# https://docs.djangoproject.com/en/3.2/topics/i18n/

LANGUAGE_CODE = "en-us"

# Languages the game is played in. Questions and categories each belong to
# one of these; a match only uses questions in the player's language.
LANGUAGES = [
    ("en", "English"),
    ("bg", "Bulgarian"),
]
GAME_LANGUAGE_DEFAULT = "en"

TIME_ZONE = "UTC"

USE_I18N = True

USE_L10N = True

USE_TZ = True
TIME_ZONE = "Europe/Sofia"
