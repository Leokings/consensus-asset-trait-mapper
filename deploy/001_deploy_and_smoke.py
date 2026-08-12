"""Deploy, finalize, smoke-test, and checkpoint reproducible proof.

Run from the repository root with the ASSET_MAPPER_* variables documented in
docs/ONCHAIN_TESTING.md. The selected gltest network must match the declared
network. The harness will not overwrite or blindly replay a checkpoint.
"""

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path

from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded
from gltest.types import TransactionStatus
from gltest.utils import extract_contract_address
from gltest_cli.config.general import get_general_config


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "contracts" / "ConsensusAssetAdmissionTraitMapper.py"
PORTABLE_DEPLOYMENT_INPUT_LIMIT = 50_000
POLICY_FIELDS = {
    "admission_rules",
    "class_power_caps",
    "collection_sources",
    "max_power_tier",
    "max_rarity_tier",
    "policy_id",
    "policy_version",
    "trait_profiles",
}
PLACEHOLDER_MARKERS = (
    "PLACEHOLDER",
    "REPLACE_WITH",
    "EXACT_HOST",
    "FULL_40_CHARACTER",
    "SHA256_HEX",
)


def _required(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise AssertionError(f"{name} is required")
    upper = value.upper()
    if upper in {"TODO", "TBD", "NOT_RUN"} or any(marker in upper for marker in PLACEHOLDER_MARKERS):
        raise AssertionError(f"{name} contains a placeholder")
    return value


def _reject_duplicate_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _reject_nonfinite(value):
    raise ValueError(f"non-finite JSON value: {value}")


def _strict_json(value):
    return json.loads(
        value,
        object_pairs_hook=_reject_duplicate_pairs,
        parse_constant=_reject_nonfinite,
    )


def _json_safe(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, bytes):
        return "0x" + value.hex()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if hasattr(value, "to_dict"):
        return _json_safe(value.to_dict())
    if hasattr(value, "__dict__"):
        return _json_safe(vars(value))
    return str(value)


def _consensus_evidence(value, path="receipt"):
    def has_payload(item):
        if isinstance(item, str):
            return len(item.strip()) > 0
        if isinstance(item, dict):
            return any(has_payload(child) for child in item.values())
        if isinstance(item, (list, tuple)):
            return any(has_payload(child) for child in item)
        if isinstance(item, int) and not isinstance(item, bool):
            return item > 0
        return False

    found = {}
    if isinstance(value, dict):
        for key, item in value.items():
            child_path = f"{path}.{key}"
            lowered = str(key).lower()
            is_vote_data = lowered == "vote" or lowered == "votes"
            is_validator_data = lowered in {
                "validators",
                "validator_addresses",
                "validator_receipts",
            }
            if (is_vote_data or is_validator_data) and has_payload(item):
                found[child_path] = _json_safe(item)
            found.update(_consensus_evidence(item, child_path))
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            found.update(_consensus_evidence(item, f"{path}[{index}]"))
    return found


def _has_actual_consensus_evidence(evidence):
    paths = [path.lower() for path in evidence]
    has_vote_data = any(".vote" in path for path in paths)
    has_validator_data = any(
        ".validators" in path
        or ".validator_addresses" in path
        or ".validator_receipts" in path
        for path in paths
    )
    return has_vote_data and has_validator_data


def _transaction_identifiers(value):
    result = []
    accepted = {"transaction_hash", "transaction_id", "tx_hash", "tx_id", "hash"}

    def visit(item, path):
        if isinstance(item, dict):
            for key, child in item.items():
                child_path = f"{path}.{key}" if path else str(key)
                if str(key).lower() in accepted and isinstance(child, str):
                    normalized = child.lower()
                    if normalized.startswith("0x") and len(normalized) == 66:
                        candidate = {"path": child_path, "value": normalized}
                        if candidate not in result:
                            result.append(candidate)
                visit(child, child_path)
        elif isinstance(item, (list, tuple)):
            for index, child in enumerate(item):
                visit(child, f"{path}[{index}]")

    visit(value, "")
    return result


def _assert_finalized_successful_receipt(receipt, label):
    if not isinstance(receipt, dict):
        raise AssertionError(f"{label} receipt must be an object")
    status = receipt.get("status_name", receipt.get("status", ""))
    status_text = str(status).strip().upper()
    if status_text != "FINALIZED" and not status_text.endswith(".FINALIZED"):
        raise AssertionError(f"{label} receipt is not explicitly FINALIZED")
    if not tx_execution_succeeded(receipt):
        raise AssertionError(f"{label} receipt does not prove successful execution")
    identifiers = _transaction_identifiers(receipt)
    if not identifiers:
        raise AssertionError(f"{label} receipt contains no transaction identifier")
    return identifiers


def _output_path(network):
    configured = os.environ.get(
        "ASSET_MAPPER_DEPLOY_OUTPUT",
        f"deployments/{network}-smoke.local.json",
    )
    candidate = (ROOT / configured).resolve()
    expected_parent = (ROOT / "deployments").resolve()
    if candidate.parent != expected_parent or candidate.suffix.lower() != ".json":
        raise AssertionError("ASSET_MAPPER_DEPLOY_OUTPUT must be a JSON file directly in deployments/")
    return candidate


def _atomic_write_json(path, value):
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def _source_commit():
    value = _required("ASSET_MAPPER_SOURCE_COMMIT")
    if len(value) != 40 or value.lower() != value or any(character not in "0123456789abcdef" for character in value):
        raise AssertionError("ASSET_MAPPER_SOURCE_COMMIT must be a full lowercase 40-character Git commit")
    return value


def _fixture():
    return {
        "request_id": _required("ASSET_MAPPER_REQUEST_ID"),
        "collection_id": _required("ASSET_MAPPER_COLLECTION_ID"),
        "token_reference": _required("ASSET_MAPPER_TOKEN_REFERENCE"),
        "metadata_url": _required("ASSET_MAPPER_METADATA_URL"),
        "metadata_sha256": _required("ASSET_MAPPER_METADATA_SHA256").lower(),
        "image_url": _required("ASSET_MAPPER_IMAGE_URL"),
        "image_sha256": _required("ASSET_MAPPER_IMAGE_SHA256").lower(),
    }


def _expected():
    expected = {
        "status": _required("ASSET_MAPPER_EXPECTED_STATUS"),
        "reason_code": _required("ASSET_MAPPER_EXPECTED_REASON"),
        "profile_id": _required("ASSET_MAPPER_EXPECTED_PROFILE"),
        "class_id": _required("ASSET_MAPPER_EXPECTED_CLASS"),
        "element_id": _required("ASSET_MAPPER_EXPECTED_ELEMENT"),
        "rarity_tier": int(_required("ASSET_MAPPER_EXPECTED_RARITY")),
        "power_tier": int(_required("ASSET_MAPPER_EXPECTED_POWER")),
    }
    if expected["status"] != "MAPPED" or expected["reason_code"] != "ASSET_ADMITTED_AND_MAPPED":
        raise AssertionError("The release smoke must prove one exact MAPPED profile")
    if expected["rarity_tier"] < 1 or expected["power_tier"] < 1:
        raise AssertionError("Mapped release-smoke tiers must be positive")
    return expected


def _assert_exact_result(record, fixture, expected):
    for key, expected_value in expected.items():
        if record.get(key) != expected_value:
            raise AssertionError(f"Exact result mismatch for {key}: {record.get(key)!r} != {expected_value!r}")
    bindings = {
        "request_id": fixture["request_id"],
        "collection_id": fixture["collection_id"],
        "token_reference": fixture["token_reference"],
        "metadata_url": fixture["metadata_url"],
        "metadata_sha256": fixture["metadata_sha256"],
        "image_url": fixture["image_url"],
        "image_sha256": fixture["image_sha256"],
    }
    for key, expected_value in bindings.items():
        if record.get(key) != expected_value:
            raise AssertionError(f"Persisted fixture mismatch for {key}")
    for digest_field in ("asset_digest", "request_digest", "result_digest"):
        digest = record.get(digest_field, "")
        if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
            raise AssertionError(f"Persisted {digest_field} is not a canonical digest")


def _assert_resume_record(record, network, chain_id, source_commit, source_sha256, policy_input_sha256, fixture, expected):
    checks = {
        "project": "consensus-asset-trait-mapper",
        "network": network,
        "chain_id": chain_id,
        "source_commit": source_commit,
        "source_sha256": source_sha256,
        "policy_input_sha256": policy_input_sha256,
        "fixture": fixture,
        "expected_result": expected,
    }
    for key, value in checks.items():
        if record.get(key) != value:
            raise AssertionError(f"Existing checkpoint does not match current {key}")


def test_deploy_and_smoke_finalized():
    general = get_general_config()
    actual_network = general.get_network_name()
    configured_network = _required("ASSET_MAPPER_DEPLOY_NETWORK")
    if configured_network != actual_network:
        raise AssertionError(
            "ASSET_MAPPER_DEPLOY_NETWORK does not match gltest --network: "
            f"{configured_network!r} != {actual_network!r}"
        )
    chain_id = int(general.get_chain().id)
    source_commit = _source_commit()
    policy_json = _required("ASSET_MAPPER_POLICY_JSON")
    parsed_policy = _strict_json(policy_json)
    if not isinstance(parsed_policy, dict) or set(parsed_policy) != POLICY_FIELDS:
        raise AssertionError("ASSET_MAPPER_POLICY_JSON must be a complete V2 policy")
    fixture = _fixture()
    expected = _expected()

    source = CONTRACT_PATH.read_text(encoding="utf-8")
    source_bytes = source.encode("utf-8")
    source_sha256 = hashlib.sha256(source_bytes).hexdigest()
    policy_input_sha256 = hashlib.sha256(policy_json.encode("utf-8")).hexdigest()
    deployment_input_bytes = len(source_bytes) + len(policy_json.encode("utf-8"))
    if deployment_input_bytes > PORTABLE_DEPLOYMENT_INPUT_LIMIT:
        raise AssertionError(
            f"Source plus policy is {deployment_input_bytes} bytes; portable limit is {PORTABLE_DEPLOYMENT_INPUT_LIMIT}"
        )
    if not source.splitlines()[0].startswith('# { "Depends": "py-genlayer:'):
        raise AssertionError("Contract runner is not pinned")
    if "py-genlayer:test" in source or "py-genlayer:latest" in source:
        raise AssertionError("Contract uses a local-only runner alias")

    factory = get_contract_factory("ConsensusAssetAdmissionTraitMapper")
    output = _output_path(actual_network)
    output.parent.mkdir(parents=True, exist_ok=True)
    record = None
    if output.exists():
        if os.environ.get("ASSET_MAPPER_RESUME") != "1":
            raise AssertionError("Proof checkpoint exists; set ASSET_MAPPER_RESUME=1 only to re-verify a COMPLETE record")
        record = _strict_json(output.read_text(encoding="utf-8"))
        _assert_resume_record(
            record,
            actual_network,
            chain_id,
            source_commit,
            source_sha256,
            policy_input_sha256,
            fixture,
            expected,
        )
        if record.get("record_status") != "COMPLETE":
            raise AssertionError(
                "Interrupted proof checkpoints cannot be resumed safely. Inspect the existing deployment, "
                "preserve the incomplete record, and run a fresh deployment using a new output file."
            )
        contract = factory.build_contract(contract_address=record["contract_address"])
        policy = contract.get_policy().call()
        if _json_safe(policy) != record["policy"]:
            raise AssertionError("On-chain policy differs from the checkpoint")
        deployment_ids = _assert_finalized_successful_receipt(record.get("deployment_receipt"), "Deployment")
        mapping_ids = _assert_finalized_successful_receipt(record.get("mapping_receipt"), "Mapping")
        if deployment_ids != record.get("deployment_transaction_identifiers"):
            raise AssertionError("Deployment transaction identifiers differ from the completed proof")
        if mapping_ids != record.get("mapping_transaction_identifiers"):
            raise AssertionError("Mapping transaction identifiers differ from the completed proof")
        deployment_consensus = _consensus_evidence(record["deployment_receipt"])
        mapping_consensus = _consensus_evidence(record["mapping_receipt"])
        if not _has_actual_consensus_evidence(deployment_consensus):
            raise AssertionError("Completed proof lacks nonempty deployment validator/vote evidence")
        if not _has_actual_consensus_evidence(mapping_consensus):
            raise AssertionError("Completed proof lacks nonempty mapping validator/vote evidence")
        if deployment_consensus != record.get("deployment_consensus_evidence"):
            raise AssertionError("Deployment consensus evidence differs from the completed proof")
        if mapping_consensus != record.get("mapping_consensus_evidence"):
            raise AssertionError("Mapping consensus evidence differs from the completed proof")
        persisted = contract.get_mapping(args=[record["mapping_id"]]).call()
        _assert_exact_result(persisted, fixture, expected)
        if contract.get_mapping_by_asset(
            args=[fixture["collection_id"], fixture["token_reference"]]
        ).call() != persisted:
            raise AssertionError("Global asset lookup differs from the completed proof")
        if _json_safe(persisted) != record["persisted_result"]:
            raise AssertionError("On-chain mapping differs from the completed proof")
        print(f"contract_address={contract.address}")
        print(f"deployment_proof={output}")
        return
    else:
        deployment_receipt = factory.deploy_contract_tx(
            args=[policy_json],
            wait_transaction_status=TransactionStatus.FINALIZED,
        )
        if not tx_execution_succeeded(deployment_receipt):
            raise AssertionError(f"Deployment execution failed: {deployment_receipt}")
        safe_deployment_receipt = _json_safe(deployment_receipt)
        deployment_transactions = _assert_finalized_successful_receipt(
            safe_deployment_receipt,
            "Deployment",
        )
        deployment_consensus = _consensus_evidence(safe_deployment_receipt)
        contract_address = extract_contract_address(deployment_receipt)
        contract = factory.build_contract(contract_address=contract_address)
        policy = contract.get_policy().call()
        record = {
            "schema_version": 2,
            "record_status": "DEPLOYMENT_FINALIZED_SMOKE_PENDING",
            "project": "consensus-asset-trait-mapper",
            "network": actual_network,
            "chain_id": chain_id,
            "recorded_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "contract_address": str(contract.address),
            "contract_version": policy["contract_version"],
            "policy_schema": policy["policy_schema"],
            "policy_digest": policy["policy_digest"],
            "policy_json": policy["policy_json"],
            "policy": _json_safe(policy),
            "policy_input_sha256": policy_input_sha256,
            "source_commit": source_commit,
            "source_sha256": source_sha256,
            "runner_dependency": source.splitlines()[0],
            "deployment_input_bytes": deployment_input_bytes,
            "deployment_receipt": safe_deployment_receipt,
            "deployment_transaction_identifiers": deployment_transactions,
            "deployment_consensus_evidence": deployment_consensus,
            "fixture": fixture,
            "expected_result": expected,
            "mapping_id": 0,
            "mapping_receipt": {},
            "mapping_transaction_identifiers": [],
            "mapping_consensus_evidence": {},
            "persisted_result": {},
            "limitations": [
                "Collection authenticity is bounded to immutable exact source host/path bindings; it is not ownership proof.",
                "GenVM does not expose the final destination of HTTP redirects.",
                "Vision consensus remains subject to correlated model error and appeal/finality behavior.",
            ],
        }
        _atomic_write_json(output, record)
        if not _has_actual_consensus_evidence(deployment_consensus):
            record["record_status"] = "DEPLOYMENT_FINALIZED_CONSENSUS_EVIDENCE_MISSING"
            _atomic_write_json(output, record)
            raise AssertionError(
                "The finalized deployment receipt lacks nonempty validator/vote evidence. The fail-closed "
                "checkpoint cannot be resumed; preserve it and use a fresh output/deployment after fixing receipt capture."
            )

    if record is None:
        raise AssertionError("Missing deployment checkpoint")
    if policy["contract_version"] != "2.0.0" or policy["policy_schema"] != "CONSENSUS_ASSET_ADMISSION_TRAIT_MAPPING_V2":
        raise AssertionError("Unexpected deployed contract version or policy schema")
    if policy["policy_digest"] != record["policy_digest"] or policy["policy_json"] != record["policy_json"]:
        raise AssertionError("On-chain immutable policy differs from checkpoint")

    if contract.get_mapping_count().call() != 0:
        raise AssertionError("Fresh proof deployment unexpectedly contains a mapping record")
    mapping_receipt = contract.map_asset(
        args=[
            fixture["request_id"],
            fixture["collection_id"],
            fixture["token_reference"],
            fixture["metadata_url"],
            fixture["metadata_sha256"],
            fixture["image_url"],
            fixture["image_sha256"],
        ]
    ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    if not tx_execution_succeeded(mapping_receipt):
        raise AssertionError(f"Mapping execution failed: {mapping_receipt}")
    safe_mapping_receipt = _json_safe(mapping_receipt)
    mapping_transactions = _assert_finalized_successful_receipt(safe_mapping_receipt, "Mapping")
    mapping_consensus = _consensus_evidence(safe_mapping_receipt)
    persisted = contract.get_mapping(args=[1]).call()
    _assert_exact_result(persisted, fixture, expected)
    by_asset = contract.get_mapping_by_asset(
        args=[fixture["collection_id"], fixture["token_reference"]]
    ).call()
    if by_asset != persisted:
        raise AssertionError("Global asset lookup differs from the finalized mapping record")
    if contract.get_mapping_count().call() != 1:
        raise AssertionError("Unexpected mapping count after the exact smoke")

    record["record_status"] = (
        "COMPLETE"
        if _has_actual_consensus_evidence(mapping_consensus)
        else "FINALIZED_EXECUTION_VERIFIED_CONSENSUS_EVIDENCE_MISSING"
    )
    record["recorded_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    record["mapping_id"] = 1
    record["mapping_receipt"] = safe_mapping_receipt
    record["mapping_transaction_identifiers"] = mapping_transactions
    record["mapping_consensus_evidence"] = mapping_consensus
    record["persisted_result"] = _json_safe(persisted)
    _atomic_write_json(output, record)
    if not _has_actual_consensus_evidence(mapping_consensus):
        raise AssertionError(
            "The finalized mapping receipt exposed no nonempty validator/vote evidence. The fail-closed "
            "checkpoint records verified execution but cannot be resumed or published as COMPLETE."
        )
    print(f"contract_address={contract.address}")
    print(f"deployment_proof={output}")
