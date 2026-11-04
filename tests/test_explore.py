import random
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch

import app
import explore as ex
from models import AppState, BattingScene, Category, PromptPreset


def tags(prefix, count):
    return [f"artist:{prefix}{i}" for i in range(count)]


def make_state():
    return AppState(
        categories=[Category("메인", tags("m", 12), 1.0, 1.4, .05, min_picks=2, max_picks=4, all_artists=False,
                             disabled_tags=["artist:m0", "artist:m1"]),
                    Category("신체", tags("b", 8), .4, .9, .1, min_picks=1, max_picks=3, all_artists=False),
                    Category("발", tags("f", 6), .3, .7, .1, min_picks=1, max_picks=2, all_artists=False)],
        prompt_presets=[PromptPreset("기본", "base"), PromptPreset("서기", "standing"), PromptPreset("맨발", "barefoot")],
        batting_scenes=[BattingScene("", "기본"), BattingScene("", "서기"), BattingScene("", "맨발", tags=["feet"])])


PLAN = [{"group": "메인", "mode": "pick"}, {"group": "신체", "mode": "rate"},
        {"group": "발", "mode": "rate", "labels": ["anatomy", "prompt", "style", "feet"], "scene_tag": "feet"}]


def fill_trials(c, failing=None):
    """Records a successful image for every pending cell; `failing(task)` returns failure codes."""
    for task in ex.pending_tasks(c):
        trial = ex.record_trial(c, task, "x.png", "job")
        trial.failures = list(failing(task)) if failing else []
    ex.refresh_status(c)


class GeneOperatorTests(unittest.TestCase):
    def setUp(self):
        self.state = make_state()
        self.rng = random.Random(7)
        self.c = ex.create_campaign(self.state, "t", PLAN, "기본", rng=self.rng)

    def assert_valid(self, genes, cat):
        values = ex.grid(cat)
        lo, hi = ex.bounds(cat, ex.pool(cat))
        self.assertTrue(lo <= len(genes) <= hi, genes)
        self.assertEqual(len({g.tag for g in genes}), len(genes))
        for g in genes:
            self.assertIn(g.tag, ex.pool(cat))
            self.assertNotIn(g.tag, cat.disabled_tags)
            self.assertTrue(any(abs(g.weight - v) < 1e-9 for v in values), g.weight)
            self.assertEqual(g.group, cat.name)

    def test_mutation_and_crossover_stay_valid(self):
        cat = self.state.categories[0]
        genomes = [self.c.genomes[g] for g in self.c.generations[0].genome_ids]
        rates = self.c.params["rates"]
        for i in range(1000):
            a, b = self.rng.sample(genomes, 2)
            moved, op = ex.mutate(self.c, self.state, a, "메인", rates, self.rng, converge=i % 2 == 0)
            self.assertIn(op, ex.OPERATORS)
            self.assert_valid(moved, cat)
            mixed = ex.crossover(self.c, self.state, a, b, "메인", self.rng)
            self.assert_valid(mixed, cat)
            genomes.append(ex.register(self.c, ex.full_genes(self.c, "메인", moved), op, [a.id], 0))

    def test_converging_weight_moves_one_step(self):
        c, cat = self.c, self.state.categories[0]
        genome = c.genomes[c.generations[0].genome_ids[0]]
        before = {g.tag: g.weight for g in ex.group_genes(genome, "메인")}
        only_weight = {op: 0 for op in ex.OPERATORS} | {"mut_weight": 1}
        c.params["second_op_prob"] = 0
        for _ in range(200):
            moved, _ = ex.mutate(c, self.state, genome, "메인", only_weight, self.rng, converge=True)
            changes = [abs(g.weight - before[g.tag]) for g in moved if abs(g.weight - before[g.tag]) > 1e-9]
            self.assertTrue(1 <= len(changes) <= 2)
            self.assertTrue(all(abs(d - cat.granule) < 1e-6 for d in changes), changes)

    def test_canonical_key_merges_same_combination(self):
        genes = [ex.Gene("메인", "artist:m2", 1.1), ex.Gene("메인", "artist:m3", 1.2)]
        first = ex.register(self.c, genes, "random", [], 1)
        again = ex.register(self.c, [ex.Gene(g.group, g.tag, g.weight) for g in genes], "mut_weight", [], 2)
        self.assertIs(first, again)
        self.assertNotEqual(ex.genome_id(genes), ex.genome_id(list(reversed(genes))))

    def test_full_genes_order_and_prompt_artists(self):
        genome = self.c.genomes[self.c.generations[0].genome_ids[0]]
        groups = [g.group for g in genome.genes]
        self.assertEqual(groups, sorted(groups, key=["메인", "신체", "발"].index))
        artists = app.genes_to_artists(genome.genes)
        self.assertEqual([a["tag"] for a in artists], [g.tag for g in genome.genes])
        self.assertEqual(artists[0]["prompt"], app.weight_tag(genome.genes[0].tag, genome.genes[0].weight))

    def test_baseline_uses_center_weight_and_start_genes(self):
        body = self.c.frozen["신체"]
        self.assertTrue(body)
        self.assertTrue(all(g.weight == ex.center(ex.grid(self.state.categories[1])) for g in body))
        start = [{"category": "메인", "tag": "artist:m5", "weight": 1.21}, {"category": "메인", "tag": "artist:m6", "weight": 1},
                 {"category": "신체", "tag": "artist:b2", "weight": .5}]
        c = ex.create_campaign(self.state, "t", PLAN, "기본", start_genes=start, rng=self.rng)
        self.assertEqual([(g.tag, g.weight) for g in c.frozen["신체"]], [("artist:b2", .5)])
        first = c.genomes[c.generations[0].genome_ids[0]]
        self.assertEqual(c.generations[0].origins[0], "seed")
        self.assertEqual([(g.tag, g.weight) for g in ex.group_genes(first, "메인")], [("artist:m5", 1.2), ("artist:m6", 1.0)])


class EvolutionTests(unittest.TestCase):
    def setUp(self):
        self.state = make_state()
        self.rng = random.Random(11)
        self.c = ex.create_campaign(self.state, "t", PLAN, "기본", rng=self.rng)

    def pick(self, picks):
        gen = ex.current_batch(self.c)
        fill_trials(self.c)
        self.assertEqual(gen.status, "awaiting_pick")
        return ex.pick(self.c, self.state, gen.index, picks, self.rng)

    def test_next_generation_composition(self):
        gen0 = ex.current_batch(self.c)
        self.assertEqual(gen0.origins, ["random"] * 6)  # No start combination was given.
        self.assertEqual(len(gen0.genome_ids), 6)
        self.assertEqual(len(gen0.seeds), 2)
        gen1 = self.pick(gen0.genome_ids[:2])
        kinds = [o if o in ("elite", "crossover", "random") else "mutate" for o in gen1.origins]
        self.assertEqual(Counter(kinds), Counter({"elite": 2, "crossover": 1, "mutate": 2, "random": 1}))
        self.assertEqual(gen1.genome_ids[:2], gen0.genome_ids[:2])
        gen2 = self.pick(gen1.genome_ids[3:4])
        kinds = [o if o in ("elite", "random") else "mutate" for o in gen2.origins]
        self.assertEqual(Counter(kinds), Counter({"elite": 1, "mutate": 4, "random": 1}))
        gen3 = self.pick([])
        kinds = [o if o in ("elite", "random") else "mutate" for o in gen3.origins]
        self.assertEqual(Counter(kinds), Counter({"elite": 1, "mutate": 3, "random": 2}))
        self.assertEqual(gen3.genome_ids[0], gen1.genome_ids[3])  # The previous elite survives "모두 별로".

    def test_children_avoid_recent_generations(self):
        for _ in range(8):
            gen = ex.current_batch(self.c)
            recent = ex.recent_keys(self.c, 3)
            nxt = self.pick([gen.genome_ids[self.rng.randrange(len(gen.genome_ids))]])
            self.assertNotEqual(set(nxt.seeds), set(gen.seeds))
            for gid, origin in zip(nxt.genome_ids, nxt.origins):
                if origin != "elite":
                    self.assertNotIn(self.c.genomes[gid].key, recent)

    def test_convergence_turns_on_and_off(self):
        winner = ex.current_batch(self.c).genome_ids[0]
        self.pick([winner])
        self.assertFalse(ex.is_converging(self.c))
        self.pick([winner])
        self.assertTrue(ex.is_converging(self.c))
        other = next(g for g in ex.current_batch(self.c).genome_ids if g != winner)
        self.pick([other])
        self.assertFalse(ex.is_converging(self.c))
        self.pick([other])
        self.pick([other])
        self.assertEqual(ex.same_winner_streak(self.c), 3)
        self.assertTrue(ex.campaign_info(self.c, self.state)["suggest_finish"])

    def test_pick_rejects_incomplete_generation_unless_forced(self):
        gen = ex.current_batch(self.c)
        task = ex.pending_tasks(self.c)[0]
        ex.record_trial(self.c, task, "x.png", "job")
        with self.assertRaises(ValueError):
            ex.pick(self.c, self.state, gen.index, [gen.genome_ids[0]], self.rng)
        self.assertIsNotNone(ex.pick(self.c, self.state, gen.index, [gen.genome_ids[0]], self.rng, force=True))

    def test_pending_tasks_order_and_resume(self):
        gen = ex.current_batch(self.c)
        tasks = ex.pending_tasks(self.c)
        self.assertEqual([t["seed"] for t in tasks], [gen.seeds[0]] * 6 + [gen.seeds[1]] * 6)
        ex.record_trial(self.c, tasks[0], "a.png", "job")
        ex.record_trial(self.c, tasks[1], "", "job", error="API 오류")
        left = ex.pending_tasks(self.c)
        self.assertEqual(len(left), 11)
        self.assertIn(tasks[1], left)  # Void attempts are generated again.

    def test_generation_limit(self):
        self.c.params["max_generations"] = 2
        self.assertIsNotNone(self.pick([ex.current_batch(self.c).genome_ids[0]]))
        self.assertIsNone(self.pick([ex.current_batch(self.c).genome_ids[0]]))
        self.assertTrue(ex.campaign_info(self.c, self.state)["suggest_finish"])


class RoundTests(unittest.TestCase):
    def setUp(self):
        self.state = make_state()
        self.rng = random.Random(5)
        self.c = ex.create_campaign(self.state, "t", PLAN, "기본", rng=self.rng)
        self.champion = self.c.generations[0].genome_ids[0]

    def test_wilson(self):
        low, high = ex.wilson(22, 28)
        self.assertAlmostEqual(low, .64, delta=.01)
        self.assertAlmostEqual(high, .88, delta=.01)
        self.assertEqual(ex.wilson(0, 0), (0.0, 1.0))

    def test_advance_freezes_winner_and_orders_groups(self):
        main_genes = ex.group_genes(self.c.genomes[self.champion], "메인")
        self.assertEqual(ex.advance_stage(self.c, self.state, self.champion, self.rng), "s1")
        self.assertEqual(self.c.champions["s0"], self.champion)
        self.assertEqual([(g.tag, g.weight) for g in self.c.frozen["메인"]], [(g.tag, g.weight) for g in main_genes])
        r = ex.current_batch(self.c)
        self.assertEqual(len(r.genome_ids), 8)
        self.assertEqual(r.scenes, ["기본", "서기", "맨발"])
        for gid in r.genome_ids:
            genes = self.c.genomes[gid].genes
            self.assertEqual([g.tag for g in genes[:len(main_genes)]], [g.tag for g in main_genes])
            groups = [g.group for g in genes]
            self.assertEqual(groups, sorted(groups, key=["메인", "신체", "발"].index))
        self.assertEqual(ex.group_genes(self.c.genomes[r.genome_ids[0]], "신체"), self.c.frozen["신체"])

    def test_rounds_halve_with_ties_and_void_trials(self):
        ex.advance_stage(self.c, self.state, self.champion, self.rng)
        r1 = ex.current_batch(self.c)
        good = set(r1.genome_ids[4:])
        fill_trials(self.c, lambda t: [] if t["genome_id"] in good else ["anatomy"])
        # A void attempt on a good candidate neither counts as failure nor as success.
        ex.record_trial(self.c, {"genome_id": r1.genome_ids[4], "seed": r1.seeds[0], "scene": "기본", "stage": "s1", "batch": 0},
                        "", "job", error="timeout")
        self.assertEqual(r1.status, "awaiting_labels")
        result = ex.close_round(self.c, self.state, self.rng)
        self.assertEqual(result, {"next_round": 1})
        self.assertEqual(set(r1.survivors), good)
        stats = ex.genome_stats(self.c, r1.genome_ids[4], "s1")
        self.assertEqual((stats["s"], stats["n"]), (6, 6))
        r2 = ex.current_batch(self.c)
        self.assertEqual(len(r2.seeds), 4)
        # Equal success rates: fewer style failures wins.
        styled = set(r2.genome_ids[:2])
        fill_trials(self.c, lambda t: ["style"] if t["genome_id"] in styled and t["seed"] == r2.seeds[0] else
                    ["anatomy"] if t["seed"] == r2.seeds[0] else [])
        ex.close_round(self.c, self.state, self.rng)
        self.assertEqual(set(r2.survivors), set(r2.genome_ids[2:]))
        r3 = ex.current_batch(self.c)
        self.assertEqual((len(r3.genome_ids), len(r3.seeds)), (2, 8))
        fill_trials(self.c)
        result = ex.close_round(self.c, self.state, self.rng)
        self.assertTrue(result["overlap"])
        self.assertEqual(result["recommended"], "")
        self.assertEqual(len(result["finalists"]), 2)

    def test_tie_prefers_baseline(self):
        ex.advance_stage(self.c, self.state, self.champion, self.rng)
        r1 = ex.current_batch(self.c)
        fill_trials(self.c)
        ex.close_round(self.c, self.state, self.rng)
        self.assertEqual(r1.survivors[0], r1.genome_ids[0])

    def test_close_round_requires_complete_round_and_manual_elimination(self):
        ex.advance_stage(self.c, self.state, self.champion, self.rng)
        r1 = ex.current_batch(self.c)
        with self.assertRaises(ValueError):
            ex.close_round(self.c, self.state, self.rng)
        ex.set_genome(self.c, r1.genome_ids[0], "eliminate")
        self.assertFalse(any(t["genome_id"] == r1.genome_ids[0] for t in ex.pending_tasks(self.c)))
        fill_trials(self.c)
        ex.close_round(self.c, self.state, self.rng)
        self.assertNotIn(r1.genome_ids[0], r1.survivors)
        r2 = ex.current_batch(self.c)
        ex.set_genome(self.c, r1.genome_ids[0], "revive")
        self.assertIn(r1.genome_ids[0], r2.genome_ids)

    def test_whole_campaign_reaches_done(self):
        ex.advance_stage(self.c, self.state, self.champion, self.rng)
        while not ex.current_batch(self.c).result:
            fill_trials(self.c)
            ex.close_round(self.c, self.state, self.rng)
        finalist = ex.current_batch(self.c).result["finalists"][0]
        self.assertEqual(ex.advance_stage(self.c, self.state, finalist, self.rng), "s2")
        self.assertEqual(ex.current_batch(self.c).scenes, ["맨발"])
        self.assertEqual(ex.advance_stage(self.c, self.state, "", self.rng), "retune")
        gen = ex.current_batch(self.c)
        self.assertEqual(gen.origins[0], "elite")
        self.assertTrue(ex.is_converging(self.c))
        fill_trials(self.c)
        ex.pick(self.c, self.state, gen.index, [gen.genome_ids[1]], self.rng)
        self.assertEqual(ex.advance_stage(self.c, self.state, gen.genome_ids[1], self.rng), "confirm")
        final = self.c.genomes[self.c.champions["final"]]
        self.assertEqual(ex.group_genes(final, "메인"), ex.group_genes(self.c.genomes[gen.genome_ids[1]], "메인"))
        self.assertEqual(ex.group_genes(final, "신체"), ex.group_genes(self.c.genomes[finalist], "신체"))
        confirm = ex.current_batch(self.c)
        self.assertEqual((confirm.genome_ids, len(confirm.seeds)), ([final.id], 4))
        self.assertEqual(ex.stage_info(self.c)["labels"], ["anatomy", "feet", "prompt", "style"])
        fill_trials(self.c)
        ex.close_round(self.c, self.state, self.rng)
        self.assertEqual(self.c.stage, "done")

    def test_tagged_stage_needs_tagged_scenes(self):
        self.state.batting_scenes[2].tags = []
        ex.advance_stage(self.c, self.state, self.champion, self.rng)
        with self.assertRaises(ValueError):
            ex.advance_stage(self.c, self.state, "", self.rng)
        self.assertEqual(self.c.stage, "s1")
        self.assertEqual(ex.advance_stage(self.c, self.state, "", self.rng, skip_next=True), "retune")

    def test_labels(self):
        ex.advance_stage(self.c, self.state, self.champion, self.rng)
        trial = ex.record_trial(self.c, ex.pending_tasks(self.c)[0], "x.png", "job")
        ex.label_trial(self.c, trial.id, ["anatomy", "style"])
        self.assertEqual(ex.genome_stats(self.c, trial.genome_id, "s1")["reasons"]["style"], 1)
        with self.assertRaises(ValueError):
            ex.label_trial(self.c, trial.id, ["unknown"])
        with self.assertRaises(ValueError):
            ex.label_trial(self.c, trial.id, ["feet"])  # Feet is only judged in the feet stage.


class ReopenTests(unittest.TestCase):
    """Going back to an earlier stage of a finished campaign."""

    def setUp(self):
        self.state = make_state()
        self.rng = random.Random(13)
        self.c = ex.create_campaign(self.state, "t", PLAN, "기본", rng=self.rng)
        self.feet_base = [(g.tag, g.weight) for g in self.c.frozen["발"]]

    def finish(self, skip_feet_unseen=False):
        """s0 pick → s1 rounds → s2 skipped → retune with a new winner → confirm → done."""
        c = self.c
        fill_trials(c)
        self.main = c.generations[0].genome_ids[1]
        ex.pick(c, self.state, 0, [self.main], self.rng)
        ex.advance_stage(c, self.state, self.main, self.rng)
        while not ex.current_batch(c).result:
            fill_trials(c)
            ex.close_round(c, self.state, self.rng)
        self.body = ex.current_batch(c).result["finalists"][0]
        ex.advance_stage(c, self.state, self.body, self.rng, skip_next=skip_feet_unseen)
        if not skip_feet_unseen:
            fill_trials(c)  # Some feet images exist, then the stage is skipped.
            ex.advance_stage(c, self.state, "", self.rng)
        gen = ex.current_batch(c)
        fill_trials(c)
        ex.pick(c, self.state, gen.index, [gen.genome_ids[2]], self.rng)
        self.retuned = gen.genome_ids[2]
        self.stale = ex.pending_tasks(c)[0]  # A retune image still generating when the user goes back.
        ex.advance_stage(c, self.state, self.retuned, self.rng)
        fill_trials(c)
        ex.close_round(c, self.state, self.rng)
        self.assertEqual(c.stage, "done")

    def pairs(self, genes):
        return [(g.tag, g.weight) for g in genes]

    def assert_back_at_feet(self):
        c = self.c
        self.assertEqual(c.stage, "s2")
        self.assertEqual(set(c.champions), {"s0", "s1"})
        self.assertFalse([b for b in [*c.generations, *c.rounds, *c.trials] if b.stage in ("retune", "confirm")])
        # The main group holds its stage 1 winner again, not the retune result.
        self.assertEqual(c.frozen["메인"], ex.group_genes(c.genomes[self.main], "메인"))
        self.assertEqual(c.frozen["신체"], ex.group_genes(c.genomes[self.body], "신체"))
        self.assertEqual(self.pairs(c.frozen["발"]), self.feet_base)
        r = ex.current_batch(c)
        self.assertEqual(self.pairs(ex.group_genes(c.genomes[r.genome_ids[0]], "발")), self.feet_base)
        self.assertEqual(ex.group_genes(c.genomes[r.genome_ids[0]], "메인"), c.frozen["메인"])
        return r

    def test_skipped_stage_resumes_where_it_was_left(self):
        self.finish()
        made = len([t for t in self.c.trials if t.stage == "s2"])
        ex.reopen_stage(self.c, self.state, "s2", self.rng)
        r = self.assert_back_at_feet()
        self.assertEqual(r.status, "awaiting_labels")
        self.assertEqual(len([t for t in self.c.trials if t.stage == "s2"]), made)
        # Finishing it again runs the later stages anew.
        while not ex.current_batch(self.c).result:
            fill_trials(self.c)
            ex.close_round(self.c, self.state, self.rng)
        feet = ex.current_batch(self.c).result["finalists"][0]
        self.assertEqual(ex.advance_stage(self.c, self.state, feet, self.rng), "retune")
        self.assertEqual(ex.current_batch(self.c).genome_ids[0], ex.genome_id(ex.full_genes(self.c, "메인", self.c.frozen["메인"])))

    def test_candidate_confirmed_mid_round_resumes_that_round(self):
        c = self.c
        fill_trials(c)
        main = c.generations[0].genome_ids[1]
        ex.pick(c, self.state, 0, [main], self.rng)
        ex.advance_stage(c, self.state, main, self.rng)
        r1 = ex.current_batch(c)
        fill_trials(c)
        early = r1.genome_ids[3]
        # Chosen straight from the first round, before it is closed.
        self.assertEqual(ex.advance_stage(c, self.state, early, self.rng), "s2")
        self.assertEqual(c.champions["s1"], early)
        self.assertEqual(c.frozen["신체"], ex.group_genes(c.genomes[early], "신체"))
        self.assertEqual(len(ex.stage_rounds(c, "s1")), 1)
        ex.reopen_stage(c, self.state, "s1", self.rng)
        self.assertEqual(c.stage, "s1")
        self.assertNotIn("s1", c.champions)
        r = ex.current_batch(c)
        self.assertEqual((r.index, r.status), (0, "awaiting_labels"))
        ex.close_round(c, self.state, self.rng)
        self.assertEqual(ex.current_batch(c).index, 1)

    def test_stage_skipped_unseen_starts_fresh(self):
        self.finish(skip_feet_unseen=True)
        self.assertFalse(ex.stage_rounds(self.c, "s2"))
        ex.reopen_stage(self.c, self.state, "s2", self.rng)
        r = self.assert_back_at_feet()
        self.assertEqual((r.index, r.status, len(r.genome_ids)), (0, "pending", 8))

    def test_older_campaign_without_stored_baselines(self):
        self.finish()
        self.c.baselines = {}
        ex.reopen_stage(self.c, self.state, "s2", self.rng)
        self.assert_back_at_feet()
        self.assertEqual(self.pairs(self.c.baselines["발"]), self.feet_base)

    def test_late_image_of_a_dropped_stage_is_ignored(self):
        self.finish()
        ex.reopen_stage(self.c, self.state, "s1", self.rng)
        self.assertEqual(self.c.stage, "s1")
        self.assertEqual(ex.current_batch(self.c).status, "done")  # The final round waits for a winner again.
        self.assertNotIn("s1", self.c.champions)
        self.assertIsNone(ex.record_trial(self.c, self.stale, "late.png", "job"))
        self.assertFalse([t for t in self.c.trials if t.stage == "retune"])

    def test_only_earlier_searched_stages(self):
        for key in ("s0", "retune", "confirm", "done", "nope"):
            with self.assertRaises(ValueError):
                ex.reopen_stage(self.c, self.state, key, self.rng)
        self.finish(skip_feet_unseen=True)
        before = ex.campaign_to_dict(self.c)
        self.state.batting_scenes[2].tags = []  # No scene for the feet stage: the campaign stays as it was.
        with self.assertRaises(ValueError):
            ex.reopen_stage(self.c, self.state, "s2", self.rng)
        self.assertEqual(ex.campaign_to_dict(self.c), before)


class PlanTests(unittest.TestCase):
    """Category setups other than main/body/feet."""

    def setUp(self):
        self.state = AppState(
            categories=[Category("메인", tags("m", 8), 1.0, 1.3, .05, min_picks=2, max_picks=3, all_artists=False),
                        Category("색감", tags("c", 6), .5, 1.0, .1, min_picks=1, max_picks=2, all_artists=False),
                        Category("신체", tags("b", 6), .4, .9, .1, min_picks=1, max_picks=2, all_artists=False),
                        Category("배경", tags("g", 4), .6, .8, .1, min_picks=1, max_picks=1, all_artists=False),
                        Category("실험", tags("x", 3), 1, 1, .1, min_picks=1, max_picks=1, all_artists=False)],
            prompt_presets=[PromptPreset("기본", "base")], batting_scenes=[BattingScene("", "기본")])
        self.rng = random.Random(9)
        # Search order differs from the category order; 실험 is not used at all.
        self.plan = [{"group": "신체", "mode": "rate"}, {"group": "색감", "mode": "pick"},
                     {"group": "메인", "mode": "pick"}, {"group": "배경", "mode": "fixed"}, {"group": "실험", "mode": "off"}]
        self.c = ex.create_campaign(self.state, "t", self.plan, "기본", rng=self.rng)

    def test_stage_list_follows_plan(self):
        self.assertEqual([(s["key"], s["kind"], s["group"]) for s in ex.stages(self.c)],
                         [("s0", "round", "신체"), ("s1", "evolve", "색감"), ("s2", "evolve", "메인"),
                          ("retune", "evolve", "색감"), ("confirm", "round", None), ("done", "done", None)])
        self.assertEqual(ex.reference_stage(self.c), "s1")
        self.assertEqual(self.c.group_order, ["메인", "색감", "신체", "배경"])

    def test_fixed_groups_stay_in_every_prompt_in_category_order(self):
        order = ["메인", "색감", "신체", "배경"]
        r = ex.current_batch(self.c)
        self.assertIsInstance(r, ex.Round)
        for gid in r.genome_ids:
            groups = [g.group for g in self.c.genomes[gid].genes]
            self.assertEqual(sorted(set(groups), key=order.index), order)
            self.assertEqual(groups, sorted(groups, key=order.index))
            self.assertEqual(ex.group_genes(self.c.genomes[gid], "배경"), self.c.frozen["배경"])
            self.assertNotIn("실험", groups)

    def test_later_pick_stage_starts_from_its_baseline(self):
        base = self.c.frozen["색감"]
        ex.advance_stage(self.c, self.state, "", self.rng)
        gen = ex.current_batch(self.c)
        self.assertEqual(gen.origins[0], "seed")
        self.assertEqual(ex.group_genes(self.c.genomes[gen.genome_ids[0]], "색감"), base)
        main = {tuple((g.tag, g.weight) for g in ex.group_genes(self.c.genomes[gid], "메인")) for gid in gen.genome_ids}
        self.assertEqual(len(main), 1)  # Only 색감 moves.
        fill_trials(self.c)
        ex.pick(self.c, self.state, 0, [gen.genome_ids[2]], self.rng)
        ex.advance_stage(self.c, self.state, gen.genome_ids[2], self.rng)
        self.assertEqual(self.c.frozen["색감"], ex.group_genes(self.c.genomes[gen.genome_ids[2]], "색감"))
        self.assertEqual(self.c.stage, "s2")
        self.assertEqual(ex.current_batch(self.c).origins.count("seed"), 1)

    def test_plan_validation(self):
        with self.assertRaises(ValueError):
            ex.create_campaign(self.state, "t", [{"group": "메인", "mode": "fixed"}], "기본", rng=self.rng)
        with self.assertRaises(ValueError):
            ex.create_campaign(self.state, "t", [{"group": "없음", "mode": "pick"}], "기본", rng=self.rng)
        with self.assertRaises(ValueError):
            ex.create_campaign(self.state, "t", [{"group": "메인", "mode": "rate", "labels": ["nope"]}], "기본", rng=self.rng)
        frozen = ex.baseline(self.state, self.plan, rng=self.rng)
        self.assertEqual(set(frozen), {"신체", "색감", "메인", "배경"})


class PersistenceTests(unittest.TestCase):
    def test_round_trip(self):
        state = make_state()
        rng = random.Random(3)
        with tempfile.TemporaryDirectory() as folder, patch.object(app, "EXPLORE_DIR", Path(folder)):
            c = ex.create_campaign(state, "저장", PLAN, "기본", rng=rng)
            fill_trials(c)
            ex.save_campaign(c)
            loaded = ex.load_campaign(c.id)
            self.assertEqual(ex.campaign_to_dict(loaded), ex.campaign_to_dict(c))
            self.assertIsInstance(loaded.genomes[c.generations[0].genome_ids[0]].genes[0], ex.Gene)
            self.assertEqual([s["id"] for s in ex.list_campaigns()], [c.id])
            with self.assertRaises(ValueError):
                ex.load_campaign("../secret")
            ex.delete_campaign(c.id)
            self.assertEqual(ex.list_campaigns(), [])


if __name__ == "__main__":
    unittest.main()
