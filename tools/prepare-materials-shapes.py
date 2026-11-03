#!/usr/bin/env python3
"""Prepare traceable simulator reference data from the accepted TRL inputs.

This script does not calculate finished-lens thickness. Shape outlines are
illustrations extracted from the supplied screenshot, not Lensware trace data.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
from collections import Counter, defaultdict, deque
from decimal import Decimal, InvalidOperation
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
# The runtime ships prepared catalogs; these optional authoring dependencies
# are loaded only after explicit source paths have been supplied on the CLI.
np = None
Image = None
ACTIVE_INDICES = ['1.50', '1.56', '1.57', '1.60', '1.67', '1.74']
FIELDS = [
    'supplier', 'LensCode', 'Descr', 'base_curve', 'diameter',
    'center_thickness', 'edge_thickness', 'sph_from', 'sph_to',
    'cyl_from', 'cyl_to', 'add_from', 'add_to',
]


def decimal_value(value: str) -> Decimal:
    return Decimal(value.replace(',', '.'))


def numeric(value: str) -> float:
    return float(decimal_value(value))


def canonical_number(value: str) -> str:
    return format(decimal_value(value), '.2f')


def material_index(description: str) -> str:
    values = {
        format(Decimal(value.replace(',', '.')), '.2f')
        for value in re.findall(r'(?<![0-9])1[.,][0-9]{1,3}(?![0-9])', description)
    }
    if len(values) != 1:
        raise ValueError(f'Ambiguous refractive-index label: {description!r}')
    return values.pop()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare_materials(material_source: Path) -> dict:
    products: dict[str, dict] = {}
    blanks: dict[str, dict] = {}
    rule_groups: dict[tuple[str, ...], dict] = {}
    supplier_counts: Counter[str] = Counter()
    index_counts: Counter[str] = Counter()
    raw_count = 0

    with material_source.open('r', encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream, delimiter=';')
        if reader.fieldnames != FIELDS:
            raise ValueError(f'Unexpected material columns: {reader.fieldnames!r}')
        for row in reader:
            source_row = reader.line_num
            raw_count += 1
            if any(row.get(field) in (None, '') for field in FIELDS):
                raise ValueError(f'Incomplete material row {source_row}')
            for prefix in ('sph', 'cyl', 'add'):
                if decimal_value(row[f'{prefix}_from']) > decimal_value(row[f'{prefix}_to']):
                    raise ValueError(f'Reversed range at row {source_row}: {prefix}')
            for field in ('base_curve', 'diameter', 'center_thickness', 'edge_thickness'):
                if decimal_value(row[field]) <= 0:
                    raise ValueError(f'Non-positive {field} at row {source_row}')

            supplier = row['supplier']
            code = row['LensCode']
            product_id = f'{supplier}:{code}'
            index = material_index(row['Descr'])
            supplier_counts[supplier] += 1
            index_counts[index] += 1
            product = {
                'id': product_id,
                'supplier': supplier,
                'code': code,
                'name': row['Descr'],
                'index': index,
                'activeForSimulator': index in ACTIVE_INDICES,
            }
            if product_id in products and products[product_id] != product:
                raise ValueError(f'Conflicting product record {product_id}')
            products[product_id] = product

            blank_id = (
                f'{product_id}:BC{canonical_number(row["base_curve"])}'
                f':D{canonical_number(row["diameter"])}'
            )
            blank = {
                'id': blank_id,
                'productId': product_id,
                'baseCurve': numeric(row['base_curve']),
                'diameter': numeric(row['diameter']),
                'ct': numeric(row['center_thickness']),
                'et': numeric(row['edge_thickness']),
            }
            if blank_id in blanks and blanks[blank_id] != blank:
                raise ValueError(f'Conflicting blank dimensions: {blank_id}')
            blanks[blank_id] = blank

            # Only exact 13-field repetitions collapse here. A different range
            # remains a separate rule even when the blank is identical.
            exact_key = tuple(row[field] for field in FIELDS)
            if exact_key not in rule_groups:
                digest = hashlib.sha256(
                    json.dumps(exact_key, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
                ).hexdigest()[:16]
                rule_groups[exact_key] = {
                    'id': f'rule:{digest}',
                    'blankId': blank_id,
                    'sphFrom': numeric(row['sph_from']),
                    'sphTo': numeric(row['sph_to']),
                    'cylFrom': numeric(row['cyl_from']),
                    'cylTo': numeric(row['cyl_to']),
                    'addFrom': numeric(row['add_from']),
                    'addTo': numeric(row['add_to']),
                    'sourceRows': [],
                }
            rule_groups[exact_key]['sourceRows'].append(source_row)

    rules = list(rule_groups.values())
    for rule in rules:
        rule['exactDuplicateCount'] = len(rule['sourceRows']) - 1
        rule['hasExactDuplicates'] = rule['exactDuplicateCount'] > 0

    summary = {
        'sourceFile': material_source.name,
        'sourceSha256': sha256(material_source),
        'sourceRowCount': raw_count,
        'sourceColumnCount': len(FIELDS),
        'productCount': len(products),
        'blankCount': len(blanks),
        'uniqueRuleCount': len(rules),
        'exactDuplicateExtraRows': sum(rule['exactDuplicateCount'] for rule in rules),
        'exactDuplicateGroups': sum(rule['hasExactDuplicates'] for rule in rules),
        'sourceRowsBySupplier': dict(supplier_counts),
        'sourceRowsByIndex': dict(sorted(index_counts.items())),
        'activeIndices': ACTIVE_INDICES,
        'catalogueOnlyIndices': sorted(set(index_counts) - set(ACTIVE_INDICES)),
        'idConvention': 'Deterministic application IDs; not official Lensware record IDs.',
        'indexOrigin': 'Nominal label extracted from Descr; 1.6 is displayed as 1.60.',
        'thicknessMeaning': 'Raw blank CT/ET from source, not finished-lens thickness.',
        'rangeBoundaryAssumption': 'Inclusive; validate against Lensware before production use.',
        'zeroCylinderAssumption': 'Literal zero for candidate search; wildcard semantics not confirmed.',
        'selectionPriority': 'Not supplied. Return all matching candidates; do not auto-pick lowest CT.',
        'units': {
            'dimensions': 'Source CSV omits units; mm assumed for display, to be verified by lab.',
            'baseCurve': 'Source convention; nominal/true curve reference not supplied.',
        },
    }
    assert (raw_count, len(products), len(blanks), len(rules)) == (2689, 19, 186, 2026)
    assert summary['exactDuplicateExtraRows'] == 663
    assert summary['exactDuplicateGroups'] == 51
    assert sum(len(rule['sourceRows']) for rule in rules) == raw_count
    return {
        'schemaVersion': 1,
        'summary': summary,
        'products': list(products.values()),
        'blanks': list(blanks.values()),
        'rules': rules,
    }


def components(mask: np.ndarray) -> list[list[tuple[int, int]]]:
    height, width = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    result = []
    for y, x in zip(*np.where(mask)):
        if seen[y, x]:
            continue
        queue = deque([(int(x), int(y))])
        seen[y, x] = True
        pixels = []
        while queue:
            xx, yy = queue.popleft()
            pixels.append((xx, yy))
            for nx, ny in ((xx - 1, yy), (xx + 1, yy), (xx, yy - 1), (xx, yy + 1)):
                if 0 <= nx < width and 0 <= ny < height and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    queue.append((nx, ny))
        if len(pixels) >= 100:
            result.append(pixels)
    return result


def signed_area(points: list[tuple[float, float]]) -> float:
    return sum(
        x1 * y2 - x2 * y1
        for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1])
    ) / 2


def outer_contour(pixels: list[tuple[int, int]]) -> list[tuple[float, float]]:
    occupied = set(pixels)
    edges: dict[tuple[int, int], list[tuple[int, int]]] = defaultdict(list)
    for x, y in pixels:
        if (x, y - 1) not in occupied:
            edges[(x, y)].append((x + 1, y))
        if (x + 1, y) not in occupied:
            edges[(x + 1, y)].append((x + 1, y + 1))
        if (x, y + 1) not in occupied:
            edges[(x + 1, y + 1)].append((x, y + 1))
        if (x - 1, y) not in occupied:
            edges[(x, y + 1)].append((x, y))

    loops = []
    while edges:
        start = min(edges, key=lambda point: (point[1], point[0]))
        current = start
        contour = []
        for _ in range(100000):
            contour.append(current)
            targets = edges.get(current)
            if not targets:
                raise ValueError('Open contour in screenshot mask')
            target = targets.pop()
            if not targets:
                del edges[current]
            current = target
            if current == start:
                break
        else:
            raise ValueError('Contour tracing failed to close')
        loops.append(contour)
    # The white cross produces an interior hole; use the exterior boundary.
    contour = max(loops, key=lambda loop: abs(signed_area(loop)))
    if signed_area(contour) < 0:
        contour.reverse()
    return contour


def resample(points: list[tuple[float, float]], count: int = 80) -> list[list[float]]:
    segments = list(zip(points, points[1:] + points[:1]))
    lengths = [math.dist(a, b) for a, b in segments]
    perimeter = sum(lengths)
    output = []
    segment_index = 0
    segment_start_distance = 0.0
    for i in range(count):
        target_distance = perimeter * i / count
        while segment_start_distance + lengths[segment_index] < target_distance:
            segment_start_distance += lengths[segment_index]
            segment_index += 1
        a, b = segments[segment_index]
        t = (target_distance - segment_start_distance) / lengths[segment_index]
        output.append([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
    return output


def prepare_shapes(shape_source: Path) -> dict:
    image = np.asarray(Image.open(shape_source).convert('RGB')).astype(int)
    r, g, b = image[:, :, 0], image[:, :, 1], image[:, :, 2]
    mask = (r < 70) & (g > 100) & (b > 90) & (np.abs(g - b) < 45)
    groups = components(mask)
    assert len(groups) == 9, f'Expected 9 shape silhouettes, found {len(groups)}'
    # First row contains five thumbnails, second row four.
    groups.sort(key=lambda pixels: (0 if min(y for x, y in pixels) < 180 else 1, min(x for x, y in pixels)))
    items = []
    for i, pixels in enumerate(groups, 1):
        contour = outer_contour(pixels)
        xmin, xmax = min(x for x, y in contour), max(x for x, y in contour)
        ymin, ymax = min(y for x, y in contour), max(y for x, y in contour)
        width, height = xmax - xmin, ymax - ymin
        points = [
            [round((x - xmin) / width - 0.5, 6), round((y - ymin) / height - 0.5, 6)]
            for x, y in resample(contour)
        ]
        assert len(points) == 80
        assert signed_area([tuple(p) for p in points]) > 0
        assert all(-0.500001 <= value <= 0.500001 for point in points for value in point)
        items.append({
            'code': f'{i:03d}',
            'name': f'Shape {i:03d}',
            'points': points,
            'source': 'screenshot',
            'status': 'illustrative',
            'sourceRegion': {'x': xmin, 'y': ymin, 'width': width, 'height': height},
            'sourceAspectRatio': round(width / height, 6),
        })
    return {
        'schemaVersion': 1,
        'sourceFile': shape_source.name,
        'sourceSha256': sha256(shape_source),
        'coordinateSystem': 'Normalized bounding box; x right, y down; clockwise screen winding.',
        'note': 'Contours derived from source screenshot pixels for illustration. Not official Lensware trace coordinates. Resizing A/B and right/left orientation remain application illustrations.',
        'items': items,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Regenerate optional reference catalogs from the accepted material CSV and Lensware shape screenshot. Normal installation uses the bundled catalogs and does not run this script.')
    parser.add_argument('--materials-csv', type=Path, required=True,
                        help='Path to the accepted raw-material CSV, e.g. DMO UNV OSA(1).csv')
    parser.add_argument('--shape-image', type=Path, required=True,
                        help='Path to the screenshot containing the nine Lensware shapes')
    parser.add_argument('--output-dir', type=Path, default=PROJECT / 'dist' / 'assets',
                        help='Output directory; defaults to this checkout\'s dist/assets')
    args = parser.parse_args()
    for name, source in [('materials CSV', args.materials_csv), ('shape image', args.shape_image)]:
        if not source.is_file():
            parser.error(f'{name} does not exist or is not a file: {source}')
    global np, Image
    try:
        import numpy as np
        from PIL import Image
    except ImportError as exc:
        parser.error(f'Optional catalog authoring dependencies are missing ({exc.name}). Install numpy and Pillow in a Python environment before regenerating catalogs.')
    try:
        materials = prepare_materials(args.materials_csv)
        shapes = prepare_shapes(args.shape_image)
        args.output_dir.mkdir(parents=True, exist_ok=True)
        (args.output_dir / 'materials.json').write_text(json.dumps(materials, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        (args.output_dir / 'shapes.json').write_text(json.dumps(shapes, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    except (OSError, ValueError, AssertionError, InvalidOperation, csv.Error) as exc:
        parser.error(f'Cannot prepare reference catalogs: {exc}')
    print(json.dumps({
        'materials': materials['summary'],
        'shapes': [{'code': row['code'], 'points': len(row['points']), 'region': row['sourceRegion']} for row in shapes['items']],
        'outputs': [str(args.output_dir / 'materials.json'), str(args.output_dir / 'shapes.json')],
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
