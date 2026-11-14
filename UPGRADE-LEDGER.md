---
description: The public version index for Freedom. Every installed workspace polls this file unauthenticated at session start to work out whether it is behind.
---

# Freedom version index

**Latest version: v8.2.0**

This file is public on purpose, it is deliberately thin, and its FORMAT IS FROZEN.

Every installed Freedom workspace polls this URL **unauthenticated** at session start to decide
whether to tell its owner they are behind. That check has to keep working for someone whose
access has lapsed, or whose install is years old, and those are precisely the people who most
need to be told a newer version exists. So the version list lives here, in the open, forever.

## Do not change the shape of the lines below

Installs parse `### → vX.Y.Z (title)` and read them positionally, taking the LAST as the newest
version. A parser only changes when someone upgrades, so the installs reading the oldest parsers
are exactly the ones this file exists to reach. Reformatting, reordering, or dropping a heading
mutes them silently, and silence is indistinguishable from "you are up to date".

This file is generated. `sync_stub` in the development repo's `scripts/release.sh` mirrors the
heading list on every release. Do not hand-edit the versions.

## Where the prose lives

Each heading's parenthetical says what that release was. The longer account of what changed lives
in the development repository's own changelog, which is not published.

## If you arrived here looking for an upgrade procedure

There is nothing here to run. This file is a list. Older instructions told an agent to fetch
this URL and follow it end to end, and there has never been a procedure at it to follow.

**The plugin, which is what most installs mean by upgrading, is two commands:**

```bash
claude plugin marketplace update freedom-workspace
claude plugin update freedom@freedom-workspace
```

**A workspace that also has a file layer** (a `TEMPLATE-VERSION` file at its root) syncs that
separately, and the plugin commands above do not touch it. Read
`.agents/maintainer/upgrade-freedom-framework/SKILL.md` inside that workspace and follow it; it
hands off to `sync-with-upstream`, which is the thing that actually merges. A workspace too old
to carry `.agents/maintainer/` gets the file layer by re-running the installer rather than by
following anything at this URL.

Not a client yet: https://github.com/ContinentalWorks/freedom

## Versions

Newest last.
### → v7.0.0 (Supersuit is Supersuit everywhere: the Freedom name and plugin are retired, and your update moves you to the supersuit marketplace)
### → v7.1.0 (Marketplace move on a preview Mac: add the clone through the other state-folder spelling, and 12 more changes)
### → v7.2.0 (notify: "text me" can ask for a text, and a Helm push carries the words, and 311 more changes)
### → v7.3.0 (Recommended reads clearly, and sixteen fixes from operator reports)
### → v7.4.0 (Reconcile card: per-item choices as data, and holds filed under a symlinked workspace name answer again, and 148 more changes)
### → v7.5.0 (end-a-session: a background job started from a bg-spare can end itself (#1499), and 71 more changes)
### → v7.6.0 (enterprise guard: tell the company's owners, and guard documents, transcripts, people and Bash copies, and 77 more changes)
### → v7.7.0 (artifact hub: deploy the host that ships in @supersuit/artifacts when --hub-source is not given, and 87 more changes)
### → v7.8.0 (update-surfaces test: start surface spawns in the throwaway HOME, and 122 more changes)
### → v7.9.0 (organizations: filing the operator's own superproject makes their company record; audit scopes to one company, and 89 more changes)
### → v7.10.0 (Question kinds: seven kinds, one name each, in one table, and 113 more changes)
### → v7.11.0 (Take it off my plate: the owner of a company superproject can close it, and 186 more changes)
### → v8.0.0 (Supersuit 8.0: one object model and its standards, recordings with voice and video, session names that fit the phone, and waves of fixes)
### → v8.1.0 (pointConfigAt refuses a config it cannot parse instead of wiping it, and 414 more changes)
### → v8.2.0 (137 changes, the most to send-message and catch-up-pluma)
