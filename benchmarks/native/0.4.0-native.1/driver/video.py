"""Decode retained bytes on the validating host; manifest claims are not a decoder."""
import atexit
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
from functools import lru_cache
from pathlib import Path
from video_timing import presentation_timing

@lru_cache(maxsize=1)
def decoder():
    if sys.platform=='darwin' and shutil.which('xcrun'):
        scratch=tempfile.TemporaryDirectory(prefix='ni-video-');atexit.register(scratch.cleanup)
        binary=str(Path(scratch.name)/'video-check')
        p=subprocess.run(['xcrun','swiftc',str(Path(__file__).with_suffix('.swift')),'-o',binary],capture_output=True,timeout=60)
        if p.returncode:raise ValueError('video-decoder-unavailable:swiftc')
        return ('avfoundation',binary)
    ffmpeg=shutil.which('ffmpeg')
    if not ffmpeg:
        try:
            import imageio_ffmpeg
            ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
        except (ImportError,RuntimeError):pass
    if not ffmpeg:raise ValueError('video-decoder-unavailable')
    return ('ffmpeg',ffmpeg)

def decoded_video(path):
    path=Path(path)
    return _decode(str(path.resolve()),hashlib.sha256(path.read_bytes()).hexdigest(),decoder())

@lru_cache(maxsize=64)
def _decode(path,digest,backend):
    # The hash is part of the cache key: rebinding a mutated file always decodes again.
    kind,binary=backend
    try:
        seconds,samples=presentation_timing(path)
        if kind=='avfoundation':
            p=subprocess.run([binary,path],capture_output=True,timeout=60)
            if p.returncode:raise ValueError('invalid-video')
            info=json.loads(p.stdout)
        else:
            p=subprocess.run([binary,'-hide_banner','-i',path],capture_output=True,timeout=30)
            info_text=p.stderr.decode(errors='replace')
            if not re.search(r'Stream .*Video: h264\b',info_text):raise ValueError('invalid-video')
            p=subprocess.run([binary,'-v','error','-xerror','-err_detect','explode','-i',path,'-map','0:v:0','-fps_mode','passthrough','-progress','pipe:1','-nostats','-f','null','-'],capture_output=True,timeout=60)
            frames=re.findall(rb'(?m)^frame=(\d+)',p.stdout)
            if p.returncode or not frames or int(frames[-1])<=0:raise ValueError('invalid-video')
            info={'codec':'h264','durationSeconds':seconds,'decodedEndpoints':True,'decodedFrames':int(frames[-1])}
        if not (info['codec']=='h264' and info['decodedEndpoints'] is True and math.isfinite(info['durationSeconds']) and info['durationSeconds']>0):raise ValueError('invalid-video')
        if info.get('decodedFrames')!=samples:raise ValueError('video-decoded-sample-count-mismatch')
        if abs(info['durationSeconds']-seconds)>.01:raise ValueError('invalid-video-timing')
        return info
    except (OSError,subprocess.TimeoutExpired) as e:
        raise ValueError('video-decoder-unavailable:'+type(e).__name__) from None
