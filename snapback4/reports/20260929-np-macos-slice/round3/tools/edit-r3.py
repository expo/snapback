from pathlib import Path
p=Path('snapback4/crates/snapback4/src/verbs/witness/native-inputs.mjs');s=p.read_text();s=s.replace("const key = rawKey.replace(/\\[[^\\]]+\\]/g, '');", "const key = rawKey.replace(/\\[[^\\]]+\\]/g, '');\n      if (/(?:BUILD_DIR|BUILD_ROOT|TEMP_DIR|TEMP_ROOT|CACHE_DIR|CACHE_ROOT)$/.test(key)\n        || ['SYMROOT', 'OBJROOT', 'DSTROOT', 'CCHROOT', 'SHARED_PRECOMPS_DIR', 'DERIVED_DATA_DIR', 'DERIVED_FILE_DIR', 'DERIVED_FILES_DIR', 'DERIVED_SOURCES_DIR', 'INDEX_DATA_STORE_DIR'].includes(key)) reject(`custom output ${key}: ${raw}`);")
s=s.replace('#(?:include|import)', '#\\s*(?:include|import)')
p.write_text(s)
