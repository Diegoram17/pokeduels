# Deployment system vocabulary, by block

This is vocabulary for building a real deployment design during a Deploy Pass — not a checklist to
run mechanically item by item. Apply only what's relevant to the project under review, and only
after DISCOVER has actually found evidence for it.

## Build

- How dependencies get installed reproducibly
- Compile / transpile step, if any
- Static asset generation
- What the build produces: docker image, npm package, binary, static bundle, server bundle,
  deployment package
- Lint / typecheck / security checks run as part of build
- Whether the build is deterministic — same input, same output, every time
- For monorepos: what triggers a build/deploy for a given service — path-based filters or
  affected-package detection — so a change to one service doesn't trigger the pipeline of every
  service in the repo

## Artifact

- What exactly gets deployed (must be one concrete thing, not "the code")
- Versioning: how an artifact traces back to a specific commit
- Traceability: commit → build → artifact vN → environment, so any running instance can be tied
  back to what produced it

## Config & secrets

- What's config (varies safely by environment) vs. what's a secret (must never leak)
- Where secrets actually live (never in the repo, never in logs, never in error messages)
- Secret manager or equivalent mechanism, if the project's scale justifies one
- Per-environment config, and how it's kept in sync without duplicating secrets

## Infrastructure

- Compute: VMs, containers, serverless
- Container orchestration, if any (Kubernetes, ECS, etc.)
- Database hosting and how the app reaches it
- Storage / buckets
- Queues / async processing
- Real-time, WebSockets, TLS termination
- CDN / load balancer
- Firewall / network security boundaries
- Chosen for **this** project's actual scale and constraints — not a default cloud provider

## Environments

- What dev / staging / prod actually differ in (config and secrets — never code)
- How promotion between environments works

## Release strategy

- Direct release, rolling update, blue/green, canary, feature-flagged gradual rollout
- Chosen based on this project's tolerance for risk and downtime — not applied by habit
- Explicit statement: rolling back code does not automatically roll back data
- **For published packages (npm, Composer, PyPI...)**: this is a different problem than deploying
  a running service — once a version is published, third parties may already have installed it.
  Never publish straight to the tag/stream consumers install by default (`latest`, `stable`).
  Publish to a pre-release tag first (e.g. `next`, `beta`), verify it (tests, a real consumer smoke
  test), and only then promote it to the default tag.

## Data & migrations

- Schema changes and their ordering relative to code deploy
- Backward compatibility of the old code with the new schema during rollout (and vice versa)
- Seed data, data transformations
- Zero-downtime migration strategy, if the project needs one
- What "rollback" actually means when data has already changed

## Deploy gates

- What must pass before a release proceeds: unit / integration / e2e tests, security checks,
  dependency checks, a successful build
- CI/CD itself is a control mechanism, not just automation for convenience

## Verify & observe

- Verify (did it work?): health checks, smoke tests, critical user paths, DB connectivity
- Observe (how's it doing?): logs, metrics, traces, error rate, latency, availability, business
  metrics relevant to this project

## Recovery

- Rollback to a previous version
- Redeploy
- Restore infrastructure
- Restore data (and how that interacts with what changed after the bad deploy)
- Incident handling process
- Post-deploy diagnosis: what to check first when something's wrong
- **For published packages (npm, Composer, PyPI...)**: you cannot undo what third parties already
  installed — this is not a rollback in the server sense. Recovery means moving the default
  tag/stream pointer back to the last known-good version (e.g. `npm dist-tag`), marking the broken
  version deprecated so it warns on install, and shipping a fixed version fast — not deleting
  published history, which most registries restrict or actively discourage.
