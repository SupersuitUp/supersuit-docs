---
description: The public version index for Freedom. Every installed workspace polls this file unauthenticated at session start to work out whether it is behind.
---

# Freedom version index

**Latest version: v9.0.0**

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
### → v8.0.0 (Supersuit 8.0: one object model and its standards, recordings with voice and video, session names that fit the phone, and waves of fixes)
### → v8.1.0 (pointConfigAt refuses a config it cannot parse instead of wiping it, and 414 more changes)
### → v8.2.0 (137 changes, the most to send-message and catch-up-pluma)
### → v8.3.0 (The Helm is now Supertools: a collection of tools that help Pluma help you)
### → v8.4.0 (128 changes, the most to send-message and Superask)
### → v8.5.0 (Monthly schedules, a quieter catch-up, Pluma's own Chrome for scheduled runs, and 109 of your reports fixed)
### → v8.5.1 (Solo voice memos, Telegram by choice, company skills that run programs, S2S on at activation, and 40 of your reports closed)
### → v8.6.0 (308 changes, the most to catch-up and send-message)
### → v8.7.0 (104 changes, the most to Misses and send-message)
### → v8.8.0 (141 changes, the most to create-or-update-an-automation and catch-up-pluma)
### → v8.9.0 (116 changes, the most to catch-up-pluma and catch-up)
### → v8.10.0 (388 changes, the most to S2S and Company experiments)
### → v9.0.0 (Supertools overhaul: faster, with your projects, what is next for each, your team, and what each supersession is doing for you)
