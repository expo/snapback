//! Bounded ISO-BMFF sample, codec-configuration, and timing validation for
//! Snapback 3's deliberately narrow MP4/H.264/AAC lane.

use crate::protocol::Refusal;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::ops::Range;
use std::path::Path;

const MAX_BOXES: u64 = 65_536;
const MAX_TRACKS: usize = 32;
const MAX_SAMPLE_DESCRIPTIONS: u32 = 64;
const MAX_SAMPLES: u64 = 1_000_000;
const MAX_CHUNKS: u32 = 1_000_000;
const MAX_TABLE_ENTRIES: u32 = 1_000_000;
const MAX_CODEC_CONFIG_BYTES: u64 = 64 * 1024;
const MAX_DURATION_MS: u64 = 60_000;
const DURATION_TOLERANCE_MS: u64 = 1_000;

#[derive(Clone, Copy, Debug)]
struct Atom {
    kind: [u8; 4],
    payload: u64,
    end: u64,
}

#[derive(Clone, Copy, Debug)]
struct Clock {
    timescale: u64,
    duration: u64,
}

#[derive(Clone, Copy, Debug)]
struct Timing {
    duration: u64,
    max_delta: u64,
}

#[derive(Clone, Copy, Debug)]
struct SampleToChunk {
    first_chunk: u32,
    samples_per_chunk: u32,
    description_index: u32,
}

#[derive(Clone, Copy, Debug)]
struct TrackValidation {
    handler: [u8; 4],
    media: Clock,
    movie_duration: u64,
}

struct Reader {
    file: File,
    boxes: u64,
    samples: u64,
}

// @ref LLP 2000#integration-choices — S3 intentionally admits only its
// benchmark MP4/H.264/AAC lane; it does not inherit S2's no-codec-refusal
// choice. This validates bounded container/sample structure, not every encoded
// bitstream macroblock.
pub fn verify_h264_aac(path: &Path) -> Result<u64, Refusal> {
    let file = File::open(path).map_err(|error| io("open MP4", error))?;
    let end = file
        .metadata()
        .map_err(|error| io("inspect MP4", error))?
        .len();
    let mut reader = Reader {
        file,
        boxes: 0,
        samples: 0,
    };
    let top = reader.children(0, end, true)?;
    let moov = exactly_one(&top, b"moov", "movie box")?;
    if top.iter().any(|atom| atom.kind == *b"moof") {
        return Err(asset_type(
            "fragmented MP4 is outside the validated Snapback3 media lane",
        ));
    }
    let media_ranges = top
        .iter()
        .filter(|atom| atom.kind == *b"mdat")
        .map(|atom| atom.payload..atom.end)
        .filter(|range| !range.is_empty())
        .collect::<Vec<_>>();
    if media_ranges.is_empty() {
        return Err(asset_type("MP4 has no non-empty media-data box"));
    }

    let movie = reader.children(moov.payload, moov.end, false)?;
    if movie.iter().any(|atom| atom.kind == *b"mvex") {
        return Err(asset_type(
            "fragmented MP4 movie metadata is outside the validated Snapback3 media lane",
        ));
    }
    let movie_clock = reader.parse_mvhd(exactly_one(&movie, b"mvhd", "movie header")?)?;
    reject_overlong(movie_clock, "movie")?;
    let tracks = movie
        .iter()
        .filter(|atom| atom.kind == *b"trak")
        .copied()
        .collect::<Vec<_>>();
    if tracks.is_empty() || tracks.len() > MAX_TRACKS {
        return Err(asset_type(format!(
            "MP4 track count is outside the 1..={MAX_TRACKS} bound"
        )));
    }

    let mut video_tracks = 0_u32;
    let mut longest_movie_track = 0_u64;
    for track in tracks {
        let validated = reader.validate_track(track, movie_clock, &media_ranges)?;
        if validated.handler == *b"vide" {
            video_tracks = video_tracks.saturating_add(1);
        }
        if matches!(&validated.handler, b"vide" | b"soun") {
            reject_overlong(validated.media, "media track")?;
            let media_ms = duration_ms(validated.media)?;
            let track_ms = duration_ms(Clock {
                timescale: movie_clock.timescale,
                duration: validated.movie_duration,
            })?;
            if media_ms.abs_diff(track_ms) > DURATION_TOLERANCE_MS {
                return Err(asset_type(
                    "track header duration disagrees with decoded sample timing",
                ));
            }
            longest_movie_track = longest_movie_track.max(validated.movie_duration);
        }
    }
    if video_tracks == 0 {
        return Err(asset_type("MP4 has no H.264 video track"));
    }
    let movie_ms = duration_ms(movie_clock)?;
    let longest_track_ms = duration_ms(Clock {
        timescale: movie_clock.timescale,
        duration: longest_movie_track,
    })?;
    if movie_ms.abs_diff(longest_track_ms) > DURATION_TOLERANCE_MS {
        return Err(asset_type(
            "movie duration disagrees with its longest playable track",
        ));
    }
    Ok(movie_ms)
}

impl Reader {
    fn children(&mut self, start: u64, end: u64, top: bool) -> Result<Vec<Atom>, Refusal> {
        let mut atoms = Vec::new();
        let mut at = start;
        while at < end {
            self.boxes = self.boxes.saturating_add(1);
            if self.boxes > MAX_BOXES {
                return Err(asset_type("MP4 box count exceeds the processing ceiling"));
            }
            if at.checked_add(8).is_none_or(|value| value > end) {
                return Err(asset_type("MP4 carries a truncated box header"));
            }
            let header = self.read_vec(at, 16.min((end - at) as usize), end)?;
            let size32 = u32::from_be_bytes(header[..4].try_into().unwrap());
            let kind = header[4..8].try_into().unwrap();
            let (payload, atom_end) = match size32 {
                0 if top => (at + 8, end),
                0 => return Err(asset_type("nested MP4 box has an unbounded size")),
                1 => {
                    if header.len() < 16 {
                        return Err(asset_type("MP4 largesize header is truncated"));
                    }
                    let size = u64::from_be_bytes(header[8..16].try_into().unwrap());
                    if size < 16 {
                        return Err(asset_type("MP4 largesize is smaller than its header"));
                    }
                    (
                        at + 16,
                        at.checked_add(size)
                            .ok_or_else(|| asset_type("MP4 box size overflows"))?,
                    )
                }
                2..=7 => return Err(asset_type("MP4 box size is smaller than its header")),
                size => (
                    at + 8,
                    at.checked_add(u64::from(size))
                        .ok_or_else(|| asset_type("MP4 box size overflows"))?,
                ),
            };
            if atom_end > end || atom_end <= at || payload > atom_end {
                return Err(asset_type("MP4 box extends beyond its parent"));
            }
            atoms.push(Atom {
                kind,
                payload,
                end: atom_end,
            });
            at = atom_end;
        }
        Ok(atoms)
    }

    fn validate_track(
        &mut self,
        track: Atom,
        movie: Clock,
        media_ranges: &[Range<u64>],
    ) -> Result<TrackValidation, Refusal> {
        let track_children = self.children(track.payload, track.end, false)?;
        let movie_duration =
            self.parse_tkhd(exactly_one(&track_children, b"tkhd", "track header")?)?;
        let mdia = exactly_one(&track_children, b"mdia", "track media box")?;
        let media_children = self.children(mdia.payload, mdia.end, false)?;
        let handler =
            self.parse_handler(exactly_one(&media_children, b"hdlr", "media handler")?)?;
        let media = self.parse_mdhd(exactly_one(&media_children, b"mdhd", "media header")?)?;
        let minf = exactly_one(&media_children, b"minf", "media information box")?;
        let minf_children = self.children(minf.payload, minf.end, false)?;
        let stbl = exactly_one(&minf_children, b"stbl", "sample table")?;
        let table = self.children(stbl.payload, stbl.end, false)?;
        if table.iter().any(|atom| atom.kind == *b"stz2") {
            return Err(asset_type(
                "compact sample-size tables are outside the validated Snapback3 media lane",
            ));
        }
        let description_count = self
            .validate_descriptions(exactly_one(&table, b"stsd", "sample description")?, handler)?;
        let sample_sizes = self.sample_sizes(exactly_one(&table, b"stsz", "sample-size table")?)?;
        let timing = self.sample_timing(
            exactly_one(&table, b"stts", "decoding-time table")?,
            sample_sizes.len() as u64,
        )?;
        if media.duration.abs_diff(timing.duration) > timing.max_delta {
            return Err(asset_type(
                "media-header duration disagrees with the bounded sample timing table",
            ));
        }
        self.validate_composition_timing(&table, sample_sizes.len() as u64, timing.duration)?;
        if handler == *b"vide" {
            self.validate_sync_samples(&table, sample_sizes.len() as u64)?;
        }
        let mappings =
            self.sample_to_chunk(exactly_one(&table, b"stsc", "sample-to-chunk table")?)?;
        let chunks = self.chunk_offsets(&table)?;
        self.validate_chunk_extents(
            &chunks,
            &mappings,
            &sample_sizes,
            description_count,
            media_ranges,
        )?;
        if movie.timescale == 0 || movie_duration == 0 {
            return Err(asset_type(
                "track header has a zero movie-timescale duration",
            ));
        }
        Ok(TrackValidation {
            handler,
            media,
            movie_duration,
        })
    }

    fn parse_mvhd(&mut self, atom: Atom) -> Result<Clock, Refusal> {
        self.parse_clock(atom, "mvhd")
    }

    fn parse_mdhd(&mut self, atom: Atom) -> Result<Clock, Refusal> {
        self.parse_clock(atom, "mdhd")
    }

    fn parse_clock(&mut self, atom: Atom, name: &str) -> Result<Clock, Refusal> {
        let version = self.fullbox_version(atom, &[0, 1], name)?;
        let (timescale_at, duration_at, duration_bytes) = if version == 0 {
            (atom.payload + 12, atom.payload + 16, 4)
        } else {
            (atom.payload + 20, atom.payload + 24, 8)
        };
        let timescale = u64::from(self.read_u32(timescale_at, atom.end)?);
        let duration = if duration_bytes == 4 {
            u64::from(self.read_u32(duration_at, atom.end)?)
        } else {
            self.read_u64(duration_at, atom.end)?
        };
        if timescale == 0 || duration == 0 || duration == u64::MAX {
            return Err(asset_type(format!(
                "{name} must carry a finite non-zero timescale and duration"
            )));
        }
        Ok(Clock {
            timescale,
            duration,
        })
    }

    fn parse_tkhd(&mut self, atom: Atom) -> Result<u64, Refusal> {
        let version = self.fullbox_version(atom, &[0, 1], "tkhd")?;
        if version == 0 {
            Ok(u64::from(self.read_u32(atom.payload + 20, atom.end)?))
        } else {
            self.read_u64(atom.payload + 28, atom.end)
        }
    }

    fn parse_handler(&mut self, atom: Atom) -> Result<[u8; 4], Refusal> {
        self.fullbox_version(atom, &[0], "hdlr")?;
        self.read4(atom.payload + 8, atom.end)
    }

    fn validate_descriptions(&mut self, stsd: Atom, handler: [u8; 4]) -> Result<u32, Refusal> {
        self.fullbox_version(stsd, &[0], "stsd")?;
        let count = self.read_u32(stsd.payload + 4, stsd.end)?;
        if count == 0 || count > MAX_SAMPLE_DESCRIPTIONS {
            return Err(asset_type(format!(
                "sample description count is outside the 1..={MAX_SAMPLE_DESCRIPTIONS} bound"
            )));
        }
        let entries = self.children(stsd.payload + 8, stsd.end, false)?;
        if entries.len() != count as usize {
            return Err(asset_type(
                "sample description count disagrees with its entries",
            ));
        }
        for entry in entries {
            let data_reference = self.read_u16(entry.payload + 6, entry.end)?;
            if data_reference != 1 {
                return Err(asset_type(
                    "sample description uses an external or unknown data reference",
                ));
            }
            match handler {
                kind if kind == *b"vide" => {
                    if !matches!(&entry.kind, b"avc1" | b"avc3") {
                        return Err(asset_type("video track is not H.264 (avc1/avc3)"));
                    }
                    let child_start = entry
                        .payload
                        .checked_add(78)
                        .filter(|start| *start <= entry.end)
                        .ok_or_else(|| asset_type("H.264 sample entry is truncated"))?;
                    let children = self.children(child_start, entry.end, false)?;
                    self.validate_avcc(exactly_one(
                        &children,
                        b"avcC",
                        "AVC decoder configuration",
                    )?)?;
                }
                kind if kind == *b"soun" => {
                    if entry.kind != *b"mp4a" {
                        return Err(asset_type("audio track is not AAC (mp4a)"));
                    }
                    let version = self.read_u16(entry.payload + 8, entry.end)?;
                    if version != 0 {
                        return Err(asset_type(
                            "versioned QuickTime audio sample entries are outside the validated MP4 lane",
                        ));
                    }
                    let child_start = entry
                        .payload
                        .checked_add(28)
                        .filter(|start| *start <= entry.end)
                        .ok_or_else(|| asset_type("AAC sample entry is truncated"))?;
                    let children = self.children(child_start, entry.end, false)?;
                    self.validate_esds(exactly_one(
                        &children,
                        b"esds",
                        "AAC elementary-stream descriptor",
                    )?)?;
                }
                _ => {}
            }
        }
        Ok(count)
    }

    fn validate_avcc(&mut self, atom: Atom) -> Result<(), Refusal> {
        let size = atom.end - atom.payload;
        if !(7..=MAX_CODEC_CONFIG_BYTES).contains(&size) {
            return Err(asset_type("AVC decoder configuration has an invalid size"));
        }
        let bytes = self.read_vec(atom.payload, size as usize, atom.end)?;
        if bytes[0] != 1
            || bytes[4] & 0xfc != 0xfc
            || bytes[4] & 0b11 == 0b10
            || bytes[5] & 0xe0 != 0xe0
        {
            return Err(asset_type("AVC decoder configuration header is malformed"));
        }
        let mut at = 6_usize;
        let sps = usize::from(bytes[5] & 0x1f);
        if sps == 0 {
            return Err(asset_type("AVC decoder configuration carries no SPS"));
        }
        for _ in 0..sps {
            at = skip_length_prefixed_nal(&bytes, at, "SPS", 7)?;
        }
        let pps = *bytes
            .get(at)
            .ok_or_else(|| asset_type("AVC decoder configuration is missing its PPS count"))?
            as usize;
        at += 1;
        if pps == 0 {
            return Err(asset_type("AVC decoder configuration carries no PPS"));
        }
        for _ in 0..pps {
            at = skip_length_prefixed_nal(&bytes, at, "PPS", 8)?;
        }
        Ok(())
    }

    fn validate_esds(&mut self, atom: Atom) -> Result<(), Refusal> {
        self.fullbox_version(atom, &[0], "esds")?;
        let size = atom.end.saturating_sub(atom.payload + 4);
        if size == 0 || size > MAX_CODEC_CONFIG_BYTES {
            return Err(asset_type(
                "AAC elementary-stream descriptor has an invalid size",
            ));
        }
        let bytes = self.read_vec(atom.payload + 4, size as usize, atom.end)?;
        let (tag, payload, end) = descriptor(&bytes, 0, bytes.len())?;
        if tag != 0x03 || end != bytes.len() || payload + 3 > end {
            return Err(asset_type("AAC ES descriptor is malformed"));
        }
        let flags = bytes[payload + 2];
        let mut at = payload + 3;
        if flags & 0x80 != 0 {
            at = at
                .checked_add(2)
                .ok_or_else(|| asset_type("AAC ES flags overflow"))?;
        }
        if flags & 0x40 != 0 {
            let url_len = usize::from(
                *bytes
                    .get(at)
                    .ok_or_else(|| asset_type("AAC ES URL is truncated"))?,
            );
            at = at
                .checked_add(1 + url_len)
                .ok_or_else(|| asset_type("AAC ES URL size overflows"))?;
        }
        if flags & 0x20 != 0 {
            at = at
                .checked_add(2)
                .ok_or_else(|| asset_type("AAC ES OCR flags overflow"))?;
        }
        if at > end {
            return Err(asset_type("AAC ES optional fields are truncated"));
        }
        let mut found_decoder = false;
        while at < end {
            let (child_tag, child_payload, child_end) = descriptor(&bytes, at, end)?;
            if child_tag == 0x04 {
                self.validate_aac_decoder_descriptor(&bytes, child_payload, child_end)?;
                found_decoder = true;
            }
            at = child_end;
        }
        if !found_decoder {
            return Err(asset_type("AAC ES descriptor has no decoder configuration"));
        }
        Ok(())
    }

    fn validate_aac_decoder_descriptor(
        &self,
        bytes: &[u8],
        payload: usize,
        end: usize,
    ) -> Result<(), Refusal> {
        if payload + 13 > end || bytes[payload] != 0x40 || bytes[payload + 1] >> 2 != 0x05 {
            return Err(asset_type("audio decoder configuration is not MPEG-4 AAC"));
        }
        let mut at = payload + 13;
        let mut found_specific = false;
        while at < end {
            let (tag, specific, child_end) = descriptor(bytes, at, end)?;
            if tag == 0x05 {
                validate_audio_specific_config(&bytes[specific..child_end])?;
                found_specific = true;
            }
            at = child_end;
        }
        if !found_specific {
            return Err(asset_type(
                "AAC decoder configuration has no AudioSpecificConfig",
            ));
        }
        Ok(())
    }

    fn sample_sizes(&mut self, stsz: Atom) -> Result<Vec<u64>, Refusal> {
        self.fullbox_version(stsz, &[0], "stsz")?;
        let fixed = u64::from(self.read_u32(stsz.payload + 4, stsz.end)?);
        let count = u64::from(self.read_u32(stsz.payload + 8, stsz.end)?);
        if count == 0 || self.samples.saturating_add(count) > MAX_SAMPLES {
            return Err(asset_type(format!(
                "total MP4 sample count is outside the 1..={MAX_SAMPLES} bound"
            )));
        }
        self.samples += count;
        let variable_bytes = if fixed == 0 {
            count
                .checked_mul(4)
                .ok_or_else(|| asset_type("sample-size table length overflows"))?
        } else {
            0
        };
        let expected = stsz
            .payload
            .checked_add(12)
            .and_then(|at| at.checked_add(variable_bytes))
            .ok_or_else(|| asset_type("sample-size table length overflows"))?;
        if expected != stsz.end {
            return Err(asset_type(
                "sample-size table length disagrees with its count",
            ));
        }
        let mut sizes = Vec::with_capacity(count as usize);
        if fixed > 0 {
            sizes.resize(count as usize, fixed);
        } else {
            let mut at = stsz.payload + 12;
            for _ in 0..count {
                let size = u64::from(self.read_u32(at, stsz.end)?);
                if size == 0 {
                    return Err(asset_type("MP4 carries a zero-byte media sample"));
                }
                sizes.push(size);
                at += 4;
            }
        }
        Ok(sizes)
    }

    fn sample_timing(&mut self, stts: Atom, sample_count: u64) -> Result<Timing, Refusal> {
        self.fullbox_version(stts, &[0], "stts")?;
        let entries = self.table_entry_count(stts, 8, "decoding-time")?;
        let mut count = 0_u64;
        let mut duration = 0_u64;
        let mut max_delta = 0_u64;
        let mut at = stts.payload + 8;
        for _ in 0..entries {
            let samples = u64::from(self.read_u32(at, stts.end)?);
            let delta = u64::from(self.read_u32(at + 4, stts.end)?);
            if samples == 0 || delta == 0 {
                return Err(asset_type("decoding-time entries must be non-zero"));
            }
            count = count
                .checked_add(samples)
                .ok_or_else(|| asset_type("decoding-time sample count overflows"))?;
            duration = duration
                .checked_add(
                    samples
                        .checked_mul(delta)
                        .ok_or_else(|| asset_type("decoding-time duration overflows"))?,
                )
                .ok_or_else(|| asset_type("decoding-time duration overflows"))?;
            max_delta = max_delta.max(delta);
            at += 8;
        }
        if count != sample_count {
            return Err(asset_type(
                "decoding-time sample count disagrees with the sample-size table",
            ));
        }
        Ok(Timing {
            duration,
            max_delta,
        })
    }

    fn validate_composition_timing(
        &mut self,
        table: &[Atom],
        sample_count: u64,
        decode_duration: u64,
    ) -> Result<(), Refusal> {
        let entries = table
            .iter()
            .filter(|atom| atom.kind == *b"ctts")
            .copied()
            .collect::<Vec<_>>();
        if entries.len() > 1 {
            return Err(asset_type("MP4 carries duplicate composition-time tables"));
        }
        let Some(ctts) = entries.first().copied() else {
            return Ok(());
        };
        let version = self.fullbox_version(ctts, &[0, 1], "ctts")?;
        let count = self.table_entry_count(ctts, 8, "composition-time")?;
        let mut samples = 0_u64;
        let mut at = ctts.payload + 8;
        for _ in 0..count {
            let run = u64::from(self.read_u32(at, ctts.end)?);
            if run == 0 {
                return Err(asset_type("composition-time entries must cover samples"));
            }
            let raw = self.read_u32(at + 4, ctts.end)?;
            let offset = if version == 0 {
                i64::from(raw)
            } else {
                i64::from(i32::from_be_bytes(raw.to_be_bytes()))
            };
            if offset.unsigned_abs() > decode_duration {
                return Err(asset_type(
                    "composition-time offset exceeds the track duration",
                ));
            }
            samples = samples
                .checked_add(run)
                .ok_or_else(|| asset_type("composition-time sample count overflows"))?;
            at += 8;
        }
        if samples != sample_count {
            return Err(asset_type(
                "composition-time sample count disagrees with the sample-size table",
            ));
        }
        Ok(())
    }

    fn validate_sync_samples(&mut self, table: &[Atom], sample_count: u64) -> Result<(), Refusal> {
        let entries = table
            .iter()
            .filter(|atom| atom.kind == *b"stss")
            .copied()
            .collect::<Vec<_>>();
        if entries.len() > 1 {
            return Err(asset_type("MP4 carries duplicate sync-sample tables"));
        }
        let Some(stss) = entries.first().copied() else {
            return Ok(());
        };
        self.fullbox_version(stss, &[0], "stss")?;
        let count = self.table_entry_count(stss, 4, "sync-sample")?;
        let mut prior = 0_u32;
        let mut at = stss.payload + 8;
        for _ in 0..count {
            let sample = self.read_u32(at, stss.end)?;
            if sample == 0 || u64::from(sample) > sample_count || sample <= prior {
                return Err(asset_type(
                    "sync-sample indices must be increasing and within the sample table",
                ));
            }
            prior = sample;
            at += 4;
        }
        Ok(())
    }

    fn sample_to_chunk(&mut self, stsc: Atom) -> Result<Vec<SampleToChunk>, Refusal> {
        self.fullbox_version(stsc, &[0], "stsc")?;
        let count = self.table_entry_count(stsc, 12, "sample-to-chunk")?;
        let mut entries = Vec::with_capacity(count as usize);
        let mut at = stsc.payload + 8;
        for _ in 0..count {
            let entry = SampleToChunk {
                first_chunk: self.read_u32(at, stsc.end)?,
                samples_per_chunk: self.read_u32(at + 4, stsc.end)?,
                description_index: self.read_u32(at + 8, stsc.end)?,
            };
            if entry.first_chunk == 0
                || entry.samples_per_chunk == 0
                || entry.description_index == 0
                || entries
                    .last()
                    .is_some_and(|prior: &SampleToChunk| prior.first_chunk >= entry.first_chunk)
            {
                return Err(asset_type("sample-to-chunk entries are malformed"));
            }
            entries.push(entry);
            at += 12;
        }
        if entries.first().is_none_or(|entry| entry.first_chunk != 1) {
            return Err(asset_type(
                "sample-to-chunk mapping must begin at chunk one",
            ));
        }
        Ok(entries)
    }

    fn chunk_offsets(&mut self, table: &[Atom]) -> Result<Vec<u64>, Refusal> {
        let stco = table
            .iter()
            .filter(|atom| atom.kind == *b"stco")
            .copied()
            .collect::<Vec<_>>();
        let co64 = table
            .iter()
            .filter(|atom| atom.kind == *b"co64")
            .copied()
            .collect::<Vec<_>>();
        if stco.len() + co64.len() != 1 {
            return Err(asset_type(
                "sample table must carry exactly one 32-bit or 64-bit chunk-offset table",
            ));
        }
        let (atom, width, label) = if let Some(atom) = stco.first().copied() {
            (atom, 4_u64, "chunk-offset")
        } else {
            (co64[0], 8_u64, "large chunk-offset")
        };
        self.fullbox_version(atom, &[0], label)?;
        let count = self.read_u32(atom.payload + 4, atom.end)?;
        if count == 0 || count > MAX_CHUNKS {
            return Err(asset_type(format!(
                "chunk count is outside the 1..={MAX_CHUNKS} bound"
            )));
        }
        let expected = atom
            .payload
            .checked_add(8)
            .and_then(|at| at.checked_add(u64::from(count) * width))
            .ok_or_else(|| asset_type("chunk-offset table length overflows"))?;
        if expected != atom.end {
            return Err(asset_type(
                "chunk-offset table length disagrees with its count",
            ));
        }
        let mut offsets = Vec::with_capacity(count as usize);
        let mut at = atom.payload + 8;
        for _ in 0..count {
            offsets.push(if width == 4 {
                u64::from(self.read_u32(at, atom.end)?)
            } else {
                self.read_u64(at, atom.end)?
            });
            at += width;
        }
        Ok(offsets)
    }

    fn validate_chunk_extents(
        &self,
        chunks: &[u64],
        mappings: &[SampleToChunk],
        samples: &[u64],
        description_count: u32,
        media_ranges: &[Range<u64>],
    ) -> Result<(), Refusal> {
        if mappings
            .iter()
            .any(|entry| entry.description_index > description_count)
        {
            return Err(asset_type(
                "sample-to-chunk mapping names a missing sample description",
            ));
        }
        if mappings
            .last()
            .is_some_and(|entry| entry.first_chunk as usize > chunks.len())
        {
            return Err(asset_type(
                "sample-to-chunk mapping starts beyond the chunk-offset table",
            ));
        }
        let mut mapping_index = 0_usize;
        let mut sample_index = 0_usize;
        let mut referenced_bytes = 0_u64;
        let mut extents = Vec::with_capacity(chunks.len());
        for (index, offset) in chunks.iter().copied().enumerate() {
            let chunk_number = index as u32 + 1;
            while mapping_index + 1 < mappings.len()
                && mappings[mapping_index + 1].first_chunk <= chunk_number
            {
                mapping_index += 1;
            }
            let count = mappings[mapping_index].samples_per_chunk as usize;
            let end_sample = sample_index
                .checked_add(count)
                .filter(|end| *end <= samples.len())
                .ok_or_else(|| {
                    asset_type("sample-to-chunk mapping exceeds the sample-size table")
                })?;
            let chunk_bytes = samples[sample_index..end_sample]
                .iter()
                .try_fold(0_u64, |sum, size| sum.checked_add(*size))
                .ok_or_else(|| asset_type("chunk byte extent overflows"))?;
            let chunk_end = offset
                .checked_add(chunk_bytes)
                .ok_or_else(|| asset_type("chunk byte extent overflows"))?;
            if !media_ranges
                .iter()
                .any(|range| offset >= range.start && chunk_end <= range.end)
            {
                return Err(asset_type(
                    "sample chunk points outside a bounded media-data payload",
                ));
            }
            referenced_bytes = referenced_bytes
                .checked_add(chunk_bytes)
                .ok_or_else(|| asset_type("referenced media byte count overflows"))?;
            extents.push(offset..chunk_end);
            sample_index = end_sample;
        }
        if sample_index != samples.len() || referenced_bytes == 0 {
            return Err(asset_type(
                "sample/chunk tables do not reference every non-empty media sample",
            ));
        }
        extents.sort_unstable_by_key(|extent| extent.start);
        if extents.windows(2).any(|pair| pair[0].end > pair[1].start) {
            return Err(asset_type(
                "sample chunks overlap inside the media-data payload",
            ));
        }
        Ok(())
    }

    fn table_entry_count(
        &mut self,
        atom: Atom,
        entry_bytes: u64,
        label: &str,
    ) -> Result<u32, Refusal> {
        let count = self.read_u32(atom.payload + 4, atom.end)?;
        if count == 0 || count > MAX_TABLE_ENTRIES {
            return Err(asset_type(format!(
                "{label} entry count is outside the 1..={MAX_TABLE_ENTRIES} bound"
            )));
        }
        let expected = atom
            .payload
            .checked_add(8)
            .and_then(|at| at.checked_add(u64::from(count) * entry_bytes))
            .ok_or_else(|| asset_type(format!("{label} table length overflows")))?;
        if expected != atom.end {
            return Err(asset_type(format!(
                "{label} table length disagrees with its count"
            )));
        }
        Ok(count)
    }

    fn fullbox_version(&mut self, atom: Atom, allowed: &[u8], label: &str) -> Result<u8, Refusal> {
        let version = self
            .read_vec(atom.payload, 4, atom.end)?
            .first()
            .copied()
            .expect("four bytes read");
        if !allowed.contains(&version) {
            return Err(asset_type(format!(
                "{label} carries an unsupported version"
            )));
        }
        Ok(version)
    }

    fn read_u16(&mut self, at: u64, end: u64) -> Result<u16, Refusal> {
        Ok(u16::from_be_bytes(
            self.read_vec(at, 2, end)?.try_into().unwrap(),
        ))
    }

    fn read_u32(&mut self, at: u64, end: u64) -> Result<u32, Refusal> {
        Ok(u32::from_be_bytes(
            self.read_vec(at, 4, end)?.try_into().unwrap(),
        ))
    }

    fn read_u64(&mut self, at: u64, end: u64) -> Result<u64, Refusal> {
        Ok(u64::from_be_bytes(
            self.read_vec(at, 8, end)?.try_into().unwrap(),
        ))
    }

    fn read4(&mut self, at: u64, end: u64) -> Result<[u8; 4], Refusal> {
        Ok(self.read_vec(at, 4, end)?.try_into().unwrap())
    }

    fn read_vec(&mut self, at: u64, length: usize, end: u64) -> Result<Vec<u8>, Refusal> {
        if at
            .checked_add(length as u64)
            .is_none_or(|value| value > end)
        {
            return Err(asset_type("MP4 field is truncated"));
        }
        self.file
            .seek(SeekFrom::Start(at))
            .map_err(|error| io("seek MP4", error))?;
        let mut bytes = vec![0_u8; length];
        self.file
            .read_exact(&mut bytes)
            .map_err(|error| io("read MP4", error))?;
        Ok(bytes)
    }
}

fn descriptor(bytes: &[u8], at: usize, parent_end: usize) -> Result<(u8, usize, usize), Refusal> {
    let tag = *bytes
        .get(at)
        .filter(|_| at < parent_end)
        .ok_or_else(|| asset_type("MPEG-4 descriptor tag is truncated"))?;
    let mut cursor = at + 1;
    let mut length = 0_usize;
    let mut terminated = false;
    for _ in 0..4 {
        let byte = *bytes
            .get(cursor)
            .filter(|_| cursor < parent_end)
            .ok_or_else(|| asset_type("MPEG-4 descriptor length is truncated"))?;
        cursor += 1;
        length = length
            .checked_shl(7)
            .and_then(|value| value.checked_add(usize::from(byte & 0x7f)))
            .ok_or_else(|| asset_type("MPEG-4 descriptor length overflows"))?;
        if byte & 0x80 == 0 {
            terminated = true;
            break;
        }
    }
    if !terminated {
        return Err(asset_type("MPEG-4 descriptor length exceeds four bytes"));
    }
    let end = cursor
        .checked_add(length)
        .filter(|end| *end <= parent_end)
        .ok_or_else(|| asset_type("MPEG-4 descriptor extends beyond its parent"))?;
    Ok((tag, cursor, end))
}

fn skip_length_prefixed_nal(
    bytes: &[u8],
    at: usize,
    label: &str,
    expected_type: u8,
) -> Result<usize, Refusal> {
    let length_end = at
        .checked_add(2)
        .filter(|end| *end <= bytes.len())
        .ok_or_else(|| asset_type(format!("AVC {label} length is truncated")))?;
    let length = usize::from(u16::from_be_bytes(
        bytes[at..length_end].try_into().unwrap(),
    ));
    if length == 0 {
        return Err(asset_type(format!("AVC {label} is empty")));
    }
    if bytes[length_end] & 0x1f != expected_type {
        return Err(asset_type(format!(
            "AVC {label} carries the wrong NAL-unit type"
        )));
    }
    length_end
        .checked_add(length)
        .filter(|end| *end <= bytes.len())
        .ok_or_else(|| asset_type(format!("AVC {label} extends beyond avcC")))
}

fn validate_audio_specific_config(bytes: &[u8]) -> Result<(), Refusal> {
    if bytes.len() < 2 {
        return Err(asset_type("AAC AudioSpecificConfig is truncated"));
    }
    let object_type = bytes[0] >> 3;
    if matches!(object_type, 0 | 5 | 29 | 31) {
        return Err(asset_type(
            "AAC AudioSpecificConfig carries an unsupported object type",
        ));
    }
    let frequency_index = ((bytes[0] & 0x07) << 1) | (bytes[1] >> 7);
    let channel_config = if frequency_index == 15 {
        if bytes.len() < 5 {
            return Err(asset_type(
                "AAC AudioSpecificConfig explicit frequency is truncated",
            ));
        }
        let frequency = (u32::from(bytes[1] & 0x7f) << 17)
            | (u32::from(bytes[2]) << 9)
            | (u32::from(bytes[3]) << 1)
            | u32::from(bytes[4] >> 7);
        if frequency == 0 {
            return Err(asset_type(
                "AAC AudioSpecificConfig has a zero explicit frequency",
            ));
        }
        (bytes[4] >> 3) & 0x0f
    } else {
        if frequency_index >= 13 {
            return Err(asset_type(
                "AAC AudioSpecificConfig has a reserved frequency index",
            ));
        }
        (bytes[1] >> 3) & 0x0f
    };
    if !(1..=7).contains(&channel_config) {
        return Err(asset_type(
            "AAC AudioSpecificConfig channel layout is outside the validated lane",
        ));
    }
    Ok(())
}

fn exactly_one(atoms: &[Atom], kind: &[u8; 4], label: &str) -> Result<Atom, Refusal> {
    let mut found = atoms.iter().copied().filter(|atom| atom.kind == *kind);
    let Some(value) = found.next() else {
        return Err(asset_type(format!("MP4 is missing its {label}")));
    };
    if found.next().is_some() {
        return Err(asset_type(format!("MP4 carries duplicate {label}s")));
    }
    Ok(value)
}

fn duration_ms(clock: Clock) -> Result<u64, Refusal> {
    let milliseconds = u128::from(clock.duration)
        .checked_mul(1_000)
        .ok_or_else(|| asset_type("media duration overflows"))?
        / u128::from(clock.timescale);
    u64::try_from(milliseconds).map_err(|_| asset_type("media duration exceeds u64"))
}

fn reject_overlong(clock: Clock, label: &str) -> Result<(), Refusal> {
    if u128::from(clock.duration) * 1_000
        > u128::from(clock.timescale) * u128::from(MAX_DURATION_MS)
    {
        return Err(too_large(format!("{label} duration exceeds 60 seconds")));
    }
    Ok(())
}

fn asset_type(message: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_ASSET_TYPE",
        "input",
        message,
        "upload an MP4 whose bounded samples use configured H.264 and optional AAC",
        "assets/video",
    )
}

fn too_large(message: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_ASSET_TOO_LARGE",
        "input",
        message,
        "upload an MP4 no longer than 60 seconds",
        "assets/video",
    )
}

fn io(action: &str, error: std::io::Error) -> Refusal {
    Refusal::new(
        "E_OWNER_ASSET_IO",
        "owner",
        format!("could not {action}: {error}"),
        "repair the asset staging directory and retry",
        "assets/storage",
    )
}
