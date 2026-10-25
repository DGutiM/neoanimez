import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from catalog_sources import CatalogClient, SourceError
from actualizar_extras_anime import song, recommendations, write_entries, load_entries


class Extras(unittest.TestCase):
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
            self.assertEqual(len(list((root / "anime-extras").glob("*.json"))), 16)
            self.assertFalse((root / "anime-lista.json").exists())

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
