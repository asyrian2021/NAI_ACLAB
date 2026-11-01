import json
import random
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

import app
from app import (ApiSettings, AppState, Category, Character, GenerationSettings, NovelAIClient,
                 PromptPreset, artist_tags_for_prompt, float_range, load_state, save_state)
from models import migrate_data, state_from_dict, validate_state
from web_app import build_prompt, scene_state


class PromptTests(unittest.TestCase):
    def state(self):
        return AppState(prompt_presets=[PromptPreset('Scene', 'base', [Character('one',''),Character('two','negative two')])],
                        generation=GenerationSettings(preset='Scene'),quality_prompt='quality',negative_prompt='common')

    def test_prompt_order_and_negative_slots_match_payload(self):
        state=self.state()
        artist={'tag':'artist:test','weight':1.2,'prompt':'1.2::artist:test ::'}
        prompt,negative,_=build_prompt(state,[artist])
        self.assertEqual(prompt,'base, 1.2::artist:test ::, quality | one | two')
        self.assertEqual(negative,'common |  | negative two')
        payload=NovelAIClient(ApiSettings()).build_payload(prompt,negative,seed=7)
        self.assertEqual(payload['parameters']['uc'],negative)
        self.assertEqual(payload['parameters']['v4_prompt']['caption']['base_caption'],prompt)

    def test_character_only_preserves_empty_base_slot(self):
        state=self.state();state.quality_prompt='';state.prompt_presets[0].base_prompt=''
        self.assertEqual(build_prompt(state,[])[0],' | one | two')

    def test_global_settings_survive_preset_switch(self):
        state=self.state();state.prompt_presets.append(PromptPreset('Other','other'))
        state.generation.preset='Other'
        self.assertEqual(build_prompt(state,[])[:2],('other, quality','common'))

    def test_blank_character_does_not_emit_orphan_negative(self):
        state=self.state();state.prompt_presets[0].characters.insert(1,Character('','orphan'))
        self.assertEqual(build_prompt(state,[])[1],'common |  | negative two')

    def test_live_mode_requires_token(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / '.test-data') as d, self.assertRaises(ValueError):
            NovelAIClient(ApiSettings(mock_mode=False)).generate('a','b',Path(d)/'x.png')


class MigrationTests(unittest.TestCase):
    def legacy(self):
        return {'base_presets':[{'name':'A','prompt':'base A','quality_prompt':'old quality'},{'name':'B','prompt':'base B'},{'name':'orphan','prompt':'keep me'}],
                'character_presets':[{'name':'A','prompts':['one','two'],'negatives':['','two negative']},{'name':'C','prompts':['three']},{'name':'alone','prompts':['keep character']}],
                'preset_sets':[{'name':'manual','base_preset':'B','character_preset':'C'}],
                'generation':{'preset_set':'manual','base_preset':'B','character_preset':'C'},
                'batting_scenes':[{'name':'scene','base_preset':'A','character_preset':'C'}],
                'quality_override_prompt':'global quality','negative_prompt':'global negative',
                'history':[{'id':'old','items':[{'path':'old/image.png','rating':5,'style_rating':4,'stability_rating':5,'artists':[{'tag':'artist:a','learning_role':'style','rating_count':4}]}]}]}

    def test_sets_matching_unmatched_and_scene_pairs_preserved(self):
        raw=self.legacy();data=migrate_data(raw)
        names={p['name'] for p in data['prompt_presets']}
        self.assertTrue({'manual','A','orphan','alone','A + C'}<=names)
        self.assertEqual(data['generation']['preset'],'manual')
        self.assertEqual(data['batting_scenes'][0]['preset'],'A + C')
        self.assertEqual(data['quality_prompt'],'global quality')
        self.assertEqual(data['negative_prompt'],'global negative')
        self.assertEqual(raw,self.legacy())
        self.assertEqual(migrate_data(data),data)
        self.assertNotIn('style_rating',json.dumps(data))
        self.assertNotIn('learning_role',json.dumps(data))

    def test_selected_pair_and_duplicate_names_get_unique_presets(self):
        raw=self.legacy();raw['preset_sets'][0]['name']='A'
        data=migrate_data(raw)
        self.assertEqual(data['generation']['preset'],'A')
        self.assertIn('A (2)',{p['name'] for p in data['prompt_presets']})

    def test_migration_disk_backup_and_secret_removal(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / '.test-data') as folder:
            root=Path(folder)
            with patch.multiple(app,DATA_DIR=root,OUTPUT_DIR=root/'outputs',STATE_PATH=root/'app_state.json',TOKEN_SECRET_PATH=root/'token'):
                raw=self.legacy();app.STATE_PATH.write_text(json.dumps(raw),encoding='utf-8')
                migrated=load_state()
                self.assertEqual(migrated.schema_version,2)
                self.assertTrue((root/'app_state.pre-v2.json').exists())
                stored=json.loads(app.STATE_PATH.read_text(encoding='utf-8'))
                self.assertNotIn('base_presets',stored)
                self.assertNotIn('rating',json.dumps(stored))
                before=app.STATE_PATH.read_bytes();load_state()
                self.assertEqual(app.STATE_PATH.read_bytes(),before)

    def test_scene_switches_entire_preset_without_changing_global(self):
        state=state_from_dict(self.legacy())
        derived=scene_state(state,state.batting_scenes[0])
        self.assertEqual(derived.generation.preset,'A + C')
        self.assertEqual(derived.quality_prompt,state.quality_prompt)
        self.assertEqual(state.generation.preset,'manual')


class RandomTests(unittest.TestCase):
    def test_count_range_migration_and_sampling(self):
        for old in (0, 3):
            category = state_from_dict({'schema_version': 2, 'categories': [{'picks': old}]}).categories[0]
            self.assertEqual(category.all_artists, old == 0)
            self.assertEqual((category.min_picks, category.max_picks), (max(1, old), max(1, old)))
        category = Category(tags=[f'artist:{i}' for i in range(8)], min_picks=3, max_picks=5, all_artists=False)
        state = AppState(categories=[category])
        with patch('app.random.randint', return_value=4) as draw:
            result = artist_tags_for_prompt(state)
            draw.assert_called_once_with(3, 5)
            self.assertEqual(len({a['tag'] for a in result}), 4)
        category.tags = ['artist:a', 'artist:b']
        self.assertEqual(len(artist_tags_for_prompt(state)), 2)
        category.tags = []
        self.assertEqual(artist_tags_for_prompt(state), [])
        category.min_picks, category.max_picks = 5, 3
        with self.assertRaises(ValueError): validate_state(state)
        category.min_picks, category.max_picks = 1.5, 3
        with self.assertRaises(ValueError): validate_state(state)

    def test_seed_and_guidance_validation(self):
        for key, value in [('seed', 2**32), ('seed', 1.5), ('guidance_rescale', 1.1), ('scale', float('nan'))]:
            state = AppState()
            setattr(state.api, key, value)
            with self.assertRaises(ValueError): validate_state(state)

    def test_history_cannot_influence_sampling(self):
        state=AppState(categories=[Category('a',['artist:a','artist:b','artist:c'],.8,1.2,.1,2)])
        random.seed(101);first=[artist_tags_for_prompt(state) for _ in range(40)]
        state.history=[{'items':[{'style_rating':5,'artists':[{'tag':'artist:a','weight':1.2}]}]}]*100
        random.seed(101);second=[artist_tags_for_prompt(state) for _ in range(40)]
        self.assertEqual(first,second)
        self.assertGreater(len({tuple(a['tag'] for a in r) for r in first}),3)

    def test_fixed_order_and_weight_preserved_but_stale_prompt_rebuilt(self):
        fixed=[{'tag':'artist:z','weight':.7,'prompt':'stale'},{'tag':'artist:a','weight':1.3}]
        state=AppState(generation=GenerationSettings(fixed_artists=deepcopy(fixed)))
        for _ in range(20):
            result=artist_tags_for_prompt(state)
            self.assertEqual([a['tag'] for a in result],['artist:z','artist:a'])
            self.assertEqual(result[0]['prompt'],'0.7::artist:z ::')
        self.assertEqual(state.generation.fixed_artists,fixed)

    def test_weight_range_never_exceeds_maximum(self):
        self.assertEqual(float_range(.1,.26,.1),[.1,.2])

    def test_invalid_ranges_rejected(self):
        for category in [Category(min_weight=2,max_weight=1),Category(granule=0),Category(min_weight=float('nan'))]:
            with self.assertRaises(ValueError):validate_state(AppState(categories=[category]))

if __name__=='__main__':unittest.main()
