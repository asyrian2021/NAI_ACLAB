"""Close only the test-owned desktop window by exact process ID."""
import ctypes
from ctypes import wintypes
import sys
pid=int(sys.argv[1])
callback=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)
user=ctypes.windll.user32
user.PostMessageW.argtypes=[wintypes.HWND,wintypes.UINT,wintypes.WPARAM,wintypes.LPARAM]
@callback
def visit(hwnd,_):
    actual=wintypes.DWORD()
    user.GetWindowThreadProcessId(hwnd,ctypes.byref(actual))
    if actual.value==pid:
        title=ctypes.create_unicode_buffer(256)
        user.GetWindowTextW(hwnd,title,256)
        if title.value=='NAI ACLAB':user.PostMessageW(hwnd,0x0010,0,0)
    return True
user.EnumWindows(visit,0)
