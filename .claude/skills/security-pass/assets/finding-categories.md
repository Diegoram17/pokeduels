# Finding vocabulary by layer

This is vocabulary for recognizing a real problem when you see one during a Security Pass — not a
checklist to run mechanically item by item. Apply only what's relevant to the layers that actually
exist in the project under review, and only where there's concrete evidence.

## Product / requirements

- Abuse of legitimate functionality (a feature used the way it's designed, but toward a harmful
  end)
- Malicious actors not considered in the requirements
- Sensitive data implied by the product but not called out
- Critical/irreversible operations with no stated safeguard
- Missing security requirements (authn/authz expectations, rate limits, audit needs)
- Dangerous assumptions ("only trusted users will ever call this")
- Ambiguous requirements that could be implemented insecurely without violating the letter of the
  spec
- Privacy gaps (data collected/retained beyond stated purpose)
- Integrity gaps (nothing stops tampering with data the system relies on)
- Availability gaps (no consideration of what happens under abuse/load)

## Architecture / design

- Attack surface not mapped or not minimized
- Missing or unclear trust boundaries between components
- Weak or absent authentication
- Weak or absent authorization / privilege separation
- Overly broad privileges (services, tokens, or roles with more access than they need)
- Sensitive data exposed across a trust boundary unnecessarily
- Sensitive data flows without adequate protection in transit or at rest
- Unmanaged or poorly scoped external dependencies (third-party services, SDKs, APIs)
- Secrets handled outside a secrets-management mechanism
- Weak, outdated, or misused cryptography
- Insufficient isolation between tenants, environments, or components
- Failure modes that fail open (fail unsafe) instead of fail closed
- Architectural decisions with a security cost not weighed against its benefit

## Specs / tasks

- Missing authorization criteria (who is allowed to do this, and who isn't)
- Missing authentication criteria
- Missing input validation criteria
- Missing limits (rate, size, quantity, scope)
- Unspecified error-handling behavior for sensitive operations
- Sensitive data mentioned with no handling requirement attached
- No negative/abuse-case scenarios in the acceptance criteria
- No ownership/ACL rules for the resource being specified
- No handling for invalid or unexpected states
- No security-specific acceptance criteria at all, on a spec that clearly needs one

## Code

- Authentication bypass
- Broken access control
- Privilege escalation
- Insecure direct object/resource reference
- Injection (SQL, command, template, log, etc. — whatever applies to the stack)
- Unsafe input handling / missing sanitization
- Path traversal
- Unsafe command/process execution
- Sensitive data exposure (in responses, errors, or storage)
- Secrets committed or hardcoded
- Insecure or misused cryptography
- Insecure session or token handling (fixation, predictable tokens, missing expiry)
- Business-logic abuse (the code is "correct" but the logic itself can be gamed)
- Race conditions with a real security consequence (not every race condition qualifies)
- Replay-attack exposure
- Resource exhaustion / missing rate limiting on expensive operations
- Insecure error handling (stack traces, internals leaked to the client)
- Insecure defaults (permissive by default instead of restrictive by default)
- Dependency / supply-chain risk (unpinned, abandoned, or known-vulnerable dependencies)
- Unsafe file handling (upload, path construction, extraction)
- Configuration problems (debug mode in production, permissive CORS, open ports)
- Logging of sensitive information
- Absence of a control the system clearly needs, given what it protects

## Tests

- Security properties that are already verified by existing tests (worth naming as a strength)
- Negative/abuse scenarios that are covered
- Important controls (authn, authz, validation) with zero test coverage
- Authorization boundaries never tested (can user A access user B's resource?)
- Security invariants that exist informally but were never turned into a test
