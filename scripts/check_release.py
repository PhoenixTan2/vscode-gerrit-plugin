"""Check local VSIX deliverability without logging in or publishing."""
from pathlib import Path
import json
import re
import struct
import zipfile

root = Path(__file__).resolve().parents[1]
p = json.loads((root / 'package.json').read_text(encoding='utf-8'))
base = json.loads((root / 'package.nls.json').read_text(encoding='utf-8'))
en = json.loads((root / 'package.nls.en.json').read_text(encoding='utf-8'))
assert base.keys() == en.keys(), 'NLS key mismatch'
keys = set(re.findall(r'%([^%]+)%', json.dumps(p)))
assert keys <= base.keys(), 'Unresolved NLS contribution'
assert not any(re.search('[\u3400-\u9fff]', value) for value in en.values()), 'Untranslated English NLS value'
assert p['contributes']['configuration']['properties']['gerrit.language']['default'] == 'zh-CN'
assert not any(x['command'] == 'gerrit.openThisFile' for x in p['contributes']['menus']['editor/context'])
binding = next(x for x in p['contributes']['keybindings'] if x['command'] == 'gerrit.comment')
assert binding['key'] == 'c' and 'editorHasSelection' not in binding['when']
assert all(x in binding['when'] for x in ['editorTextFocus', 'isInDiffEditor', 'editorReadonly', 'resourceScheme == gerrit'])
required = ['package.json','package.nls.json','package.nls.en.json','README.md','README.en.md','CHANGELOG.md','CHANGELOG.en.md','RELEASE.md','RELEASE.en.md','THIRD_PARTY_NOTICES.md','LICENSE']
artifact = root / (p['name'] + '-' + p['version'] + '.vsix')
with zipfile.ZipFile(artifact) as z:
    assert z.testzip() is None
    names = set(z.namelist())
    assert all('extension/' + name in names for name in required)
    assert {'extension/media/i18n.js','extension/media/vendor/markdown-it.LICENSE','extension/src/i18n.js'} <= names
    assert all(name in ['extension.vsixmanifest','[Content_Types].xml'] or name in ['extension/'+x for x in required] or name.startswith(('extension/src/','extension/media/')) for name in names), 'Unexpected package files'
    assert not any('..' in name.split('/') or name.endswith(('.log','.tmp','.vsix')) for name in names)
    icon = z.read('extension/' + p['icon'])
    assert icon[:8] == b'\x89PNG\r\n\x1a\n'
    assert all(size >= 128 for size in struct.unpack('>II', icon[16:24]))
assert len(list(root.glob(p['name']+'-*.vsix'))) == 1, 'Old project package remains'
print('Local release checks passed: localization, bilingual docs, icon, shortcuts and package allowlist.')
