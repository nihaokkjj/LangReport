---
status: accepted
---

# Keep Workspace model credentials encrypted and separate from model routes

## Context

The workbench needs a user-facing entry for a Workspace Owner or Admin to configure a Bailian API Key. A browser-held key, a plaintext database field, or a key embedded in a Generation Job would make credential leakage and historical data exposure too easy. At the same time, the frozen Model Route Snapshot must remain a non-secret reproducibility record.

## Decision

- Store at most one current `Workspace Model Credential` for Bailian per Workspace. It records only ciphertext, a four-character suffix, timestamps and actors.
- API accepts the key only over the authenticated API endpoint, encrypts it immediately with AES-256-GCM and `MODEL_CREDENTIAL_ENCRYPTION_KEY`, then writes a metadata-only audit event. Owner/Admin is required for both status and rotation.
- API and Generation Worker receive the same encryption key; Web, Generation Job, Model Route Snapshot, Model Invocation, normal logs and HTTP responses never receive the plaintext.
- Before a Bailian invocation, Generation Worker decrypts the Workspace credential in memory. A Workspace credential overrides the Worker environment `BAILIAN_API_KEY`; if stored decryption fails, the Job fails explicitly rather than falling back to a different secret. If no Workspace credential exists, the existing Worker-only environment key remains valid.
- The non-secret model endpoint, model ID and structured-output configuration remain deployment-managed and frozen when the Job is queued.

## Consequences

Administrators gain a visible rotation entry without broadening browser or Job secret exposure. Operations must provide the shared Base64 32-byte encryption key to API and Generation Worker before enabling this UI. Rotating a Workspace credential changes the operational credential for future executions, but never rewrites a Job's frozen model route or its audit history.
