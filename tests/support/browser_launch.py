"""Choose a local Chromium-family browser for Watchdog's offline QA suites.

Defaults: Windows/macOS use installed Chrome; Linux uses installed Chromium,
falling back to a Playwright-managed browser when no system browser is found.
Override with WATCHDOG_BROWSER_EXE or WATCHDOG_BROWSER_CHANNEL.
"""
import os
import shutil
import sys
from pathlib import Path


def chromium_launch_options():
    """Return kwargs for playwright.chromium.launch without forcing Linux paths."""
    executable = os.environ.get('WATCHDOG_BROWSER_EXE', '').strip()
    channel = os.environ.get('WATCHDOG_BROWSER_CHANNEL', '').strip()
    if executable and channel:
        raise ValueError('Set either WATCHDOG_BROWSER_EXE or WATCHDOG_BROWSER_CHANNEL, not both')
    if executable:
        if not Path(executable).is_file():
            raise FileNotFoundError(f'WATCHDOG_BROWSER_EXE does not exist: {executable}')
        return {'executable_path': executable}
    if channel:
        return {'channel': channel}

    if sys.platform in ('win32', 'darwin'):
        return {'channel': 'chrome'}

    if sys.platform.startswith('linux'):
        candidates = ['/usr/bin/chromium', shutil.which('chromium'), shutil.which('chromium-browser')]
        for candidate in candidates:
            if candidate and Path(candidate).is_file():
                return {'executable_path': candidate}
        if shutil.which('google-chrome') or shutil.which('google-chrome-stable'):
            return {'channel': 'chrome'}
    # Allow the regular Playwright-managed Chromium on other platforms, or
    # when no system browser is available. Playwright provides install hints.
    return {}
