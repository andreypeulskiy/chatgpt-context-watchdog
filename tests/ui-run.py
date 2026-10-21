#!/usr/bin/env python3
"""Bounded Chromium suites, classified by the same groups.json inventory.

Failures don't hide independent results. Each actual execution receives PASS or FAIL;
NOT RUN is reserved for orchestration prerequisites and never inferred as PASS.
"""
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

root = Path(__file__).resolve().parent
groups = json.loads((root / 'groups.json').read_text(encoding='utf-8'))
selector = sys.argv[1] if len(sys.argv) > 1 else 'ui'
result_arg = next((arg for arg in sys.argv[2:] if arg.startswith('--results=')), None)
result_path = Path(result_arg.split('=', 1)[1]) if result_arg else None
lanes = {'functional', 'visual', 'release'}
if selector not in {'all', *lanes, *groups}:
    sys.exit('Usage: python tests/ui-run.py [functional|visual|release|css|ui|logic|security|build|integration|all] [--results=path]')

results = []
for category, suites in groups.items():
    for item in suites['browser']:
        name, lane = item['file'], item['lane']
        if selector not in ('all', category, lane):
            continue
        with tempfile.TemporaryFile(mode='w+t') as log:
            begin = time.monotonic()
            proc = subprocess.Popen(
                [sys.executable, '-u', str(root / name)],
                stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                env={**os.environ, 'WATCHDOG_TEST_BUNDLE': 'stable' if category == 'integration' else 'dev'}
            )
            timed_out = False
            try:
                exit_code = proc.wait(timeout=35)
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait(timeout=5)
                exit_code = -1
            duration_ms = round((time.monotonic() - begin) * 1000)
            log.seek(0)
            output = log.read()
            status = 'PASS' if exit_code == 0 else 'FAIL'
            reported_pass_lines = output.count('PASS ')
            results.append({'file': name, 'category': category, 'lane': lane,
                            'kind': 'browser', 'status': status, 'durationMs': duration_ms,
                            'exitCode': exit_code, 'timeout': timed_out,
                            'reportedPassLines': reported_pass_lines})
            if status == 'FAIL':
                print(f'FAIL [{lane}/{category}] {name}' + (' (timeout)' if timed_out else f' (code={exit_code})'), flush=True)
                print(output[-6000:], flush=True)
            else:
                print(f'PASS [{lane}/{category}] {name}: {reported_pass_lines} PASS markers', flush=True)
if result_path:
    result_path.write_text(json.dumps({'runner':'browser','selector':selector,'results':results}, indent=2)+'\n', encoding='utf-8')
passed = sum(item['status'] == 'PASS' for item in results)
print(f'{passed}/{len(results)} bounded browser suites PASS ({selector})', flush=True)
if passed != len(results):
    sys.exit(1)
