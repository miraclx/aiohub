# Working on it

```sh
npm install
npm run dev          # the site alone, with made-up data at /?sample
npm run typecheck
npm test -- <path to a Chromium binary>
```

`npm run dev` needs no account or keys: the preview runs on made-up data and saves nothing.

`npm test` builds the site, starts the Worker on your machine with a fresh database and stand-in servers, and runs the
API tests, a browser walk-through and the AIOMetadata tests. With the shipped test values (`tests/local.vars`) every
outside address points at a stand-in on your own machine. If you keep a `.dev.vars` of your own, the run uses that
instead. It needs a Chromium binary because the walk-through drives one. A full run takes about 45 minutes.

## Layout

| Path | What it is |
| --- | --- |
| `src/` | The site: React and hand-written CSS. |
| `worker/` | The Worker: the site's API, the sign-in front that player apps talk to, and the code that keeps AIOStreams and AIOMetadata matching. |
| `migrations/` | The database tables. New ones are only ever added. |
| `tests/` | The three test parts and their stand-in servers. |
| `formatter-preview/` | See below. |
| `public/` | Pictures the site shows: poster backdrops and collection covers. |
| `setup.mjs` | The terminal setup script. |
| `scripts/default-home.mjs` | Prints the rows a new hub's Home starts with. |

## Settings only the tests use

None of these belong on a real site. Each is described where it is declared, in `worker/util.ts`.

| Name | What it is |
| --- | --- |
| `TEST_WHERE` | The one test switch. With it on, the Worker reads a request's place and time from test headers and opens a few routes only the tests ask. |
| `NOTICE_VIA` | Sends the Home change call to a stand-in. Read only while `TEST_WHERE` is on. |
| `TMDB_API`, `TMDB_CHECK`, `MDBLIST_API`, `TRAKT_API`, `TRAKT_AUTH`, `FLIXPATROL_API` | Where the Worker reaches each service. The tests point them at stand-ins on your own machine. |
| `FORYOU_HOUR`, `RECS_HOUR` | The UTC hour from which the day's For you picks and Recommended rows are worked out (5 and 4). The tests move them. |
| `FRONT` | `aiometadata` in every real copy. The other value is an older path, kept only until its tests are moved over. |

If you keep a `.dev.vars` from before the server settings were renamed, delete it before running the tests, so the
run copies the current `tests/local.vars`.

## formatter-preview

The manager can choose how stream names are labelled in the apps, and the site shows a live preview of the label
while they edit it. To make that preview match what AIOStreams will really produce, it runs AIOStreams' own formatter
code in the browser.

`formatter-preview/` is that code: the formatter files from AIOStreams v2.37.0, unchanged under `upstream/`, and the
same files with their types removed under `canonical/`, which is what the site loads. `source-manifest.json` records
where each file came from, and `scripts/verify-source.mjs` checks them against it. It runs in a browser worker and
makes no network requests. `NOTICE` has the licence details.
