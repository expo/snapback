#!/usr/bin/env python3
# Generator for the LLP 0092 §0E.2 byte-pinned HTML-safe serializer fixtures.
#
# The corpus is normative: NNN-name.input.json is the value to serialize
# (key order in the file is the serialization order) and
# NNN-name.expected.bytes is the exact output a conforming Channel A
# serializer must produce (compact JSON, unconditional lowercase
# backslash-u escapes for U+003C, U+003E, U+2028, U+2029 in every string
# token including object keys, raw UTF-8 for everything else RFC 8259
# does not force to be escaped).
#
# The files are written programmatically because this program's transport
# layers have twice silently decoded backslash-u escape sequences back
# into literal characters (LLP 0090 v0.2 revision history; LLP 0092
# §0E.1). Every dangerous character below is constructed with chr(...)
# so the generator source itself never contains a literal escape sequence
# a transport could mangle. After regenerating, verify byte-level with
# xxd/grep: expected files must contain no 0x3C, no 0x3E, and no
# E2 80 A8 / E2 80 A9 sequences.
#
# Usage: python3 generate.py   (from this directory; rewrites all fixtures)

import json
import os
import collections

BS = chr(92)          # backslash
LT = chr(0x3C)        # <
GT = chr(0x3E)        # >
LSEP = chr(0x2028)    # line separator
PSEP = chr(0x2029)    # paragraph separator

ESC = {
    LT: BS + 'u003c',
    GT: BS + 'u003e',
    LSEP: BS + 'u2028',
    PSEP: BS + 'u2029',
}


def serialize(value):
    """Reference implementation of the LLP 0092 §0E.1 serializer."""
    out = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    # The four escaped code points never appear outside string tokens in
    # JSON (structural characters are {}[],:" plus literals), so a
    # whole-document replacement is exactly the per-string-token rule.
    for raw, esc in ESC.items():
        out = out.replace(raw, esc)
    return out.encode('utf-8')


SCRIPT_CLOSE = LT + '/script' + GT              # </script>
SCRIPT_OPEN = LT + 'script' + GT                # <script>
COMMENT_OPEN = LT + '!--'                       # <!--
COMMENT_CLOSE = '--' + GT                       # -->

CASES = [
    (
        '001-script-close-value',
        'literal </script> and <script> inside a string value',
        collections.OrderedDict([
            ('content', SCRIPT_CLOSE + SCRIPT_OPEN + 'alert(1)' + SCRIPT_CLOSE),
        ]),
    ),
    (
        '002-script-close-key',
        'literal </script><script> as an object property name',
        collections.OrderedDict([
            (SCRIPT_CLOSE + SCRIPT_OPEN, True),
            ('safe', 'value'),
        ]),
    ),
    (
        '003-mixed-case',
        'mixed-case script terminators (HTML tag names are case-insensitive)',
        collections.OrderedDict([
            ('a', LT + '/ScRiPt' + GT),
            ('b', LT + '/SCRIPT ' + GT),
            ('c', LT + 'sCrIpT src=x' + GT),
        ]),
    ),
    (
        '004-escaped-slash',
        'backslash before the slash: the < must still be escaped and the backslash preserved',
        collections.OrderedDict([
            ('content', 'a' + LT + BS + '/script' + GT + 'b'),
        ]),
    ),
    (
        '005-comment-open',
        'comment-opening sequence <!-- in string values',
        collections.OrderedDict([
            ('html', COMMENT_OPEN + ' begin'),
            ('note', 'x ' + COMMENT_OPEN + 'y'),
        ]),
    ),
    (
        '006-comment-close',
        'comment-closing sequence --> in a string value',
        collections.OrderedDict([
            ('html', 'end ' + COMMENT_CLOSE + ' tail'),
        ]),
    ),
    (
        '007-nested',
        'dangerous keys and values at depth in nested objects and arrays',
        collections.OrderedDict([
            ('outer', collections.OrderedDict([
                (SCRIPT_CLOSE, [COMMENT_OPEN, collections.OrderedDict([
                    ('inner' + LT + 'tag' + GT, COMMENT_CLOSE),
                ])]),
                ('list', [1, LT, GT]),
            ])),
            ('n', 2),
        ]),
    ),
    (
        '008-unicode-separators',
        'raw U+2028/U+2029 in a value and in a property name',
        collections.OrderedDict([
            ('content', 'line1' + LSEP + 'line2' + PSEP + 'end'),
            (LSEP + 'key', 'v'),
        ]),
    ),
    (
        '009-kitchen-sink',
        'composite: terminators, comments, escaped-slash, separators, quotes, backslashes, controls, raw UTF-8 passthrough',
        collections.OrderedDict([
            (SCRIPT_CLOSE + ' ' + COMMENT_OPEN, collections.OrderedDict([
                ('quote', 'say "hi"' + LT + 'b' + GT),
                ('backslash', BS + ' and ' + BS + BS),
                ('control', 'tab' + chr(9) + 'newline' + chr(10) + 'bell' + chr(7)),
                ('sep', LSEP + PSEP),
                ('utf8', 'caf' + chr(0xE9) + ' ' + chr(0x1F680) + ' stays raw'),
                ('sneaky', 'a' + LT + BS + '/ScRiPt ' + GT + COMMENT_CLOSE + 'b'),
            ])),
        ]),
    ),
]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    index = []
    for name, exercises, value in CASES:
        input_path = os.path.join(here, name + '.input.json')
        expected_path = os.path.join(here, name + '.expected.bytes')
        with open(input_path, 'wb') as f:
            f.write(json.dumps(value, ensure_ascii=False, indent=2).encode('utf-8'))
            f.write(chr(10).encode('utf-8'))
        expected = serialize(value)
        with open(expected_path, 'wb') as f:
            f.write(expected)  # byte-exact: no trailing newline
        # Self-checks: the whole-output byte property, escape presence,
        # and JSON round-trip equality.
        for banned in (bytes([0x3C]), bytes([0x3E]),
                       bytes([0xE2, 0x80, 0xA8]), bytes([0xE2, 0x80, 0xA9])):
            assert banned not in expected, (name, banned)
        assert json.loads(expected.decode('utf-8')) == json.loads(
            json.dumps(value)), name
        index.append(collections.OrderedDict([
            ('name', name),
            ('input', name + '.input.json'),
            ('expected', name + '.expected.bytes'),
            ('exercises', exercises),
        ]))
    with open(os.path.join(here, 'cases.json'), 'wb') as f:
        f.write(json.dumps(collections.OrderedDict([
            ('contract', 'LLP 0092 §0E.1-0E.2 HTML-safe serializer'),
            ('expectedByteProperty',
             'no 0x3C, no 0x3E, no UTF-8 U+2028/U+2029 (E2 80 A8 / E2 80 A9) '
             'anywhere in an expected file; expected files are byte-exact '
             'with no trailing newline'),
            ('cases', index),
        ]), ensure_ascii=False, indent=2).encode('utf-8'))
        f.write(chr(10).encode('utf-8'))
    print('wrote', len(CASES), 'cases')


if __name__ == '__main__':
    main()
