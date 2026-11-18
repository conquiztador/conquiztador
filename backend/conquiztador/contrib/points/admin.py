from django.contrib import admin

from .models import PointsEntry


@admin.register(PointsEntry)
class PointsEntryAdmin(admin.ModelAdmin):
    list_display = ("user", "reason", "count", "amount", "match_id", "created_at")
    list_filter = ("reason", "created_at")
    search_fields = ("user__email", "match_id")
    readonly_fields = [f.name for f in PointsEntry._meta.fields]
