# Consensus Asset Admission & Trait Mapper

An MIT-licensed reusable GenLayer Intelligent Contract that evaluates one public visual game asset against an immutable source policy and, when admitted, selects exactly one predefined destination-game trait profile.

The contract is not a game, NFT bridge, ownership oracle, marketplace, appraisal service, or arbitrary AI trait generator.

## Consensus boundary

The caller submits a collection ID, token reference, public metadata and image URLs, and exact SHA-256 digests. For every configured collection, the immutable policy binds:

- One exact metadata hostname and path prefix
- One exact image hostname and path prefix
- A closed set of complete trait profiles
- Admission rules and deterministic tier caps

The leader fetches and hashes both sources, verifies metadata identity and exact image-URL binding, validates a strict bounded PNG, inspects the image, and returns only a status plus one `profile_id`. Validators independently re-fetch the same digest-pinned bytes and audit the substantive result. Deterministic code derives class, element, rarity, and power from the selected profile; the LLM never chooses or modifies numeric tiers.

The image envelope is deliberately narrow for consensus liveness: PNG only, at most 65,536 encoded bytes, 8-bit non-interlaced RGB/RGBA, 32-2,048 pixels per dimension, at most 1,048,576 pixels, and bounded exact zlib output. CRCs, chunk order, scanline filters, EOF, and decoded length are checked before any vision call. APNG, palettes, text/unknown chunks, decompression bombs, and malformed streams are rejected.

## Outcomes

```text
MAPPED
AMBIGUOUS
INELIGIBLE_COLLECTION
UNSUPPORTED_ASSET
METADATA_CONFLICT
SOURCE_UNAVAILABLE
INTEGRITY_FAILURE
INVALID_SOURCE_FORMAT
CONTENT_LIMIT
```

Only `MAPPED` reserves the asset identity globally within that deployment and immutable policy. Failed, unavailable, malformed, oversized, conflicting, unsupported, and ambiguous attempts remain append-only audit records but do not prevent a new request with corrected evidence.

## Collection authenticity boundary

`collection_sources` is the contract's authenticity boundary. A collection is eligible only when its submitted URLs use the exact configured hostnames and path prefixes, and the fetched metadata repeats the submitted collection ID, token reference, and exact image URL.

This proves that the evaluated bytes came through deployment-trusted source locations. It does not prove current token ownership, legal rights, bridge authorization, or that a poorly chosen multi-tenant path is controlled by the intended issuer. Use commit-pinned/provider-controlled prefixes. Ownership and on-chain collection-address checks belong in a deterministic integration.

## V2 policy shape

See [examples/policy.example.json](examples/policy.example.json). Each profile fixes the entire result:

```json
{
  "profile_id": "HEAVY_FIRE_R3_P2",
  "description": "Visibly heavy wearable armor with a dominant fire element and fortified construction.",
  "class_id": "HEAVY_ARMOR",
  "element_id": "FIRE",
  "rarity_tier": 3,
  "power_tier": 2
}
```

If more than one profile remains materially plausible, consensus must return `AMBIGUOUS`.

## Public interface

```python
get_policy()
get_mapping_count()
get_mapping(mapping_id)
get_mapping_by_request(submitter, request_id)
get_mapping_by_asset(collection_id, token_reference)
map_asset(request_id, collection_id, token_reference,
          metadata_url, metadata_sha256, image_url, image_sha256)
```

Request IDs are sender scoped. Request and result digests bind the sender, chain ID, contract address, immutable policy, and material inputs. The asset digest omits the sender deliberately: it binds chain, deployment, policy, collection, and token so one successful mapping is globally reusable and cannot be outcome-ground across addresses.
The `submitter` argument remains an ABI `address`; the contract normalizes both
runtime `Address` objects and GenVM's canonical hexadecimal call representation
before deriving the request key.

## Local verification

```powershell
python -m pip install -r requirements.txt
genvm-lint check contracts\ConsensusAssetAdmissionTraitMapper.py --json
genvm-lint typecheck contracts\ConsensusAssetAdmissionTraitMapper.py --json
genvm-lint schema contracts\ConsensusAssetAdmissionTraitMapper.py --json
pytest tests\direct -q
npm install
npm run check:deploy
npm run test:tooling
```

Current suite: **84 direct tests**, **7 Python proof-harness tests**, and
**18 JavaScript Bradbury-harness tests**. Coverage includes validator-hook audit
acceptance/rejection, malformed audits, changed evidence, terminal-result
equivalence, transient-error parity, deployable repository fixtures,
digest-pinned `text/plain` JSON metadata, transaction-return provenance,
durable submission intent, and EVM finalization proof.

## StudioNet and Bradbury

Configure the variables documented in [docs/ONCHAIN_TESTING.md](docs/ONCHAIN_TESTING.md), then run:

```powershell
gltest tests\integration\test_consensus_asset_trait_mapper.py -v -s `
  --network studionet -m semantic

gltest tests\integration\test_consensus_asset_trait_mapper.py -v -s `
  --network testnet_bradbury -m semantic
```

Both deployment and mapping explicitly wait for `FINALIZED`, and successful execution is asserted separately.

### Recorded 2026-08-12 network evidence

- StudioNet returned the exact expected `MAPPED` record at
  `0x5b24a46Eb67b0B5d7076Ea5e542c7bfB2717b180`, as reported by the
  test harness. No StudioNet transaction/vote artifact is included here.
- V2.0.2 source commit `9704da33003b74755315ab1d05e5f2cf8ac90501`
  deployed on Bradbury at `0x60F385056d8FD7d4CFcD496764Ff92EDf5Ce6Bf7`.
  Deployment transaction
  `0x04d685f9b00b06e0d041931497e5003f11ad5cf353bd87374a9bd1d99c1354b1`
  finalized with five `AGREE` votes.
- Bradbury semantic transaction
  `0x8b9505cbff65788371fe54e79855b35d52e4dd45768d38eb8c376cc56915b0db`
  did **not** finalize a mapping. The SDK reports `TIMEOUT` and
  `numOfRounds = 6`; the explorer exposes seven raw round entries and labels
  the terminal result/execution `MAJORITY_TIMEOUT` / `NONDET_DISAGREE`. In the
  last round the SDK labels the first vote `DETERMINISTIC_VIOLATION`, while the
  explorer labels it `NONDET_DISAGREE`; both expose four other `TIMEOUT` votes.
- After that terminal timeout, `mapping_count` remained zero, request and asset
  lookups were absent under both `latest-final` and `latest-nonfinal`. This
  release harness performed no retry, and the checkpoint records none. The
  observed leader candidate is not a contract result.

The concise audited record is
[`deployments/bradbury-2026-08-12-v2.0.2-timeout-audit.json`](deployments/bradbury-2026-08-12-v2.0.2-timeout-audit.json);
it embeds SHA-256-committed terminal subsets retrieved through genlayer-js 1.1.8
and the official Explorer API. The corresponding fail-closed full checkpoint
remains beside it, but is explicitly pre-terminal `IN_PROGRESS` evidence and
does not contain the eventual timeout rounds. This repository claims a finalized
Bradbury deployment, not a finalized Bradbury semantic mapping.

The audit labels its root-cause diagnosis as an **inference, not a proven
cause**. The most likely explanation is inconsistent Bradbury validator
vision-provider availability, image-capability routing, or latency. That is
consistent with four timeout votes, a returned-but-unaccepted candidate, and
GenLayer's documented requirement that validators route image requests to
vision-capable models. Full validator runtime/provider logs are unavailable, so
the audit also preserves credible alternatives: Raw GitHub fetch latency or
rate limits, model/schema variance, provider overload, validator capacity, and
GenVM/web-module runtime faults. See the audit's `timeout_diagnosis` object and
its official documentation links; do not cite the inference as a confirmed
network root cause.

The proof harness records finalized receipts, discovered consensus/vote fields, exact expected and persisted results, policy/source hashes, and limitations:

```powershell
gltest deploy\001_deploy_and_smoke.py -v -s --network studionet
```

It refuses missing/placeholder evidence, a network-label mismatch, an unpinned runner, a non-full source commit, or a source-plus-policy deployment input above 50,000 bytes.
It checkpoints the finalized deployment before submitting the semantic smoke and refuses to overwrite an existing record. Only an already-`COMPLETE` proof may be re-verified with `ASSET_MAPPER_RESUME=1`; interrupted runs fail closed and must use a fresh output file and deployment. The record cannot become `COMPLETE` unless both finalized receipts prove successful execution and expose nonempty validator and vote evidence.

For Bradbury release evidence, use
`deploy/001_deploy_and_verify.js`. It durably checkpoints submission intent and
every captured hash before waiting, verifies decoded source/constructor/call
provenance and sender, proves the mapping ID from the transaction return, scopes
the 60,000,000 EVM-gas ceiling to deployment estimation only, verifies each
Bradbury finalization transaction and EVM receipt, then re-reads the exact
`MAPPED` record through `latest-final`. See
[docs/ONCHAIN_TESTING.md](docs/ONCHAIN_TESTING.md).

That release proof fixes the outer Bradbury EVM chain ID (`4221`) separately
from the GenVM chain ID (`1`) used by contract digests. It also pins the exact
committed bytes of `examples/live-policy.json`: one Emberguard source and one
immutable profile only. Resumed `ACCEPTED`, `READY_TO_FINALIZE`, and `FINALIZED`
transactions are revalidated, and a successful external finalizer may be
recovered only from one exact `TransactionFinalized` log whose EVM transaction,
calldata, receipt, and event are all verified. Event recovery snapshots the
latest EVM block, verifies the exact SDK transaction identifier, anchors the
scan 128 blocks before its canonical read-state activation block, and scans
non-overlapping ranges of at most 10,000 blocks. A missing or malformed anchor
fails closed; recovery never falls back to a genesis scan.

## Limitations

- Validators need vision-capable models.
- All submitted evidence is public.
- GenVM currently does not expose the final HTTP redirect destination; exact host/path checks apply to submitted and metadata-declared URLs, not a hidden redirect target.
- Digest equality proves byte stability, not ownership or legal rights.
- Metadata served as `text/plain` is accepted only as a transport container: its exact bytes remain digest-pinned and must pass the same strict JSON, identity, URL-binding, and size checks.
- The 65,536-byte PNG and decoded-work limits are consensus-liveness boundaries, not merely upload validation; larger or structurally complex images must be canonicalized off-chain and re-pinned.
- Correlated vision-model errors remain possible; keep consequences bounded and retain an appeal path.
- Consumers must wait for finality and pin both contract address and `policy_digest`.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
