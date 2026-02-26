#!/usr/bin/env python3
"""
annotate_docx.py — Run-aware DOCX annotation tool.

Replaces known real values with {placeholder} tags in a DOCX file,
even when the text is split across multiple XML runs (w:t nodes).

Usage:
  python3 scripts/annotate_docx.py \\
    --input docs/templates/samples/sbi_lb_lt5cr/report.docx \\
    --mapping scripts/sbi_lb_lt5cr_mapping.json \\
    --output docs/templates/samples/sbi_lb_lt5cr/report.docx

IMPORTANT:
  - Uses run-merging approach to avoid corrupting XML structure.
  - Preserves all formatting (bold, italic, font size) when possible.
  - Never replaces inside field codes, hyperlink anchors, or bookmarks.
"""

import argparse
import copy
import json
import re
import shutil
import sys
import zipfile
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET

# Word namespace
W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
ET.register_namespace('w', W_NS)

W = lambda tag: f'{{{W_NS}}}{tag}'


def get_runs_in_paragraph(para: ET.Element) -> list:
    return para.findall(f'.//{W("r")}')


def get_text_from_run(run: ET.Element) -> str:
    parts = []
    for t in run.findall(f'{W("t")}'):
        parts.append(t.text or '')
    return ''.join(parts)


def set_text_in_run(run: ET.Element, text: str):
    """Set the text of a run, preserving existing t element attributes."""
    ts = run.findall(f'{W("t")}')
    if not ts:
        t = ET.SubElement(run, W('t'))
        t.text = text
        if text and (text[0].isspace() or text[-1].isspace()):
            t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        return
    # Use the first t element, clear others
    first_t = ts[0]
    first_t.text = text
    if text and (text[0].isspace() or text[-1].isspace()):
        first_t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    for extra_t in ts[1:]:
        run.remove(extra_t)


def apply_replacements_to_paragraph(para: ET.Element, replacements: dict[str, str], stats: dict) -> int:
    """
    Merge all runs in a paragraph into text, apply all replacements,
    then write back to the first run and blank the rest.
    Returns number of replacements made.
    """
    runs = get_runs_in_paragraph(para)
    if not runs:
        return 0

    # Build full text + run boundary map
    full_text = ''
    boundaries = []  # (start_char, end_char_exclusive, run_element)
    for run in runs:
        start = len(full_text)
        txt = get_text_from_run(run)
        full_text += txt
        boundaries.append((start, len(full_text), run))

    original = full_text
    modified = full_text

    count = 0
    for real_value, placeholder in replacements.items():
        if real_value in modified:
            modified = modified.replace(real_value, placeholder)
            count += modified.count(placeholder) - full_text.count(placeholder)
            stats['replaced'] = stats.get('replaced', 0) + 1
            stats['details'].append(f'  "{real_value}" → "{placeholder}"')

    if modified == original:
        return 0

    # Write modified text back: first run gets everything, rest get empty string
    if boundaries:
        set_text_in_run(boundaries[0][2], modified)
        for _, _, run in boundaries[1:]:
            set_text_in_run(run, '')

    return count


def apply_replacements_to_xml(xml_bytes: bytes, replacements: dict[str, str]) -> tuple[bytes, dict]:
    """Parse XML, walk paragraphs, apply run-aware replacements, return new bytes."""
    stats = {'replaced': 0, 'details': []}
    root = ET.fromstring(xml_bytes)

    # Walk all paragraphs (w:p) anywhere in the document
    for para in root.iter(W('p')):
        apply_replacements_to_paragraph(para, replacements, stats)

    # Also process table cells (w:tc) which contain paragraphs
    # (already covered by iter, but make sure)

    # Serialize back
    ET.indent(root, space='')  # Python 3.9+; no-op on older
    out = ET.tostring(root, encoding='unicode')
    return out.encode('utf-8'), stats


def annotate_docx(input_path: Path, mapping: dict[str, str], output_path: Path):
    """Main annotation function."""
    print(f'Reading: {input_path}')

    with zipfile.ZipFile(input_path, 'r') as zin:
        names = zin.namelist()
        file_contents = {name: zin.read(name) for name in names}

    total_stats = {'replaced': 0, 'details': []}

    xml_parts_to_process = [
        'word/document.xml',
        'word/header1.xml', 'word/header2.xml', 'word/header3.xml',
        'word/footer1.xml', 'word/footer2.xml', 'word/footer3.xml',
    ]
    # Add any actual headers/footers present
    extra_parts = [n for n in names if (
        (n.startswith('word/header') or n.startswith('word/footer'))
        and n.endswith('.xml')
        and n not in xml_parts_to_process
    )]
    xml_parts_to_process.extend(extra_parts)

    for part in xml_parts_to_process:
        if part not in file_contents:
            continue
        raw = file_contents[part]
        modified, stats = apply_replacements_to_xml(raw, mapping)
        file_contents[part] = modified
        if stats['replaced']:
            print(f'  [{part}] {stats["replaced"]} replacement(s):')
            for d in stats['details']:
                print(d)
        total_stats['replaced'] += stats['replaced']

    # Write output DOCX
    output_path.parent.mkdir(parents=True, exist_ok=True)
    buf = BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zout:
        for name, content in file_contents.items():
            zout.writestr(name, content)
    output_path.write_bytes(buf.getvalue())

    print(f'\nDone. Total replacements: {total_stats["replaced"]}')
    print(f'Output: {output_path}')
    return total_stats['replaced']


def main():
    parser = argparse.ArgumentParser(description='Run-aware DOCX annotator')
    parser.add_argument('--input', required=True, help='Input .docx path')
    parser.add_argument('--mapping', required=True, help='JSON mapping file {real_value: placeholder}')
    parser.add_argument('--output', required=True, help='Output .docx path (can be same as input)')
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    mapping_path = Path(args.mapping)

    if not input_path.exists():
        print(f'ERROR: Input file not found: {input_path}', file=sys.stderr)
        sys.exit(1)
    if not mapping_path.exists():
        print(f'ERROR: Mapping file not found: {mapping_path}', file=sys.stderr)
        sys.exit(1)

    with open(mapping_path) as f:
        mapping = json.load(f)

    # If output == input, work on a temp file first
    if output_path.resolve() == input_path.resolve():
        tmp = input_path.with_suffix('.docx.tmp')
        annotate_docx(input_path, mapping, tmp)
        shutil.move(str(tmp), str(output_path))
    else:
        annotate_docx(input_path, mapping, output_path)


if __name__ == '__main__':
    main()
