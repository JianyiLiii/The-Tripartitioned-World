"""Checks for the boundary between the public demo and private application."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'

class StaticPreviewTests(unittest.TestCase):
    def test_browser_code_has_no_network_or_html_execution_sinks(self):
        forbidden = re.compile(r'\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|eval)\s*\(|\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(')
        for path in (DOCS / 'assets/js').rglob('*.js'):
            with self.subTest(path=path.name):
                self.assertIsNone(forbidden.search(path.read_text(encoding='utf-8')))

    def test_all_imports_are_local_and_present(self):
        for path in (DOCS / 'assets/js').rglob('*.js'):
            for target in re.findall(r"(?:from\s+|import\s*)['\"]([^'\"]+)['\"]", path.read_text(encoding='utf-8')):
                with self.subTest(path=path.name, target=target):
                    self.assertTrue(target.startswith('.'))
                    resolved = (path.parent / target).resolve()
                    self.assertTrue(resolved.is_relative_to(DOCS.resolve()))
                    self.assertTrue(resolved.is_file())

    def test_published_files_are_static_only(self):
        allowed = {'.html', '.css', '.js', '.svg', '.jpg', '.png'}
        for path in DOCS.rglob('*'):
            if path.is_file():
                with self.subTest(path=path.name):
                    self.assertTrue(path.name == '.nojekyll' or path.suffix in allowed)
                    self.assertNotIn(path.name, {'api.js', 'app.js', 'server.py'})

    def test_csp_disables_connections_and_forms(self):
        html = (DOCS / 'index.html').read_text(encoding='utf-8')
        for directive in ("default-src 'none'", "connect-src 'none'", "form-action 'none'", "script-src 'self'", "base-uri 'none'", "object-src 'none'"):
            self.assertIn(directive, html)
        self.assertNotIn('unsafe-inline', html)
        self.assertNotIn('unsafe-eval', html)

if __name__ == '__main__':
    unittest.main()
