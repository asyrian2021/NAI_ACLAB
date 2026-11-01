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
        self.p1=patch.multiple(app,DATA_DIR=root,OUTPUT_DIR=root/'outputs',STATE_PATH=root/'app_state.json',TOKEN_SECRET_PATH=root/'token')
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

    def test_media_traversal_is_rejected(self):
        self.assertIsNone(web.safe_child_path(web.OUTPUT_DIR,'../secret'))
        self.assertIsNone(web.safe_child_path(web.OUTPUT_DIR,'%2e%2e/secret'))

if __name__=='__main__':unittest.main()
