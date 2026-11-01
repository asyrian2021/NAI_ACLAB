"""Build a standalone Python engine including the compiled React UI."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
target = root / 'src-tauri' / 'binaries'
target.mkdir(exist_ok=True)
if not (root / 'web' / 'index.html').exists():
    raise SystemExit('Run npm run build first.')
subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile',
                '--name', 'nai-engine-x86_64-pc-windows-msvc', '--distpath', str(target),
                '--workpath', str(root / 'build' / 'pyinstaller'), '--specpath', str(root / 'build'),
                '--add-data', f'{root / "web"};web', '--exclude-module', 'tkinter',
                str(root / 'web_app.py')], cwd=root, check=True)
