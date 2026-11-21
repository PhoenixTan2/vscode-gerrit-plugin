# Local release checks

[中文](RELEASE.md) | **English**

The source is available on [GitHub](https://github.com/PhoenixTan2/vscode-gerrit-plugin). Published VSIX files are available from [GitHub Releases](https://github.com/PhoenixTan2/vscode-gerrit-plugin/releases). The Marketplace package uses `phoenixtan2.gerrit-workbench`. Users of `local-tools.gerrit-workbench` need to install the new extension and reconnect to Gerrit.

1. Run `python scripts/verify.py`, followed by `python scripts/package.py`.
2. Run `python scripts/verify_host.py --vsix gerrit-workbench-1.1.5.vsix` to exercise an isolated real VS Code host and Webview workflows.
3. Run `python scripts/check_release.py` to check localization, bilingual documents, PNG icon and archive allowlisting. Exclude logs, credentials, tests and temporary files.
4. Retain only the current VSIX and record one local Git commit. Push when requested.

The comment shortcut binds bare C only in read-only Gerrit diffs. Ctrl+C does not match it. Comparisons use preview tabs; users can double-click a tab to keep it.

Core APIs target VS Code 1.95 or later. Integrated-browser commands are detected at runtime; older versions may not support authenticated web browsing, while native review workflows remain available. Native contribution titles follow the VS Code display language; Gerrit Language controls views/dialogs.

Before any future public release, confirm the real publisher ID, repository and support URLs, and acceptance-test real comments, votes, uploads and state changes against the target Gerrit. Current automated checks use local fixtures and do not replace write-operation acceptance testing.

## 1.1.5 first Marketplace release

- Package the distributable with official `vsce` and upload the same VSIX to GitHub Releases and Marketplace.
- The public 1.1.4 uses `local-tools.gerrit-workbench`, while 1.1.5 uses `phoenixtan2.gerrit-workbench`. VS Code installs these IDs separately. Switch extensions manually.

## 1.1.4 reissue validation

- This reissue fixes HTTP 400 when posting patch-set-level comments. New change-level comments default to resolved, while new code comments default to unresolved. Reinstall this VSIX and reload VS Code if the original 1.1.4 is already installed.
- Done and reply publish independently. Done needs no reply text; replies preserve resolution state. Discussion drafts survive Done refreshes. Only the thread author can mark it resolved, including on historical patch sets.
- 223 tests pass. Packaged activation, workbench, discussion Done clicks, global comment posting options, native comments and diff regression passed on VS Code 1.146.0 with English and Simplified Chinese display languages.
- Same-window 1.1.3 → 1.1.4 → 1.1.3 installation/rollback preserved settings and matched file fingerprints, but the runtime stayed at 1.1.3. No-reload upgrade acceptance is unmet. New-runtime connection, persisted state, discussion, native comment and diff migration/rollback acceptance remains incomplete. Reload once after installation.
- No real credentials or writes against real Gerrit changes were used. Target-server write acceptance remains unverified.

## 1.1.3 local validation

- Packaged activation, workbench/discussion Webviews, native comments and diff regression passed on VS Code 1.144.0. Same-window 1.1.2 → 1.1.3 → 1.1.2 installs/rollback matched expected file fingerprints and preserved settings, but left the 1.1.2 runtime active. No-reload upgrade acceptance remains unmet; active-runtime rollback compatibility is unverified. Reload once after installation to activate new code. Later expired-session recovery does not require a reload or manual connection.
- 214 tests pass, covering identity 403, CSRF 403 with an authenticated identity, missing/malformed tokens, bounded persistent 403, shared concurrent recovery, HTTP Key isolation and localized errors/redacted logs.
- Automatically sign in with saved credentials without opening the connection flow. A rejection with the fresh session reports a specific permission/credential error. Network failures never replay writes.
- No real credentials or writes against existing intranet changes were used. The reported server-side cause is not confirmed by target-server logs; a local HTTP fixture reproduces the repaired paths.

## 1.1.2 local validation

- Packaged-extension host and Webview / diff regression passed on VS Code 1.143.1. Same-window 1.1.1 → 1.1.2 → 1.1.1 installation and rollback preserved settings but left the 1.1.1 runtime active. No-reload update acceptance remains unmet and active-runtime rollback compatibility is unverified; reload after installation.

- 207 tests pass, adding session expiration, anonymous identity responses, concurrent re-login, fresh CSRF, bounded authentication retries, permission denials, no write replay after connection loss, and cancellation.
- No real credentials or writes against existing intranet changes were used. Recovery applies to the extension session, not external browsers.

## 1.1.1 local validation

- 197 tests pass, including unchanged-line mapping, renames, Base rebases, cancellation, asynchronous loading and replies on the original PS.
- Packaged-extension activation and Webview/native diff regression passed on VS Code 1.143.1.
- Same-window 1.1.0 → 1.1.1 → 1.1.0 installation was exercised in an isolated profile. Settings were preserved, but the active runtime remained 1.1.0. **No-window-reload update acceptance is not met; active-runtime rollback compatibility is also unverified.** Reload the window after installing this build. Clean-host checks do not prove stateful upgrade compatibility.
- Reproduce with `python scripts/verify_update.py --previous <previous.vsix> --vsix gerrit-workbench-1.1.1.vsix`; keep the prior package outside the workspace. Exit 2 means the no-reload acceptance criterion was not met. No existing intranet change was modified.

## 1.1.0 local validation

Additional coverage: current-account score preselection/no-op reselect, direct card navigation, state-based comment folding/counts, detail badge colors and right-centred combined windows at wide/narrow widths.

Additional checks cover inline reviewer/group suggestions, direct scores, right-centred window geometry, bidirectional Edit comparisons, restart after discard, distinct WIP/negative colors and server-authoritative submission eligibility.

The version is unchanged for this batch. Native Edit integration covers immutable Base, writable right side, multiple files saved to one server draft and published once, and a retired read-only session. Regression tests cover conflict checks, persistent folding, Rebase and operations without confirmation popups. No write acceptance test was performed against existing intranet changes.

- `python scripts/verify.py`: 190 passing tests covering remote branch selection, cancellation, stale suggestions, ownership, group confirmation, vote-removal warnings and bilingual controls.
- `python scripts/package.py` and `python scripts/check_release.py`: passed; retain only the current Gerrit Workbench VSIX.
- `python scripts/verify_host.py --vsix gerrit-workbench-1.1.1.vsix --viewer-vsix <third-party-viewer.vsix>`: passed in an isolated VS Code 1.143.1 host with Excel Viewer 4.2.58. Valid old/new XLSX snapshots opened as custom-editor preview tabs in two groups. The viewer is installed only in the temporary test profile, not bundled or required by this extension.
- Excel integration checks exact bytes, editor type and split opening for XLSX, not every Excel format or visual correctness of complex formulas/charts. The screenshot runtime was unavailable; visual screenshot acceptance is not claimed.
- Keep `engines.vscode` at `^1.95.0`. The minimum supported version is unchanged. No reviewer write operations were performed against existing intranet changes.
