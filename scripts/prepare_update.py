"""Prepare signed GitHub Release assets. Does not publish anything."""
import hashlib
import json
import shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
config = json.loads((root / 'src-tauri/tauri.conf.json').read_text(encoding='utf-8'))
version = config['version']
source = root / f'src-tauri/target/release/bundle/nsis/NAI ACLAB_{version}_x64-setup.exe'
signature = Path(str(source) + '.sig')
if not source.is_file() or not signature.is_file():
    raise SystemExit('Signed installer and .sig are required. Build with TAURI_SIGNING_PRIVATE_KEY first.')
output = root / 'dist'
output.mkdir(exist_ok=True)
name = f'NAI-ACLAB-{version}-Windows-x64-setup.exe'
shutil.copy2(source, output / name)
shutil.copy2(signature, output / (name + '.sig'))
notes = root / f'releases/{version}.md'
manifest = {'version': version, 'notes': notes.read_text(encoding='utf-8').strip() if notes.exists() else f'NAI ACLAB {version}', 'platforms': {'windows-x86_64': {
    'url': f'https://github.com/asyrian2021/NAI_ACLAB/releases/download/v{version}/{name}',
    'signature': signature.read_text(encoding='utf-8').strip()}}}
(output / 'latest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(output / 'SHA256SUMS.txt').write_text(hashlib.sha256(source.read_bytes()).hexdigest() + '  ' + name + '\n', encoding='ascii')
print(f'Prepared signed update assets for {version} in dist/')
