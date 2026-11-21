"""Build a dependency-free VSIX: python scripts/package.py"""
from pathlib import Path
import json
import zipfile
from xml.sax.saxutils import escape

root = Path(__file__).resolve().parents[1]
p = json.loads((root / 'package.json').read_text(encoding='utf-8'))
nls = json.loads((root / 'package.nls.json').read_text(encoding='utf-8'))
description = nls.get(p['description'].strip('%'), p['description'])
target = root / f"{p['name']}-{p['version']}.vsix"
temporary = target.with_suffix('.vsix.tmp')
manifest = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
<Metadata><Identity Language="en-US" Id="{p['name']}" Version="{p['version']}" Publisher="{p['publisher']}"/><DisplayName>{p['displayName']}</DisplayName><Description xml:space="preserve">{escape(description)}</Description><Tags>gerrit,review,git</Tags><Categories>SCM Providers,Other</Categories><GalleryFlags>Public</GalleryFlags><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="{escape(p['engines']['vscode'])}"/><Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace"/></Properties><License>extension/LICENSE</License></Metadata>
<Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/{p['icon']}" Addressable="true"/></Assets></PackageManifest>'''
types = '''<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="html" ContentType="text/html"/><Default Extension="css" ContentType="text/css"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="vsixmanifest" ContentType="text/xml"/><Override PartName="/extension/LICENSE" ContentType="text/plain"/></Types>'''
with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('extension.vsixmanifest', manifest)
    z.writestr('[Content_Types].xml', types)
    for name in ['package.json', 'package.nls.json', 'package.nls.zh-cn.json', 'README.md', 'README.en.md', 'CHANGELOG.md', 'CHANGELOG.en.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'RELEASE.md', 'RELEASE.en.md']:
        z.write(root / name, 'extension/' + name)
    for directory in ['src', 'media']:
        for file in sorted((root / directory).rglob('*')):
            if file.is_file():
                z.write(file, 'extension/' + file.relative_to(root).as_posix())
with zipfile.ZipFile(temporary) as z:
    if z.testzip() is not None:
        raise RuntimeError('VSIX integrity validation failed')
temporary.replace(target)
for previous in root.glob(f"{p['name']}-*.vsix"):
    if previous != target:
        if previous.is_symlink() or previous.resolve().parent != root:
            raise RuntimeError(f'Refusing to remove an out-of-workspace VSIX: {previous}')
        previous.unlink()
print(target)
