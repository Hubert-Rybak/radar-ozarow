"""Daily change log ("Lista zmian"): first appearance of permit and investment records per import day."""
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("build_changes", ROOT / "scripts/build_changes.py")
bc = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(bc)
NOW = datetime(2026, 11, 2, 3, 30, tzinfo=timezone.utc)


def permit(i, **extra):
    return {"id": f"permit:{i}", "title": f"Budowa {i}", "kind": "decision", "locality": "Ożarów Mazowiecki",
            "description": "not copied", **extra}


def investment(i):
    return {"id": f"bo:{i}", "title": f"Inwestycja {i}", "recordType": "proposal", "sourceId": "bo", "costs": []}


class ChangeLog(unittest.TestCase):
    def run_update(self, log, day, prev_p, cur_p, prev_i, cur_i):
        return bc.update(log, day, previous_permits=prev_p, permits=cur_p,
                         previous_investments=prev_i, investments=cur_i, now=NOW)

    def test_first_generation_is_baseline_not_new(self):
        log = self.run_update(None, "2026-11-01", None, [permit(1)], None, [investment(1)])
        self.assertEqual(log["days"], [])
        self.assertEqual(log["since"], "2026-11-01")
        self.assertEqual(log["generatedAt"], "2026-11-02T03:30:00Z")

    def test_records_only_additions_with_public_snapshot_fields(self):
        log = self.run_update(None, "2026-11-02", [permit(1), permit(2)], [permit(1), permit(3)],
                              [investment(1)], [investment(1), investment(2)])
        self.assertEqual(log["days"], [{
            "date": "2026-11-02",
            "permits": [{"id": "permit:3", "title": "Budowa 3", "kind": "decision", "locality": "Ożarów Mazowiecki"}],
            "investments": [{"id": "bo:2", "title": "Inwestycja 2", "recordType": "proposal", "sourceId": "bo"}],
        }])

    def test_quiet_day_adds_no_entry_and_days_stay_newest_first(self):
        log = self.run_update(None, "2026-11-01", [], [permit(1)], [], [])
        log = self.run_update(log, "2026-11-02", [permit(1)], [permit(1)], [], [])
        log = self.run_update(log, "2026-11-03", [permit(1)], [permit(1), permit(2)], [], [investment(1)])
        self.assertEqual([d["date"] for d in log["days"]], ["2026-11-03", "2026-11-01"])

    def test_same_day_rerun_keeps_earlier_additions(self):
        log = self.run_update(None, "2026-11-02", [], [permit(1)], [], [])
        log = self.run_update(log, "2026-11-02", [permit(1)], [permit(1), permit(2)], [], [])
        self.assertEqual([e["id"] for e in log["days"][0]["permits"]], ["permit:1", "permit:2"])

    def test_input_log_is_not_mutated(self):
        log = self.run_update(None, "2026-11-01", [], [permit(1)], [], [])
        before = json.dumps(log)
        self.run_update(log, "2026-11-02", [permit(1)], [permit(1), permit(2)], [], [])
        self.assertEqual(json.dumps(log), before)

    def test_rejects_malformed_logs(self):
        good = self.run_update(None, "2026-11-02", [], [permit(1)], [], [])
        for broken in (
            {**good, "schemaVersion": 2},
            {**good, "days": good["days"] * 2},
            {**good, "since": "2026-11-03"},
            {**good, "days": [{**good["days"][0], "permits": [], "investments": []}]},
            {**good, "days": [{**good["days"][0], "permits": [{**good["days"][0]["permits"][0], "description": "x"}]}]},
        ):
            with self.assertRaises((ValueError, KeyError)):
                bc.validate(broken)

    def test_cli_compares_published_generation_with_candidate(self):
        with tempfile.TemporaryDirectory() as temp:
            previous, output = Path(temp, "previous"), Path(temp, "candidate")
            previous.mkdir(), output.mkdir()
            (previous / "permits.json").write_text(json.dumps({"records": [permit(1)]}))
            (previous / "investments.json").write_text(json.dumps({"records": []}))
            bc.write(previous / "changes.json", bc.update(None, "2026-11-01", previous_permits=[], permits=[permit(1)],
                                                         previous_investments=[], investments=[], now=NOW))
            (output / "permits.json").write_text(json.dumps({"records": [permit(1), permit(2)]}))
            (output / "investments.json").write_text(json.dumps({"records": [investment(5)]}))
            bc.main(["--previous", str(previous), "--output", str(output), "--date", "2026-11-02"])
            log = json.loads((output / "changes.json").read_text())
            self.assertEqual([d["date"] for d in log["days"]], ["2026-11-02", "2026-11-01"])
            self.assertEqual([e["id"] for e in log["days"][0]["permits"]], ["permit:2"])
            self.assertEqual([e["id"] for e in log["days"][0]["investments"]], ["bo:5"])
            self.assertEqual((output / "changes.json").stat().st_mode & 0o777, 0o644)


class PublishedChangeLog(unittest.TestCase):
    def test_published_log_is_valid_and_lists_each_record_once(self):
        log = bc.validate(json.loads((ROOT / "public/data/changes.json").read_text()))
        ids = [e["id"] for d in log["days"] for key in ("permits", "investments") for e in d[key]]
        self.assertEqual(len(ids), len(set(ids)))


if __name__ == "__main__":
    unittest.main()
