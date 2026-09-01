import random
import unittest
from unittest.mock import patch

from app import (
    ApiSettings,
    AppState,
    BattingScene,
    Category,
    CharacterPreset,
    GenerationSettings,
    NovelAIClient,
    PresetSet,
    PromptPreset,
    artist_rating_summary,
    artist_tags_for_prompt,
    order_artist_tags,
    random_artist_tags_for_state,
    sanitize_history_item,
    stability_rating_summary,
    sync_auto_preset_sets,
)
from web_app import state_from_dict


class AdaptiveArtistTests(unittest.TestCase):
    def test_rating_summary_uses_neutral_prior(self):
        history = [
            {
                "items": [
                    {"rating": 5, "artists": [{"tag": "artist:favorite"}]},
                    {"rating": 1, "artists": [{"tag": "artist:other"}]},
                ]
            }
        ]
        summary = artist_rating_summary(history)
        self.assertGreater(summary["artist:favorite"]["smoothed_rating"], 3)
        self.assertLess(summary["artist:other"]["smoothed_rating"], 3)
        self.assertGreater(summary["artist:favorite"]["selection_multiplier"], 1)
        self.assertLess(summary["artist:other"]["selection_multiplier"], 1)

    def test_high_rated_artist_is_selected_more_often(self):
        rated_items = []
        for _ in range(12):
            rated_items.append({"rating": 5, "artists": [{"tag": "artist:favorite"}]})
            rated_items.append({"rating": 1, "artists": [{"tag": "artist:other"}]})
        state = AppState(
            categories=[Category("test", ["artist:favorite", "artist:other"], 0.5, 1.5, 0.1, 1)],
            history=[{"items": rated_items}],
        )
        random.seed(17)
        selections = {"artist:favorite": 0, "artist:other": 0}
        weights = {"artist:favorite": [], "artist:other": []}
        for _ in range(600):
            artist = random_artist_tags_for_state(state)[0]
            selections[artist["tag"]] += 1
            weights[artist["tag"]].append(artist["weight"])
        self.assertGreater(selections["artist:favorite"], selections["artist:other"] * 2)
        self.assertGreater(
            sum(weights["artist:favorite"]) / len(weights["artist:favorite"]),
            sum(weights["artist:other"]) / len(weights["artist:other"]),
        )

    def test_highest_weights_are_placed_at_both_ends(self):
        artists = [
            {"tag": "a", "weight": 1.4},
            {"tag": "b", "weight": 1.3},
            {"tag": "c", "weight": 1.2},
            {"tag": "d", "weight": 1.1},
        ]
        with patch("app.random.getrandbits", return_value=1):
            ordered = order_artist_tags(artists)
        self.assertEqual(ordered[0]["tag"], "a")
        self.assertEqual(ordered[-1]["tag"], "b")

    def test_fixed_artist_order_is_preserved(self):
        state = AppState(
            generation=GenerationSettings(
                fixed_artists=[
                    {"tag": "artist:middle", "weight": 0.8},
                    {"tag": "artist:first", "weight": 1.4},
                    {"tag": "artist:last", "weight": 1.2},
                ]
            )
        )
        ordered = artist_tags_for_prompt(state)
        self.assertEqual([item["tag"] for item in ordered], ["artist:middle", "artist:first", "artist:last"])

    def test_batting_ratings_are_excluded_from_learning(self):
        history = [
            {
                "type": "batting_test",
                "items": [{"rating": 5, "artists": [{"tag": "artist:fixed"}]}],
            },
            {
                "type": "generation",
                "items": [{"rating": 4, "artists": [{"tag": "artist:learned"}]}],
            },
        ]
        summary = artist_rating_summary(history)
        self.assertNotIn("artist:fixed", summary)
        self.assertIn("artist:learned", summary)

    def test_subscription_quota_returns_only_display_safe_values(self):
        response = {
            "tier": 3,
            "active": True,
            "paymentProcessorData": {"secret": "must-not-leak"},
            "trainingStepsLeft": {"fixedTrainingStepsLeft": 850, "purchasedTrainingSteps": 120},
            "usage": {"percent": 72.5, "isNegative": False, "timeUntilNextPercent": 1800},
        }

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                import json

                return json.dumps(response).encode("utf-8")

        with patch("app.urllib.request.urlopen", return_value=FakeResponse()):
            quota = NovelAIClient(ApiSettings(token="token-for-test", mock_mode=False)).subscription_quota()

        self.assertEqual(quota["total_anlas"], 970)
        self.assertEqual(quota["v5_percent"], 72.5)
        self.assertNotIn("paymentProcessorData", quota)

    def test_style_and_stability_ratings_use_separate_artist_roles(self):
        history = [
            {
                "items": [
                    {
                        "style_rating": 5,
                        "stability_rating": 2,
                        "artists": [
                            {"tag": "artist:style", "weight": 1.3, "learning_role": "style"},
                            {"tag": "artist:stable", "weight": 0.6, "learning_role": "stability"},
                        ],
                    }
                ]
            }
        ]
        style = artist_rating_summary(history)
        stability = stability_rating_summary(history)
        self.assertEqual(set(style), {"artist:style"})
        self.assertEqual(set(stability), {"artist:stable"})
        self.assertEqual(stability["artist:stable"]["best_weight"], 0.6)

    def test_stability_learning_favors_best_observed_weight(self):
        items = []
        for _ in range(12):
            items.extend(
                [
                    {
                        "stability_rating": 1,
                        "artists": [{"tag": "artist:stable", "weight": 0.5, "learning_role": "stability"}],
                    },
                    {
                        "stability_rating": 5,
                        "artists": [{"tag": "artist:stable", "weight": 0.7, "learning_role": "stability"}],
                    },
                    {
                        "stability_rating": 1,
                        "artists": [{"tag": "artist:stable", "weight": 0.9, "learning_role": "stability"}],
                    },
                ]
            )
        state = AppState(
            categories=[Category("stability", ["artist:stable"], 0.5, 0.9, 0.2, 0, "stability")],
            history=[{"items": items}],
        )
        random.seed(31)
        counts = {0.5: 0, 0.7: 0, 0.9: 0}
        for _ in range(400):
            counts[random_artist_tags_for_state(state)[0]["weight"]] += 1
        self.assertGreater(counts[0.7], counts[0.5] * 3)
        self.assertGreater(counts[0.7], counts[0.9] * 3)

    def test_legacy_rating_migrates_to_style_rating(self):
        item = sanitize_history_item({"path": "image.png", "rating": 4})
        self.assertEqual(item["style_rating"], 4)
        self.assertNotIn("rating", item)

    def test_legacy_stability_category_role_is_inferred(self):
        category = Category("그림체 안정화 작가", [], 0.4, 0.9, 0.1)
        self.assertEqual(category.learning_role, "stability")


class PresetSetTests(unittest.TestCase):
    def test_matching_names_create_and_apply_auto_set(self):
        state = AppState(
            base_presets=[PromptPreset("Scene A")],
            character_presets=[CharacterPreset("Scene A")],
            generation=GenerationSettings(preset_set="Scene A"),
            batting_scenes=[BattingScene(name="test", preset_set="Scene A")],
        )
        sync_auto_preset_sets(state)
        self.assertEqual(len(state.preset_sets), 1)
        self.assertTrue(state.preset_sets[0].auto)
        self.assertEqual(state.generation.base_preset, "Scene A")
        self.assertEqual(state.generation.character_preset, "Scene A")
        self.assertEqual(state.batting_scenes[0].base_preset, "Scene A")

    def test_web_state_accepts_manual_set(self):
        state = state_from_dict(
            {
                "base_presets": [{"name": "Base"}],
                "character_presets": [{"name": "Character"}],
                "preset_sets": [
                    {
                        "name": "My Set",
                        "base_preset": "Base",
                        "character_preset": "Character",
                        "auto": False,
                    }
                ],
                "generation": {"preset_set": "My Set"},
            }
        )
        self.assertEqual(state.preset_sets, [PresetSet("My Set", "Base", "Character", False)])
        self.assertEqual(state.generation.base_preset, "Base")
        self.assertEqual(state.generation.character_preset, "Character")


if __name__ == "__main__":
    unittest.main()
