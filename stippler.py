"""Conservative, dependency-free paint variation for Stormworks vehicle XML."""
import random
from collections import Counter, defaultdict
import re
import xml.etree.ElementTree as ET


TAG = re.compile(r'<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:[^>"\']|"[^"]*"|\'[^\']*\')*>')
PAINT = re.compile(r'''(?P<prefix>\s(?P<name>sc|bc|ac|bc2|bc3)\s*=\s*)(?P<quote>["'])(?P<color>[^"']*)(?P=quote)''')
HEX = re.compile(r'[0-9a-fA-F]{1,6}\Z')


def supported_colors(name, value):
    if HEX.fullmatch(value) and (name != 'sc' or len(value) == 6):
        return [value], 0
    parts = value.split(',')
    if name == 'sc' and parts[0].isdigit() and len(parts) > 1 and all(HEX.fullmatch(p) for p in parts[1:]):
        return parts, 1
    return None, 0


def vary_xml(source, strength=12, seed=0):
    """Vary supported paints on component <o> tags, preserving XML text."""
    if not isinstance(source, str) or not source.strip():
        raise ValueError('Choose a nonempty XML file.')
    if not isinstance(strength, int) or isinstance(strength, bool) or not 0 <= strength <= 50:
        raise ValueError('Strength must be a whole number between 0 and 50.')
    if not isinstance(seed, int) or isinstance(seed, bool):
        raise ValueError('Seed must be a whole number.')
    if re.search(r'<!\s*(?:DOCTYPE|ENTITY)\b', source, re.I):
        raise ValueError('XML containing DTDs or entities is not supported.')
    try:
        root = ET.fromstring(source)
    except ET.ParseError as exc:
        raise ValueError(f'Invalid XML: {exc}') from exc
    if root.tag != 'vehicle':
        raise ValueError('Expected a Stormworks <vehicle> XML document.')
    rng = random.Random(seed)
    matched = changed = objects = 0
    counts = Counter()
    shades = defaultdict(Counter)

    def tag_replace(match):
        nonlocal matched, changed, objects
        tag = match.group()
        if not re.match(r'<o(?:\s|/?>)', tag) or not any(supported_colors(p['name'], p['color'])[0] for p in PAINT.finditer(tag)):
            return tag
        objects += 1
        offset = rng.randint(-strength, strength)

        def paint_replace(paint):
            nonlocal matched, changed
            parts, start = supported_colors(paint['name'], paint['color'])
            if parts is None:
                return paint.group()
            for index in range(start, len(parts)):
                matched += 1
                color = parts[index].zfill(6)
                channels = [int(color[i:i + 2], 16) for i in (0, 2, 4)]
                result = ''.join(f'{max(0, min(255, c + offset)):02X}' for c in channels)
                counts[color.upper()] += 1
                shades[color.upper()][result] += 1
                if result.lower() != color.lower():
                    changed += 1
                    parts[index] = result
            return paint['prefix'] + paint['quote'] + ','.join(parts) + paint['quote']

        return PAINT.sub(paint_replace, tag)

    output = TAG.sub(tag_replace, source)
    if not matched:
        raise ValueError('No supported paint found. Expected hexadecimal bc/ac/bc2/bc3 colors or sc face colors on <o> elements.')
    preview_rng = random.Random(seed)
    preview = []
    for color, count in counts.most_common(3):
        variants = shades[color]
        preview.append({'color': color, 'count': count,
                        'samples': preview_rng.choices(list(variants), weights=list(variants.values()), k=64)})
    return output, {'objects': objects, 'paint_fields': matched, 'changed_fields': changed, 'preview': preview}
