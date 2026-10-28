#!/usr/bin/env python3
"""Add the iOS permission disclosures and location background mode for PIKI Riders."""

from pathlib import Path
import plistlib
import sys


if len(sys.argv) != 2:
    raise SystemExit("Usage: configure-ios-background-location.py path/to/Info.plist")

plist_path = Path(sys.argv[1])
if not plist_path.is_file():
    raise SystemExit(f"Info.plist not found: {plist_path}")

with plist_path.open("rb") as source:
    info = plistlib.load(source)

info["NSLocationWhenInUseUsageDescription"] = (
    "PIKI Riders usa tu ubicación durante tu jornada para asignarte pedidos y compartir tu posición con el equipo."
)
info["NSLocationAlwaysAndWhenInUseUsageDescription"] = (
    "PIKI Riders necesita tu ubicación durante la jornada activa, incluso con la pantalla bloqueada, para actualizar tus pedidos y compartir tu posición con el equipo."
)

background_modes = info.get("UIBackgroundModes", [])
if not isinstance(background_modes, list):
    raise SystemExit("Info.plist UIBackgroundModes is not an array")
if "location" not in background_modes:
    background_modes.append("location")
info["UIBackgroundModes"] = background_modes

with plist_path.open("wb") as destination:
    plistlib.dump(info, destination, fmt=plistlib.FMT_XML, sort_keys=False)

print(f"Configured iOS location permissions and UIBackgroundModes: location ({plist_path})")
