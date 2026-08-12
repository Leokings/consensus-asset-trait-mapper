# On-chain testing and deployment proof

## Local gate

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

## Exact public fixture

Host real metadata and a valid PNG/JPEG/WebP at immutable URLs. The policy's collection entry must bind the exact metadata and image hostnames and path prefixes. Compute SHA-256 over the exact response bytes; content encoding, formatting, or metadata changes alter the commitment.

Set every variable in `.env.example`. Replace all placeholders. `ASSET_MAPPER_SOURCE_COMMIT` must be the full 40-character commit containing the deployed source. The release smoke deliberately requires one exact `MAPPED` profile and all derived traits.

The repository includes a prepared immutable metadata fixture at:

```text
https://raw.githubusercontent.com/Leokings/genlayer-ic-public-fixtures/534a1d95bcc280277626612582275f7479efa286/fixtures/metadata/emberguard-heavy-armor-compact.json
```

Its exact SHA-256 is `55387d76d0299d95bbe74d4880d98dc9904870fa458470c87572dbceab6fac0b`. GitHub Raw serves this strict JSON file as `text/plain`; V2 accepts that MIME only as a transport container after exact digest verification, then applies the same strict JSON, identity, source-prefix, and image-URL checks. The metadata binds this independently pinned image:

```text
https://raw.githubusercontent.com/Leokings/genlayer-ic-public-fixtures/d22e122aac62ac138e5056be53177e8bcceddd5d/fixtures/assets/emberguard-heavy-armor-compact.png
```

The exact image SHA-256 is `c86aefbd3140da84536192d5518c59dfaf2ef56ae7595825db934e4b94768fcb` over 58,501 bytes. Both URLs are commit-pinned; compute and independently verify both response digests immediately before the run.

## StudioNet

```powershell
$env:ASSET_MAPPER_DEPLOY_NETWORK = "studionet"
$env:ASSET_MAPPER_DEPLOY_OUTPUT = "deployments/studionet-smoke.local.json"
gltest tests\integration\test_consensus_asset_trait_mapper.py -v -s --network studionet -m semantic
gltest deploy\001_deploy_and_smoke.py -v -s --network studionet
```

## Bradbury

After StudioNet succeeds and the configured account is funded:

```powershell
$env:ASSET_MAPPER_DEPLOY_NETWORK = "testnet_bradbury"
$env:ASSET_MAPPER_EXPECTED_GENVM_CHAIN_ID = "1"
$env:ASSET_MAPPER_DEPLOY_OUTPUT = "deployments/bradbury-2026-08-12.json"
$env:ASSET_MAPPER_SOURCE_COMMIT = "<FULL_COMMIT_CONTAINING_DEPLOYED_SOURCE_AND_HARNESS>"
$env:ASSET_MAPPER_POLICY_JSON = Get-Content -Raw examples\live-policy.json
$env:ASSET_MAPPER_REQUEST_ID = "SMOKE-EMBERGUARD-001"
$env:ASSET_MAPPER_COLLECTION_ID = "demo:emberguard-armor"
$env:ASSET_MAPPER_TOKEN_REFERENCE = "emberguard-heavy-armor-1"
$env:ASSET_MAPPER_METADATA_URL = "https://raw.githubusercontent.com/Leokings/genlayer-ic-public-fixtures/534a1d95bcc280277626612582275f7479efa286/fixtures/metadata/emberguard-heavy-armor-compact.json"
$env:ASSET_MAPPER_METADATA_SHA256 = "55387d76d0299d95bbe74d4880d98dc9904870fa458470c87572dbceab6fac0b"
$env:ASSET_MAPPER_IMAGE_URL = "https://raw.githubusercontent.com/Leokings/genlayer-ic-public-fixtures/d22e122aac62ac138e5056be53177e8bcceddd5d/fixtures/assets/emberguard-heavy-armor-compact.png"
$env:ASSET_MAPPER_IMAGE_SHA256 = "c86aefbd3140da84536192d5518c59dfaf2ef56ae7595825db934e4b94768fcb"
$env:ASSET_MAPPER_EXPECTED_STATUS = "MAPPED"
$env:ASSET_MAPPER_EXPECTED_REASON = "ASSET_ADMITTED_AND_MAPPED"
$env:ASSET_MAPPER_EXPECTED_PROFILE = "EMBERGUARD_HEAVY_ARMOR_FIRE_R3_P2"
$env:ASSET_MAPPER_EXPECTED_CLASS = "HEAVY_ARMOR"
$env:ASSET_MAPPER_EXPECTED_ELEMENT = "FIRE"
$env:ASSET_MAPPER_EXPECTED_RARITY = "3"
$env:ASSET_MAPPER_EXPECTED_POWER = "2"
genlayer network set testnet-bradbury
genlayer deploy
```

The CLI loads `deploy/001_deploy_and_verify.js` with its configured Bradbury
client. The JavaScript release harness is distinct from the portable Python
StudioNet harness. It is intentionally Bradbury-only and requires the exact
chain name, chain ID, and official RPC URL.

Bradbury's outer EVM chain ID is `4221`; the ID visible to this contract as
`gl.message.chain_id` inside GenVM is `1`. The harness requires
`ASSET_MAPPER_EXPECTED_GENVM_CHAIN_ID=1`, checkpoints the two identities in
separate `evm_chain_id` and `genvm_chain_id` fields, and uses only the GenVM ID
when independently recomputing the contract's asset, request, and result
digests. A missing or mismatched identity invalidates the checkpoint.

The Bradbury release policy is not a configurable proof input. Its environment
value must be byte-for-byte identical to committed `examples/live-policy.json`,
including the final newline (SHA-256
`ec72aa8b0391432a2e2f5d613e4fd767e3225693526775d5565e32e2a2bd9df0`).
The harness verifies the exact contract, policy, and JavaScript harness Git
objects at `ASSET_MAPPER_SOURCE_COMMIT`, requires that commit to be checked-out
HEAD with a clean tracked working tree, and permits exactly the documented Emberguard
policy ID/version/admission rules, one source binding, and one trait profile.

The release harness checks both remote fixture byte commitments before any
on-chain transaction. Before deployment and mapping broadcasts it atomically
writes a durable intent record. A captured transaction hash is checkpointed
before receipt/finality waits. If a process stops after intent but before the
hash is captured, it refuses to submit again: recover the original hash or use
a fresh output/deployment. It never accepts arbitrary receipt JSON, a global
record count, or an unrelated prior mapping as creation proof.

On resume, use the same output file. The script prints these values as they
become available; they may also be supplied explicitly after independent
recovery:

```text
ASSET_MAPPER_DEPLOYMENT_TX
ASSET_MAPPER_CONTRACT_ADDRESS
ASSET_MAPPER_DEPLOYMENT_FINALIZATION_EVM_TX
ASSET_MAPPER_MAPPING_TX
ASSET_MAPPER_MAPPING_FINALIZATION_EVM_TX
```

Every supplied hash must agree with the checkpoint. The finalization hashes are
verified against the Bradbury consensus contract, exact
`finalizeTransaction(genlayerTxId)` calldata, and successful EVM receipts. A
custom lifecycle poll accepts a resumed transaction already at `ACCEPTED`,
`READY_TO_FINALIZE`, or `FINALIZED`, but applies the same positive execution,
consensus, quorum, and vote checks before using it. If another account finalized
the transaction, the harness recovers exactly one
`TransactionFinalized(bytes32)` log, then verifies its emitting contract,
indexed GenLayer transaction ID, EVM transaction target/calldata, successful
receipt, and unique matching receipt log. Missing, malformed, duplicate, or
reverted finalization evidence is rejected.

The proof becomes `COMPLETE` only after decoded deployment source/constructor
arguments and decoded `map_asset` target/method/arguments/sender are exact, the
mapping ID is recovered from that transaction's return receipt or execution
trace, the immutable policy/digests match independently computed values, all
lookup indexes agree, and the same exact `MAPPED` record is re-read through
`latest-final`.

The harness refuses a mismatch between `ASSET_MAPPER_DEPLOY_NETWORK` and the actual `--network`. It waits for `FINALIZED`, separately checks execution, validates the exact persisted result, and records complete receipts plus discovered validator/vote/consensus fields.

It writes a deployment checkpoint before broadcasting the semantic smoke and refuses to overwrite an existing record. Only a record already marked `COMPLETE` can be re-verified by setting `ASSET_MAPPER_RESUME=1`. Interrupted or evidence-incomplete checkpoints cannot be resumed, supplied with arbitrary recovery JSON, or resubmitted by the harness: preserve them for audit and use a new output path and fresh deployment. This deliberately trades recovery convenience for fail-closed proof provenance. A record becomes `COMPLETE` only when both receipts are explicitly `FINALIZED`, prove successful execution, contain transaction identifiers, expose nonempty validator and vote data, and the exact stored mapping and global asset lookup match the configured fixture.

Review the local proof, verify the address and transactions independently in the explorer, then copy it to a reviewed non-`.local.json` deployment record before committing.

`ACCEPTED` and `FINALIZED` lifecycle labels alone do not prove execution succeeded. Do not claim a Bradbury deployment while `deployments/bradbury-template.json` still contains placeholders.
