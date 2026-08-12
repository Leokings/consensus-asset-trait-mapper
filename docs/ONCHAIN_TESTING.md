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
https://gist.githubusercontent.com/Leokings/b61f3173ee0c04183e35682f353d2605/raw/289239399f6941b2c11f7ba5b4c045018fe7f733/live-metadata.json
```

Its exact SHA-256 is `1918ccd13ec9bada556c95099687d410a32ef9df85b9a29d6c6c8c93f32082bf`. The metadata binds the commit-pinned Python-emblem image URL in `examples/live-metadata.json`; compute and independently verify the image response digest immediately before the run.

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

It writes a deployment checkpoint before broadcasting the semantic smoke. It refuses to overwrite an existing record or blindly replay an uncertain transaction. To inspect or continue a checkpoint, set `ASSET_MAPPER_RESUME=1`. If mapping count remains zero, inspect the network first and set `ASSET_MAPPER_RESUME_SUBMIT=1` only when resubmission is safe. If state advanced but the process lost its receipt, supply the complete explorer receipt as `ASSET_MAPPER_RESUME_MAPPING_RECEIPT_JSON`; a bare transaction hash is not accepted as full proof. A record cannot become `COMPLETE` unless the mapping receipt exposes validator, vote, or consensus evidence; an execution-only checkpoint is preserved with an explicit incomplete status.

Review the local proof, verify the address and transactions independently in the explorer, then copy it to a reviewed non-`.local.json` deployment record before committing.

`ACCEPTED` and `FINALIZED` lifecycle labels alone do not prove execution succeeded. Do not claim a Bradbury deployment while `deployments/bradbury-template.json` still contains placeholders.
