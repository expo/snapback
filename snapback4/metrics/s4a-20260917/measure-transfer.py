from pathlib import Path
import json, subprocess
out = {}
for name in ['chat.backend.json', 'chat.proposed-schema.json', 'chat.probe.sb4b']:
    path = Path('/tmp/s4a-stop') / name
    out[name] = {'raw': path.stat().st_size, 'gzip': len(subprocess.check_output(['gzip', '-9', '-n', '-c', str(path)]))}
out['proposed_double_transfer'] = {key: out['chat.proposed-schema.json'][key] + out['chat.probe.sb4b'][key] for key in ['raw', 'gzip']}
n = out['chat.probe.sb4b']['raw']
out['metadata_string'] = {'hex_ASCII_bytes': n * 2, 'base64_ASCII_bytes': ((n + 2) // 3) * 4, 'hex_UTF16_bytes': n * 4, 'base64_UTF16_bytes': ((n + 2) // 3) * 8}
print(json.dumps(out))
