#!/usr/bin/env python3
"""Daily change log: which permit and investment records appeared for the first time, per import day.

Compares the previously published generation (``--previous``, normally ``public/data``) with the
freshly imported candidate (``--output``) and writes ``changes.json`` into the candidate. Only
additions are recorded; the first generation without a prior dataset becomes the baseline.
"""
from __future__ import annotations

import argparse
from datetime import date as Date, datetime, timezone
import json
import os
from pathlib import Path
import tempfile

SCHEMA_VERSION = 1
FILENAME = "changes.json"
PERMIT_FIELDS = ("id", "title", "kind", "locality")
INVESTMENT_FIELDS = ("id", "title", "recordType", "sourceId")


def _records(path: Path) -> list[dict] | None:
    if not path.is_file():
        return None
    document = json.loads(path.read_text(encoding="utf-8"))
    records = document.get("records") if isinstance(document, dict) else None
    if not isinstance(records, list) or not all(isinstance(r, dict) and isinstance(r.get("id"), str) for r in records):
        raise ValueError(f"{path.name}: records with string ids are required")
    return records


def _snapshot(record: dict, fields: tuple[str, ...]) -> dict:
    return {field: record[field] if isinstance(record.get(field), str) else "" for field in fields}


def empty_log(day: str) -> dict:
    return {"schemaVersion": SCHEMA_VERSION, "generatedAt": None, "since": day, "days": []}


def validate(log: dict) -> dict:
    if not isinstance(log, dict) or log.get("schemaVersion") != SCHEMA_VERSION or not isinstance(log.get("days"), list):
        raise ValueError("changes.json: unsupported format")
    Date.fromisoformat(log["since"])
    seen_days: set[str] = set()
    for day in log["days"]:
        Date.fromisoformat(day["date"])
        if day["date"] in seen_days or day["date"] < log["since"]:
            raise ValueError(f"changes.json: duplicate or pre-baseline day {day['date']}")
        seen_days.add(day["date"])
        for key, fields in (("permits", PERMIT_FIELDS), ("investments", INVESTMENT_FIELDS)):
            entries = day[key]
            if not isinstance(entries, list) or len({e["id"] for e in entries}) != len(entries):
                raise ValueError(f"changes.json: invalid {key} on {day['date']}")
            for entry in entries:
                if set(entry) != set(fields) or not all(isinstance(entry[f], str) for f in fields) or not entry["id"]:
                    raise ValueError(f"changes.json: invalid {key} entry on {day['date']}")
        if not day["permits"] and not day["investments"]:
            raise ValueError(f"changes.json: empty day {day['date']}")
    dates = [day["date"] for day in log["days"]]
    if dates != sorted(dates, reverse=True):
        raise ValueError("changes.json: days must be newest first")
    return log


def update(log: dict | None, day: str, *, previous_permits: list[dict] | None, permits: list[dict],
           previous_investments: list[dict] | None, investments: list[dict], now: datetime) -> dict:
    """Return a new log with the records added since the previous generation listed under ``day``."""
    Date.fromisoformat(day)
    log = json.loads(json.dumps(log)) if log is not None else empty_log(day)
    validate(log)
    added = {}
    for key, previous, current, fields in (("permits", previous_permits, permits, PERMIT_FIELDS),
                                           ("investments", previous_investments, investments, INVESTMENT_FIELDS)):
        # No prior generation of this dataset: everything is baseline, not "new".
        known = None if previous is None else {r["id"] for r in previous}
        added[key] = [] if known is None else [_snapshot(r, fields) for r in current if r["id"] not in known]
    days = [d for d in log["days"] if d["date"] != day]
    existing = next((d for d in log["days"] if d["date"] == day), None)
    if existing:  # A same-day re-run keeps what an earlier run already recorded.
        for key in added:
            ids = {e["id"] for e in existing[key]}
            added[key] = existing[key] + [e for e in added[key] if e["id"] not in ids]
    if added["permits"] or added["investments"]:
        days.append({"date": day, **added})
    days.sort(key=lambda d: d["date"], reverse=True)
    log["days"] = days
    log["since"] = min(log["since"], day)
    log["generatedAt"] = now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return validate(log)


def write(path: Path, log: dict) -> None:
    text = json.dumps(validate(log), ensure_ascii=False, indent=1) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=".changes-", delete=False) as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(handle.name, 0o644)
    os.replace(handle.name, path)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--previous", type=Path, required=True, help="previously published data directory")
    parser.add_argument("--output", type=Path, required=True, help="candidate data directory to write changes.json into")
    parser.add_argument("--date", required=True, help="import day, YYYY-MM-DD")
    args = parser.parse_args(argv)
    permits = _records(args.output / "permits.json")
    investments = _records(args.output / "investments.json")
    if permits is None or investments is None:
        raise SystemExit("Candidate generation must contain permits.json and investments.json")
    prior_log = args.previous / FILENAME
    log = update(json.loads(prior_log.read_text(encoding="utf-8")) if prior_log.is_file() else None, args.date,
                 previous_permits=_records(args.previous / "permits.json"), permits=permits,
                 previous_investments=_records(args.previous / "investments.json"), investments=investments,
                 now=datetime.now(timezone.utc))
    write(args.output / FILENAME, log)
    today = next((d for d in log["days"] if d["date"] == args.date), None)
    print(f"changes.json: {args.date}: +{len(today['permits']) if today else 0} permits, "
          f"+{len(today['investments']) if today else 0} investments")


if __name__ == "__main__":
    main()
