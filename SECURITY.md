# Security Policy

> [Ringfall](README.md) > Security Policy

Ringfall is a static page with no backend, no third-party scripts, and no
storage beyond personal bests in the browser's local storage. Every request
is same-origin, the fonts included (`src/fonts.css`), and the Content
Security Policy in `index.html` names no other host. The security surface
is the published build, the pinned dependencies, and the GitHub Actions
workflows.

## Threat model

1. **Assets**: the published build at the custom domain, the `main` branch, and the player's local storage; there are no accounts, secrets, or server-side data.
2. **Untrusted input**: the query string (`?seed`, `?atmo`, `?weather`, `?bot`, `?record`, `?nopost`) and the `ringfall.records.v1` local storage value; both are parsed by allow-list in `src/core` and never reach markup.
3. **Browser surface**: a strict Content Security Policy meta tag (same-origin scripts, no inline script, no `eval`, no workers, no objects) and `no-referrer`; GitHub Pages cannot set headers, so `frame-ancestors` and `Permissions-Policy` are unavailable.
4. **Supply chain**: every dependency is an exact pin with a lockfile integrity hash, lifecycle scripts are disabled, releases younger than a day are not resolved, and `pnpm audit --prod` must be clean.
5. **Build output**: content-hashed assets with hidden source maps; the bundle contains no environment variables and makes no network calls.
6. **Workflows**: every action is pinned to a commit, tokens are read-only except for the Pages deploy job, checkouts do not persist credentials, and no workflow runs on `pull_request_target`.
7. **Deploy**: only a completed push to `main` publishes; the custom domain is pinned by `public/CNAME`.
8. **Out of scope**: a player altering their own local storage or query string affects only their own session and personal bests; there is no leaderboard to defraud.
9. **Residual risk**: a compromised npm package at install time can alter the build; the pins, lockfile hashes and release cooldown narrow the window, and the fonts are served from this origin so no third-party stylesheet is inside the trust boundary.
10. **Admin-only controls** (branch rulesets, secret scanning, Pages HTTPS enforcement) are tracked on the review issue and are not enforceable from this repository's files.

## Supported versions

| Version | Supported |
| ------- | --------- |
| Latest release | Best effort |
| Older releases and unreleased revisions | No |

Only the latest release is supported; older releases are not patched.

**Why**: maintenance effort stays on the release players are directed to use.

## Reporting a vulnerability

Security vulnerabilities **MUST NOT** be reported through public issues.

Report privately at
<https://github.com/agh/ringfall/security/advisories/new>. Do not open a
public placeholder issue.

**Why**: the private advisory thread protects players before a fix.

Vulnerabilities in someone else's project, including three.js and the
build tooling, **MUST** go through that project's own security policy,
never a public issue here.

**Why**: that project's maintainers control the fix and disclosure.

Include a description of the vulnerability, steps to reproduce, the
potential impact, and a suggested fix if you have one.

### What to expect

Replies and fixes are best effort. There is no promised response time,
fix date, or service level, and no bounty or other payment. Progress is
discussed in the private advisory thread. After a fix is released, a
security advisory is published with impact and remediation.

**Why**: an advisory informs players without promising an unsupported schedule.

### Disclosure policy

Reporters **SHOULD** coordinate disclosure in the private thread until the
fix and advisory are published. Reporters are credited unless they request
anonymity. No legal action will be taken against good-faith reporters.

**Why**: coordinated disclosure protects players while a fix is prepared.
