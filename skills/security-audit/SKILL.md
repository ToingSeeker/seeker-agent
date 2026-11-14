---
name: security-audit
description: Defensive security review of code the user owns - authz, injection, secrets, SSRF, unsafe deserialization, dependencies - with an exploit path and a fix for each finding. Use for "security audit", "is this secure", "pentest my code", "check for vulnerabilities".
---

# Security audit (defensive)

## Scope and ethics
Use this only on code and systems the user owns or is authorised to assess. This is source review plus safe local verification. Don't attack third-party systems, don't scan hosts you weren't pointed at, and don't run exploits against production without explicit written permission from the user for that specific action. If ownership is unclear, ask before starting. Findings are leads for the owner to fix. Write them so they can be fixed, not as weaponised exploits.

## Gather first
- **What the system is**: its entry points (HTTP routes, RPC handlers, CLI arguments, queue consumers, webhooks, file uploads), trust boundaries, and who the users and roles are.
- **The stack**: framework, ORM or query layer, auth mechanism (sessions, JWT, OAuth), deployment, and where secrets live.
- **The assets worth protecting**: money, personal data, credentials, admin functions, other tenants' data.
- **The scope**: the whole repo, a service, or just a diff. For a diff, look at what the change touches and what it newly exposes.

## Procedure
1. **Map the attack surface.** Enumerate the routes and handlers by searching the code for router registrations and handler decorators. For each one, record the method, the path, the auth required, and the inputs. This table drives everything after it.
2. **Authentication.** Check:
   - password hashing (a slow, salted algorithm)
   - session and token handling: expiry, rotation on login, revocation, `HttpOnly`, `Secure` and `SameSite` cookie flags
   - JWT verification (the algorithm is pinned, the signature is actually checked)
   - OAuth state and redirect URI validation
   - rate limiting on login, reset and OTP endpoints, and how the client IP is derived behind proxies
   - the password-reset and email-change flows
3. **Authorization**, usually the richest vein. For every handler that takes a resource ID, confirm the server checks that *this user* may act on *this resource*. Watch for:
   - IDOR, where an ID from the request is used with no ownership check
   - missing tenant scoping on queries
   - role checks done only in the UI
   - mass assignment, where request bodies are spread into models and can set `role` or `owner_id`
   - admin routes reachable without an admin check
4. **Injection.** Trace user input to its sinks:
   - SQL built from strings
   - shell commands
   - file paths, including traversal and archive extraction
   - template rendering
   - HTML output, for XSS: dangerous-HTML APIs and unescaped interpolation
   - regex built from user input (ReDoS)
   - headers (CRLF)
   - LDAP and NoSQL operators

   Prefer showing the exact source-to-sink path.
5. **Server-side requests.** Any feature that fetches a URL the user supplies (webhooks, link previews, imports) needs a scheme allowlist, private and link-local IP blocking that also holds after DNS resolution, and limits on redirects. Also check open redirects.
6. **Data handling.** Look for:
   - secrets committed to the repo or its history, `.env` files tracked by git, and keys in client bundles
   - sensitive data in logs or error responses
   - unsafe deserialization (pickle, YAML loaders, Java or PHP object streams)
   - weak randomness for tokens
   - missing integrity checks on webhooks: signature verification, replay windows
7. **Configuration.** Check CORS (wildcard with credentials, reflected origins), CSRF protection on cookie-authenticated mutations, security headers, debug modes in production, verbose stack traces, and default credentials.
8. **Dependencies.** Run the ecosystem's audit tool if available (e.g. `npm audit`, `pip-audit`, `cargo audit`). Report only the vulnerabilities that are reachable or relevant, with the fixed version.
9. **Verify safely.** For each candidate finding, confirm it by reading the full path, and where possible write a local test or run a request against a local instance that demonstrates it. Mark anything you couldn't confirm as "needs verification", not as fact.

## Finding format
For each finding:
- **Title and severity**: critical, high, medium or low, judged by realistic impact and how hard it is to exploit.
- **Location**: `file:line` for the source and the sink.
- **Exploit path**: who the attacker is (anonymous, any user, another tenant), what they send, and what they gain. Keep it concrete but non-operational.
- **Fix**: the specific code change or control, and how to test it.
- **Status**: confirmed or needs verification.

## Pitfalls
- Reporting scanner output without checking reachability.
- Missing authz bugs because the endpoint "requires login".
- Trusting client-side validation.
- Flagging framework-escaped output as XSS without checking for a raw-HTML escape hatch.
- Printing real secrets in the report. Show only the location and a masked prefix.

## Report
Start with a summary: how many findings at each severity, and the single most important fix. Then list the findings by severity. Then list the areas reviewed and the areas not reviewed (e.g. infra config, third-party services, runtime behaviour). Recommend that fixed findings be retested, and not considered closed until they are.
