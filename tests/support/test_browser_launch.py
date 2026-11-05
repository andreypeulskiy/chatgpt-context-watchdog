"""Test platform-dependent browser selection without launching a browser."""
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from browser_launch import chromium_launch_options


class BrowserLaunchOptionsTest(unittest.TestCase):
    def test_windows_uses_installed_chrome_channel(self):
        with patch('browser_launch.sys.platform', 'win32'), patch.dict(os.environ, {}, clear=True):
            self.assertEqual(chromium_launch_options(), {'channel': 'chrome'})

    def test_linux_prefers_system_chromium(self):
        with (patch('browser_launch.sys.platform', 'linux'),
              patch('browser_launch.Path.is_file', lambda p: str(p) == '/usr/bin/chromium'),
              patch.dict(os.environ, {}, clear=True)):
            self.assertEqual(chromium_launch_options(), {'executable_path': '/usr/bin/chromium'})

    def test_channel_override(self):
        with patch.dict(os.environ, {'WATCHDOG_BROWSER_CHANNEL': 'msedge', 'WATCHDOG_BROWSER_EXE': ''}):
            self.assertEqual(chromium_launch_options(), {'channel': 'msedge'})

    def test_executable_override(self):
        with TemporaryDirectory() as temp:
            exe = Path(temp) / 'my-chrome'
            exe.touch()
            with patch.dict(os.environ, {'WATCHDOG_BROWSER_CHANNEL': '', 'WATCHDOG_BROWSER_EXE': str(exe)}):
                self.assertEqual(chromium_launch_options(), {'executable_path': str(exe)})

    def test_conflicting_overrides_rejected(self):
        with patch.dict(os.environ, {'WATCHDOG_BROWSER_CHANNEL': 'chrome', 'WATCHDOG_BROWSER_EXE': 'other'}):
            with self.assertRaises(ValueError):
                chromium_launch_options()


if __name__ == '__main__':
    unittest.main()
