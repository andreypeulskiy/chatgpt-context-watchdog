from pathlib import Path
import os
import json
ROOT = Path(__file__).resolve().parents[2]
import re
header = (ROOT / 'src/userscript-header.txt').read_text()
VERSION = re.search(r'^// @version\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$', header, re.M).group(1)
BUNDLE_KIND = os.environ.get('WATCHDOG_TEST_BUNDLE', 'stable')
if BUNDLE_KIND not in ('stable', 'dev'):
    raise ValueError('WATCHDOG_TEST_BUNDLE must be stable or dev')
SUFFIX = '.dev' if BUNDLE_KIND == 'dev' else ''
SCRIPT = (ROOT / 'dist' / f'chatgpt-context-watchdog-{VERSION}{SUFFIX}.user.js').read_text()
