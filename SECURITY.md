# Security Policy

> [Ringfall](README.md) > Security Policy

Ringfall is a static page with no backend, no network calls after load,
no third-party scripts, and no storage beyond personal bests in the
browser's local storage. The security surface is the published build, the
pinned dependencies, and the GitHub Actions workflows.

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
