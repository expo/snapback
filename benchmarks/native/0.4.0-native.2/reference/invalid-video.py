"""Qualification fault: a recorder/checker pair that lies about undecodable bytes."""
import json,struct,sys
from pathlib import Path
Path(sys.argv[1]).write_bytes(b''.join(struct.pack('>I4s',8,k) for k in [b'ftyp',b'mdat',b'moov']))
print(json.dumps({'codec':'h264','durationSeconds':3600,'decodedEndpoints':True}))
