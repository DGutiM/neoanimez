#!/usr/bin/env python3
"""Version an already validated static candidate; no network access."""

import datetime as dt
from actualizar_datos_mensuales import update_publication_version

if __name__ == "__main__":
    update_publication_version(dt.date.today())
