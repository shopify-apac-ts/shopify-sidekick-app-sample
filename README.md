# Shopify Sidekick App Sample

A small custom app sample that connects a merchant's internal company data to Sidekick. Sidekick can analyze dummy inventory, sales, inbound shipments, and supplier rules, then help prepare a replenishment plan. The merchant reviews the quantities and reasons and clicks **Register request** to save a purchasing instruction in the dummy company system outside Shopify.

One Node.js server runs the React Router app, JSON APIs, and company-data module. A local SQLite file stores the dummy data, purchasing requests, audit history, and Shopify sessions. Shopify hosts the Sidekick extensions. The app server runs independently of Shopify CLI.

See [Application Architecture](docs/00-ARCHITECTURE.md) for diagrams, authentication, tool and intent flows, inventory calculations, persistence guarantees, endpoints, and the source map.

## Requirements

- Node.js 22.13 or later; the Render configuration uses Node.js 24.15.0.
- pnpm 10.28.0, as specified in `package.json`.
- For Shopify integration: [Shopify CLI](https://shopify.dev/docs/api/shopify-cli), Dev Dashboard access, and a store with Sidekick available.
- For hosting: a Render account with GitHub access and billing enabled for a paid web service and persistent disk.

## Try the Local Demo

```sh
git clone https://github.com/shopify-apac-ts/shopify-sidekick-app-sample.git
cd shopify-sidekick-app-sample
pnpm install
pnpm run dev:demo
```

Open [http://127.0.0.1:3000/app](http://127.0.0.1:3000/app). You can view inventory, edit a replenishment plan, register a request, and inspect saved requests. Dummy data is initialized automatically and stored in `./data/company.sqlite`.

This mode needs no Shopify credentials. It binds to loopback and disables Shopify authentication, App Bridge, and Sidekick tools. Sidekick itself is available after installing the app in Shopify Admin using the steps below.

## Deploy to Render

### 1. Create a Shopify App

Create an app in the [Shopify Dev Dashboard](https://dev.shopify.com/dashboard). In the app's settings, copy its **Client ID** and **Client secret** for the Render environment variables in the next step. Use this same app throughout the setup.

The sample uses Shopify-managed installation and token exchange through the official React Router library. Its Shopify access scopes are empty because the inventory and purchasing data belong to the app. Keep the secret in Render's environment settings and local `.env` files.

### 2. Create the Render Service from the Blueprint

Push this repository to a GitHub repository that Render can access. In the [Render Dashboard](https://dashboard.render.com), select **New > Blueprint**, connect that repository, choose the `main` branch, and use the root [`render.yaml`](render.yaml).

Review the resources before deploying. The Blueprint defines:

| Setting | Value |
| --- | --- |
| Service | One Node.js web service |
| Plan | Starter |
| Build command | `pnpm install --prod=false && pnpm run build` |
| Start command | `pnpm run start` |
| Health check | `/healthz` |
| Persistent disk | 1 GB mounted at `/var/data` |
| Database path | `/var/data/company.sqlite` |

Render prompts for these three values, declared with `sync: false`:

| Environment variable | Value to enter |
| --- | --- |
| `SHOPIFY_API_KEY` | Your app's Client ID |
| `SHOPIFY_API_SECRET` | Your app's Client secret |
| `SHOPIFY_APP_URL` | The public HTTPS origin of your Render service, such as `https://your-service.onrender.com` |

If Render has not assigned the final hostname yet, use `https://your-app.example.com` temporarily, then replace it with the assigned URL in step 3 before installing the app. Select **Deploy Blueprint** to create the service.

The Blueprint already sets `NODE_ENV=production`, `NODE_VERSION`, `SHOPIFY_API_VERSION=2026-10`, and `DATABASE_PATH`. Render supplies `PORT`. Leave `DEMO_MODE` unset so the app uses Shopify authentication and listens on the public service interface.

The [persistent disk](https://render.com/docs/disks) requires a paid service and preserves the SQLite data across restarts and deploys. Keep this sample on one service instance. Tables and shop-specific dummy data are created automatically; there is no separate migration or seed command.

### 3. Match the Render and Shopify URLs

Copy the service's actual HTTPS URL from Render. In the service's **Environment** settings, set `SHOPIFY_APP_URL` to that origin, with no trailing slash or `/app` path, then save and redeploy if the value changed.

Edit the existing values in [`shopify.app.toml`](shopify.app.toml):

| Field | Value |
| --- | --- |
| `client_id` | The same Client ID as Render's `SHOPIFY_API_KEY` |
| `application_url` | The same HTTPS origin as Render's `SHOPIFY_APP_URL` |
| `[auth] redirect_urls` | `["https://your-service.onrender.com/auth/callback"]`, using your actual hostname |

Keep the other configuration, including `[sidekick]`, access scopes, and the uninstall webhook subscription. The checked-in Client ID and domains are placeholders.

Once Render reports the service as live, verify its health endpoint using your actual hostname:

```sh
curl --fail https://your-service.onrender.com/healthz
```

The expected response is `{"ok":true}`. Continue with the Shopify deployment and installation below.

### 4. Deploy the Shopify Configuration and Extensions

From the repository root on your development machine, with Shopify CLI installed:

```sh
pnpm install
pnpm run shopify:validate
pnpm run shopify:deploy
```

Complete the CLI's authentication prompts and confirm the intended app before releasing the version. The deploy command publishes the app configuration and both extensions to Shopify:

- `company-data`: read-only company inventory, replenishment-plan, and saved-request tools.
- `replenishment-plan`: create/edit intents and tools that stage changes in the plan editor.

[`shopify app deploy`](https://shopify.dev/docs/api/shopify-cli/app/app-deploy) handles the Shopify configuration and extensions. Render hosts and deploys the Node.js server separately; Shopify CLI is not part of the hosted start command.

### 5. Install and Try the App

Install the released app on your test store from the Dev Dashboard's **Installs** card. For a Partner-owned app intended for a merchant store, configure [Custom distribution](https://shopify.dev/docs/apps/launch/distribution/select-distribution-method) and generate an installation link for that store. See [Dev Dashboard app installation](https://shopify.dev/docs/apps/build/dev-dashboard/create-apps-using-dev-dashboard#step-3-install-your-app) for the installation flow.

Open **Company Replenishment** from the store's Shopify Admin. The inventory page initializes that shop's dummy dataset. Try asking Sidekick:

> Using Company Replenishment's internal inventory, identify products at risk of stockouts and prepare a replenishment plan within JPY 100,000. Explain the quantities and reasons.

Review the plan in the app, adjust it if needed, and click **Register request**. Open **Registered requests** to inspect the saved purchasing instruction and audit history. Sidekick's editor tools stage a draft; saving happens when the merchant clicks the registration button.

## Updating the Deployment

With Render's default auto-deploy enabled, pushes to its connected branch deploy server changes automatically. After changes to app configuration or extensions, also run `pnpm run shopify:deploy` to release them to Shopify. Use one GitHub repository as the Render deployment source even if you maintain multiple remotes.

Use a separate app/configuration for local Shopify CLI development: the committed `automatically_update_urls_on_dev = true` allows `shopify app dev` to update the selected app's URLs for development.

For local Shopify-mode server development, copy [`.env.example`](.env.example) to `.env`, fill in the credentials and public HTTPS URL, and use `pnpm run dev`. The `.env` file is ignored by Git. The standalone local demo remains available through `pnpm run dev:demo`.

## Checks

```sh
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run extensions:build
```

These check the app and extension build locally. Live installation and Sidekick behavior must also be verified in your configured store.

## Documentation

- [Application Architecture](docs/00-ARCHITECTURE.md): runtime diagrams, authentication, Sidekick flows, data model, calculation rules, API routes, and source files.
- [Render Blueprints](https://render.com/docs/infrastructure-as-code): creating and managing the service from `render.yaml`.
- [Host a Shopify app](https://shopify.dev/docs/apps/launch/deployment/deploy-to-hosting-service): hosting and Shopify configuration.
- [Surface app data in Sidekick](https://shopify.dev/docs/apps/build/sidekick/build-app-data) and [surface app actions](https://shopify.dev/docs/apps/build/sidekick/build-app-actions): the integration used by this sample.
