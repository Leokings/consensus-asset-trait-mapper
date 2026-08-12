import ast
import json
from pathlib import Path
import runpy

import pytest


HARNESS_PATH = Path("deploy/001_deploy_and_smoke.py")
HARNESS = runpy.run_path(str(HARNESS_PATH))


def receipt(*, status="FINALIZED", validators=None, votes=None):
    consensus = {
        "leader_receipt": [{"execution_result": "SUCCESS"}],
        "validators": validators if validators is not None else [],
        "votes": votes if votes is not None else {},
    }
    return {
        "status_name": status,
        "tx_id": "0x" + "11" * 32,
        "consensus_data": consensus,
    }


def test_empty_or_summary_only_consensus_is_not_publication_evidence():
    empty = HARNESS["_consensus_evidence"]({"consensus": {}})
    summary_only = HARNESS["_consensus_evidence"](
        {"consensus_data": {"validator_result_hash": "0x1234", "votes_committed": 5}}
    )
    empty_nested = HARNESS["_consensus_evidence"](
        {"consensus_data": {"validators": [{}], "votes": {"0xabc": ""}}}
    )

    assert empty == {}
    assert HARNESS["_has_actual_consensus_evidence"](empty) is False
    assert HARNESS["_has_actual_consensus_evidence"](summary_only) is False
    assert HARNESS["_has_actual_consensus_evidence"](empty_nested) is False


def test_nonempty_validator_and_vote_data_is_required_and_preserved():
    value = receipt(
        validators=[{"address": "0xabc", "vote": "AGREE"}],
        votes={"0xabc": "AGREE"},
    )
    evidence = HARNESS["_consensus_evidence"](value)

    assert HARNESS["_has_actual_consensus_evidence"](evidence) is True
    assert evidence["receipt.consensus_data.validators"][0]["address"] == "0xabc"
    assert evidence["receipt.consensus_data.votes"]["0xabc"] == "AGREE"


def test_receipt_gate_requires_finality_success_and_transaction_identifier():
    value = receipt(
        validators=[{"address": "0xabc", "vote": "AGREE"}],
        votes={"0xabc": "AGREE"},
    )
    identifiers = HARNESS["_assert_finalized_successful_receipt"](value, "Mapping")
    assert identifiers == [{"path": "tx_id", "value": "0x" + "11" * 32}]

    with pytest.raises(AssertionError, match="not explicitly FINALIZED"):
        HARNESS["_assert_finalized_successful_receipt"](
            receipt(status="ACCEPTED"),
            "Mapping",
        )

    failed = receipt()
    failed["consensus_data"]["leader_receipt"][0]["execution_result"] = "ERROR"
    with pytest.raises(AssertionError, match="successful execution"):
        HARNESS["_assert_finalized_successful_receipt"](failed, "Mapping")


def test_harness_has_no_arbitrary_or_resubmission_recovery_inputs():
    source = HARNESS_PATH.read_text(encoding="utf-8")
    assert "ASSET_MAPPER_RESUME_MAPPING_RECEIPT_JSON" not in source
    assert "ASSET_MAPPER_RESUME_SUBMIT" not in source
    assert "Interrupted proof checkpoints cannot be resumed safely" in source


def test_fresh_deployment_uses_validated_actual_network():
    tree = ast.parse(HARNESS_PATH.read_text(encoding="utf-8"))
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "_deploy_contract"
    ]

    assert len(calls) == 1
    assert isinstance(calls[0].args[2], ast.Name)
    assert calls[0].args[2].id == "actual_network"


def test_deployment_size_matches_json_serialized_constructor():
    source_bytes = Path(
        "contracts/ConsensusAssetAdmissionTraitMapper.py"
    ).read_bytes()
    policy_json = Path("examples/live-policy.json").read_text(encoding="utf-8")
    constructor_args = json.dumps(
        [policy_json],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")

    measured = HARNESS["_deployment_input_size"](source_bytes, policy_json)

    assert measured == len(source_bytes) + len(constructor_args)
    assert measured == 48_670
    assert measured < HARNESS["PORTABLE_DEPLOYMENT_INPUT_LIMIT"]


def test_portable_deployment_ceiling_is_strict():
    check = HARNESS["_assert_portable_deployment_input_size"]

    assert check(49_999) is None
    with pytest.raises(AssertionError, match="portable ceiling is below 50000"):
        check(50_000)
    with pytest.raises(AssertionError, match="portable ceiling is below 50000"):
        check(50_001)
