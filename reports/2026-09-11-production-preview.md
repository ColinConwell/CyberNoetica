# Production and preview release setup — 2026-09-11

## URLs and branches

| Purpose | URL | Railway service | GitHub branch |
| --- | --- | --- | --- |
| Reviewed production | https://cybernoetica.app | cybernoetica-web | main |
| Potentially unstable preview | https://demo.cybernoetica.app | CyberNoetica | latest |

Both services remain in the existing Cybernoetica project’s Demo environment. Their deployments are separate. Production retains its existing audio volume at `/data/audio`; preview has no audio volume and supports generated Soundscape audio or local-file input. The explicit demo subdomain takes precedence over the existing registrar wildcard parking record; no wildcard certificate or unrelated domain routing was added.

Production’s apex ALIAS remains `pst3byz3.up.railway.app`. Preview’s CNAME uses Railway’s assigned `7bfn7u27.up.railway.app` target and port 8080, matching the runtime’s Railway-provided PORT. Each has its own Railway ownership TXT record.

Removed `app.imbasso.com` and `app.imbasso.art` from Railway and removed their app CNAME records at Porkbun. Other registrar records were preserved. Operational defaults in JUSTFile, the upload helper and `.env.example` now use `https://cybernoetica.app`. The DNS CNAME recipe takes explicit subdomain and routing-target arguments instead of hardcoding an Imbasso host.

## Release behavior

Previously the apex domain served a manually uploaded deployment while a different service followed `main`. Production now has a GitHub source and `main` push trigger. The existing second service follows `latest`. Both use the repository-root Dockerfile and `/api/health` deployment check. Source and trigger configuration were updated without deploying old main over the running production build.

Merging the draft `latest` → `main` PR will trigger a production build. Opening the PR, marking it ready or approving a review does not deploy production. A successful build and health check are required for a healthy rollout. Railway does not currently wait for GitHub check suites, and no GitHub Actions workflow is configured; review and validation before merging remain necessary. Direct CLI deployment can still bypass the branch workflow, so use the PR merge as the normal production release mechanism.

The PR includes OpenAstra commit `c67b863` and the prior visualizer, stereo DSP, playback, rendering, server and documentation changes accumulated on `latest`. It brings the catalog to 72 visualizers.

## Validation and limitations

- All 507 Vitest tests passed on the release checkout including OpenAstra; TypeScript checks and the production SPA/server build passed.
- Shell syntax, JUSTFile parsing and Git whitespace checks passed for operational helper changes.
- Railway read-back verified separate repository branch triggers and production volume retention. Production remained on deployment `bb1582e4-eddd-45b4-89a2-152fb5e22237` during setup.
- Railway successfully deployed OpenAstra commit `c67b863` on preview (deployment `51f12392-9bf4-41e1-a119-28edc4d4e4e8`).
- Stable and preview home pages and `/api/health` returned HTTPS 200; the preview’s entry JavaScript asset also returned 200 after matching its domain target to runtime port 8080.
- Registrar read-back confirmed both retired CNAMEs were absent. Railway reported valid certificates for stable and preview domains.
- Physical mobile and other browser engines were not revalidated in this release-preparation task. Existing build warnings remain. Preview has no sample music library. Production health and audio must be checked after merging.

Railway’s documented [GitHub autodeploy behavior](https://docs.railway.com/deployments/github-autodeploys) matches the configured branch triggers. DNS caches may temporarily retain retired host records.
