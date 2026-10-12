from django.urls import path

from .views import AnalyticsSummaryView, DashboardView

urlpatterns = [
    path("dashboard/", DashboardView.as_view()),
    path("analytics/summary/", AnalyticsSummaryView.as_view()),
]
