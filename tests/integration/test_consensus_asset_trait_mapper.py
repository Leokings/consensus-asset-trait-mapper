import json
import os

import pytest
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded
from gltest.types import TransactionStatus


def _required(name):
    value = os.environ.get(name, "").strip()
    if not value:
        pytest.skip(f"Set {name} to run the live visual consensus test")
    upper = value.upper()
    markers = ("PLACEHOLDER", "REPLACE_WITH", "EXACT_HOST", "SHA256_HEX", "FULL_40_CHARACTER")
    if upper in {"TODO", "TBD"} or any(marker in upper for marker in markers):
        pytest.fail(f"{name} contains a placeholder")
    return value


@pytest.mark.semantic
def test_exact_live_asset_mapping_consensus_finalized():
    policy_json = _required("ASSET_MAPPER_POLICY_JSON")
    factory = get_contract_factory("ConsensusAssetAdmissionTraitMapper")
    contract = factory.deploy(
        args=[policy_json],
        wait_transaction_status=TransactionStatus.FINALIZED,
    )
    print(f"contract_address={contract.address}")

    receipt = contract.map_asset(
        args=[
            _required("ASSET_MAPPER_REQUEST_ID"),
            _required("ASSET_MAPPER_COLLECTION_ID"),
            _required("ASSET_MAPPER_TOKEN_REFERENCE"),
            _required("ASSET_MAPPER_METADATA_URL"),
            _required("ASSET_MAPPER_METADATA_SHA256"),
            _required("ASSET_MAPPER_IMAGE_URL"),
            _required("ASSET_MAPPER_IMAGE_SHA256"),
        ]
    ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    assert tx_execution_succeeded(receipt), receipt

    record = contract.get_mapping(args=[1]).call()
    expected = {
        "status": _required("ASSET_MAPPER_EXPECTED_STATUS"),
        "reason_code": _required("ASSET_MAPPER_EXPECTED_REASON"),
        "profile_id": _required("ASSET_MAPPER_EXPECTED_PROFILE"),
        "class_id": _required("ASSET_MAPPER_EXPECTED_CLASS"),
        "element_id": _required("ASSET_MAPPER_EXPECTED_ELEMENT"),
        "rarity_tier": int(_required("ASSET_MAPPER_EXPECTED_RARITY")),
        "power_tier": int(_required("ASSET_MAPPER_EXPECTED_POWER")),
    }
    assert expected["status"] == "MAPPED"
    assert expected["reason_code"] == "ASSET_ADMITTED_AND_MAPPED"
    for field, value in expected.items():
        assert record[field] == value
    assert record["collection_id"] == _required("ASSET_MAPPER_COLLECTION_ID")
    assert record["metadata_url"] == _required("ASSET_MAPPER_METADATA_URL")
    assert record["image_url"] == _required("ASSET_MAPPER_IMAGE_URL")
    assert record["metadata_sha256"] == _required("ASSET_MAPPER_METADATA_SHA256").lower()
    assert record["image_sha256"] == _required("ASSET_MAPPER_IMAGE_SHA256").lower()
    assert contract.get_mapping_by_asset(
        args=[
            _required("ASSET_MAPPER_COLLECTION_ID"),
            _required("ASSET_MAPPER_TOKEN_REFERENCE"),
        ]
    ).call() == record
    assert contract.get_mapping_by_request(
        args=[record["submitter"], _required("ASSET_MAPPER_REQUEST_ID")]
    ).call() == record
    assert len(record["asset_digest"]) == 64
    assert len(record["request_digest"]) == 64
    assert len(record["result_digest"]) == 64
    assert contract.get_mapping_count().call() == 1
    policy = contract.get_policy().call()
    assert policy["contract_version"] == "2.0.2"
    assert policy["policy_schema"] == "CONSENSUS_ASSET_ADMISSION_TRAIT_MAPPING_V2"
    assert json.loads(policy["policy_json"])["trait_profiles"]
    print(json.dumps({"mapping_id": 1, **expected}, sort_keys=True))
