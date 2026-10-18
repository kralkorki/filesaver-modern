# Security policy

## Supported versions

Only the latest 3.x line receives security fixes. This library has a small surface — it creates
`<a download>` elements, object URLs, and calls platform save APIs — so the risk of a vulnerability is
low, but a fix still matters when every app's "Download" button depends on it.

| Version | Supported |
|---|---|
| 3.x | ✅ |
| 2.x (original `file-saver`) | ❌ — maintained by Eli Grey |

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting: go to the Security tab of this repository →
"Report a vulnerability". That opens a private thread only maintainers can read.

Include:

- What the vulnerability allows an attacker to do
- A reproduction, ideally on a page you control
- Which browser and version you tested on

You can expect an acknowledgement within a few days and a decision on whether to publish a fix within
two weeks. If a fix is warranted it will ship with a test that fails without it, and a CVE if the impact
warrants one.

## What counts as a vulnerability here

In scope:

- One origin's page triggering a download on another origin's page
- A crafted filename escaping into an unexpected path or overwriting a file the user did not choose
- Denial of service through unbounded memory use in the library itself

Out of scope:

- Anything the user must opt into, such as accepting a large download
- Social engineering a user into accepting a file
- The browser's own save dialog behaviour
- Vulnerabilities in browser APIs the library calls

## Note for reporters

This library builds on Eli's original
[FileSaver.js](https://github.com/eligrey/FileSaver.js). If the same issue reproduces there, a report to
that project is worth filing too — a very large number of installs depend on it.