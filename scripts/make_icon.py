"""Build the geometric N application mark without external image dependencies."""
import struct
import zlib
from pathlib import Path

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))

size = 64
rows = []
for y in range(size):
    row = bytearray([0])
    for x in range(size):
        mark = (15 <= x <= 21 or 42 <= x <= 48 or abs(x - (18 + (y-16)*27/32)) < 4) and 16 <= y <= 48
        row.extend((179, 211, 189, 255) if mark else (33, 40, 36, 255))
    rows.append(bytes(row))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b'')
folder = Path(__file__).resolve().parents[1] / 'src-tauri' / 'icons'
folder.mkdir(exist_ok=True)
(folder/'icon.png').write_bytes(png)
(folder/'icon.ico').write_bytes(struct.pack('<HHH',0,1,1) + struct.pack('<BBBBHHII',size,size,0,0,1,32,len(png),22) + png)
