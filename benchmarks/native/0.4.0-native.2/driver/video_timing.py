"""Bind MP4 presentation endpoints to encoded sample timing, not duration labels."""
# @ref LLP 0201.000#5 — endpoint evidence must agree with the actual decoded samples.
import struct
from pathlib import Path

def endpoints_covered(intervals,ranges):
    """Require a real start sample; allow only sub-frame terminal rounding."""
    terminal=max(intervals,key=lambda interval:(interval[1],interval[0]))
    terminal_frame=terminal[1]-terminal[0]
    for begin,end in ranges:
        start_covered=any(left<=begin<right for left,right in intervals)
        end_covered=any(left<=end<=right for left,right in intervals)
        if not end_covered and terminal[1]<end<terminal[1]+terminal_frame:end_covered=True
        if not start_covered or not end_covered:return False
    return True

def presentation_timing(path, require_endpoints=True):
    data = Path(path).read_bytes()

    def boxes(start, end):
        result = []
        while start < end:
            if start + 8 > end:
                raise ValueError('invalid-video-timing')
            size, kind = struct.unpack_from('>I4s', data, start)
            header = 8
            if size == 1:
                size = struct.unpack_from('>Q', data, start + 8)[0]
                header = 16
            elif size == 0:
                size = end - start
            if size < header or start + size > end:
                raise ValueError('invalid-video-timing')
            result.append((kind, start + header, start + size))
            start += size
        return result

    def child(parent, name):
        found = [b for b in boxes(parent[1], parent[2]) if b[0] == name]
        if len(found) != 1:
            raise ValueError('invalid-video-timing')
        return found[0]

    def duration(box):
        at = box[1]
        version = data[at]
        if version not in (0, 1):
            raise ValueError('invalid-video-timing')
        offset = at + (20 if version else 12)
        scale = struct.unpack_from('>I', data, offset)[0]
        ticks = struct.unpack_from('>Q' if version else '>I', data, offset + 4)[0]
        if not scale or not ticks:
            raise ValueError('invalid-video-timing')
        return scale, ticks

    moov = child((b'root', 0, len(data)), b'moov')
    movie_scale, movie_ticks = duration(child(moov, b'mvhd'))
    movie_seconds = movie_ticks / movie_scale
    tracks = []
    for track in boxes(moov[1], moov[2]):
        if track[0] != b'trak':
            continue
        media = child(track, b'mdia')
        handler = child(media, b'hdlr')
        if data[handler[1] + 8:handler[1] + 12] == b'vide':
            tracks.append((track, media))
    if len(tracks) != 1:
        raise ValueError('invalid-video-timing')
    track, media = tracks[0]
    media_scale, _ = duration(child(media, b'mdhd'))
    table = child(child(media, b'minf'), b'stbl')

    def runs(box, signed=False):
        at = box[1]
        count = struct.unpack_from('>I', data, at + 4)[0]
        if at + 8 + count * 8 > box[2]:
            raise ValueError('invalid-video-timing')
        return [struct.unpack_from('>Ii' if signed else '>II', data, at + 8 + i * 8) for i in range(count)]

    durations = runs(child(table, b'stts'))
    sample_count = sum(n for n, _ in durations)
    if not 0 < sample_count <= 1_000_000:
        raise ValueError('invalid-video-timing')
    sizes = [b for b in boxes(table[1], table[2]) if b[0] in (b'stsz', b'stz2')]
    if len(sizes) != 1:
        raise ValueError('invalid-video-timing')
    size_box = sizes[0];at = size_box[1]
    stored_count = struct.unpack_from('>I', data, at + 8)[0]
    if stored_count != sample_count:
        raise ValueError('video-sample-count-mismatch')
    composition = [b for b in boxes(table[1], table[2]) if b[0] == b'ctts']
    # QuickTime recordings use signed composition offsets even with CTTS v0.
    brand = child((b'root', 0, len(data)), b'ftyp')
    quicktime = data[brand[1]:brand[1] + 4] == b'qt  '
    offsets = runs(composition[0], data[composition[0][1]] == 1 or quicktime) if composition else [(sample_count, 0)]
    if sum(n for n, _ in offsets) != sample_count:
        raise ValueError('invalid-video-timing')
    expanded_offsets = (offset for n, offset in offsets for _ in range(n))
    intervals, dts = [], 0
    for n, delta in durations:
        if not delta:
            raise ValueError('invalid-video-timing')
        for _ in range(n):
            pts = dts + next(expanded_offsets)
            intervals.append((pts / media_scale, (pts + delta) / media_scale))
            dts += delta
    intervals.sort()
    tolerance = min(.01, 1 / media_scale + 1 / movie_scale)
    # Always parse edit-table structure. Empty, rate-changed or uncovered edits
    # are disqualifying only when this capture is evidence for a measurement.
    edits = [b for b in boxes(track[1], track[2]) if b[0] == b'edts']
    ranges = [(0., movie_seconds)]
    if edits:
        edit = child(edits[0], b'elst');at = edit[1];version = data[at]
        size = 20 if version == 1 else 12
        count = struct.unpack_from('>I', data, at + 4)[0]
        if version not in (0, 1) or at + 8 + count * size > edit[2]:
            raise ValueError('invalid-video-timing')
        ranges, movie_total = [], 0.
        for i in range(count):
            length, begin, rate, fraction = struct.unpack_from('>Qqhh' if version else '>Iihh', data, at + 8 + i * size)
            if require_endpoints and (begin < 0 or rate != 1 or fraction != 0):
                raise ValueError('video-endpoint-uncovered')
            seconds = length / movie_scale;movie_total += seconds
            ranges.append((begin / media_scale, begin / media_scale + seconds))
        if require_endpoints and abs(movie_total - movie_seconds) > tolerance:
            raise ValueError('video-endpoint-uncovered')
    if require_endpoints:
        # Simulator recordings can close their movie/edit duration a few
        # milliseconds after the terminal encoded sample. Accept only that
        # terminal rounding, bounded strictly below one actual frame. The
        # beginning still has to land in a sample, without a tick tolerance.
        if not endpoints_covered(intervals,ranges):raise ValueError('video-endpoint-uncovered')
    return movie_seconds, sample_count
