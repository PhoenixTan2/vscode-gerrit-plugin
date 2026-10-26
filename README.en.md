# Gerrit Workbench

[中文](README.md) | **English** · [Changelog](CHANGELOG.en.md) · [Local release checks](RELEASE.en.md)

Connect, upload commits, review changes, comment on code, reply and vote from VS Code. Normal workflows use the sidebar, editor buttons and file panel without opening the Command Palette.

## Review reading and comment states

Diff views load earlier PS code comments in the background and label each comment and thread with its original PS. Unchanged lines map to the displayed code. Comments on changed, deleted or unmappable lines remain file-level threads with their original location; use File comments to jump to the original PS. Replies retain the original PS, file and line. When comparing two PS versions, each side shows its own comments, with other earlier comments on the newer side to avoid duplicates.

Clicking a search-result card opens the review discussion directly and reuses the existing discussion tab. Comparisons remain in the workbench; returning does not repeat the search.

Post review and current votes share one floating window centred on the right at every viewport width. It scrolls internally. Collapse reduces it to a title bar; expanding retains unsent comments and score choices.

Code-Review / Verified show score buttons without an unchanged-score option. The current account's existing vote is preselected, or 0 when there is no vote. Clicking the selected score leaves it unchanged. Different scores are sent only by Post review; unchanged votes are omitted from the request.

Discussion threads use orange for unresolved and green for resolved. Resolved threads start collapsed, unresolved threads expanded, and global comments expanded. Manual folding is retained until the resolution state changes. Code views distinguish states through coloured gutter icons, inline counts and overview-ruler markers; native thread labels also name the state. The default-expand-comments setting was removed; other settings remain.

Workbench and comparison code-comment counts use **unresolved(resolved)**, such as **2(5)** for two unresolved and five resolved code discussion threads. The latest comment determines each thread's state. Replies are not counted again and global comments are excluded from code-thread counts.

Conflicting-change links use link blue and underlines. Status text beside the change number uses blue for Open, brown for WIP, pink for ready to submit, green for merged and red for abandoned. Negative votes retain a separate orange indicator without overriding server eligibility.

## In-page review controls and state colors

On your own Open / WIP changes, type a name, email or group name directly in the discussion's **Reviewers** box. Select a suggestion to add a person or group; use × next to an existing reviewer to remove them. Keyboard navigation is supported. Stale suggestions cannot add a different person, and sidebar/discussion suggestions are isolated. Reviewer updates preserve the review comment being edited.

Score buttons preselect your current vote. Code-Review / Verified have no unchanged-score button; clicking the selected value does nothing. Post review and current votes share one collapsible right-centred window at every viewport width, with internal scrolling.

The workbench comparison selectors include **Edit (saved draft)** for comparison against any PS or Base in either direction. **Compare saved edit** compares the draft to its original PS. Save local edits first; comparisons create no PS. Code comments require publishing the Edit as a PS. **Discard edit** deletes the whole private draft without changing published PS revisions. Dirty local buffers block discard until saved or undone. You can start a fresh Edit on the same PS afterwards.

Your own Open / WIP latest PS always exposes **Rebase**, even when the server omitted action metadata. The server checks permission and feasibility after the Base is selected. Historical views must first switch to the latest PS.

| Card color | Meaning |
| --- | --- |
| Blue | Ordinary Open |
| Brown | WIP |
| Orange | Negative votes; -1 / -2 share a color and retain their values |
| Pink | Server says ready to submit, with no negative-vote warning |
| Green | Merged |
| Red | Abandoned |

Stripe priority: merged / abandoned, then negative votes, WIP, ready to submit and ordinary Open. Color is a warning, while eligibility uses the server's submittable flag. A negative-voted change that the server permits can show an orange stripe and **Ready to submit** together; the extension does not invent a submission block. Exact tones follow the VS Code theme.

## Edit, publish and rebase

Open a text diff of the latest PS of your own Open / WIP change and choose **Edit** in the editor toolbar. The left Base / selected PS stays read-only; only the right Edit side is writable. Use **Save Gerrit edit** or Ctrl+S to save a private server-side draft, without a local repository or target-branch changes.

**All files in one change share one Edit draft.** Edit and save multiple files; saving does not create a PS. When finished, choose **Publish edit as new PS**. It saves every open dirty Edit file for that change, then publishes the whole draft as one new PS. Files are never published individually. A failed save or remaining dirty buffer stops publication and retains editor content. Newer patch sets or edits changed in another window are not overwritten. Reconcile them and reopen the edit. Saved drafts can be continued in Gerrit Web; save unsaved content before closing the window.

The workbench and discussion expose permitted actions: publish WIP for review, Rebase, submit and publish an Edit. Rebase can preserve dependencies automatically, use the target branch tip, or use an entered change number / SHA / ref. An old Edit must be rebased onto the latest PS before publication. All writes remain subject to server permissions.

Uploads, publishing, submission, abandonment and reviewer changes no longer show extra confirmation warnings. Necessary target/mode/rebase inputs and failure messages remain.

Commit and relation panels remember expansion separately for the workbench and discussion, across changes and restarts. The default-expansion settings were removed. Compact related changes show numbered Gerrit nodes, mark outdated patch sets and omit repeated parent-SHA rows. Parent navigation remains in commit metadata.

Background conflict checks distinguish target-branch merge conflicts from conflicts with unmerged changes; conflicting changes link to details. Unsupported checks are explicitly marked unavailable. Comment navigation uses directional comment-bubble icons distinct from diff-change navigation.

## Upload branches and reviewers

Uploads read live branches from the selected Git remote. Prefill the local branch only when it exists remotely; otherwise start empty. Type to filter suggestions case-insensitively. Outgoing commits and Change-Ids are still checked before pushing, without a confirmation warning.

Your own Open / WIP changes show a **Reviewers · Code-Review / Verified** section in the discussion page only. Type a name, email or group name in the box and select a suggestion; use × next to a reviewer to remove them. Groups expand into members; server-required group confirmation is handled automatically. Removing reviewers also removes their votes and remains subject to server permissions. Switch historical views to the latest PS before managing reviewers.

Gerrit assigns reviewers to a whole change, not separately to Code-Review and Verified. Adding reviewers does not grant voting rights; server project configuration controls label permissions. Votes remain displayed per label.

## Excel original-file comparison

Binary snapshots retain their exact bytes and filename extension. VS Code opens the old and new copies in separate editor groups as preview tabs. Gerrit Workbench does not render spreadsheets or calculate cell differences.

Install [Office Viewer](https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-office) for xls / xlsx / xlsm or [Excel Viewer](https://marketplace.visualstudio.com/items?itemName=GrapeCity.gc-excelviewer) for xlsx / xlsm separately. If a binary warning remains, right-click the tab, choose **Reopen Editor With...**, select the viewer and make it the default. The extension follows VS Code editor associations without overriding other formats. Rendering of complex formulas, charts and macros depends on the viewer. Files exceeding the response limit remain unavailable.

## Install and connect

Install `gerrit-workbench-1.1.0.vsix` using Extensions → **Install from VSIX**, then open the Gerrit Workbench activity icon. Enter a server root such as `http://192.168.1.10` or `https://review.example.com:8443`. Do not append `/gerrit` unless your server is actually deployed at that prefix. Dashboard URLs are also accepted.

Choose one authentication method per connection:

- **Website password** (default): for HTTP reverse-proxy login. Creates a website session and sends CSRF tokens for writes.
- **HTTP Key / HTTP password**: the credential generated in Gerrit Settings → HTTP Credentials, using the `/a/` REST API.

The methods are not combined; a server may support either or both. Existing connections keep the last choice. Passwords are stored in VS Code SecretStorage. Cookies and session tokens stay in memory. Interactive SSO/OAuth is not supported. HTTPS certificate verification remains enabled.

## Language

Set **Gerrit → Language** to `zh-CN` (default) or `en`. Views, dialogs and extension-generated messages change immediately. Native VS Code command and settings titles follow the VS Code display language through packaged NLS resources. User comments, source code, names and server data remain unchanged.

## Main workflows

| Feature | How it works |
| --- | --- |
| Search | Open (including visible WIP), Merged, Abandoned, related-to-me and my-changes presets. Combine Message, Repo, Branch, Owner, exact Gerrit number and modified-file path fields. Message and filename matching use case-insensitive substring matching. Advanced Gerrit conditions remain available. |
| Message search | Searches subjects, historical commit messages, overall reviews, inline comments, Change-Ids, numbers and SHAs. It does not search source contents. Narrow Repo/Branch to reduce scanning time. |
| Stable results | Results stream in the background. Browsing locks their order; later hits show a count until you merge them. Back navigation uses cached results. Search/reset/list refresh starts a new search; detail refresh updates only that change. |
| Background tasks | Sidebar/file-panel task button and discussion entry show Message scans, path indexes and downloads. Cancel or retry failed/cancelled tasks. Checkout cannot be interrupted once it starts. |
| Change navigation | Previous/Next follows cached result order. Parent links appear only for confirmed visible Gerrit changes and open the exact referenced PS. Breadcrumbs return directly to any child context, restoring comparisons. |
| Commit and related changes | Created and last-updated timestamps, full commit message and metadata. Author/committer/repo/branch links search their identity. Related changes preload in the background; manual collapse state is retained. |
| Arbitrary comparison | Choose any PS pair or PS/Base in the sidebar. Base is the other PS's first parent. Selecting a revision immediately updates the bottom **Gerrit Comparison** panel. |
| PS annotations | Adjacent PS revisions are compared in the background. A revision is annotated only when no code files differ from the preceding PS. Virtual commit-message files are ignored. |
| Comparison files | File types have distinct colors, with path filters, statistics and comment counts. Successful opening marks that PS file read locally; failed opening does not. Read markers can be cleared manually. New PS versions retain reads only for unchanged files. |
| Temporary tabs | File comparisons use reusable preview tabs to avoid tab accumulation. Double-click a tab to keep it. Original binary pairs also use preview tabs in their two editor groups. |
| Single-side files | Top-right buttons open the left, right or currently focused side separately using already-loaded snapshots. Missing sides cannot be opened. |
| Discussions | Discussion opens in the active editor group. Code threads and activity entries collapse to their first lines. Filters select unresolved threads and discussions you joined. Back from the comparison panel opens the discussion tab. |
| Inline comments | Press `C` in a read-only Gerrit diff: comment on the selected range, or at the cursor line when no selection exists. `Ctrl+C` still copies. The shortcut is inactive in comment text inputs. Gutter/comment-toolbar entry points are also available. |
| Comment navigation | Gutter markers, hover summaries, scrollbar marks and previous/next comment buttons. Discussion navigation opens the original PS/Base diff and reveals the correct side. Change-level comments have no code navigation button. |
| Markdown and links | Discussions and draft replies support safe Markdown with preview on blur. HTTP(S) links open in the integrated browser. Same-site Gerrit links use the authenticated gateway; external links receive no Gerrit credentials. Site-relative links are supported. Raw HTML and non-web link protocols are disabled. |
| Votes and management | Nonzero votes show directly; unvoted/zero-score people are collapsed. Cards deduplicate identical scores. Pink Ready-to-submit cards use the server's submittable flag; submitting still requires permission. Own WIP can be published, own changes abandoned, permitted changes submitted. |
| Browse revision files | Find paths in any selected PS, including unchanged headers, without a matching workspace repository. An isolated temporary bare Git cache fetches paths over SSH; content is read through Gerrit. No checkout or workspace changes occur. |
| Binary files | Gerrit's binary flag does not prevent text decoding/diff. Opaque files are passed as original bytes to VS Code in old/new editor groups; preview depends on installed file extensions. No embedded PDF/Excel viewer is included. |
| Large files | Metadata preflights both sides against the 32 MiB Base64 response budget (about 24 MiB source bytes). Known oversized files are disabled. Without metadata, Content-Length is checked before reading and streaming responses retain the byte limit. |

File reads are local progress markers, separate from Gerrit's reviewed-by-me state. That state means you commented or voted after the author's last update. Opening a file does not publish a Gerrit review.

Overall reviews and votes target the latest PS. Historical PS pages require explicitly opening the latest PS before overall review or change-management actions. Inline replies retain the original revision. Reviews publish immediately; drafts are never automatically published.

## SSH downloads and uploads

Downloads use the Gerrit-advertised SSH URL and your local OpenSSH key/agent and known_hosts. Password prompts and automatic host-key acceptance are disabled. No private keys are managed by the extension.

Open a local Git repository whose remote project matches the change. The extension fetches the selected change ref, verifies FETCH_HEAD against its SHA, then creates `change-<number>` and checks it out. It checks uncommitted files, unsaved editors and existing branches before checkout. It never clones, overwrites branches, stashes or forces checkout. Downloads and uploads are serialized per repository.

Upload staged changes or the existing HEAD through the sidebar or Source Control upload button. The destination is `refs/for/<branch>`, optionally WIP. Install Gerrit's commit-msg hook first; every uploaded commit needs a valid Change-Id. Remote and branch choices are used directly after commit validation, without a confirmation warning.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `gerrit.language` | `zh-CN` | Chinese or English views/dialogs |
| `gerrit.defaultQuery` | `is:open` | Initial query |
| `gerrit.pageSize` | 50 | 10–100 changes per page |
| `gerrit.requestTimeout` | 30000 | HTTP timeout in milliseconds |
| `gerrit.diff.openBeside` | false | Open comparisons in a separate editor group on the right |
| `gerrit.logLevel` | `info` | off/error/info/debug |

Toolbar settings and output buttons open extension settings and the Gerrit Workbench output channel. Known secrets and authentication headers are redacted; request bodies and response bodies are not logged. Output can contain server/project paths.

## Development and local delivery

Run `python scripts/verify.py`, then `python scripts/package.py`. Optionally run `python scripts/verify_host.py --vsix gerrit-workbench-1.1.0.vsix` for an isolated real VS Code host check. Node.js or VS Code's bundled Node runtime and Python are required. Local Git tests require Git. The packager validates the new archive before removing older project VSIX files and includes only runtime assets and documentation.

This is a local delivery; no remote repository or Marketplace publication is configured. See [release checks](RELEASE.en.md). MIT license; bundled markdown-it license is documented in [third-party notices](THIRD_PARTY_NOTICES.md).
