import ast, importlib.util, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('recovery', Path(__file__).with_name('muse-post-interruption-phase.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class QualificationChecks(unittest.TestCase):
    def test_qualified_actual_builder(self):
        self.assertEqual(m.qualify()['builderExit'], 130)

    def test_only_builder_path_qualifies(self):
        self.assertTrue(m.qualified_path(m.BUILDER_END))
        for name in ['grok-snapback4.end.json', 'muse-snapback4.grade.end.json', 'muse-snapback4.score.end.json']:
            self.assertFalse(m.qualified_path(m.BUILDER_END.parent / name))

    def test_exact_one_expression_change(self):
        original, result = m.RUNNER.read_text(), m.patched_source()
        self.assertEqual(result.replace(m.NEW, m.OLD, 1), original)
        self.assertEqual(result.count(m.NEW), 1)

    def test_global_nonzero_completion_still_refuses(self):
        fn = next(x for x in ast.parse(m.patched_source()).body if isinstance(x, ast.FunctionDef) and x.name == 'completed')
        scope = {'Path': Path, 'json': json}
        exec(compile(ast.Module(body=[fn], type_ignores=[]), '<unchanged completed>', 'exec'), scope)
        with tempfile.TemporaryDirectory(prefix='sb4-phase-guard-') as d:
            path = Path(d) / 'record.json'
            self.assertFalse(scope['completed'](path))
            for code, expected in [(0, True), (1, False), (130, False), (-2, False)]:
                path.write_text(json.dumps({'exitCode': code}))
                self.assertEqual(scope['completed'](path), expected)

    def check_changed_bytes_refused(self, target, data):
        original = Path.read_bytes
        with patch.object(Path, 'read_bytes', lambda p: data if p == target else original(p)), self.assertRaises(ValueError):
            m.qualify()

    def test_changed_qualification_refused(self):
        self.check_changed_bytes_refused(m.QUALIFICATION, b'{}')

    def test_changed_builder_end_refused(self):
        end = json.loads(m.BUILDER_END.read_text())
        end['exitCode'] = 0
        self.check_changed_bytes_refused(m.BUILDER_END, json.dumps(end).encode())

    def test_changed_final_report_refused(self):
        self.check_changed_bytes_refused(m.PACKET / 'lanes/muse-snapback4/final-report.md', b'rewritten')


if __name__ == '__main__':
    unittest.main(verbosity=2)
