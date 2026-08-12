# Architecture

## Responsibility boundary

```text
Immutable V2 policy
  collection ID -> exact metadata host/prefix + exact image host/prefix
  admission rules + complete trait profiles + deterministic caps
                              |
Caller submits sender-scoped request, token reference, exact URLs and SHA-256 digests
                              |
Deterministic validation
  strict JSON, source prefix, hashes, and bounded canonical PNG validation
                              |
Leader vision judgment
  status + one profile_id only
                              |
Independent validator audit
  re-fetch same bytes, verify terminal result or audit exact semantic proposal
                              |
Append attempt record
                              |
MAPPED only -> reserve global deployment/policy asset identity
```

The application owns UI, wallets, indexing, token ownership, collection-address checks, gameplay, and consequences. The contract owns only source-bound admission and bounded destination-profile selection.

## Immutable source authority

Every `collection_sources` entry contains exactly:

```json
{
  "collection_id": "demo:forge",
  "metadata_domain": "assets.example.com",
  "metadata_path_prefix": "/official/demo-forge/",
  "image_domain": "images.example.com",
  "image_path_prefix": "/official/demo-forge/"
}
```

Calls for a configured collection must use the exact host and matching prefix; subdomains are not implicitly trusted. Prefixes cannot be root-only, percent encoded, contain dot segments, backslashes, queries, or fragments. Metadata must bind the exact collection, token, and image URL.

This is a deliberately explicit trust boundary, not cryptographic ownership proof. Deployers must choose provider-controlled or commit-pinned paths. A changed source authority requires a new immutable deployment.

## Deterministic profiles

The model does not emit traits or tier numbers. It may select one configured `profile_id`; deterministic code expands it into class, element, rarity, and power. Constructor checks ensure profile IDs and exact trait combinations are unique and tiers satisfy global and per-class caps.

`MAPPED` is valid only when one profile is directly supported. Multiple plausible profiles require `AMBIGUOUS`; no faithful profile requires `UNSUPPORTED_ASSET`.

## Evidence failures versus semantic outcomes

The contract keeps source problems distinct:

- `SOURCE_UNAVAILABLE`: non-success response or empty body
- `INTEGRITY_FAILURE`: SHA-256 mismatch
- `INVALID_SOURCE_FORMAT`: malformed/duplicate/nonfinite JSON, non-PNG evidence, invalid content encoding, or PNG structure/dimension/pixel/decode failure. PNGs must be 8-bit non-interlaced RGB/RGBA with CRC-valid ordered chunks and bounded exact zlib output. Digest-pinned `text/plain` metadata is permitted because common immutable raw-file hosts use that MIME type, but the bytes still undergo strict JSON parsing and every identity/source check.
- `CONTENT_LIMIT`: encoded bytes above 65,536, metadata/canonical-text limits, or content-length mismatch

None reserves the asset identity. `UNSUPPORTED_ASSET` is reserved for valid evidence that semantically fits no configured profile.

## State and replay invariants

Every completed attempt is append-only and consumes only that submitter's request ID. The request lookup key binds chain ID, contract address, submitter, and request ID.

Request and result digests use length-framed fields and bind chain, deployment, sender, and policy. The asset digest intentionally binds chain, deployment, policy, collection, and token without the sender. The global mapped-asset index is written only for `MAPPED`, preventing cross-address outcome grinding while allowing all other outcomes to be retried under a new request ID. Later callers can retrieve the canonical record with `get_mapping_by_asset`.

## Equivalence principle

The leader either returns a deterministic source-terminal status or evaluates the bounded image/profile question. A custom validator:

1. Re-fetches and re-hashes the same metadata and image.
2. Reproduces deterministic terminal results exactly.
3. Rejects a semantic leader result if evidence now produces a terminal result.
4. Independently audits admission, the exact profile, metadata/image consistency, and whether another profile is equally plausible.
5. Accepts only an exact boolean audit schema.

Malformed model output, unknown profiles, extra fields, changed evidence, and non-reproduced transient errors force disagreement.

## Deliberate exclusions

- Token ownership and signatures
- On-chain collection-address or token-URI verification
- Transfers, bridges, minting, payments, and gameplay
- Market rarity, valuation, or pricing
- Generated traits or arbitrary abilities
- Legal and intellectual-property conclusions
