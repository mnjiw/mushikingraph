# -*- coding: utf-8 -*-
"""
Builds the static data files consumed by the web app (site/data/*) from
character.csv + CSVchar/*.CSV.

Output:
  site/data/dates.json      -- sorted array of every distinct collection date
                                that appears in ANY character's CSV, as
                                "YYYY-MM-DD" strings.
  site/data/characters.json -- array of character metadata objects, in the
                                same order/index as site/data/series.bin.
  site/data/series.bin      -- binary, delta + varint encoded time series for
                                every character (see format below). This is
                                the bulk of the data (~136k data points) so
                                it gets the compact encoding; dates.json and
                                characters.json are small enough that plain
                                JSON is fine.

series.bin layout (little-endian throughout):
  Uint32   N                       -- number of characters
  Uint32[N+1] blobOffset           -- byte offset of each character's blob
                                       within the payload section (so
                                       character i's bytes are
                                       payload[blobOffset[i] : blobOffset[i+1]])
  <payload, N blobs back to back>

Each character's blob is its (dateIndex, count) series, sorted ascending by
date, encoded as:
  varint   numPoints
  varint[numPoints]   date index deltas (delta from the previous point's
                       date index, or from 0 for the first point -- date
                       indices only ever increase, so these are unsigned)
  zigzag-varint[numPoints]  count deltas (delta from the previous point's
                       count, or from 0 for the first point -- counts can
                       decrease, e.g. a revival after a gap, so these need
                       a signed encoding)

varints are standard LEB128 (7 payload bits per byte, MSB = continuation).
Signed deltas use zigzag mapping (0,-1,1,-2,2,... -> 0,1,2,3,4,...) before
varint-encoding so small negative and positive deltas both stay 1 byte.

Run this any time CSVchar/ or character.csv changes, then redeploy site/.
"""
import os
import csv
import json
import struct

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHARACTER_CSV = os.path.join(BASE, "character.csv")
CSVCHAR_DIR = os.path.join(BASE, "CSVchar")
OUT_DIR = os.path.join(BASE, "site", "data")


def yymmdd_to_iso(yymmdd):
    yy = int(yymmdd[0:2])
    mm = int(yymmdd[2:4])
    dd = int(yymmdd[4:6])
    return "%04d-%02d-%02d" % (2000 + yy, mm, dd)


def write_uvarint(buf, value):
    """Unsigned LEB128."""
    if value < 0:
        raise ValueError("write_uvarint got a negative value: %r" % value)
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            buf.append(byte | 0x80)
        else:
            buf.append(byte)
            return


def zigzag(n):
    return (n << 1) if n >= 0 else (((-n) << 1) - 1)


def write_svarint(buf, value):
    write_uvarint(buf, zigzag(value))


def encode_character_blob(pairs):
    """pairs: list of (dateIdx:int, count:int), sorted ascending by dateIdx."""
    buf = bytearray()
    write_uvarint(buf, len(pairs))
    prev_d = 0
    for d, _ in pairs:
        write_uvarint(buf, d - prev_d)
        prev_d = d
    prev_c = 0
    for _, c in pairs:
        write_svarint(buf, c - prev_c)
        prev_c = c
    return bytes(buf)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    with open(CHARACTER_CSV, encoding="cp932", newline="") as f:
        reader = csv.DictReader(f)
        char_rows = list(reader)

    per_char_series = []  # list of list[(yymmdd, count)], aligned to char_rows
    all_dates = set()
    missing_files = []
    for row in char_rows:
        name = row["name"]
        path = os.path.join(CSVCHAR_DIR, name + ".CSV")
        if not os.path.exists(path):
            missing_files.append(name)
            per_char_series.append([])
            continue
        with open(path, encoding="cp932") as f:
            pairs = []
            for line in f:
                line = line.strip()
                if not line:
                    continue
                d, c = line.split(",")
                pairs.append((d, int(c)))
        pairs.sort(key=lambda p: p[0])
        per_char_series.append(pairs)
        all_dates.update(d for d, _ in pairs)

    if missing_files:
        raise SystemExit("ERROR: missing CSVchar files for: %r" % missing_files)

    sorted_dates = sorted(all_dates)  # yymmdd strings sort correctly
    date_index = {d: i for i, d in enumerate(sorted_dates)}
    iso_dates = [yymmdd_to_iso(d) for d in sorted_dates]

    characters_out = []
    blobs = []
    for row, pairs in zip(char_rows, per_char_series):
        characters_out.append({
            "name": row["name"],
            "name_kana": row["name_kana"],
            "name_kana_sub": row["name_kana_sub"],
            "number_kana": int(row["number_kana"]),
            "number_debut": int(row["number_debut"]),
            "number_subscribe": int(row["number_subscribe"]),
            "gender": int(row["gender"]),
            "graduation": int(row["graduation"]),
            "generation": int(row["generation"]),
            "color": row["color"],
        })
        idx_pairs = [(date_index[d], c) for d, c in pairs]
        blobs.append(encode_character_blob(idx_pairs))

    with open(os.path.join(OUT_DIR, "dates.json"), "w", encoding="utf-8") as f:
        json.dump(iso_dates, f, ensure_ascii=False, separators=(",", ":"))

    with open(os.path.join(OUT_DIR, "characters.json"), "w", encoding="utf-8") as f:
        json.dump(characters_out, f, ensure_ascii=False, separators=(",", ":"))

    n = len(blobs)
    offsets = [0]
    for b in blobs:
        offsets.append(offsets[-1] + len(b))
    with open(os.path.join(OUT_DIR, "series.bin"), "wb") as f:
        f.write(struct.pack("<I", n))
        f.write(struct.pack("<%dI" % (n + 1), *offsets))
        for b in blobs:
            f.write(b)

    old_series_json = os.path.join(OUT_DIR, "series.json")
    if os.path.exists(old_series_json):
        os.remove(old_series_json)  # superseded by series.bin

    total_points = sum(len(p) for p in per_char_series)
    print("characters:", len(characters_out))
    print("distinct dates:", len(iso_dates), "(", iso_dates[0], "to", iso_dates[-1], ")")
    print("total data points:", total_points)
    for fn in ("dates.json", "characters.json", "series.bin"):
        p = os.path.join(OUT_DIR, fn)
        print(fn, os.path.getsize(p), "bytes")


if __name__ == "__main__":
    main()
