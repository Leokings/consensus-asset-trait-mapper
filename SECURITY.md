# Security Model

## Trust assumptions

- Consumers trust the immutable deployment policy and exact collection source prefixes.
- Those source paths are controlled by the intended collection authority or are commit pinned.
- Metadata and image bytes are public and independently retrievable.
- Consumers verify finality, contract address, `policy_digest`, sender, and result fields.
- Validators use competent vision-capable models.

## Defenses

- Concrete pinned GenVM runner
- Strict JSON with duplicate-key and non-finite-number rejection
- Exact HTTPS hostname and non-root path-prefix bindings per collection
- Rejection of credentials, ports, queries, fragments, percent escapes, backslashes, numeric/private-looking and reserved hostnames
- Exact metadata and image SHA-256 commitments
- Exact metadata collection, token-reference, and image-URL binding
- MIME, signature, byte, content-length, and canonical-metadata limits
- Closed statuses, reasons, profiles, and deterministic trait expansion
- Global and per-class deterministic tier caps
- Evidence framed as untrusted data in leader and audit prompts
- Validator re-fetch and independent substantive audit
- Sender-scoped request indexes, global mapped-asset identity, and deployment-bound digests
- Only `MAPPED` reserves an asset; all other outcomes can be retried with a new request
- Native value rejection

## Residual risks

### Source authority

Exact host/path binding proves which configured location supplied the digest-pinned bytes. It does not prove token ownership, issuer signatures, collection-address identity, or legal rights. A deployer who trusts a shared writable prefix gives its users that authority. Prefer collection-controlled or commit-pinned prefixes and combine this primitive with deterministic on-chain ownership/token-URI checks when required.

### Redirects and DNS

GenVM responses do not expose the final redirect destination. An initially permitted source could redirect elsewhere, and syntactically public DNS can change resolution. Digests bind returned bytes but do not prevent the request itself. Use nonredirecting immutable-content hosts or a trusted evidence mirror; avoid open redirects and broad multi-tenant prefixes.

### Correlated model error

Validators can share the same visual misconception. Complete profiles remove arbitrary tier choice but do not make image interpretation objective. Ambiguity must be acceptable, consequences should be capped, and high-value integrations should retain appeals or delayed execution.

### Prompt injection

Metadata and text visible in images share context with model instructions. The prompts mark them as untrusted, output is reduced to status/profile ID, deterministic code expands traits, and validators independently audit. These controls reduce but cannot mathematically eliminate prompt injection.

### Front-running, global identity, and retries

Request IDs are sender scoped, so another address cannot consume them. Successful asset identity is global to the deployment and policy: the first finalized `MAPPED` result for a collection/token prevents cross-address remapping and outcome grinding. Because the contract does not prove ownership, anyone can submit the same public asset first; consumers must treat the submitter only as provenance, retrieve the reusable result with `get_mapping_by_asset`, and never infer ownership. Nonconclusive attempts do not reserve the asset and remain retryable.

### Public data

All submitted URLs, digests, metadata and decisions are public. Never submit secrets, private media, credentials, personal data, or unpublished assets.

## Consumer checklist

- Wait for `FINALIZED` and verify execution succeeded.
- Pin contract address and `policy_digest`.
- Verify expected submitter, collection, token, source digests, status and profile.
- Act only on `MAPPED`; distinguish every evidence-failure status from `UNSUPPORTED_ASSET`.
- Do not treat a mapping as ownership, licensing, valuation, or bridge authorization.
- Limit downstream minting/gameplay consequences and preserve an appeal path.

## Reporting

Report vulnerabilities privately with contract version, source commit, minimal reproduction, expected result, and actual result. Never put secrets or exploitable credentials in on-chain test evidence.
