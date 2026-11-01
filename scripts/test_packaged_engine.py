"""Smoke-test the actual frozen engine without touching user data or API credits."""
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request

root=Path(__file__).resolve().parents[1]
data=root/'.test-data'/f'frozen-{time.time_ns()}'
exe=root/'src-tauri/binaries/nai-engine-x86_64-pc-windows-msvc.exe'
proc=subprocess.Popen([str(exe),'--desktop'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                      creationflags=subprocess.CREATE_NO_WINDOW,env={**os.environ,'NAI_ARTIST_LAB_USER_DIR':str(data)})
try:
    url=json.loads(proc.stdout.readline())['url']
    html=urllib.request.urlopen(url,timeout=10).read().decode()
    token=json.loads(re.search(r'window.__NAI_ACLAB_TOKEN__=("[^"]+")',html)[1])
    def request(route,body=None):
        req=urllib.request.Request(url+'api/'+route,headers={'X-NAI-ACLAB-Token':token},data=json.dumps(body).encode() if body is not None else None)
        return json.load(urllib.request.urlopen(req,timeout=10))
    state=request('state')['state'];state['generation']['count']=1;state['api'].update(mock_mode=True,width=64,height=64)
    job=request('generate',{'state':state})['job_id']
    for _ in range(100):
        if request('jobs')['jobs'][0]['status'] in {'done','failed'}:break
        time.sleep(.1)
    assert request('jobs')['jobs'][0]['status']=='done'
    image=request('state')['state']['history'][0]['items'][0]
    assert urllib.request.urlopen(url.rstrip('/')+image['image_url']).read().startswith(b'\x89PNG')
    proc.stdin.close();proc.wait(timeout=15)
    print(json.dumps({'frozen_engine':'passed','mock_generation':'passed','parent_pipe_shutdown':'passed'}))
finally:
    if proc.poll() is None:proc.kill();proc.wait()
