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

If the SKIP_IF_RECORDED_TODAY environment variable is truthy, the script
exits without doing anything when today's (JST) data point has already been
recorded for essentially every target character. That makes it safe to fire
the workflow several times a day as a backup against GitHub Actions dropping
or heavily delaying the scheduled run -- the backup runs become no-ops once
the day's numbers are in.

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

# バックアップ実行をスキップしてよいと判断する割合。登録者数を非公開にした
# チャンネルが1つでもあると「全員分そろった」は永久に成立しないため、
# ちょうど100%ではなく閾値で判定する。
RECORDED_TODAY_THRESHOLD = 0.9


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


def last_recorded_date(name):
    """CSVchar/<name>.CSV の最終行の日付(YYMMDD)。ファイルが無ければ None。"""
    path = os.path.join(CSVCHAR_DIR, name + ".CSV")
    if not os.path.exists(path):
        return None
    with open(path, encoding="cp932", newline="") as f:
        lines = [l for l in f.read().splitlines() if l.strip()]
    if not lines:
        return None
    return lines[-1].split(",")[0]


def already_recorded_today(targets, today):
    """今日(JST)の分がもう記録済みか。バックアップ実行の空振り判定に使う。"""
    if not targets:
        return False
    done = sum(1 for r in targets if last_recorded_date(r["name"]) == today)
    print("today's data already recorded for %d / %d characters" % (done, len(targets)))
    return done >= len(targets) * RECORDED_TODAY_THRESHOLD


def env_flag(name):
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes")


def main():
    if not API_KEY:
        raise SystemExit("ERROR: YOUTUBE_API_KEY is not set")

    with open(CHARACTER_CSV, encoding="cp932", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)

    targets = [r for r in rows if r["channelid"] != "0"]

    today = yymmdd_today_jst()
    if env_flag("SKIP_IF_RECORDED_TODAY") and already_recorded_today(targets, today):
        print("today (%s JST) is already recorded -- nothing to do." % today)
        return

    channel_ids = [r["channelid"] for r in targets]
    print("fetching subscriber counts for %d channels..." % len(channel_ids))
    counts = fetch_subscriber_counts(channel_ids)
    print("got %d / %d counts back" % (len(counts), len(channel_ids)))

    if not counts:
        raise SystemExit("ERROR: got zero subscriber counts back, aborting without writing anything")

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
