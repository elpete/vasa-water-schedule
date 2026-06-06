# Render Deployment

This app is ready for Render as a Node web service.

## Render setup

1. Create or sign in to a Render account.
2. Create a new Web Service from the GitHub repository.
3. Use these settings:
   - Runtime: Node
   - Branch: `main`
   - Build command: `npm ci`
   - Start command: `npm start`
   - Auto-Deploy: off, if you want GitHub Actions to be the deploy trigger
4. After the service exists, open its Settings tab and copy the Deploy Hook URL.

## GitHub setup

1. Open the GitHub repository settings.
2. Go to Secrets and variables, then Actions.
3. Add a repository secret named `RENDER_DEPLOY_HOOK_URL`.
4. Paste the Render Deploy Hook URL as the secret value.

Pushing to `main` will now run `.github/workflows/deploy-render.yml`, install dependencies, run syntax checks, and trigger a Render deploy.

## Custom domain

In Render, add a custom domain such as `vasa.elpete.com` to the service. Then add the DNS record Render provides in your DNS manager for `elpete.com` and verify it in Render.
