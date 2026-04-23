## Deploy Configuration (configured for Railway)
- Platform: Railway
- Production URL: https://<your-service>.up.railway.app
- Deploy workflow: GitHub auto-deploy or manual `railway up`
- Deploy status command: HTTP health check
- Merge method: squash
- Project type: web app + public API
- Post-deploy health check: https://<your-service>.up.railway.app/health

### Custom deploy hooks
- Pre-merge: `npm test`
- Deploy trigger: push to main or run `railway up`
- Deploy status: poll `/health` and verify `/api`
- Health check: `/health`

### Default working agreement
- Unless the user explicitly says not to deploy, treat code changes as incomplete until the latest version is applied to the live website.
- Preferred finish sequence for code changes: local verification -> deploy to production -> confirm `/health` is healthy.
- If Railway CLI is unavailable, use the repo's GitHub-to-Railway auto-deploy path by pushing the updated code to `main`.
- If a change is clearly risky for production, pause briefly and confirm before pushing live.
