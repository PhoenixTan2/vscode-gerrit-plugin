# Changelog

[中文](CHANGELOG.md) | **English**

## 1.1.5

- First Marketplace release under `phoenixtan2.gerrit-workbench`. GitHub Releases and Marketplace use the same VSIX.
- If the previous `local-tools.gerrit-workbench` extension is installed, disable or uninstall it before installing the new extension, then reconnect to Gerrit.

## 1.1.4

- Publish change-level comments for the viewed patch set. Change-level comments default to resolved and can be posted as unresolved by clearing the checkbox. New code comments default to unresolved.
- Only the thread author can use Done in the discussion view and native comments, regardless of change ownership. Done preserves the original patch set, location and reply relationship and requires no reply text.

## 1.1.3

- Fix missing automatic re-login when identity checks return 403 or CSRF is rejected, missing or malformed despite a valid identity. Clear the old session, sign in automatically and retry once. Persistent failures report specific permission or credential errors instead of a generic reconnect instruction. Add recovery logging without credentials.

## 1.1.2

- Website-password (HTTP reverse proxy) mode restores expired sessions using the saved credentials. It verifies identity before loading change details and before write operations. An explicit authentication rejection can trigger one re-login and one retry, shared by concurrent requests. Timeouts, dropped connections and authenticated permission denials do not replay operations. External-browser sign-in remains server-managed; reconnect if credentials stop working.

## 1.1.1

- Diff views load earlier PS code comments in the background and label each comment and thread with its original PS. Unchanged lines map to the displayed code. Comments on changed, deleted or unmappable lines remain file-level threads with their original location; use File comments to jump to the original PS. Replies retain the original PS, file and line. When comparing two PS versions, each side shows its own comments, with other earlier comments on the newer side to avoid duplicates.

## 1.1.0

- Remove reviewer management from the workbench; keep in-page people/group controls in discussions.

- Keep 1.1.0: cards open/reuse discussions directly; conflict links are blue and underlined, with state-coloured detail badges.
- Combine review submission/current votes into one collapsible right-centred window at all widths. Preselect the account's current vote; selecting it again does nothing. Remove unchanged-score controls for Code-Review / Verified.
- Colour resolved/unresolved discussions and code markers; default to resolved collapsed, unresolved expanded and global comments expanded. Remove the comment-expansion setting.
- Show unresolved(resolved) thread counts such as 2(5) in the workbench and comparison list, without counting replies twice.

- Keep 1.1.0: inline reviewer/group autocomplete and removal, direct score buttons, and a sticky review column without overlap.
- Compare saved Edit against any PS / Base in either direction; discard an entire draft and restart on the same PS, with dirty-buffer protection.
- Always expose Rebase for your own Open / WIP changes; the server validates the operation.
- Use orange for all negative votes and brown for WIP. Submission eligibility follows the server even when negative votes exist.

- Keep version 1.1.0 for this batch: edit your latest PS in a native diff with immutable left and writable right sides. Save multiple files into one draft and publish one new PS, with server-edit concurrency checks.
- Add publish/rebase controls and background merge/conflicting-change indicators with detail links.
- Compact related nodes, omit duplicate parent SHAs and anonymous nodes, mark old patch sets, persist Commit/relation expansion per surface and remove default-expansion settings.
- Remove extra confirmation warnings, use directional comment-bubble icons, and add native Edit host and background-race checks.

- Complete upload targets from live remote branches; prefill matching local branches and filter case-insensitively.
- Search and add reviewers or groups and remove reviewers on your own open changes. Handle group confirmation automatically; removing reviewers also removes their votes; historical views cannot modify reviewers.
- Localize reviewer controls in Chinese and English; label permissions remain server-controlled.
- Document third-party Excel comparison and isolated host validation; keep VS Code ^1.95.0 compatibility.

## 1.0.0

- Finalize the validated 0.16.0 feature set as stable 1.0.0; remove the extension preview flag.
- Update bilingual installation and local release instructions. No additional functional changes or public publication.

## 0.16.0

- Localize native comment prompts and Post comment / Reply actions using Gerrit Language. Distinguish new comments from existing threads.
- Redirect command-driven navigation to registered native Comments threads into the appropriate PS/Base diff; preserve explicit standalone opening and ordinary cursor movement.
- Embed English documentation in root documents with in-page language links so the installed extension details viewer does not need a repository URL.

## 0.15.0

- Open comment/activity web links in the integrated browser. Same-site Gerrit links reuse authenticated sessions; external links do not receive Gerrit credentials.
- Add Chinese (default) and English views, dialogs and messages, packaged NLS contributions and bilingual documentation. Preserve user content verbatim.
- Move Open this side separately from the context menu to the editor toolbar.
- Reuse preview tabs for diffs and binary comparison pairs.
- Press C in read-only Gerrit diffs to comment on the selection or cursor line. Ctrl+C remains copy.
- Restrict package contents to runtime resources, localization and documentation. Prepare a local package without publishing.

## 0.14.0

Return from comparisons to discussion; align filters; deduplicate votes; compare adjacent PS code in the background; color file types; locate historical comments in PS/Base diffs; add single-side actions; mark successful file opens read; hide change-level code navigation.

## 0.13.0

Add exact change-number and case-insensitive modified-path filters, simplify connection prompts and default to website login. Expand details by default, show pink submittable cards, fold unvoted reviewers and preflight the Base64 response size budget.

## 0.12.0

Freeze search order while browsing with explicit merging of new hits. Add background task cancellation/retry, ancestor breadcrumbs, persistent PS file progress and scoped refresh.

## 0.11.0

Remove workspace dependence from revision path lookup using isolated temporary bare Git caches. Support unchanged files, case-insensitive paths, cache isolation and cleanup.

## 0.10.0

Preload related changes and resolve parent SHAs to visible Gerrit changes. Pin parent navigation to exact historical revisions, retain return context and guard historical review writes.

## 0.9.0

Add result Previous/Next navigation, configurable related-change expansion, metadata searches, compact layout and consistent collapse arrows.

## 0.8.0

Add status colors and clearer controls. Automatically compare mutually exclusive version selections. Improve file path lookup and Markdown discussion editing/preview.

## 0.7.0

Improve streaming search, cancellation, cached results, compact files and status filters.

## 0.6.0

Improve friendly search and native opening of binary originals without embedded file-format readers.

## 0.5.0

Improve comparison/review navigation, related changes, file presentation and search workflows.

## 0.4.0

Improve discussion layout, background SSH downloads, timestamps and commit information.

## 0.3.2

Fix extension activation and view visibility compatibility.

## 0.3.1

Improve extension installation and workbench activation reliability.

## 0.3.0

Expand review, code browsing, download and comment navigation workflows.

## 0.2.0

Add configurable views, arbitrary comparisons, inline discussions and debug output.

## 0.1.2

Improve server authentication and connection handling.

## 0.1.1

Initial connection, commit upload, review, comment, reply and voting workflows.

For the detailed original historical notes, see the [Chinese changelog](CHANGELOG.md).
