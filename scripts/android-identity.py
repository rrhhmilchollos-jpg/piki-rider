#!/usr/bin/env python3
"""Generate/check Play-aligned identity. No network; no invented icon or versionCode."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape
from PIL import Image, ImageColor

ROOT = Path(__file__).resolve().parents[1]
ANDROID = "{http://schemas.android.com/apk/res/android}"
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
ADAPTIVE = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical(path):
    with Image.open(path) as image:
        require(image.format == "PNG", "El origen canónico debe ser PNG, no una miniatura ni una conversión inventada.")
        require(image.size == (512, 512), "El icono canónico debe ser exactamente el PNG 512×512 de la ficha Play.")
        result = image.convert("RGBA")
        return result


def outputs(image):
    for density, scale in DENSITIES.items():
        side = round(48 * scale)
        legacy = image.resize((side, side), Image.Resampling.LANCZOS)
        for filename in ("ic_launcher.png", "ic_launcher_round.png"):
            yield f"android/app/src/main/res/mipmap-{density}/{filename}", legacy
        side = round(108 * scale)
        # A 46dp square fits entirely inside the 66dp safe circle. Never crop artwork.
        content = round(46 * scale)
        foreground = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        foreground.alpha_composite(image.resize((content, content), Image.Resampling.LANCZOS), ((side - content) // 2, (side - content) // 2))
        yield f"android/app/src/main/res/mipmap-{density}/ic_launcher_foreground.png", foreground
    yield "public/piki-icon-192.png", image.resize((192, 192), Image.Resampling.LANCZOS)
    yield "public/piki-icon.png", image
    yield "public/piki-favicon.webp", image.resize((192, 192), Image.Resampling.LANCZOS)


def generate(root, env):
    for name in ("PIKI_CANONICAL_ICON",):
        require(env.get(name, "").strip(), f"Falta {name}; no se cambia el logo ni se adivina la ficha de Play.")
    source = Path(env["PIKI_CANONICAL_ICON"]).expanduser().resolve()
    require(source.is_file(), "No existe el icono canónico configurado.")
    image = canonical(source)
    config = root / "capacitor.config.ts"
    text = config.read_text()
    current_name = re.search(r'appName:\s*[\'\"]([^\'\"]+)', text).group(1)
    name = env.get("PIKI_PLAY_APP_NAME", current_name).strip()
    require(len(name) <= 30 and not re.search(r"[\x00-\x1f\\]", name), "Nombre Play no válido (máximo 30 caracteres; sin controles ni barras inversas).")
    background = env.get("PIKI_ADAPTIVE_BACKGROUND", "").strip().upper()
    if not background:
        opaque = [(count, color) for count, color in image.getcolors(512 * 512) if color[3] == 255]
        require(opaque, "El origen no tiene píxeles opacos: configura explícitamente un fondo aprobado.")
        color = max(opaque, key=lambda pair: (pair[0], pair[1]))[1]
        background = "#" + "".join(f"{component:02X}" for component in color[:3])
    require(re.fullmatch(r"#[0-9A-F]{6}", background), "PIKI_ADAPTIVE_BACKGROUND debe ser #RRGGBB aprobado, no inferido.")
    ImageColor.getrgb(background)
    package = re.search(r'appId:\s*[\'\"]([^\'\"]+)', text).group(1)
    for target in (root / "resources/play-icon.png", root / "public/piki-icon-512.png"):
        target.parent.mkdir(parents=True, exist_ok=True)
        if source != target.resolve():
            shutil.copyfile(source, target)
    for relative, generated in outputs(image):
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.suffix == ".webp":
            generated.save(target, format="WEBP", lossless=True, exact=True)
        else:
            generated.save(target, format="PNG")
    res = root / "android/app/src/main/res"
    for filename in ("ic_launcher.xml", "ic_launcher_round.xml"):
        (res / "mipmap-anydpi-v26" / filename).write_text(ADAPTIVE)
    (res / "values/ic_launcher_background.xml").write_text(f'<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">{background}</color></resources>\n')
    # Remove unused Android-template logo resources instead of leaving ambiguous fallbacks.
    for obsolete in ("drawable-v24/ic_launcher_foreground.xml", "drawable/ic_launcher_background.xml"):
        (res / obsolete).unlink(missing_ok=True)
    strings = res / "values/strings.xml"
    native_manifest = root / "android/app/src/main/AndroidManifest.xml"
    native_manifest.write_text(native_manifest.read_text().replace('android:label="@string/title_activity_main"', 'android:label="@string/app_name"'))
    xml = strings.read_text()
    for key in ("app_name", "title_activity_main"):
        xml, count = re.subn(rf'(<string name="{key}">).*?(</string>)', lambda match: match[1] + escape(name).replace("'", "\\'").replace('"', '\\"') + match[2], xml)
        require(count == 1, f"Falta o se duplica el recurso {key}.")
    strings.write_text(xml)
    text, count = re.subn(r'appName:\s*([\'\"])(?:\\.|(?!\1).)*\1', lambda _: "appName: " + json.dumps(name, ensure_ascii=False), text)
    require(count == 1, "No se puede actualizar appName de Capacitor de forma inequívoca.")
    config.write_text(text)
    manifest = root / "public/manifest.json"
    if manifest.exists():
        web = json.loads(manifest.read_text())
        web["name"] = web["short_name"] = name
        manifest.write_text(json.dumps(web, indent=2, ensure_ascii=False) + "\n")
    gradle = (root / "android/app/build.gradle").read_text()
    namespace_match = re.search(r'\bnamespace\s*(?:=\s*)?[\'\"]([^\'\"]+)', gradle)
    require(namespace_match, "Falta namespace Java Android.")
    record = {"schema": 1, "locale": "es-ES", "packageName": package, "androidNamespace": namespace_match.group(1), "playAppName": name, "canonicalIcon": "resources/play-icon.png", "canonicalSha256": sha256(source), "canonicalSourceUrl": env.get("PIKI_CANONICAL_SOURCE_URL", ""), "adaptiveBackground": background, "foregroundSafeSquareDp": 46}
    (root / "resources/android-identity.json").write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n")
    check(root)


def check(root, synced=False):
    record_path = root / "resources/android-identity.json"
    require(record_path.is_file(), "Falta resources/android-identity.json. Extrae y valida nombre/icono es-ES en Play; ejecuta generate con el PNG canónico. Release bloqueada.")
    record = json.loads(record_path.read_text())
    require(record.get("schema") == 1 and record.get("locale") == "es-ES" and record.get("foregroundSafeSquareDp") == 46, "Registro de identidad no soportado.")
    name, package = record["playAppName"], record["packageName"]
    source = root / "resources/play-icon.png"
    require(record["canonicalIcon"] == "resources/play-icon.png", "El origen canónico debe estar versionado en resources/play-icon.png.")
    require(sha256(source) == record["canonicalSha256"], "El icono canónico ha cambiado sin revisar el registro Play.")
    image = canonical(source)
    external = os.environ.get("PIKI_CANONICAL_ICON")
    if external:
        require(sha256(Path(external)) == record["canonicalSha256"], "El asset suministrado no coincide con el icono registrado.")
    expected_name = os.environ.get("PIKI_PLAY_APP_NAME")
    if expected_name:
        require(name == expected_name.strip(), "Nombre registrado distinto de la ficha Play configurada.")
    require(sha256(root / "public/piki-icon-512.png") == record["canonicalSha256"], "El asset público 512 no coincide byte a byte con el de Play.")
    config = (root / "capacitor.config.ts").read_text()
    require(re.search(r'appId:\s*[\'\"]' + re.escape(package) + r'[\'\"]', config), "appId Capacitor no coincide.")
    names = re.findall(r'appName:\s*([\'\"])((?:\\.|(?!\1).)*)\1', config)
    require(len(names) == 1, "appName Capacitor ambiguo.")
    config_name = json.loads('"' + names[0][1] + '"') if names[0][0] == '"' else names[0][1]
    require(config_name == name, "appName Capacitor no coincide con la ficha.")
    gradle = (root / "android/app/build.gradle").read_text()
    require(re.search(r'\bapplicationId\s*(?:=\s*)?[\'\"]' + re.escape(package) + r'[\'\"]', gradle), "applicationId Android no coincide con la ficha.")
    # Java namespace can legitimately differ from the published applicationId.
    namespace = record.get("androidNamespace", package)
    require(re.search(r'\bnamespace\s*(?:=\s*)?[\'\"]' + re.escape(namespace) + r'[\'\"]', gradle), "namespace Java distinto del registro revisado.")
    res = root / "android/app/src/main/res"
    for xml_path in res.glob("values*/strings.xml"):
        strings = {entry.attrib.get("name"): entry.text or "" for entry in ET.parse(xml_path).getroot() if entry.tag == "string"}
        for key in ("app_name", "title_activity_main"):
            if key in strings:
                require(strings[key].replace("\\'", "'").replace('\\"', '"') == name, f"Nombre {key} distinto en {xml_path}.")
        if xml_path.parent.name == "values":
            require(all(key in strings for key in ("app_name", "title_activity_main")), "Faltan nombres Android principales.")
            require(strings.get("package_name") == package and strings.get("custom_url_scheme") == package, "Package/URL scheme Android distinto.")
    manifest_path = root / "android/app/src/main/AndroidManifest.xml"
    app = ET.parse(manifest_path).getroot().find("application")
    require(app is not None and app.get(ANDROID + "label") == "@string/app_name", "Label application distinto de app_name.")
    require(app.get(ANDROID + "icon") == "@mipmap/ic_launcher" and app.get(ANDROID + "roundIcon") == "@mipmap/ic_launcher_round", "Referencias de icono incorrectas en AndroidManifest.")
    for activity in app.findall("activity") + app.findall("activity-alias"):
        if activity.find("intent-filter/category[@" + ANDROID + "name='android.intent.category.LAUNCHER']") is not None:
            require(activity.get(ANDROID + "label", "@string/app_name") == "@string/app_name", "El launcher puede sobrescribir el nombre de la aplicación.")
            require(activity.get(ANDROID + "icon", "@mipmap/ic_launcher") == "@mipmap/ic_launcher", "El launcher puede sobrescribir el icono.")
            require(activity.get(ANDROID + "roundIcon", "@mipmap/ic_launcher_round") == "@mipmap/ic_launcher_round", "El launcher puede sobrescribir el icono redondo.")
    for path in (root / "android/app/src").glob("*/AndroidManifest.xml"):
        if path != manifest_path:
            require(not re.search(r'android:(?:label|icon|roundIcon)\s*=', path.read_text()), "Manifest de flavor/buildType sobrescribe la identidad.")
    for path in (root / "android/app/src").glob("*/res/**/ic_launcher*"):
        require(path.is_relative_to(res), "Recurso de flavor/buildType sobrescribe el icono canónico.")
    for path in (root / "android/app/src").glob("*/res/values*/*.xml"):
        if not path.is_relative_to(res):
            require(not any(node.get("name") in ("app_name", "title_activity_main") for node in ET.parse(path).getroot()), "Recurso de flavor/buildType sobrescribe el nombre.")
    expected_paths = set()
    for relative, expected in outputs(image):
        target = root / relative
        expected_paths.add(target)
        require(target.is_file(), f"Falta {relative}.")
        with Image.open(target) as actual:
            require(actual.size == expected.size and actual.convert("RGBA").tobytes() == expected.tobytes(), f"Icono no derivado del origen canónico: {relative}.")
    for path in res.glob("**/ic_launcher*.png"):
        require(path in expected_paths, f"Recurso alternativo no controlado: {path}.")
    for filename in ("ic_launcher.xml", "ic_launcher_round.xml"):
        path = res / "mipmap-anydpi-v26" / filename
        require(path.read_text() == ADAPTIVE, f"Adaptativo {filename} no coincide con la receta canónica.")
    permitted_xml = {res / "mipmap-anydpi-v26/ic_launcher.xml", res / "mipmap-anydpi-v26/ic_launcher_round.xml", res / "values/ic_launcher_background.xml"}
    for path in res.glob("**/ic_launcher*.xml"):
        require(path in permitted_xml, f"Vector/override de plantilla no permitido: {path}.")
    color = ET.parse(res / "values/ic_launcher_background.xml").getroot().find("color")
    require(color is not None and color.attrib.get("name") == "ic_launcher_background" and color.text == record["adaptiveBackground"], "Fondo adaptativo distinto del aprobado.")
    for path in res.glob("values*/*.xml"):
        if path != res / "values/ic_launcher_background.xml":
            require(not any(node.get("name") == "ic_launcher_background" for node in ET.parse(path).getroot()), "Override de fondo adaptativo no controlado.")
    if synced:
        assets = root / "android/app/src/main/assets/public"
        require(sha256(assets / "piki-icon-512.png") == record["canonicalSha256"], "Asset nativo sincronizado distinto del canónico.")
        native_config = json.loads((root / "android/app/src/main/assets/capacitor.config.json").read_text())
        require(native_config.get("appId") == package and native_config.get("appName") == name, "Config Capacitor sincronizada distinta.")
    print(f"Identidad Android verificada: {package}; nombre/iconos/resources coinciden con el registro es-ES.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("generate", "check"))
    parser.add_argument("--project-dir", type=Path, default=ROOT, help="Repositorio Capacitor destino; por defecto el que contiene este script")
    parser.add_argument("--canonical512", type=Path, help="PNG canónico 512x512; alternativa a PIKI_CANONICAL_ICON")
    parser.add_argument("--play-app-name", help="Nombre es-ES confirmado; si se omite se conserva appName existente")
    parser.add_argument("--background", help="#RRGGBB aprobado; si se omite se usa el píxel opaco más frecuente del origen")
    parser.add_argument("--source-url", help="URL de procedencia Play para el registro")
    parser.add_argument("--synced", action="store_true", help="Verifica assets y config después de cap sync")
    args = parser.parse_args()
    env = dict(os.environ)
    for key, value in (("PIKI_CANONICAL_ICON", args.canonical512), ("PIKI_PLAY_APP_NAME", args.play_app_name), ("PIKI_ADAPTIVE_BACKGROUND", args.background), ("PIKI_CANONICAL_SOURCE_URL", args.source_url)):
        if value is not None:
            env[key] = str(value)
    if args.command == "check":
        if args.canonical512 is not None:
            os.environ["PIKI_CANONICAL_ICON"] = str(args.canonical512)
        if args.play_app_name is not None:
            os.environ["PIKI_PLAY_APP_NAME"] = args.play_app_name
    try:
        if args.command == "generate":
            generate(args.project_dir.resolve(), env)
        else:
            check(args.project_dir.resolve(), args.synced)
    except (ValueError, OSError, KeyError, ET.ParseError) as error:
        print(f"ERROR identidad Android: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
