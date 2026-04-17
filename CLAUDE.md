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
