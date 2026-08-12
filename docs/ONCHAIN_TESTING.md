# On-chain testing and deployment proof

## Local gate

```powershell
python -m pip install -r requirements.txt
genvm-lint check contracts\ConsensusAssetAdmissionTraitMapper.py --json
genvm-lint typecheck contracts\ConsensusAssetAdmissionTraitMapper.py --json
genvm-lint schema contracts\ConsensusAssetAdmissionTraitMapper.py --json
pytest tests\direct -q
```

## Exact public fixture

Host real metadata and a valid PNG/JPEG/WebP at immutable URLs. The policy's collection entry must bind the exact metadata and image hostnames and path prefixes. Compute SHA-256 over the exact response bytes; content encoding, formatting, or metadata changes alter the commitment.

Set every variable in `.env.example`. Replace all placeholders. `ASSET_MAPPER_SOURCE_COMMIT` must be the full 40-character commit containing the deployed source. The release smoke deliberately requires one exact `MAPPED` profile and all derived traits.

The repository includes a prepared immutable metadata fixture at:

```text
https://raw.githubusercontent.com/Leokings/genlayer-ic-public-fixtures/225251710d96fa4349c3c5d98ea6b6873ee1959e/fixtures/metadata/emberguard-heavy-armor.json
```

Its exact SHA-256 is `a23e88a1f7253928a073f5f16534bf70ebbd7029a1e702b17914c05432e2f27d`. GitHub Raw serves this strict JSON file as `text/plain`; V2 accepts that MIME only as a transport container after exact digest verification, then applies the same strict JSON, identity, source-prefix, and image-URL checks. The metadata binds this independently pinned image:

```text
https://raw.githubusercontent.com/Leokings/genlayer-ic-public-fixtures/c5a1fb7503d2af3e3ec7dfae47830940f6ab9cd5/fixtures/assets/emberguard-heavy-armor.png
```

The exact image SHA-256 is `fdcf0cc4742d841a94514c629ce9f46466a6588f8880c695832fcc25bf6c2f9c` over 402,248 bytes. Both URLs are commit-pinned; compute and independently verify both response digests immediately before the run.

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
$env:ASSET_MAPPER_DEPLOY_OUTPUT = "deployments/bradbury-smoke.local.json"
gltest deploy\001_deploy_and_smoke.py -v -s --network testnet_bradbury
```

The harness refuses a mismatch between `ASSET_MAPPER_DEPLOY_NETWORK` and the actual `--network`. It waits for `FINALIZED`, separately checks execution, validates the exact persisted result, and records complete receipts plus discovered validator/vote/consensus fields.

It writes a deployment checkpoint before broadcasting the semantic smoke and refuses to overwrite an existing record. Only a record already marked `COMPLETE` can be re-verified by setting `ASSET_MAPPER_RESUME=1`. Interrupted or evidence-incomplete checkpoints cannot be resumed, supplied with arbitrary recovery JSON, or resubmitted by the harness: preserve them for audit and use a new output path and fresh deployment. This deliberately trades recovery convenience for fail-closed proof provenance. A record becomes `COMPLETE` only when both receipts are explicitly `FINALIZED`, prove successful execution, contain transaction identifiers, expose nonempty validator and vote data, and the exact stored mapping and global asset lookup match the configured fixture.

Review the local proof, verify the address and transactions independently in the explorer, then copy it to a reviewed non-`.local.json` deployment record before committing.

`ACCEPTED` and `FINALIZED` lifecycle labels alone do not prove execution succeeded. Do not claim a Bradbury deployment while `deployments/bradbury-template.json` still contains placeholders.
