import unittest
import xml.etree.ElementTree as ET
from stippler import vary_xml


SAMPLE = '''<?xml version="1.0"?>
<vehicle><bodies><body><components><c d="01_block"><o sc="808080" bc='304050' other="keep"><vp x="1" y="2" z="3"/></o></c></components></body></bodies><!-- <o sc="FFFFFF"/> --></vehicle>'''


class StipplerTests(unittest.TestCase):
    def test_omitted_leading_zero_colors(self):
        source = '<vehicle><o bc="E232" ac="00e232" sc="2,E232,454545"/><o bc="0" sc="6"/></vehicle>'
        output, report = vary_xml(source, 0)
        self.assertEqual(output, source)
        self.assertEqual(report['paint_fields'], 5)
        self.assertEqual(report['preview'][0]['color'], '00E232')
        self.assertEqual(report['preview'][0]['count'], 3)
        output, _ = vary_xml(source, 12, 1)
        root = ET.fromstring(output)
        self.assertEqual(root[0].attrib['bc'], root[0].attrib['ac'])
        self.assertEqual(root[0].attrib['sc'].split(',')[0], '2')
        self.assertEqual(root[1].attrib['sc'], '6')

    def test_changes_only_paint(self):
        output, report = vary_xml(SAMPLE, 12, 1)
        self.assertEqual({k: report[k] for k in ('objects', 'paint_fields', 'changed_fields')}, {'objects': 1, 'paint_fields': 2, 'changed_fields': 2})
        original, varied = ET.fromstring(SAMPLE), ET.fromstring(output)
        for a, b in zip(original.iter(), varied.iter()):
            self.assertEqual(a.tag, b.tag)
            self.assertEqual({k:v for k,v in a.attrib.items() if k not in ('sc','bc')}, {k:v for k,v in b.attrib.items() if k not in ('sc','bc')})
        self.assertIn('<!-- <o sc="FFFFFF"/> -->', output)
        self.assertTrue(output.startswith('<?xml version="1.0"?>'))

    def test_repeatable_and_zero_strength(self):
        self.assertEqual(vary_xml(SAMPLE, 12, 1), vary_xml(SAMPLE, 12, 1))
        self.assertEqual(vary_xml(SAMPLE, 0)[0], SAMPLE)

    def test_rejects_unsupported_and_malformed(self):
        for source in ('<vehicle>', '<other/>', '<vehicle><o sc="123"/></vehicle>', '<!DOCTYPE vehicle><vehicle/>'):
            with self.assertRaises(ValueError):
                vary_xml(source)

    def test_clamps_channels(self):
        for seed in range(20):
            output, _ = vary_xml('<vehicle><o sc="000000" bc="FFFFFF"/></vehicle>', 50, seed)
            for value in ET.fromstring(output)[0].attrib.values():
                self.assertEqual(len(value), 6)
                self.assertTrue(0 <= int(value, 16) <= 0xffffff)

    def test_face_colors_and_markers(self):
        source = '<vehicle><o bc="969696" ac="969696" sc="6,969696,969696,8F0000,969696,969696,969696"/><o bc="969696" sc="1"/></vehicle>'
        output, report = vary_xml(source, 12, 1)
        self.assertEqual(report['paint_fields'], 9)
        first, second = ET.fromstring(output)
        self.assertEqual(first.attrib['bc'], first.attrib['ac'])
        self.assertEqual(first.attrib['sc'].split(',')[0], '6')
        self.assertEqual(first.attrib['sc'].split(',')[1], first.attrib['bc'])
        self.assertEqual(second.attrib['sc'], '1')

    def test_preview_ranks_colors_and_uses_actual_output_shades(self):
        source = '<vehicle><o bc="808080" ac="808080" sc="2,808080,FFFFFF"/><o bc="000000" ac="123456"/></vehicle>'
        output, report = vary_xml(source, 12, 1)
        self.assertEqual([p['color'] for p in report['preview']], ['808080', 'FFFFFF', '000000'])
        self.assertEqual(report['preview'][0]['count'], 3)
        actual = ET.fromstring(output)[0].attrib['bc']
        self.assertEqual(set(report['preview'][0]['samples']), {actual})
        for p in vary_xml(source, 0)[1]['preview']:
            self.assertEqual(set(p['samples']), {p['color']})


if __name__ == '__main__':
    unittest.main()
