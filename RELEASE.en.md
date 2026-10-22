# Local release checks

[中文](RELEASE.md) | **English**

This delivery is a local VSIX only. No public repository, Marketplace upload or Git push is configured. Keep the current local-tools publisher identity; do not invent repository, homepage or issue URLs.

1. Run `python scripts/verify.py`, followed by `python scripts/package.py`.
2. Run `python scripts/verify_host.py --vsix gerrit-workbench-0.16.0.vsix` to exercise an isolated real VS Code host and Webview workflows.
3. Run `python scripts/check_release.py` to check localization, bilingual documents, PNG icon and archive allowlisting. Exclude logs, credentials, tests and temporary files.
4. Retain only the current VSIX and record one local Git commit. Do not push.

The comment shortcut binds bare C only in read-only Gerrit diffs. Ctrl+C does not match it. Comparisons use preview tabs; users can double-click a tab to keep it.

Core APIs target VS Code 1.95 or later. Integrated-browser commands are detected at runtime; older versions may not support authenticated web browsing, while native review workflows remain available. Native contribution titles follow the VS Code display language; Gerrit Language controls views/dialogs.

Before any future public release, confirm the real publisher ID, repository and support URLs, and acceptance-test real comments, votes, uploads and state changes against the target Gerrit. Current automated checks use local fixtures and do not replace write-operation acceptance testing.
