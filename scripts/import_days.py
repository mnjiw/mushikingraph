# -*- coding: utf-8 -*-
"""
Bulk-imports day-by-day snapshots from days/*.CSV (filename "YYYYMMDD.CSV",
UTF-8, a header line followed by "name,count" rows -- one snapshot per day,
e.g. from a manual OCR catch-up) into CSVchar/*.CSV and character.csv, the
same way scripts/fetch_subscribers.py applies a single day's API fetch.

Each day's rows are applied to whichever CSVchar/<name>.CSV file matches
`name` (created if it doesn't exist yet); if that file's last line is
already dated the same day, it's overwritten instead of duplicated -- so
re-running this script is safe. After all days/ files are processed,
character.csv's number_subscribe is set to the count from the LAST (most
recent) date each character appeared in across days/.

Run this any time days/ has new snapshot files to import, then run
`python scripts/build_data.py` to regenerate site/data/*.
"""
import csv
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHARACTER_CSV = os.path.join(BASE, "character.csv")
CSVCHAR_DIR = os.path.join(BASE, "CSVchar")
DAYS_DIR = os.path.join(BASE, "days")


def yyyymmdd_to_yymmdd(yyyymmdd):
    return yyyymmdd[2:]


def update_character_csv_file(name, count, yymmdd):
    path = os.path.join(CSVCHAR_DIR, name + ".CSV")
    line = "%s,%d" % (yymmdd, count)
    if os.path.exists(path):
        with open(path, encoding="cp932", newline="") as f:
            content = f.read()
        lines = [l for l in content.splitlines() if l.strip()]
    else:
        lines = []  # brand-new character -- this becomes its first data point
    if lines and lines[-1].split(",")[0] == yymmdd:
        lines[-1] = line  # already imported this date -- overwrite, don't duplicate
    else:
        lines.append(line)
    with open(path, "w", encoding="cp932", newline="") as f:
        f.write("\r\n".join(lines) + "\r\n")


def main():
    day_files = sorted(f for f in os.listdir(DAYS_DIR) if f.upper().endswith(".CSV"))
    if not day_files:
        raise SystemExit("ERROR: no files found in days/")

    latest_counts = {}  # name -> count; overwritten while iterating so only the last date wins
    for fn in day_files:
        yyyymmdd = fn.split(".")[0]
        yymmdd = yyyymmdd_to_yymmdd(yyyymmdd)
        with open(os.path.join(DAYS_DIR, fn), encoding="utf-8") as f:
            lines = [l for l in f.read().splitlines() if l.strip()][1:]  # skip header
        for line in lines:
            name, count_str = line.rsplit(",", 1)
            count = int(count_str)
            update_character_csv_file(name, count, yymmdd)
            latest_counts[name] = count
        print("%s: applied %d characters" % (fn, len(lines)))

    with open(CHARACTER_CSV, encoding="cp932", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)

    updated = 0
    for row in rows:
        if row["name"] in latest_counts:
            row["number_subscribe"] = str(latest_counts[row["name"]])
            updated += 1

    with open(CHARACTER_CSV, "w", encoding="cp932", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(rows)

    print("character.csv: updated number_subscribe for %d characters" % updated)


if __name__ == "__main__":
    main()
