"""Fail a release build if local user paths are embedded in shipped binaries."""
import json
import marshal
import re
import tempfile
import types
from pathlib import Path
from PyInstaller.archive.readers import CArchiveReader, ZlibArchiveReader

root = Path(__file__).resolve().parents[1]
paths = [root / 'src-tauri/target/release/nai-aclab.exe', root / 'src-tauri/binaries/nai-engine-x86_64-pc-windows-msvc.exe']
forbidden = []
for value in (str(Path.home()), str(root)):
    for text in (value, value.replace('\\', '/')):
        forbidden.extend([text.encode('utf-8').lower(), text.encode('utf-16le').lower()])
user_path = re.compile(rb'[a-z]:[\\/]+users[\\/]+|/users/|/home/[^/ ]+/', re.I)
findings = set()

def inspect(label, data):
    if any(value in data.lower() for value in forbidden) or user_path.search(data):
        findings.add(label)

def code_paths(label, code):
    if not isinstance(code, types.CodeType):
        return
    inspect(label, code.co_filename.encode('utf-8'))
    for value in code.co_consts:
        if isinstance(value, types.CodeType):
            code_paths(label, value)

for path in paths:
    inspect(path.name, path.read_bytes())
engine = CArchiveReader(str(paths[1]))
temporary_root = root / 'build'
temporary_root.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(dir=temporary_root) as temporary:
    for name in engine.toc:
        data = engine.extract(name)
        inspect('engine:' + name, data)
        if name == 'web_app':
            code_paths(name, marshal.loads(data))
        if name == 'PYZ.pyz':
            archive = Path(temporary) / 'modules.pyz'
            archive.write_bytes(data)
            modules = ZlibArchiveReader(str(archive))
            for module in modules.toc:
                code = modules.extract(module)
                if isinstance(code, types.CodeType):
                    code_paths(module, code)
if findings:
    raise SystemExit('Release privacy check failed in: ' + ', '.join(sorted(findings)))
print(json.dumps({'release_privacy': 'passed', 'local_user_paths': 0}))
