import tempfile
import unittest
import json
from pathlib import Path
from unittest.mock import patch

from catalog_sources import CatalogClient, SourceError, atomic_json
from actualizar_extras_anime import (song, recommendations, write_entries, load_entries, BLOCKS,
                                    refresh, progress, STATE_FILE, validate, recover_checkpoints)


class Extras(unittest.TestCase):
    def fixture(self, root, entries=None):
        catalog = [{"mal_id": key, "title": str(key), "type": "TV", "episodes": 2,
                    "genres": [], "themes": [], "scored_by": 100 - key} for key in (1, 2, 3)]
        atomic_json(root / "anime-lista.json", catalog)
        write_entries(root, entries or {})
        return {row["mal_id"]: row for row in catalog}

    def payload(self, anime_id, resource):
        data = {"themes": {"openings": [], "endings": []}, "recommendations": [],
                "episodes": [{"number": 1, "filler": False, "recap": None}, {"number": 2, "filler": True, "recap": False}]}
        return {"provider": "tenrai", "fetched_at": "2026-10-25T12:00:00+00:00", "data": data[resource]}

    def test_bootstrap_queries_all_resources_without_a_pilot_or_type_restriction(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.fixture(root)
            rows = json.loads((root / "anime-lista.json").read_text())
            rows[0].update(type="OVA", airing_status="Not yet aired")
            atomic_json(root / "anime-lista.json", rows)
            with patch.object(CatalogClient, "extra", side_effect=self.payload) as call:
                report = refresh(root, limit=3, bootstrap=True)
            self.assertEqual(call.call_count, 9)
            self.assertEqual(report["progress"]["complete"], 3)
            self.assertEqual(report["coverage"]["guides"], 3)
            self.assertEqual(report["coverage"]["themes"], 0)

    def test_empty_success_is_not_refetched_during_resume(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.fixture(root)
            with patch.object(CatalogClient, "extra", side_effect=self.payload) as call:
                refresh(root, limit=1, bootstrap=True)
                report = refresh(root, limit=2, bootstrap=True)
                self.assertEqual(call.call_count, 9)
                refresh(root, limit=3, bootstrap=True)
                self.assertEqual(call.call_count, 9)
            self.assertEqual(report["progress"]["pending_resources"], 0)

    def test_original_resources_are_unchanged_when_filling_the_missing_guide(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            original = {"mal_id": 1, "themes": {"provider": "edge", "fetched_at": "2026-10-20", "openings": [{"title": "Original", "artist": "Artist"}], "endings": []},
                        "recommendations": {"provider": "edge", "fetched_at": "2026-10-20", "items": [{"mal_id": 2, "votes": 8}]}}
            self.fixture(root, {"1": original})
            before = (root / "anime-lista.json").read_bytes()
            with patch.object(CatalogClient, "extra", side_effect=self.payload) as call:
                refresh(root, ids=[1], limit=0, bootstrap=True)
                self.assertEqual(call.call_args_list[0].args, (1, "episodes"))
                self.assertEqual(call.call_count, 1)
            updated = load_entries(root)["1"]
            for kind in ("themes", "recommendations"):
                self.assertEqual(updated[kind], original[kind])
            self.assertEqual(before, (root / "anime-lista.json").read_bytes())

    def test_interrupt_resumes_completed_resources_from_checkpoints(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.fixture(root)
            def interrupted(anime_id, resource):
                if resource == "episodes":
                    raise KeyboardInterrupt()
                return self.payload(anime_id, resource)
            with patch.object(CatalogClient, "extra", side_effect=interrupted):
                with self.assertRaises(KeyboardInterrupt):
                    refresh(root, limit=1, bootstrap=True)
            self.assertEqual(load_entries(root), {})
            with patch.object(CatalogClient, "extra", side_effect=self.payload) as call:
                refresh(root, ids=[1], limit=0, bootstrap=True)
                self.assertEqual(call.call_count, 1)
                self.assertEqual(call.call_args.args, (1, "episodes"))

    def test_errors_are_not_empty_success_and_do_not_starve_other_anime(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.fixture(root)
            with patch.object(CatalogClient, "extra", side_effect=SourceError("temporary failure")):
                report = refresh(root, limit=1, bootstrap=True)
            self.assertEqual(report["progress"]["complete"], 0)
            with patch.object(CatalogClient, "extra", side_effect=self.payload) as call:
                report = refresh(root, limit=1, bootstrap=True)
                self.assertTrue(all(args.args[0] == 2 for args in call.call_args_list))
            self.assertEqual(report["progress"]["complete"], 1)
            self.assertEqual(len(json.loads((root / STATE_FILE).read_text())["failures"]["1"]), 3)

    def test_provider_limit_stops_batch_and_keeps_successful_work(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.fixture(root)
            def limited(anime_id, resource):
                if resource == "recommendations":
                    raise SourceError("Limite de tenrai; reintentar mas tarde")
                return self.payload(anime_id, resource)
            with patch.object(CatalogClient, "extra", side_effect=limited) as call:
                report = refresh(root, limit=3, bootstrap=True)
            self.assertEqual(call.call_count, 2)
            self.assertEqual(report["stopped"], "provider_limit")
            self.assertIn("themes", load_entries(root)["1"])
            self.assertNotIn("recommendations", load_entries(root)["1"])

    def test_time_budget_finishes_safely_between_resources(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.fixture(root)
            with patch.object(CatalogClient, "extra", side_effect=self.payload) as call, \
                    patch("actualizar_extras_anime.time.monotonic", side_effect=[0, 0, 10]):
                report = refresh(root, limit=3, bootstrap=True, max_seconds=3)
            self.assertEqual(call.call_count, 1)
            self.assertEqual(report["stopped"], "time_budget")
            self.assertEqual(report["progress"]["checked"]["themes"], 1)
            self.assertEqual(report["progress"]["checked"]["episodes"], 0)

    def test_offline_cache_misses_do_not_delay_real_future_requests(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.fixture(root)
            with patch.object(CatalogClient, "extra", side_effect=SourceError("Sin cache para tenrai")):
                report = refresh(root, limit=3, bootstrap=True, offline=True)
            self.assertIsNone(report["stopped"])
            self.assertEqual(json.loads((root / STATE_FILE).read_text())["failures"], {})
            self.assertEqual(report["progress"]["pending_resources"], 9)

    def test_validation_failure_restores_standalone_output_but_keeps_checkpoints(self):
        from actualizar_extras_anime import main
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.fixture(root)
            original_index = (root / "anime-extras-index.json").read_bytes()
            with patch("actualizar_extras_anime.ROOT", root), \
                    patch("sys.argv", ["extras", "--bootstrap", "--limit", "1"]), \
                    patch("actualizar_extras_anime.refresh", wraps=lambda **kwargs: refresh(root, **kwargs)), \
                    patch.object(CatalogClient, "extra", side_effect=self.payload), \
                    patch("actualizar_extras_anime.validate", side_effect=SourceError("Invalid candidate")):
                with self.assertRaises(SourceError):
                    main()
            self.assertEqual((root / "anime-extras-index.json").read_bytes(), original_index)
            self.assertEqual(load_entries(root), {})
            self.assertTrue((root / "cache/extras-checkpoints-v1/1.json").is_file())

    def test_refresh_never_replaces_existing_content_with_empty_or_shorter_responses(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.fixture(root)
            with patch.object(CatalogClient, "extra", side_effect=self.payload):
                refresh(root, limit=1, bootstrap=True)
            before = load_entries(root)["1"]["episodes"]
            def empty(anime_id, resource):
                result = self.payload(anime_id, resource)
                if resource == "episodes":
                    result["data"] = []
                return result
            with patch.object(CatalogClient, "extra", side_effect=empty):
                report = refresh(root, ids=[1], limit=0)
            self.assertEqual(load_entries(root)["1"]["episodes"], before)
            self.assertEqual(len(report["kept_on_error"]), 1)

    def test_old_checkpoint_cannot_override_newer_public_data(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            catalog = self.fixture(root)
            old = {"provider": "tenrai", "fetched_at": "2026-10-01", "items": []}
            new = {**old, "fetched_at": "2026-10-25", "items": [{"mal_id": 2, "votes": 1}]}
            entries = {"1": {"mal_id": 1, "recommendations": new}}
            atomic_json(root / "cache/extras-checkpoints-v1/1.json", {"version": 1, "item": {"mal_id": 1, "recommendations": old}})
            recover_checkpoints(root, catalog, entries, {"failures": {}})
            self.assertEqual(entries["1"]["recommendations"], new)

    def test_validator_rejects_mismatched_availability_and_missing_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.fixture(root)
            with patch.object(CatalogClient, "extra", side_effect=self.payload):
                refresh(root, limit=1, bootstrap=True)
            index = json.loads((root / "anime-extras-index.json").read_text())
            index["entries"]["1"]["themes"] = True
            atomic_json(root / "anime-extras-index.json", index)
            with self.assertRaises(SourceError):
                validate(root)

    def test_song_parsing_preserves_names_and_ranges(self):
        value = song('2: "Haruka Kanata" by Asian Kung-fu Generation (eps 26-53)')
        self.assertEqual(value, {"title": "Haruka Kanata", "artist": "Asian Kung-fu Generation", "episodes": "26-53"})
        self.assertEqual(song({"title": "Song", "artist": "Artist", "episodes": "eps 1-12"})["episodes"], "1-12")
        self.assertEqual(song('Unusual metadata')["title"], 'Unusual metadata')
        with self.assertRaises(SourceError):
            song({"artist": "No title"})

    def test_recommendations_are_local_nonadult_first_entries_outside_the_same_saga(self):
        catalog = {i: {"mal_id": i, "title": str(i), "type": "TV", "genres": [], "themes": []} for i in range(1, 10)}
        catalog[3]["genres"] = ["Ecchi"]
        catalog[4]["type"] = "OVA"
        catalog[8]["airing_status"] = "Not yet aired"
        catalog[9]["title"] = "Show Season 2"
        rows = [{"entry": {"mal_id": i}, "votes": i} for i in range(1, 11)]
        rows += [{"malId": 2, "votes": 30}]
        result = recommendations(1, rows, catalog, {"5": {"prequels": [99]}}, {"1": [10, 0], "6": [10, 0]})
        self.assertEqual(result, [{"mal_id": 2, "votes": 30}, {"mal_id": 7, "votes": 7}])

    def test_blocks_roundtrip_without_touching_master(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            entries = {"20": {"mal_id": 20, "episodes": {"items": [{"number": 1}]}}}
            write_entries(root, entries)
            self.assertEqual(load_entries(root), entries)
            self.assertEqual(len(list((root / "anime-extras").glob("*.json"))), BLOCKS)
            self.assertFalse((root / "anime-lista.json").exists())

    def test_repartition_does_not_overwrite_old_cached_block_urls(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            old = root / "anime-extras/extras-04.json"
            atomic_json(old, {"version": 1, "entries": {"20": {"mal_id": 20}}})
            before = old.read_bytes()
            write_entries(root, {"20": {"mal_id": 20}})
            self.assertEqual(old.read_bytes(), before)
            index = json.loads((root / "anime-extras-index.json").read_text())
            self.assertNotIn("anime-extras/extras-04.json", index["files"])
            self.assertEqual(load_entries(root), {"20": {"mal_id": 20}})

    def test_episodes_all_pages_and_unknown_flags(self):
        with tempfile.TemporaryDirectory() as folder:
            client = CatalogClient(folder)
            payloads = [({"data": [{"mal_id": 1, "filler": False}], "pagination": {"has_next_page": True}}, "now"),
                        ({"data": [{"mal_id": 2, "recap": True}], "pagination": {"has_next_page": False}}, "now")]
            with patch.object(client, "_request", side_effect=payloads):
                data = client.extra(20, "episodes")["data"]
                self.assertEqual([x["number"] for x in data], [1, 2])
                self.assertIsNone(data[0]["recap"])
                self.assertIsNone(data[1]["filler"])

    def test_partial_download_never_publishes_incomplete_pages_as_success(self):
        client = CatalogClient()
        with patch.object(client, "_request", side_effect=[
            ({"data": [{"mal_id": 1}], "pagination": {"has_next_page": True}}, "now"),
            SourceError("failed page"), SourceError("failed fallback")]):
            with self.assertRaises(SourceError):
                client.extra(20, "episodes")

    def test_fallback_restarts_at_page_one_and_does_not_mix_sources(self):
        client = CatalogClient()
        with patch.object(client, "_request", side_effect=[
            ({"data": [{"mal_id": 1}], "pagination": {"has_next_page": True}}, "now"), SourceError("failed"),
            ({"data": [{"number": 2, "filler": True}], "meta": {"pagination": {"hasNextPage": False}}}, "now")]):
            result = client.extra(20, "episodes")
            self.assertEqual(result["provider"], "edge")
            self.assertEqual([x["number"] for x in result["data"]], [2])

    def test_denial_does_not_use_fallback(self):
        client = CatalogClient()
        with patch.object(client, "_request", side_effect=SourceError("Acceso rechazado")) as call:
            with self.assertRaises(SourceError):
                client.extra(20, "themes")
            self.assertEqual(call.call_count, 1)

    def test_duplicate_episode_numbers_are_rejected(self):
        client = CatalogClient()
        with patch.object(client, "_request", return_value=({"data": [{"mal_id": 1, "number": 1}, {"mal_id": 1, "number": 1}], "pagination": {"has_next_page": False}}, "now")):
            with self.assertRaises(SourceError):
                client.extra(20, "episodes")


if __name__ == "__main__":
    unittest.main()
