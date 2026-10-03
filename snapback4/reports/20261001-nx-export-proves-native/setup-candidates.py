from pathlib import Path
import shutil
root = Path(__file__).resolve().parents[2]
for starter in ['plain', 'social']:
    project = root / 'target/nx' / starter
    for name in ['snapback4', 'snapback4-expo']:
        for item in ['src', 'dist', 'ios', 'plugin.cjs', 'export-ios.mjs', 'package.json', 'expo-module.config.json']:
            src, dst = root/'packages'/name/item, project/'node_modules'/name/item
            if not src.exists(): continue
            if dst.is_dir(): shutil.rmtree(dst)
            elif dst.exists(): dst.unlink()
            if src.is_dir(): shutil.copytree(src, dst, symlinks=True)
            else: shutil.copy2(src, dst)
    link = project/'node_modules/.bin/snapback4-export-ios'
    if not link.exists(): link.symlink_to('../snapback4-expo/export-ios.mjs')
