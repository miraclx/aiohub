# Updating

New versions are listed in [What's new](../CHANGELOG.md). Updating never asks people to sign in again, and new
database tables are added by the deploy itself.

## If you set up from a terminal

```sh
git pull
npm install
npm run build
npm run deploy
```

`npm run deploy` adds any new database tables, then deploys.

The setup script wrote your database's id into `wrangler.jsonc`. If `git pull` stops because of that file, run
`git stash`, pull, then `git stash pop`.

## If you used the button

The button made a repository of your own, and Cloudflare rebuilds your site every time that repository changes. To
bring in a new version, bring this repository's changes into yours:

```sh
git clone https://github.com/<you>/<your copy>
cd <your copy>
git remote add upstream https://github.com/miraclx/aiohub
git pull upstream main
git push
```

Cloudflare then builds and deploys by itself, tables included. After the first time, only the last two lines are
needed.

## Checking it worked

Open the site, go to Hub, General, Background work. Every job should show a recent run within ten minutes of the
deploy.
