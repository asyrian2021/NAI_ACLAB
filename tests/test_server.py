import json
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer
import app
import web_app as web


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / '.test-data');root=Path(self.temp.name)
        self.p1=patch.multiple(app,DATA_DIR=root,OUTPUT_DIR=root/'outputs',EXPLORE_DIR=root/'explore',STATE_PATH=root/'app_state.json',TOKEN_SECRET_PATH=root/'token')
        self.p2=patch.multiple(web,OUTPUT_DIR=root/'outputs',STATE_PATH=root/'app_state.json')
        self.p1.start();self.p2.start()
        web.JOBS.clear()
        self.server=ThreadingHTTPServer(('127.0.0.1',0),web.Handler)
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
        self.url=f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        web.WORK.join();self.server.shutdown();self.server.server_close();self.p2.stop();self.p1.stop();self.temp.cleanup()

    def request(self,path,body=None,auth=True):
        headers={'X-NAI-ACLAB-Token':web.LOCAL_API_TOKEN} if auth else {}
        req=urllib.request.Request(self.url+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
        with urllib.request.urlopen(req,timeout=10) as r:return json.loads(r.read())

    def test_auth_and_removed_rating_route(self):
        with self.assertRaises(urllib.error.HTTPError) as c:self.request('/api/state',auth=False)
        self.assertEqual(c.exception.code,403)
        with self.assertRaises(urllib.error.HTTPError) as c:self.request('/api/history/rate',{})
        self.assertEqual(c.exception.code,404)

    def test_scene_tags_are_a_shared_list_covering_every_scene(self):
        state=self.request('/api/state')['state']
        self.assertEqual(state['scene_tags'],[])
        preset=state['generation']['preset']
        state['scene_tags']=['전신',' 발 보임 ']
        state['batting_scenes']=[{'name':'','preset':preset,'image_size':'portrait','count':1,'tags':['발 보임']},
                                 {'name':'','preset':preset,'image_size':'portrait','count':1,'tags':['손']}]
        saved=self.request('/api/state',{'state':state})['state']
        # Tags used by scenes but missing from the list (older data) are kept as defined tags.
        self.assertEqual(saved['scene_tags'],['전신','발 보임','손'])
        state['scene_tags']=['x'*41]
        with self.assertRaises(urllib.error.HTTPError):self.request('/api/state',{'state':state})

    def test_batting_scene_per_preset_with_size_rows(self):
        state=self.request('/api/state')['state']
        preset=state['generation']['preset']
        # Older data: the same preset listed several times, one size each.
        state['batting_scenes']=[{'name':'','preset':preset,'image_size':'portrait','count':1,'tags':['a']},
                                 {'name':'','preset':preset,'image_size':'landscape','count':2,'tags':['b']},
                                 {'name':'','preset':preset,'image_size':'portrait','count':1}]
        saved=self.request('/api/state',{'state':state})['state']['batting_scenes']
        self.assertEqual(len(saved),1)
        self.assertEqual(saved[0]['sizes'],[{'image_size':'portrait','count':2},{'image_size':'landscape','count':2}])
        self.assertEqual(saved[0]['tags'],['a','b'])
        bad=dict(saved[0],sizes=[{'image_size':'square','count':1},{'image_size':'square','count':1}])
        state['batting_scenes']=[bad]
        with self.assertRaises(urllib.error.HTTPError) as e:self.request('/api/state',{'state':state})
        self.assertEqual(e.exception.code,400)
        state['batting_scenes']=saved
        sizes=[]
        def capture(client,prompt,negative,path):
            sizes.append((client.settings.width,client.settings.height));path.write_bytes(b'\x89PNG')
        with patch.object(app.NovelAIClient,'generate',capture):
            job=self.request('/api/batting/generate',{'state':state})['job_id']
            web.WORK.join()
        self.assertEqual(web.JOBS[job]['total'],4)
        self.assertEqual(sizes,[(832,1216)]*2+[(1216,832)]*2)

    def test_disabled_artist_tags_are_normalized_with_their_list(self):
        state=self.request('/api/state')['state']
        state['categories'][0]['tags']=['1.2::artist:a ::','artist:b','artist:c']
        state['categories'][0]['disabled_tags']=['artist:b','artist:gone','0.9::artist:c']
        saved=self.request('/api/state',{'state':state})['state']['categories'][0]
        self.assertEqual(saved['tags'],['artist:a','artist:b','artist:c'])
        self.assertEqual(saved['disabled_tags'],['artist:b','artist:c'])

    def test_generation_checkpoints_prompt_seed_and_media(self):
        state=self.request('/api/state')['state'];state['generation']['count']=2;state['api']['width']=64;state['api']['height']=64
        job=self.request('/api/generate',{'state':state})['job_id']
        web.WORK.join()
        self.assertEqual(web.JOBS[job]['status'],'done')
        history=self.request('/api/state')['state']['history'][0]
        self.assertEqual(len(history['items']),2)
        image=history['items'][0]
        self.assertIn('prompt',image);self.assertGreaterEqual(image['seed'],0)
        with urllib.request.urlopen(self.url+image['image_url']) as r:self.assertTrue(r.read().startswith(b'\x89PNG'))
        self.assertNotEqual(history['items'][0]['seed'],history['items'][1]['seed'])

    def test_cancel_queued_job_and_completed_images_survive(self):
        entered=threading.Event();release=threading.Event()
        def slow(client,prompt,negative,path):
            entered.set();release.wait(5);path.write_bytes(b'\x89PNG')
        state=self.request('/api/state')['state'];state['generation']['count']=2
        with patch.object(app.NovelAIClient,'generate',slow):
            first=self.request('/api/generate',{'state':state})['job_id'];self.assertTrue(entered.wait(2))
            second=self.request('/api/generate',{'state':state})['job_id']
            self.request('/api/job/cancel',{'job_id':second});self.request('/api/job/cancel',{'job_id':first})
            release.set();web.WORK.join()
        self.assertEqual(web.JOBS[first]['status'],'cancelled');self.assertEqual(web.JOBS[second]['status'],'cancelled')
        history=self.request('/api/state')['state']['history']
        self.assertEqual(len(history),1);self.assertEqual(len(history[0]['items']),1)

    def test_scene_name_is_always_preset_name(self):
        state=self.request('/api/state')['state']
        state['batting_scenes']=[{'name':'obsolete name','preset':state['generation']['preset'],'image_size':'portrait','count':1}]
        def fast(client,prompt,negative,path):path.write_bytes(b'\x89PNG')
        with patch.object(app.NovelAIClient,'generate',fast):
            self.request('/api/batting/generate',{'state':state})
            web.WORK.join()
        image=self.request('/api/state')['state']['history'][0]['items'][0]
        self.assertEqual(image['scene_name'],state['generation']['preset'])

    def test_guidance_sweep_preserves_source_and_changes_only_axes(self):
        state = self.request('/api/state')['state']
        state['api'].update(width=64, height=64, seed=123, scale=5, guidance_rescale=.2)
        state['generation']['count'] = 1
        self.request('/api/generate', {'state': state})
        web.WORK.join()
        state = self.request('/api/state')['state']
        source = state['history'][0]['items'][0]
        self.assertNotIn('token', source['generation_settings'])
        state['api'].update(seed=999, model='changed model', steps=40)
        state['quality_prompt'] = 'changed quality'
        state['prompt_presets'][0]['base_prompt'] = 'changed base'
        state['guidance_test'].update(source_path=source['path'], x_min=4, x_max=4.2, x_step=.1, y_min=0, y_max=.2, y_step=.2)
        calls = []
        def capture(client, prompt, negative, path):
            calls.append((prompt, negative, client.settings.seed, client.settings.model, client.settings.steps, client.settings.scale, client.settings.guidance_rescale))
            path.write_bytes(b'\x89PNG')
        with patch.object(app.NovelAIClient, 'generate', capture):
            job = self.request('/api/guidance/generate', {'state': state})['job_id']
            web.WORK.join()
        self.assertEqual(web.JOBS[job]['total'], 6)
        self.assertEqual(web.JOBS[job]['status'], 'done')
        self.assertEqual([(c[-2], c[-1]) for c in calls], [(4, 0), (4.1, 0), (4.2, 0), (4, .2), (4.1, .2), (4.2, .2)])
        for c in calls:
            self.assertEqual(c[:5], (source['prompt'], source['negative_prompt'], 123, source['generation_settings']['model'], source['generation_settings']['steps']))
        saved = self.request('/api/state')['state']
        result = saved['history'][0]
        self.assertEqual(result['type'], 'guidance_test')
        self.assertEqual(result['sweep']['source_seed'], 123)
        self.assertEqual([(i['sweep_x'], i['sweep_y']) for i in result['items']], [(0,0),(1,0),(2,0),(0,1),(1,1),(2,1)])
        self.assertEqual(saved['api']['seed'], 999)
        self.assertEqual(saved['quality_prompt'], 'changed quality')

    def test_guidance_legacy_settings_errors_and_cancellation(self):
        from models import AppState, GuidanceTestSettings
        source = {'path': 'legacy.png', 'prompt': 'unchanged base | character', 'negative_prompt': 'negative',
                  'seed': 7, 'width': 64, 'height': 64, 'artists': [], 'preset': 'legacy'}
        state = AppState(history=[{'id':'legacy', 'items':[source]}],
                         guidance_test=GuidanceTestSettings(source_path='legacy.png', x_min=4, x_max=5, x_step=1, y_min=0,y_max=0,y_step=.1))
        state.api.steps = 39
        current, sweep = web.prepare_guidance(state)
        self.assertEqual(sweep[3], 'current')
        self.assertEqual(current.api.steps, 39)
        self.assertEqual(current.api.seed, 7)
        job = 'sweep-error-test'
        web.JOBS[job] = {'id':job,'status':'queued','progress':0,'total':2}
        calls = []
        def partial(client, prompt, negative, path):
            calls.append(client.settings.scale)
            if len(calls) == 1: raise ValueError('mock generation error')
            path.write_bytes(b'\x89PNG')
        with patch.object(app.NovelAIClient, 'generate', partial): web.run_job(job,current,sweep=sweep)
        result = app.load_state().history[0]
        self.assertEqual(web.JOBS[job]['status'], 'failed')
        self.assertEqual(web.JOBS[job]['progress'], 2)
        self.assertIn('error',result['items'][0])
        self.assertNotIn('error',result['items'][1])
        job = 'sweep-cancel-test'
        web.JOBS[job] = {'id':job,'status':'queued','progress':0,'total':2}
        def cancel_after_one(client, prompt, negative, path):
            path.write_bytes(b'\x89PNG')
            web.update_job(job,cancel_requested=True)
        with patch.object(app.NovelAIClient, 'generate', cancel_after_one): web.run_job(job,current,sweep=sweep)
        self.assertEqual(web.JOBS[job]['status'],'cancelled')
        self.assertEqual(len(app.load_state().history[0]['items']),1)

    def test_guidance_missing_metadata_and_invalid_ranges_rejected(self):
        state = self.request('/api/state')['state']
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request('/api/guidance/generate', {'state': state})
        self.assertEqual(error.exception.code, 400)
        from guidance import axis_values, grid_values
        from models import GuidanceTestSettings
        self.assertEqual(axis_values(.1, .35, .1, 1), [.1, .2, .3])
        for values in [(2,1,.1,100), (0,1,0,1), (0,2,.1,1), (0,1,float('nan'),1)]:
            with self.assertRaises(ValueError): axis_values(*values)
        with self.assertRaises(ValueError): grid_values(GuidanceTestSettings(x_min=0,x_max=100,x_step=1,y_step=.1))

    def test_completed_job_retention_preserves_active_jobs_and_history(self):
        with web.JOBS_LOCK:
            web.JOBS['active-old'] = {'id':'active-old','status':'running','progress':0,'total':1}
            for i in range(60):
                web.JOBS[f'old-{i}'] = {'id':f'old-{i}','status':'done','progress':1,'total':1}
            web.JOBS['finishing'] = {'id':'finishing','status':'running','progress':0,'total':1}
        web.update_job('finishing',status='done',progress=1)
        result = self.request('/api/jobs')['jobs']
        self.assertEqual(sum(j['status']=='done' for j in result),50)
        self.assertTrue(any(j['id']=='active-old' for j in result))
        self.assertFalse(any(j['id']=='old-0' for j in result))
        self.assertEqual(self.request('/api/state')['state']['history'],[])

    def explore_state(self):
        state=self.request('/api/state')['state']
        state['api'].update(width=64,height=64,seed=-1,mock_mode=True)
        state['categories']=[
            {'name':'메인','tags':[f'artist:m{i}' for i in range(8)],'min_weight':1,'max_weight':1.3,'granule':.05,'picks':0,'min_picks':2,'max_picks':3,'all_artists':False},
            {'name':'신체','tags':[f'artist:b{i}' for i in range(6)],'min_weight':.5,'max_weight':.8,'granule':.1,'picks':0,'min_picks':1,'max_picks':2,'all_artists':False}]
        state['batting_scenes']=[{'name':'','preset':state['generation']['preset'],'image_size':'square','count':1,'tags':['feet']}]
        return self.request('/api/state',{'state':state})['state']

    def test_explore_generation_runs_with_shared_seeds_and_fixed_order(self):
        state=self.explore_state()
        frozen=self.request('/api/explore/baseline',{'plan':[{'group':'메인','mode':'pick'},{'group':'신체','mode':'rate'}]})['frozen']
        self.assertEqual(list(frozen),['신체'])
        c=self.request('/api/explore/create',{'name':'테스트','plan':[{'group':'메인','mode':'pick'},{'group':'신체','mode':'rate'}],'preset':state['generation']['preset'],'image_size':'landscape','frozen':frozen,'params':{'seeds_per_gen':2}})['campaign']
        self.assertEqual(c['frozen']['신체'],frozen['신체'])
        prompts=[]
        original=app.NovelAIClient.generate
        def capture(client,prompt,negative,path):
            prompts.append((prompt,client.settings.seed));original(client,prompt,negative,path)
        with patch.object(app.NovelAIClient,'generate',capture):
            job=self.request('/api/explore/run',{'id':c['id']})['job_id']
            with self.assertRaises(urllib.error.HTTPError):self.request('/api/explore/run',{'id':c['id']})
            web.WORK.join()
        self.assertEqual(web.JOBS[job]['status'],'done')
        self.assertTrue(web.JOBS[job]['name'].startswith('탐색 · 테스트 · 1단계 라운드 1'))
        c=self.request('/api/explore/'+c['id'])['campaign']
        gen=c['generations'][0]
        self.assertEqual(len(c['trials']),12);self.assertEqual(gen['status'],'awaiting_pick')
        self.assertEqual([t['seed'] for t in c['trials']],[gen['seeds'][0]]*6+[gen['seeds'][1]]*6)
        self.assertEqual([seed for _,seed in prompts],[t['seed'] for t in c['trials']])
        for (prompt,_),trial in zip(prompts,c['trials']):
            genes=c['genomes'][trial['genome_id']]['genes']
            self.assertIn(', '.join(app.weight_tag(g['tag'],g['weight']) for g in genes),prompt)
        with urllib.request.urlopen(self.url+c['trials'][0]['image_url']) as r:self.assertTrue(r.read().startswith(b'\x89PNG'))
        history=self.request('/api/state')['state']['history'][0]
        # Pick-stage images use the campaign's size, not the studio's (64×64 here).
        self.assertEqual({(i['width'],i['height']) for i in history['items']},{(1216,832)})
        self.assertEqual(history['type'],'explore');self.assertEqual(history['items'][0]['trial_id'],c['trials'][0]['id'])
        c=self.request('/api/explore/pick',{'id':c['id'],'generation':0,'picks':gen['genome_ids'][:2]})['campaign']
        self.assertEqual(c['generations'][1]['genome_ids'][:2],gen['genome_ids'][:2])
        self.assertEqual(c['info']['pending'],12)
        listing=self.request('/api/explore')['campaigns']
        self.assertEqual((listing[0]['id'],listing[0]['progress']),(c['id'],'라운드 2'))
        c=self.request('/api/explore/advance',{'id':c['id'],'champion_id':gen['genome_ids'][0]})['campaign']
        self.assertEqual(c['stage'],'s1');self.assertEqual(len(c['rounds'][0]['genome_ids']),8)
        self.request('/api/explore/delete',{'id':c['id']})
        self.assertEqual(self.request('/api/explore')['campaigns'],[])

    def test_explore_cancel_then_run_generates_only_missing(self):
        import explore
        state=self.explore_state()
        with self.assertRaises(urllib.error.HTTPError) as e:self.request('/api/explore/create',{'plan':[{'group':'메인','mode':'pick'}],'preset':state['generation']['preset']})
        self.assertEqual(e.exception.code,400)  # No image size chosen.
        c=self.request('/api/explore/create',{'plan':[{'group':'메인','mode':'pick'}],'preset':state['generation']['preset'],'image_size':'square','params':{'seeds_per_gen':2}})['campaign']
        job='explore-cancel-test'
        web.JOBS[job]={'id':job,'status':'queued','progress':0,'total':12,'campaign_id':c['id']}
        def cancel_after_three(client,prompt,negative,path):
            path.write_bytes(b'\x89PNG')
            if web.JOBS[job]['progress']>=2:web.update_job(job,cancel_requested=True)
        with web.EXPLORE_LOCK:tasks=explore.pending_tasks(explore.load_campaign(c['id']))
        with patch.object(app.NovelAIClient,'generate',cancel_after_three):web.run_job(job,app.load_state(),explore=(c['id'],tasks))
        self.assertEqual(web.JOBS[job]['status'],'cancelled')
        c=self.request('/api/explore/'+c['id'])['campaign']
        self.assertEqual((len(c['trials']),c['info']['pending']),(3,9))
        with self.assertRaises(urllib.error.HTTPError) as e:self.request('/api/explore/pick',{'id':c['id'],'generation':0,'picks':[]})
        self.assertEqual(e.exception.code,400)
        second=self.request('/api/explore/run',{'id':c['id']})['job_id'];web.WORK.join()
        self.assertEqual(web.JOBS[second]['total'],9)
        c=self.request('/api/explore/'+c['id'])['campaign']
        self.assertEqual((len(c['trials']),c['info']['pending']),(12,0))
        self.assertEqual(len({(t['genome_id'],t['seed']) for t in c['trials']}),12)
        with self.assertRaises(urllib.error.HTTPError) as e:self.request('/api/explore/..%2Fapp_state')
        self.assertIn(e.exception.code,{400,404})

    def test_explore_labels_and_rounds(self):
        state=self.explore_state()
        c=self.request('/api/explore/create',{'plan':[{'group':'메인','mode':'pick'},{'group':'신체','mode':'rate'}],'preset':state['generation']['preset'],'image_size':'square'})['campaign']
        c=self.request('/api/explore/advance',{'id':c['id'],'champion_id':c['generations'][0]['genome_ids'][0]})['campaign']
        self.request('/api/explore/run',{'id':c['id']});web.WORK.join()
        c=self.request('/api/explore/'+c['id'])['campaign']
        self.assertEqual(len(c['trials']),16)
        trial=c['trials'][0]
        c=self.request('/api/explore/label',{'id':c['id'],'trial_id':trial['id'],'failures':['anatomy']})['campaign']
        stats=c['info']['stats']['s1'][trial['genome_id']]
        self.assertEqual((stats['s'],stats['n'],stats['reasons']['anatomy']),(1,2,1))
        result=self.request('/api/explore/close-round',{'id':c['id']})
        self.assertEqual(result['round'],{'next_round':1})
        self.assertNotIn(trial['genome_id'],result['campaign']['rounds'][0]['survivors'])
        self.assertEqual(len(result['campaign']['rounds'][1]['seeds']),4)

    def test_explore_reopen_skipped_stage(self):
        state=self.explore_state()
        c=self.request('/api/explore/create',{'plan':[{'group':'메인','mode':'pick'},{'group':'신체','mode':'rate'}],'preset':state['generation']['preset'],'image_size':'square'})['campaign']
        winner=c['generations'][0]['genome_ids'][0]
        c=self.request('/api/explore/advance',{'id':c['id'],'champion_id':winner})['campaign']
        body=c['frozen']['신체']
        for _ in range(2):c=self.request('/api/explore/advance',{'id':c['id'],'champion_id':''})['campaign']
        self.assertEqual(c['stage'],'confirm')
        with self.assertRaises(urllib.error.HTTPError) as e:self.request('/api/explore/reopen',{'id':c['id'],'stage':'confirm'})
        self.assertEqual(e.exception.code,400)
        job='explore-reopen-test'
        web.JOBS[job]={'id':job,'status':'running','progress':0,'total':4,'campaign_id':c['id']}
        c=self.request('/api/explore/reopen',{'id':c['id'],'stage':'s1'})['campaign']
        self.assertEqual(web.JOBS[job]['status'],'cancelling')  # Images of the dropped stages stop.
        self.assertEqual((c['stage'],c['info']['pending'],c['frozen']['신체']),('s1',16,body))
        self.assertEqual(c['champions'],{'s0':winner})
        self.assertFalse([r for r in c['rounds'] if r['stage']=='confirm'])
        self.assertEqual(self.request('/api/explore/'+c['id'])['campaign']['stage'],'s1')

    def test_media_traversal_is_rejected(self):
        self.assertIsNone(web.safe_child_path(web.OUTPUT_DIR,'../secret'))
        self.assertIsNone(web.safe_child_path(web.OUTPUT_DIR,'%2e%2e/secret'))

if __name__=='__main__':unittest.main()
