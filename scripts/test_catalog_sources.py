#!/usr/bin/env python3
"""Offline contracts for the provider transition and non-destructive publication."""

import copy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

from catalog_sources import CatalogClient, MissingAnime, NotFound, SourceError, normalize_edge, require_anilist_permission
from catalog_transition import (assert_preserved, date_value, edge_signature, load_published_graph,
                                merge_anime, seed_graph, introduces_cycle)
from sync_catalog_sources import promote
import generar_arboles_sagas as trees


def remote(anime_id=1, **changes):
    return {"mal_id": anime_id, "title": "Example", "status": "Currently Airing", "episodes": 12,
            "relations": [], "_source": "tenrai", "_fetched_at": "2026-10-25T00:00:00Z", **changes}


class Providers(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.client = CatalogClient(self.directory.name, interval=0, retries=1)

    def test_edge_normalization(self):
        item = normalize_edge({"malId": 1, "title": "Example", "titleEnglish": "English", "scoredBy": 30,
                               "images": {"jpg": {"largeImageUrl": "https://example.test/a.jpg"}},
                               "relations": [{"relation": "Sequel", "malId": 2, "type": "anime", "title": "Next"}],
                               "broadcast": {"timezone": "JST"}, "genres": ["Action"]})
        self.assertEqual(item["images"]["jpg"]["large_image_url"], "https://example.test/a.jpg")
        self.assertEqual(item["relations"][0]["entry"][0]["mal_id"], 2)
        self.assertEqual(item["broadcast"]["timezone"], "Asia/Tokyo")
        self.assertEqual(item["genres"], [{"name": "Action"}])

    def test_fallback_uses_same_id(self):
        with patch.object(self.client, "_request", side_effect=[SourceError("offline"), ({"data": {"malId": 1, "title": "Right", "relations": []}}, "now")]):
            self.assertEqual(self.client.anime(1)["_source"], "edge")

    def test_edge_real_flat_image_shape(self):
        item = normalize_edge({"malId": 52991, "imageUrl": "https://example.test/medium.jpg",
                               "images": {"small": "s", "medium": "m", "large": "l"}})
        self.assertEqual(item["images"]["jpg"]["large_image_url"], "l")
        self.assertEqual(item["images"]["jpg"]["image_url"], "m")

    def test_wrong_id_is_never_accepted(self):
        with patch.object(self.client, "_request", return_value=({"data": remote(2)}, "now")):
            with self.assertRaises(SourceError):
                self.client.anime(1)

    def test_two_explicit_404s_are_quarantined_not_deleted(self):
        with patch.object(self.client, "_request", side_effect=NotFound("404")):
            with self.assertRaises(MissingAnime):
                self.client.anime(1)

    def test_missing_relations_is_not_empty_success(self):
        value = remote()
        value.pop("relations")
        with patch.object(self.client, "_request", return_value=({"data": value}, "now")):
            with self.assertRaises(SourceError):
                self.client.anime(1)

    def test_partial_pagination_never_returns_first_page(self):
        with patch.object(self.client, "_request", side_effect=[
            ({"data": [remote()], "pagination": {"has_next_page": True}}, "now"),
            SourceError("page failed"), SourceError("fallback failed")]):
            with self.assertRaises(SourceError):
                self.client.listing("/seasons/2027/winter")

    def test_edge_list_has_no_page_and_hydrates(self):
        with patch.object(self.client, "_request", side_effect=[SourceError("failed"), ({"data": [{"malId": 1, "title": "Example"}]}, "now")]) as request:
            with patch.object(self.client, "anime", return_value=remote()) as anime:
                self.assertEqual(self.client.listing("/seasons/2027/winter")[0]["episodes"], 12)
                self.assertNotIn("page", request.call_args.args[2])
                anime.assert_called_once_with(1)

    def test_offline_never_connects(self):
        self.client.offline = True
        with patch("urllib.request.urlopen", side_effect=AssertionError("network")):
            with self.assertRaises(SourceError):
                self.client.anime(1)

    def test_rate_limit_does_not_switch_provider(self):
        error = urllib.error.HTTPError("https://example.test", 429, "limited", {"Retry-After": "300"}, None)
        with patch("urllib.request.urlopen", side_effect=error) as request:
            with self.assertRaises(SourceError):
                self.client.anime(1)
            self.assertEqual(request.call_count, 1)

    def test_failed_provider_is_paused_instead_of_timing_out_for_every_title(self):
        with patch("urllib.request.urlopen", side_effect=OSError("offline")) as request:
            for number in range(4):
                with self.assertRaises(SourceError):
                    self.client._request("tenrai", f"/anime/{number + 1}/full")
            self.assertEqual(request.call_count, 3)

    def test_stale_or_graphql_errors_are_rejected(self):
        for extra in ({"meta": {"stale": True}}, {"meta": {"refreshFailed": True}}, {"errors": ["partial"]}):
            with self.subTest(extra=extra), patch("urllib.request.urlopen", return_value=io.BytesIO(json.dumps({"data": remote(), **extra}).encode())):
                with self.assertRaises(SourceError):
                    self.client.anime(1)

    def test_cache_is_reusable_without_network(self):
        with patch("urllib.request.urlopen", return_value=io.BytesIO(json.dumps({"data": remote()}).encode())):
            self.client.anime(1)
        self.client.offline = True
        with patch("urllib.request.urlopen", side_effect=AssertionError("network")):
            self.assertEqual(self.client.anime(1)["mal_id"], 1)

    def test_anilist_requires_explicit_permission(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(SourceError):
                require_anilist_permission()


class Preservation(unittest.TestCase):
    def setUp(self):
        self.local = {"mal_id": 1, "title": "Our title", "title_es": "Titulo cuidado", "description": "Original", "description_es": "Texto cuidado", "search_titles_es": ["Alias"], "genres": ["Curated"], "episodes": 4, "image": "https://old.test/cover.jpg", "score": 8.4, "scored_by": 100, "airing_status": "Currently Airing"}

    def test_editorial_fields_and_episode_units_stay(self):
        report = {}
        value = merge_anime(self.local, remote(episodes=12, score=9.1, scored_by=200), report)
        assert_preserved([self.local], [value])
        self.assertEqual(value["episodes"], 4)
        self.assertEqual(value["score"], 8.4)
        self.assertTrue(any(note["field"] == "episodes" for note in report["review"]))

    def test_unknown_total_can_be_filled(self):
        self.local["episodes"] = None
        self.assertEqual(merge_anime(self.local, remote(), {})["episodes"], 12)

    def test_status_can_advance_not_regress(self):
        self.local["airing_status"] = "Not yet aired"
        value = merge_anime(self.local, remote(), {})
        self.assertTrue(value["ongoing"])
        self.local["airing_status"] = "Finished Airing"
        value = merge_anime(self.local, remote(status="Not yet aired"), {})
        self.assertEqual(value["airing_status"], "Finished Airing")

    def test_no_null_erase_and_new_cover_is_alternative(self):
        value = merge_anime(self.local, remote(images={"jpg": {"large_image_url": "https://new.test/a.jpg"}}, synopsis=None), {})
        self.assertEqual(value["image"], self.local["image"])
        self.assertEqual(value["description_es"], self.local["description_es"])
        self.assertEqual(value["image_candidates"], ["https://new.test/a.jpg"])

    def test_dates_remain_partial_and_conflicts_keep_existing(self):
        self.assertEqual(date_value("2027-01"), "2027-01")
        self.assertEqual(date_value("2027"), "2027")
        self.assertEqual(date_value("2027-33-45"), "")
        self.local["aired_from"] = "2027-01-08"
        value = merge_anime(self.local, remote(aired={"from": "2027-01"}), {})
        self.assertEqual(value["aired_from"], "2027-01-08")

    def test_preservation_detects_deletion_and_mistranslation(self):
        for field in ("description_es", "image", "genres", "title_es", "episodes"):
            changed = copy.deepcopy(self.local)
            changed[field] = None
            with self.subTest(field=field), self.assertRaises(ValueError):
                assert_preserved([self.local], [changed])
        with self.assertRaises(ValueError):
            assert_preserved([self.local], [])

    def test_mal_score_pair_can_refresh_after_provenance_known(self):
        self.local["_catalog_sync"] = {"score_source": "myanimelist"}
        value = merge_anime(self.local, remote(score=8.1, scored_by=200), {})
        self.assertEqual((value["score"], value["scored_by"]), (8.1, 200))


class Promotion(unittest.TestCase):
    def test_interrupted_copy_rolls_back(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stage = root / "candidate"
            stage.mkdir()
            for name in ("a.json", "b.json"):
                (root / name).write_text("old")
                (stage / name).write_text("new")
            count = 0
            def fail_second(source, destination):
                nonlocal count
                count += 1
                if count == 2:
                    raise OSError("simulated interruption")
                os.replace(source, destination)
            with patch("sync_catalog_sources.publication_files", return_value=["a.json", "b.json"]):
                with self.assertRaises(OSError):
                    promote(root, stage, {}, root, replace=fail_second)
            self.assertEqual((root / "a.json").read_text(), "old")
            self.assertEqual((root / "b.json").read_text(), "old")

    def test_concurrent_edit_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "a.json").write_text("user edit")
            with self.assertRaises(RuntimeError):
                promote(root, root, {"a.json": "old-hash"}, root)
            self.assertEqual((root / "a.json").read_text(), "user edit")


class PublishedGraph(unittest.TestCase):
    def test_indirect_cycle_is_rejected(self):
        previous = {(1, 2), (2, 3)}
        self.assertTrue(introduces_cycle(previous, previous | {(3, 1)}))
        self.assertFalse(introduces_cycle(previous, previous | {(3, 4)}))

    def test_fresh_checkout_without_cache_retains_all_map_edges(self):
        root = Path(__file__).resolve().parents[1]
        _, old = load_published_graph(root)
        records, _ = seed_graph(root)
        catalog = json.loads((root / "anime-lista.json").read_text())
        candidate, _ = trees.build_public_payload(catalog, records)
        self.assertTrue(edge_signature(old).issubset(edge_signature(candidate["timelines"])))
        self.assertGreater(len(candidate["timelines"]), 600)


if __name__ == "__main__":
    unittest.main()
