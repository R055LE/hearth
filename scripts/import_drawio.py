#!/usr/bin/env python3
"""One-off importer: turn room shapes drawn in a .drawio floorplan into the
JSON polygon format the hearth `rooms` API expects, so existing floorplans
don't need to be re-measured by hand.

Usage:
    python3 import_drawio.py house.drawio
    python3 import_drawio.py house.drawio --post-to http://localhost:8000

A .drawio file is an <mxfile> wrapping one <diagram> per page/tab; each
diagram's content is normally deflate+base64-compressed mxGraph XML (older
or "uncompressed" exports store the XML inline instead — both are handled).
Every rectangular vertex with a label becomes a room, using its bounding box
as the polygon. Non-rectangular/grouped shapes aren't handled — this is a
one-time import, not an ongoing tool, so gaps get fixed by hand afterward.
"""

import argparse
import base64
import json
import urllib.request
import zlib
from urllib.parse import unquote
from xml.etree.ElementTree import Element  # noqa: S405 - type hints only, not used for parsing

from defusedxml import ElementTree as ET


def decode_diagram(diagram_el: Element) -> Element:
    text = (diagram_el.text or "").strip()
    if not text:
        children = list(diagram_el)
        if children:
            return children[0]
        raise ValueError("empty <diagram> element")
    if text.startswith("<"):
        return ET.fromstring(text)
    raw = base64.b64decode(text)
    xml_text = unquote(zlib.decompress(raw, -15).decode("utf-8"))
    return ET.fromstring(xml_text)


def extract_rooms(graph_root: Element, floor: str) -> list[dict]:
    rooms = []
    for cell in graph_root.iter("mxCell"):
        if cell.get("vertex") != "1":
            continue
        name = (cell.get("value") or "").strip()
        if not name:
            continue
        geometry = cell.find("mxGeometry")
        if geometry is None:
            continue
        x, y = float(geometry.get("x", 0)), float(geometry.get("y", 0))
        width, height = float(geometry.get("width", 0)), float(geometry.get("height", 0))
        if width <= 0 or height <= 0:
            continue
        polygon = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]
        rooms.append({"name": name, "floor": floor, "polygon": polygon})
    return rooms


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("drawio_file")
    parser.add_argument(
        "--floor",
        help="Floor name for every room found. Defaults to each diagram page's own "
        "name (drawio tabs are commonly one-per-floor).",
    )
    parser.add_argument(
        "--post-to",
        help="Base URL of a running hearth instance (e.g. http://localhost:8000) to "
        "POST the rooms directly instead of just printing JSON.",
    )
    args = parser.parse_args()

    mxfile = ET.parse(args.drawio_file).getroot()

    all_rooms = []
    for diagram_el in mxfile.findall("diagram"):
        floor = args.floor or diagram_el.get("name") or "main"
        graph_root = decode_diagram(diagram_el)
        all_rooms.extend(extract_rooms(graph_root, floor))

    if args.post_to:
        for room in all_rooms:
            # --post-to is a user-supplied CLI arg pointing at their own hearth instance,
            # not untrusted input, so the arbitrary-scheme audit (S310) doesn't apply here.
            req = urllib.request.Request(  # noqa: S310
                f"{args.post_to}/api/rooms",
                data=json.dumps(room).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req) as resp:  # noqa: S310
                print(f"created room {room['name']!r} on floor {room['floor']!r}: {resp.status}")
    else:
        print(json.dumps(all_rooms, indent=2))


if __name__ == "__main__":
    main()
