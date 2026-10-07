"""Round-4 regressions: transient disclosure, scaling, matting and threshold margin."""
import json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image, ImageDraw, ImageOps
import test_round2 as r2
from evidence import sha, viewonce_pixels
from run import Failure


class StickyDisclosure(unittest.TestCase):
    driver=r2.DriverRegressions.driver

    def probe(self, viewer=False):
        d,root=self.driver();d.prime={'complete':True,'eventCount':0};d.video_started=0;d.events=d.events[:3]
        d.c['viewOnceImage']=str(root/'viewonce-fixture.png')
        for name in ['prime-once.json','prime-once.png']:(d.out/name).write_bytes((root/name).read_bytes())
        for name in ['preflight','terminate','cut_backend','start_recording','launch','navigate','locate','media','step','stop_owned']:
            setattr(d,name,lambda *a,**kw:None)
        d.ui=lambda *a,**kw:{'state':1};d.tap=lambda *a,**kw:None;d.finalize=lambda:d.fail
        calls=[]
        def tree(name=None,pixels=False):
            if name=='cold-history':return json.loads((root/'cold-history.json').read_text())
            t=json.loads((root/'cold-once-attempt.json').read_text())
            if name=='cold-once':
                stale=not calls;calls.append(stale)
                (d.out/'cold-once.png').write_bytes((root/('prime-once.png' if stale and not viewer else 'cold-once.png')).read_bytes())
                if stale and viewer:t['children'].append({'id':'sm-media-viewer-image'})
                (d.out/'cold-once.json').write_text(json.dumps(t))
                if not stale:d.events.append({'kind':'media','sequence':4,'processNonce':d.launches[-1]['processNonce'],'payload':{'messageId':'v','assetId':'va','event':'denied'}})
            return t
        d.tree=tree
        d.search_destination=lambda:(_ for _ in ()).throw(AssertionError('disclosure passed'))
        return d,root,calls

    def test_transient_pixels_fail_and_keep_first_capture(self):
        d,root,calls=self.probe()
        result=d.run();self.assertEqual((result['reason'],result['outcomeClass']),('stale-viewonce-pixels','application'))
        self.assertEqual(result['appState']['state'],'unknown')
        self.assertEqual(calls,[True])
        self.assertEqual([r['pass'] for r in d.receipts if r['assertion']=='m6-a04'],[False])
        self.assertEqual(sha(d.out/'cold-once.png'),sha(root/'prime-once.png'))
        record=(d.out/'cold-once-pixels.json').read_bytes()
        self.assertTrue(json.loads(record)['samePixels'])
        # Even an accidental later wait must not replace the disclosure evidence.
        with self.assertRaisesRegex(Failure,'stale-viewonce-pixels'):d.wait(lambda:d.tree('cold-once',True))
        self.assertEqual(calls,[True]);self.assertEqual((d.out/'cold-once-pixels.json').read_bytes(),record)

    def test_visible_viewer_is_terminal_and_retains_pixel_record(self):
        d,root,calls=self.probe(True)
        self.assertEqual(d.run()['reason'],'stale-viewonce-pixels');self.assertEqual(calls,[True])
        self.assertTrue(json.loads((d.out/'cold-once-pixels.json').read_text())['viewerVisible'])

    def test_refusal_poll_retries_only_missing_evidence(self):
        d,root,calls=self.probe()
        with patch('run.viewonce_pixels',return_value=(False,0)),patch('run.viewonce_refusal',side_effect=ValueError('malformed-refusal')):
            self.assertEqual(d.run()['reason'],'malformed-refusal')
        self.assertEqual(calls,[True])


class ScaledPixels(unittest.TestCase):
    def test_bounded_scales_mats_and_tonal_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            # Asymmetric detail prevents a half-size template from matching a
            # single flat quadrant, a weakness of the historical two-color fixture.
            fixture=Image.new('RGB',(192,128),'#283647');draw=ImageDraw.Draw(fixture)
            import random
            rng=random.Random(404)
            for _ in range(70):
                x,y=rng.randrange(175),rng.randrange(111)
                draw.ellipse((x,y,x+17,y+17),fill=tuple(rng.randrange(40,210) for _ in range(3)))
            fixture.save(root/'fixture.png')
            prime=Image.new('RGB',(480,800),'white');prime.paste(fixture,(40,100));prime.save(root/'prime.png')
            # The prime frame itself is letterboxed; only its aspect-fit content
            # should determine the searched shape.
            frame={'x':40,'y':68,'width':192,'height':192,'screenWidth':480}
            def check(cold,expected):
                cold.save(root/'cold.png')
                stale,score=viewonce_pixels(root/'prime.png',root/'cold.png',frame,root/'fixture.png')
                self.assertEqual(stale,expected,score)
            clean=Image.new('RGB',prime.size,'#eeeef4');check(clean,False)
            for scale in [.25,.333,.5,.733,.9,.98,1,1.25]:
                with self.subTest(scale=scale):
                    crop=fixture.resize(tuple(round(v*scale) for v in fixture.size))
                    cold=clean.copy();cold.paste(crop,(200,400));check(cold,True)
            for variant in ['mat','frame','brightness','contrast']:
                with self.subTest(variant=variant):
                    crop=fixture
                    if variant=='mat':crop=ImageOps.expand(crop.resize((176,112)),border=8,fill='white')
                    if variant=='frame':crop=ImageOps.pad(crop,(150,220),color='white')
                    if variant=='brightness':crop=crop.point(lambda v:min(255,v+120))
                    if variant=='contrast':crop=crop.point(lambda v:round(.6*v+45))
                    cold=clean.copy();cold.paste(crop,(200,400));check(cold,True)


if __name__=='__main__':unittest.main()
