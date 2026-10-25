import contextlib
import io
import unittest
from unittest.mock import Mock, patch

import actualizar_estado_episodios_jikan as updater
import generar_relaciones_jikan as relations


class AiringRefreshTests(unittest.TestCase):
    def test_batch_reuses_pacer_and_retrying_transport(self):
        pacer = Mock()
        payload = {"data": {"Page": {"media": [{"idMal": 1}]}}}
        with patch.object(updater, "fetch_graphql", return_value=payload) as fetch:
            self.assertEqual(updater.fetch_anilist_batch([1], pacer), [{"idMal": 1}])
        self.assertIs(fetch.call_args.args[1], pacer)
        self.assertEqual(fetch.call_args.args[2], {"ids": [1]})

    def test_malformed_response_is_not_treated_as_empty_success(self):
        with patch.object(updater, "fetch_graphql", return_value={"data": {"Page": None}}):
            with self.assertRaises(RuntimeError):
                updater.fetch_anilist_batch([1], Mock())

    @patch.dict("os.environ", {"NEO_ANILIST_AUTHORIZED": "yes"})
    def test_rate_limit_waits_and_retries(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'{"data":{"Page":{"media":[]}}}'
        error = relations.urllib.error.HTTPError(
            relations.ANILIST_URL, 429, "Too Many Requests", {"Retry-After": "3"}, None
        )
        with patch.object(relations.urllib.request, "urlopen", side_effect=[error, response]) as request:
            with patch.object(relations.time, "sleep") as sleep:
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(updater.fetch_anilist_batch([1], Mock()), [])
        self.assertEqual(request.call_count, 2)
        self.assertGreaterEqual(sleep.call_args.args[0], 3)

    def test_network_failure_prevents_publishing_partial_master(self):
        record = {"mal_id": 1, "year": 2026, "episodes": 12, "title_es": "Conservado"}
        with patch("sys.argv", ["update", "--year", "2026", "--apply", "--anilist-only"]):
            with patch.object(updater, "load_json", side_effect=[[record], {}]):
                with patch.object(updater, "fetch_anilist_batch", side_effect=RuntimeError("offline")):
                    with patch.object(updater, "save_json") as save, patch.object(updater, "make_backup") as backup:
                        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
                            updater.main()
        backup.assert_not_called()
        self.assertTrue(all(call.args[0] != updater.DEFAULT_INPUT for call in save.call_args_list))
        self.assertEqual(record["title_es"], "Conservado")

    def test_future_anime_with_known_episode_count_is_also_refreshed(self):
        record = {"mal_id": 1, "year": 2027, "episodes": 12, "airing_status": "Not yet aired"}
        with patch("sys.argv", ["update", "--year", "2026", "--anilist-only"]):
            with patch.object(updater, "load_json", side_effect=[[record], {}]):
                with patch.object(updater, "fetch_anilist_batch", return_value=[]) as fetch:
                    with patch.object(updater, "save_json"), contextlib.redirect_stdout(io.StringIO()):
                        self.assertEqual(updater.main(), 0)
        self.assertEqual(fetch.call_args.args[0], [1])

    def test_status_update_preserves_curated_text(self):
        record = {"title_es": "Titulo revisado", "description_es": "Sinopsis revisada", "episodes": 12}
        updater.update_anime(record, {"episodes": 13, "status": "Finished Airing"})
        self.assertEqual(record["title_es"], "Titulo revisado")
        self.assertEqual(record["description_es"], "Sinopsis revisada")
        self.assertEqual(record["episodes"], 13)
        self.assertFalse(record["ongoing"])


if __name__ == "__main__":
    unittest.main()
