# Consensus Asset Admission & Trait Mapper

An MIT-licensed reusable GenLayer Intelligent Contract that evaluates one public visual game asset against an immutable source policy and, when admitted, selects exactly one predefined destination-game trait profile.

The contract is not a game, NFT bridge, ownership oracle, marketplace, appraisal service, or arbitrary AI trait generator.

## Consensus boundary

The caller submits a collection ID, token reference, public metadata and image URLs, and exact SHA-256 digests. For every configured collection, the immutable policy binds:

- One exact metadata hostname and path prefix
- One exact image hostname and path prefix
- A closed set of complete trait profiles
- Admission rules and deterministic tier caps

The leader fetches and hashes both sources, verifies metadata identity and exact image-URL binding, inspects the image, and returns only a status plus one `profile_id`. Validators independently re-fetch the same digest-pinned bytes and audit the substantive result. Deterministic code derives class, element, rarity, and power from the selected profile; the LLM never chooses or modifies numeric tiers.

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

## Local verification

```powershell
python -m pip install -r requirements.txt
genvm-lint check contracts\ConsensusAssetAdmissionTraitMapper.py --json
genvm-lint typecheck contracts\ConsensusAssetAdmissionTraitMapper.py --json
genvm-lint schema contracts\ConsensusAssetAdmissionTraitMapper.py --json
pytest tests\direct -q
```

Current suite: **57 direct tests**, including validator-hook tests for audit acceptance/rejection, malformed audits, changed evidence, terminal-result equivalence, transient-error parity, deployable repository fixtures, and digest-pinned `text/plain` JSON metadata.

## StudioNet and Bradbury

Configure the variables documented in [docs/ONCHAIN_TESTING.md](docs/ONCHAIN_TESTING.md), then run:

```powershell
gltest tests\integration\test_consensus_asset_trait_mapper.py -v -s `
  --network studionet -m semantic

gltest tests\integration\test_consensus_asset_trait_mapper.py -v -s `
  --network testnet_bradbury -m semantic
```

Both deployment and mapping explicitly wait for `FINALIZED`, and successful execution is asserted separately.

The proof harness records finalized receipts, discovered consensus/vote fields, exact expected and persisted results, policy/source hashes, and limitations:

```powershell
gltest deploy\001_deploy_and_smoke.py -v -s --network studionet
```

It refuses missing/placeholder evidence, a network-label mismatch, an unpinned runner, a non-full source commit, or a source-plus-policy deployment input above 50,000 bytes.
It checkpoints the finalized deployment before submitting the semantic smoke and refuses to overwrite an existing record. Only an already-`COMPLETE` proof may be re-verified with `ASSET_MAPPER_RESUME=1`; interrupted runs fail closed and must use a fresh output file and deployment. The record cannot become `COMPLETE` unless both finalized receipts prove successful execution and expose nonempty validator and vote evidence.

## Limitations

- Validators need vision-capable models.
- All submitted evidence is public.
- GenVM currently does not expose the final HTTP redirect destination; exact host/path checks apply to submitted and metadata-declared URLs, not a hidden redirect target.
- Digest equality proves byte stability, not ownership or legal rights.
- Metadata served as `text/plain` is accepted only as a transport container: its exact bytes remain digest-pinned and must pass the same strict JSON, identity, URL-binding, and size checks.
- Correlated vision-model errors remain possible; keep consequences bounded and retain an appeal path.
- Consumers must wait for finality and pin both contract address and `policy_digest`.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
