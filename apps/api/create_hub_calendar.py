"""Script one-shot: cria o calendário dedicado 'MAINFRAME' na conta Google.

Uso:
    python create_hub_calendar.py

Imprime o calendar_id criado. Cole em .env como GOOGLE_CALENDAR_ID.
"""
from __future__ import annotations

from calendar_service import (
    GoogleCalendarService,
    build_google_calendar_settings_from_env,
)

CALENDAR_NAME = "MAINFRAME"
CALENDAR_DESCRIPTION = "Tarefas e blocos de tempo criados pelo MAINFRAME."


def main() -> None:
    settings = build_google_calendar_settings_from_env()
    svc = GoogleCalendarService(settings)
    svc.authenticate(interactive=False)
    raw = svc._build_service(interactive=False)

    existing = raw.calendarList().list().execute().get("items", [])
    for cal in existing:
        if cal.get("summary") == CALENDAR_NAME:
            print(f"Já existe: {cal['id']}")
            return

    created = (
        raw.calendars()
        .insert(
            body={
                "summary": CALENDAR_NAME,
                "description": CALENDAR_DESCRIPTION,
                "timeZone": settings.timezone,
            }
        )
        .execute()
    )
    print(f"Criado: {created['id']}")
    print("Adicione no .env: GOOGLE_CALENDAR_ID=" + created["id"])


if __name__ == "__main__":
    main()
