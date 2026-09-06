import unittest

from app import (
    ApiSettings,
    AppState,
    CharacterPreset,
    GenerationSettings,
    PromptPreset,
    NovelAIClient,
    character_negative_prompt,
)
from web_app import build_prompt


class PromptAssemblyTests(unittest.TestCase):
    def test_character_negatives_use_matching_pipe_sections(self):
        character = CharacterPreset(
            "characters",
            prompts=["character one", "character two", ""],
            negatives=["negative one", "negative two", "unused negative"],
        )

        self.assertEqual(
            character_negative_prompt("common negative", character),
            "common negative | negative one | negative two",
        )

    def test_blank_character_negative_keeps_later_slot_aligned(self):
        character = CharacterPreset(
            "characters",
            prompts=["character one", "character two", ""],
            negatives=["", "negative two", ""],
        )

        self.assertEqual(
            character_negative_prompt("common negative", character),
            "common negative |  | negative two",
        )

    def test_negative_without_character_prompt_is_not_added(self):
        character = CharacterPreset(
            "characters",
            prompts=["character one", "", ""],
            negatives=["negative one", "orphan negative", ""],
        )

        self.assertEqual(
            character_negative_prompt("common negative", character),
            "common negative | negative one",
        )

    def test_web_preview_uses_same_negative_sections(self):
        state = AppState(
            base_presets=[PromptPreset("base", "base prompt")],
            character_presets=[
                CharacterPreset(
                    "characters",
                    prompts=["character one", "character two", ""],
                    negatives=["negative one", "negative two", ""],
                )
            ],
            negative_prompt="common negative",
            generation=GenerationSettings(base_preset="base", character_preset="characters"),
        )

        prompt, negative, _ = build_prompt(state, [])

        self.assertEqual(prompt, "base prompt | character one | character two")
        self.assertEqual(negative, "common negative | negative one | negative two")

        payload = NovelAIClient(ApiSettings()).build_payload(prompt, negative, seed=1)
        self.assertEqual(
            payload["parameters"]["v4_negative_prompt"]["caption"]["base_caption"],
            negative,
        )
        self.assertEqual(payload["parameters"]["uc"], negative)


if __name__ == "__main__":
    unittest.main()
