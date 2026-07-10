# -*- coding: utf-8 -*-
"""
Fetches each character's current YouTube subscriber count via the YouTube
Data API v3 (channels.list, part=statistics -- 1 quota unit per call, up to
50 channel IDs per call), then:

  1. updates `number_subscribe` in character.csv, and
  2. appends today's "YYMMDD,count" line to CSVchar/<name>.CSV (or, if this
     script already ran today, overwrites that day's line instead of adding
     a duplicate -- makes manual re-runs and workflow_dispatch retries safe).

Characters whose channelid is "0" (graduated, no channel) are skipped
entirely, same as they've always been skipped for data collection.

If a character's CSVchar/<name>.CSV file doesn't exist yet (a brand-new
character added to character.csv with a real channelid), it's created here
-- build_data.py hard-fails on any missing file, so this keeps adding a new
character from breaking the next scheduled run.

Requires the YOUTUBE_API_KEY environment variable. Run
`python scripts/build_data.py` afterwards to regenerate site/data/*.
"""
import csv
import json
import os
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHARACTER_CSV = os.path.join(BASE, "character.csv")
CSVCHAR_DIR = os.path.join(BASE, "CSVchar")

API_KEY = os.environ.get("YOUTUBE_API_KEY")
API_URL = "https://www.googleapis.com/youtube/v3/channels"
BATCH_SIZE = 50  # YouTube API allows up to 50 IDs per request

JST = timezone(timedelta(hours=9))


def fetch_subscriber_counts(channel_ids):
    """channel_ids: list[str] -> dict[str, int] (channelid -> subscriberCount).
    A channel with a hidden or missing subscriber count is simply absent
    from the result, same as if the API call for its batch had failed."""
    result = {}
    for i in range(0, len(channel_ids), BATCH_SIZE):
        batch = channel_ids[i:i + BATCH_SIZE]
        params = urllib.parse.urlencode({
            "part": "statistics",
            "id": ",".join(batch),
            "key": API_KEY,
        })
        req = urllib.request.Request(API_URL + "?" + params)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.load(resp)
        except Exception as e:
            print("WARNING: API request failed for batch starting at %d: %s" % (i, e), file=sys.stderr)
            continue
        for item in data.get("items", []):
            stats = item.get("statistics", {})
            if stats.get("hiddenSubscriberCount"):
                continue
            count = stats.get("subscriberCount")
            if count is None:
                continue
            result[item["id"]] = int(count)
    return result


def yymmdd_today_jst():
    return datetime.now(JST).strftime("%y%m%d")


def update_character_csv_file(name, count, today):
    path = os.path.join(CSVCHAR_DIR, name + ".CSV")
    line = "%s,%d" % (today, count)
    if os.path.exists(path):
        with open(path, encoding="cp932", newline="") as f:
            content = f.read()
        lines = [l for l in content.splitlines() if l.strip()]
    else:
        lines = []  # brand-new character -- this becomes its first data point
    if lines and lines[-1].split(",")[0] == today:
        lines[-1] = line  # already ran today -- overwrite instead of duplicating
    else:
        lines.append(line)
    with open(path, "w", encoding="cp932", newline="") as f:
        f.write("\r\n".join(lines) + "\r\n")


def main():
    if not API_KEY:
        raise SystemExit("ERROR: YOUTUBE_API_KEY is not set")

    with open(CHARACTER_CSV, encoding="cp932", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)

    targets = [r for r in rows if r["channelid"] != "0"]
    channel_ids = [r["channelid"] for r in targets]
    print("fetching subscriber counts for %d channels..." % len(channel_ids))
    counts = fetch_subscriber_counts(channel_ids)
    print("got %d / %d counts back" % (len(counts), len(channel_ids)))

    if not counts:
        raise SystemExit("ERROR: got zero subscriber counts back, aborting without writing anything")

    today = yymmdd_today_jst()
    updated = 0
    for row in targets:
        cid = row["channelid"]
        if cid not in counts:
            print("WARNING: no count fetched for %s (%s), skipping" % (row["name"], cid), file=sys.stderr)
            continue
        count = counts[cid]
        row["number_subscribe"] = str(count)
        update_character_csv_file(row["name"], count, today)
        updated += 1

    with open(CHARACTER_CSV, "w", encoding="cp932", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(rows)

    print("updated %d / %d characters" % (updated, len(targets)))


if __name__ == "__main__":
    main()
