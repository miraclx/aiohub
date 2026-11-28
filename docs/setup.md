# Setting up

There are two ways to get your own copy. Both end at the same place: a site of your own and a one-time link that
creates your hub.

## 1. Deploy

### With the button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/miraclx/aiohub)

1. Sign in to Cloudflare and connect GitHub or GitLab when asked. Cloudflare copies this repository to your account.
2. Fill in the two secrets:
   - `VAULT_KEY`: a long random text, 40 characters or more. It locks every key and password the site stores. Keep a
     copy somewhere safe and never change it. Without it, stored keys cannot be read again.
   - `CLAIM_CODE`: a code you make up. The site asks for it once, when your hub is created.
3. Leave the build command (`npm run build`) and the deploy command (`npm run deploy`) as they are. The deploy command
   is what creates and updates the database tables.
4. Press Deploy. When it finishes, open `https://<your site>/#/setup/<your claim code>`.

### From a terminal

You need Node 22 or newer.

```sh
git clone https://github.com/miraclx/aiohub
cd aiohub
npm install
npx wrangler login
node setup.mjs
```

To use your own servers from the start:

```sh
node setup.mjs --aiostreams https://your.aiostreams.host --aiometadata https://your.aiometadata.host
```

The script makes the database, creates its tables, makes the two secrets, builds and deploys the site, and prints the
one-time link that creates your hub.

It keeps the two secrets in `.instance.json` in this folder. **Back that file up.** Running the script again from the
same folder is safe: it keeps what already exists.

If the file is missing and the site already has its secrets, the script stops without changing anything, so it can
never replace your `VAULT_KEY` by accident. Put the file back and run it again.

## 2. Create your hub

1. Open the one-time link and choose a password. The site makes a hub code for you. You sign in with the two together,
   so save both.
2. Choose the two servers your hub uses, or keep the ones the site recommends.
3. Paste a debrid key.
4. Paste your TMDB key, and an MDBList key if you have one.
5. Pick a starting quality.
6. Add your first group and person.

## 3. Invite people

1. Add a person under People and send them their invite link, or let them scan the code.
2. They open the link and choose a password.
3. Their Devices page shows the server address, their username and an app password. They type those into any Jellyfin
   player app. On a TV they can use Quick Connect instead.

## Optional

### Turn on Trakt

A new copy has Trakt switched off. To offer it:

1. In your Trakt account, create an API app at <https://trakt.tv/oauth/applications>.
2. Set its redirect address to `https://<your site>/api/trakt/callback`.
3. Give the Worker the app's client ID as a secret:

   ```sh
   npx wrangler secret put TRAKT_CLIENT_ID
   ```

   With the button route, add it instead in the Cloudflare dashboard: your Worker, Settings, Variables and Secrets.

Only the client ID is needed. Each person then connects their own Trakt account from their own page.

### Use your own servers

Under Hub, General you can point the hub at your own AIOStreams and AIOMetadata servers at any time. To change what a
new hub starts with, see [Settings](configuration.md).

### Use your own domain

A `workers.dev` address works, and Cloudflare means it for personal projects. If your domain is on your Cloudflare
account you can add it to the Worker under Settings, Domains and Routes. Do this before inviting people: the server
address they type into their apps includes it.

If a player app cannot reach a `workers.dev` address at all, a domain of your own is the fix. Cloudflare checks
requests to `workers.dev` before they reach the Worker, and that check cannot be turned off there.
