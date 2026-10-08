"""Runs the camera AR page through a fake WebXR device in headless Chrome.

It starts AR, finds a surface, places the desk, wakes it up, finds every hardware
and software pair, tests the robot's condition with the wall and by walking up to
it, finishes the trophy screen and checks the stall watchdog, then prints the log.
No phone is needed.

Usage:  python test/run_ar_test.py
Needs Google Chrome or Microsoft Edge installed. Exit code 0 means PASS.
"""
import functools
import html
import http.server
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST = os.path.dirname(os.path.abspath(__file__))
BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def find_browser():
    for path in BROWSERS:
        if os.path.exists(path):
            return path
    sys.exit("Chrome or Edge was not found. Install one, or add its path to BROWSERS in this script.")


def build_site():
    site = tempfile.mkdtemp(prefix="desk-ar-test-")
    for name in ["ar.html", "boot-ar.js", "markerless.js", "desk.js", "game.js", "game.css", "preview.html", "index.html"]:
        shutil.copy(os.path.join(ROOT, name), site)
    for folder in ["vendor", "assets"]:
        shutil.copytree(os.path.join(ROOT, folder), os.path.join(site, folder))
    for name in ["fake-xr.js", "drive.js"]:
        shutil.copy(os.path.join(TEST, name), site)
    page = os.path.join(site, "ar.html")
    with open(page, encoding="utf-8") as handle:
        source = handle.read()
    source = source.replace("<head>\n", '<head>\n  <script src="fake-xr.js"></script>\n', 1)
    source = source.replace("</body>", '  <script src="drive.js"></script>\n</body>', 1)
    with open(page, "w", encoding="utf-8", newline="") as handle:
        handle.write(source)
    return site


def main():
    browser = find_browser()
    site = build_site()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=site))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    # The software renderer is slow, so the stall watchdog is given a huge limit;
    # drive.js triggers it on purpose at the end instead.
    url = f"http://127.0.0.1:{port}/ar.html?stall=100000000"
    command = [
        browser, "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars",
        f"--user-data-dir={os.path.join(site, 'chrome-profile')}", "--window-size=412,860",
        "--virtual-time-budget=150000", "--dump-dom", url,
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
        match = re.search(r'<pre id="testlog">(.*?)</pre>', result.stdout, re.S)
        log = html.unescape(match.group(1)) if match else "(no test log: the page did not finish)\n" + result.stdout[-1500:]
    finally:
        server.shutdown()
        shutil.rmtree(site, ignore_errors=True)
    # The log has emoji in it; a Windows console would refuse to print them.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(log.strip())
    sys.exit(0 if "RESULT: PASS" in log else 1)


if __name__ == "__main__":
    main()
