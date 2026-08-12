import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { abi as genlayerAbi } from "genlayer-js";
import {
  InvalidInputRpcError,
  RpcRequestError,
  keccak256,
  stringToHex,
} from "viem";
import {
  assertExactRecord,
  assertPolicyFixture,
  canonicalJson,
  computeMappingDigests,
  computePolicyDigest,
  finalizationRecoveryStartBlock,
  finalizeWhenReady,
  isExactLookupAbsentError,
  recoverFinalizationEvmTransaction,
  redactRpc,
  returnedMappingId,
  submitExactMapping,
  traceMappingId,
  waitReceipt,
} from "../../deploy/001_deploy_and_verify.js";

const contract = readFileSync(
  new URL("../../contracts/ConsensusAssetAdmissionTraitMapper.py", import.meta.url),
  "utf8",
);
const deployment = readFileSync(
  new URL("../../deploy/001_deploy_and_verify.js", import.meta.url),
  "utf8",
);
const livePolicyBytes = readFileSync(
  new URL("../../examples/live-policy.json", import.meta.url),
);
const livePolicy = JSON.parse(livePolicyBytes.toString("utf8"));
const eventTopic = keccak256(
  stringToHex("TransactionFinalized(bytes32)"),
).toLowerCase();

const fixture = {
  request_id: "SMOKE-EMBERGUARD-001",
  collection_id: "demo:emberguard-armor",
  token_reference: "emberguard-heavy-armor-1",
  metadata_url:
    "https://raw.githubusercontent.com/Leokings/genlayer-ic-public-fixtures/534a1d95bcc280277626612582275f7479efa286/fixtures/metadata/emberguard-heavy-armor-compact.json",
  metadata_sha256: "a".repeat(64),
  image_url:
    "https://raw.githubusercontent.com/Leokings/genlayer-ic-public-fixtures/d22e122aac62ac138e5056be53177e8bcceddd5d/fixtures/assets/emberguard-heavy-armor-compact.png",
  image_sha256: "b".repeat(64),
};
const expected = {
  status: "MAPPED",
  reason_code: "ASSET_ADMITTED_AND_MAPPED",
  profile_id: "EMBERGUARD_HEAVY_ARMOR_FIRE_R3_P2",
  class_id: "HEAVY_ARMOR",
  element_id: "FIRE",
  rarity_tier: 3,
  power_tier: 2,
};

function positiveLifecycleReceipt(statusName) {
  return {
    statusName,
    resultName: statusName === "FINALIZED" ? "MAJORITY_AGREE" : "MAJORITY_AGREE",
    txExecutionResultName: "FINISHED_WITH_RETURN",
    lastRound: {
      round: 0,
      roundValidators: [
        `0x${"a".repeat(40)}`,
        `0x${"b".repeat(40)}`,
        `0x${"c".repeat(40)}`,
      ],
      validatorVotesName: ["AGREE", "AGREE", "AGREE"],
      votesRevealed: 3,
    },
    consensus_data: {
      leader_receipt: [{ execution_result: "FINISHED_WITH_RETURN" }],
      validators: [],
    },
  };
}

function finalizationArtifacts(transactionHash, evmHash, consensusAddress) {
  const log = {
    address: consensusAddress,
    transactionHash: evmHash,
    removed: false,
    topics: [eventTopic, transactionHash],
    data: "0x",
  };
  return {
    log,
    transaction: {
      hash: evmHash,
      to: consensusAddress,
      input: `0xb2efda83${transactionHash.slice(2)}`,
    },
    receipt: {
      transactionHash: evmHash,
      to: consensusAddress,
      status: "0x1",
      logs: [log],
    },
  };
}

function recoveryLifecycleReceipt(transactionHash, activationBlock = "0") {
  return {
    ...positiveLifecycleReceipt("FINALIZED"),
    txId: transactionHash,
    readStateBlockRange: { activationBlock },
  };
}

function userErrorEnvelope(message, overrides = {}) {
  const fingerprint = new Map([
    ["frames", [new Map([["func", 130n], ["module_name", "cpython"]])]],
    [
      "module_instances",
      new Map([
        ["cpython", new Map([["memories", [new Uint8Array(32)]]])],
        ["softfloat", new Map([["memories", [new Uint8Array(32)]]])],
      ]),
    ],
  ]);
  return new Map([
    ["data", overrides.data ?? message],
    ["events", overrides.events ?? []],
    ["fingerprint", overrides.fingerprint ?? fingerprint],
    ["kind", overrides.kind ?? "UserError"],
    ["storage_changes", overrides.storage_changes ?? []],
    ...(overrides.extra ? [["extra", overrides.extra]] : []),
  ]);
}

function goVmResultMessage(envelope, overrides = {}) {
  const bytes = Buffer.from(genlayerAbi.calldata.encode(envelope));
  const returnData = [...bytes]
    .map((byte) => `0x${byte.toString(16)}`)
    .join(", ");
  return (
    overrides.prefix ??
    `execution failed: &genvm.VMResult{Kind:${overrides.kind ?? "0x1"}, ReturnData:[]uint8{${returnData}}, ` +
      "Stdout:[]uint8(nil), Stderr:[]uint8(nil)}"
  );
}

function actualViemLookupError(envelope, overrides = {}) {
  const raw = new RpcRequestError({
    body: { method: "sim_call", params: [] },
    error: {
      code: overrides.code ?? -32000,
      message: goVmResultMessage(envelope, overrides),
    },
    url: "https://rpc.example",
  });
  return new InvalidInputRpcError(raw);
}

test("contract pins a production runner and live deployment stays below input budget", () => {
  const first = contract.split(/\r?\n/, 1)[0];
  assert.match(first, /^# \{ "Depends": "py-genlayer:[a-z0-9]+" \}$/);
  assert.doesNotMatch(first, /:(test|latest)"/);
  const policyInput = livePolicyBytes.toString("utf8");
  const bytes =
    Buffer.byteLength(contract, "utf8") +
    Buffer.byteLength(JSON.stringify([policyInput]), "utf8");
  assert.ok(bytes < 50_000, `live deployment is ${bytes} bytes`);
  assert.match(contract, /CONTRACT_VERSION = "2\.0\.2"/);
  assert.match(contract, /MAX_IMAGE_BYTES = 65536/);
  assert.match(deployment, /\["image\/png"\],\s*65_536/);
  assert.doesNotMatch(deployment, /image\/(jpeg|webp)/);
});

test("Bradbury harness checkpoints intent, verifies provenance, finality, and latest-final state", () => {
  for (const required of [
    "submission_intent_recorded",
    "durable submission intent",
    "assertDeploymentProvenance",
    "assertCallProvenance",
    "decoded_provenance",
    "decoded?.code !== code",
    "map_asset",
    "latest-final",
    "FINALIZATION_EVM_TX",
    "TransactionFinalized(bytes32)",
    "recoverFinalizationEvmTransaction",
    "verifyFinalizationEvmTransaction",
    "eth_getTransactionReceipt",
    "sourceCommit",
    "source_commit Git object",
    "examples/live-policy.json differs from the source_commit Git object",
    "ASSET_MAPPER_EXPECTED_GENVM_CHAIN_ID",
    "genvm_chain_id",
    "evm_chain_id",
    "Tracked working tree is dirty",
    "finalized_receipt",
    "votes_revealed",
    "deployment_evm_gas_ceiling_scope",
  ]) {
    assert.ok(deployment.includes(required), `missing ${required}`);
  }
  assert.ok(
    deployment.indexOf("submission_intent_recorded = true") <
      deployment.indexOf("client.writeContract"),
    "mapping intent must be persisted before broadcast",
  );
  assert.ok(
    deployment.includes("finally {\n    client.estimateTransactionGas = original;"),
    "deployment gas override must be restored",
  );
});

test("canonical policy and protocol digests are deterministic and sender bound", () => {
  const canonical = JSON.stringify(canonicalJson(livePolicy));
  assert.equal(computePolicyDigest(canonical).length, 64);
  const first = computeMappingDigests({
    genvmChainId: 1,
    contractAddress: `0x${"1".repeat(40)}`,
    sender: `0x${"2".repeat(40)}`,
    policyDigest: "3".repeat(64),
    fixture,
    expected,
  });
  const second = computeMappingDigests({
    genvmChainId: 1,
    contractAddress: `0x${"1".repeat(40)}`,
    sender: `0x${"4".repeat(40)}`,
    policyDigest: "3".repeat(64),
    fixture,
    expected,
  });
  assert.equal(first.asset_digest, second.asset_digest);
  assert.notEqual(first.request_digest, second.request_digest);
  assert.notEqual(first.result_digest, second.result_digest);
  assert.equal(first.asset_digest.length, 64);
  const wrongChain = computeMappingDigests({
    genvmChainId: 4221,
    contractAddress: `0x${"1".repeat(40)}`,
    sender: `0x${"2".repeat(40)}`,
    policyDigest: "3".repeat(64),
    fixture,
    expected,
  });
  assert.notEqual(first.asset_digest, wrongChain.asset_digest);
  assert.throws(
    () =>
      computeMappingDigests({
        contractAddress: `0x${"1".repeat(40)}`,
        sender: `0x${"2".repeat(40)}`,
        policyDigest: "3".repeat(64),
        fixture,
        expected,
      }),
    /GenVM chain ID/,
  );
});

test("live policy contains the exact closed fixture profile and source bindings", () => {
  assert.equal(
    createHash("sha256").update(livePolicyBytes).digest("hex"),
    "ec72aa8b0391432a2e2f5d613e4fd767e3225693526775d5565e32e2a2bd9df0",
  );
  assert.doesNotThrow(() => assertPolicyFixture(livePolicy, fixture, expected));
  assert.throws(
    () =>
      assertPolicyFixture(
        livePolicy,
        { ...fixture, image_url: "https://example.com/armor.png" },
        expected,
      ),
    /outside the exact collection source bindings/,
  );
  assert.throws(
    () =>
      assertPolicyFixture(
        { ...livePolicy, policy_version: "2" },
        fixture,
        expected,
      ),
    /exactly match the single-source, single-profile committed live policy/,
  );
  assert.throws(
    () =>
      assertPolicyFixture(
        {
          ...livePolicy,
          collection_sources: [
            ...livePolicy.collection_sources,
            { ...livePolicy.collection_sources[0], collection_id: "demo:decoy" },
          ],
        },
        fixture,
        expected,
      ),
    /single-source, single-profile/,
  );
  assert.throws(
    () =>
      assertPolicyFixture(
        {
          ...livePolicy,
          admission_rules: `${livePolicy.admission_rules} Changed.`,
        },
        fixture,
        expected,
      ),
    /single-source, single-profile/,
  );
});

test("transaction return value is the only accepted mapping-record association", () => {
  assert.equal(
    returnedMappingId({
      consensus_data: {
        leader_receipt: [
          { result: { status: "return", payload: { readable: "17" } } },
        ],
      },
    }),
    17,
  );
  assert.throws(
    () =>
      returnedMappingId({
        consensus_data: {
          leader_receipt: [
            { result: { status: "return", payload: { readable: "17" } } },
            { result: { status: "return", payload: { readable: "18" } } },
          ],
        },
      }),
    /consistent mapping ID/,
  );
  const traceHex = (value) =>
    `0x${Buffer.from(genlayerAbi.calldata.encode(value)).toString("hex")}`;
  const actualReturn = new Map([
    ["data", 17n],
    ["events", []],
    [
      "fingerprint",
      new Map([
        ["frames", []],
        ["module_instances", new Map()],
      ]),
    ],
    ["kind", "Return"],
    ["storage_changes", [[new Uint8Array([1]), new Uint8Array([2])]]],
  ]);
  assert.equal(
    traceMappingId({ result_code: 0, return_data: traceHex(actualReturn) }),
    17,
  );
  assert.throws(
    () => traceMappingId({ result_code: 1, return_data: traceHex(actualReturn) }),
    /did not finish with a return/,
  );
  assert.throws(
    () =>
      traceMappingId({ result_code: "0", return_data: traceHex(actualReturn) }),
    /did not finish with a return/,
  );
  assert.throws(
    () => traceMappingId({ result_code: 0, return_data: traceHex(17n) }),
    /exact GenVM Return envelope/,
  );
  const decoy = new Map(actualReturn);
  decoy.set("nested_decoy", new Map([["data", 999n]]));
  assert.throws(
    () => traceMappingId({ result_code: 0, return_data: traceHex(decoy) }),
    /exact GenVM Return envelope/,
  );
  const malformedFingerprint = new Map(actualReturn);
  malformedFingerprint.set(
    "fingerprint",
    new Map([
      ["frames", []],
      ["module_instances", new Map()],
      ["decoy", 1n],
    ]),
  );
  assert.throws(
    () =>
      traceMappingId({
        result_code: 0,
        return_data: traceHex(malformedFingerprint),
      }),
    /invalid GenVM Return envelope field types/,
  );
  const unsafe = new Map(actualReturn);
  unsafe.set("data", BigInt(Number.MAX_SAFE_INTEGER) + 1n);
  assert.throws(
    () => traceMappingId({ result_code: 0, return_data: traceHex(unsafe) }),
    /invalid positive safe-integer mapping ID/,
  );
});

test("exact record proof rejects a third-party sender", () => {
  const sender = `0x${"2".repeat(40)}`;
  const digests = computeMappingDigests({
    genvmChainId: 1,
    contractAddress: `0x${"1".repeat(40)}`,
    sender,
    policyDigest: "3".repeat(64),
    fixture,
    expected,
  });
  const record = {
    mapping_id: 1,
    submitter: `0x${"9".repeat(40)}`,
    ...fixture,
    ...expected,
    ...digests,
  };
  assert.throws(
    () => assertExactRecord(record, 1, fixture, expected, sender, digests),
    /Exact mapping mismatch for submitter/,
  );
});

test("resume lifecycle poll accepts ACCEPTED, READY, or FINALIZED with positive proof", async () => {
  for (const status of ["ACCEPTED", "READY_TO_FINALIZE", "FINALIZED"]) {
    const receipt = positiveLifecycleReceipt(status);
    const client = { getTransaction: async () => receipt };
    assert.equal(
      await waitReceipt(
        client,
        `0x${"1".repeat(64)}`,
        "ACCEPTED",
        `resume ${status}`,
        false,
        1,
        0,
      ),
      receipt,
    );
  }
  const negative = positiveLifecycleReceipt("READY_TO_FINALIZE");
  negative.resultName = "MAJORITY_DISAGREE";
  await assert.rejects(
    waitReceipt(
      { getTransaction: async () => negative },
      `0x${"1".repeat(64)}`,
      "ACCEPTED",
      "negative resume",
      false,
      1,
      0,
    ),
    /lacks positive consensus/,
  );
});

test("interrupted mapping intent fails closed before resubmission", async () => {
  let writes = 0;
  const client = {
    writeContract: async () => {
      writes += 1;
      return `0x${"5".repeat(64)}`;
    },
  };
  await assert.rejects(
    submitExactMapping(
      client,
      `0x${"6".repeat(40)}`,
      `0x${"7".repeat(40)}`,
      "8".repeat(64),
      fixture,
      expected,
      { semantic_smoke: { submission_intent_recorded: true } },
      "unused.json",
    ),
    /durable submission intent but no transaction hash/,
  );
  assert.equal(writes, 0);
});

test("finalization provenance failure is never suppressed after broadcast", async () => {
  const directory = mkdtempSync(join(tmpdir(), "asset-finality-"));
  const output = join(directory, "proof.json");
  const transactionHash = `0x${"1".repeat(64)}`;
  const evmHash = `0x${"2".repeat(64)}`;
  const consensusAddress = `0x${"3".repeat(40)}`;
  const artifacts = finalizationArtifacts(
    transactionHash,
    evmHash,
    consensusAddress,
  );
  const client = {
    chain: { id: 4221, consensusMainContract: { address: consensusAddress } },
    getTransaction: async () => ({ statusName: "READY_TO_FINALIZE" }),
    finalizeTransaction: async () => evmHash,
    request: async ({ method }) =>
      method === "eth_getTransactionByHash"
        ? {
            ...artifacts.transaction,
            to: `0x${"4".repeat(40)}`,
          }
        : artifacts.receipt,
  };
  const step = {};
  try {
    await assert.rejects(
      finalizeWhenReady(
        client,
        transactionHash,
        "Test",
        step,
        "ASSET_MAPPER_TEST_BAD",
        { test: step },
        output,
        1,
      ),
      /target or calldata mismatch/,
    );
    assert.equal(step.finalization_broadcast_transaction, evmHash);
    assert.equal(step.finalization_evm_transaction, undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a finalized transaction safely recovers one successful external finalizer", async () => {
  const directory = mkdtempSync(join(tmpdir(), "asset-recovery-"));
  const output = join(directory, "proof.json");
  const transactionHash = `0x${"1".repeat(64)}`;
  const evmHash = `0x${"2".repeat(64)}`;
  const consensusAddress = `0x${"3".repeat(40)}`;
  const artifacts = finalizationArtifacts(
    transactionHash,
    evmHash,
    consensusAddress,
  );
  const finalized = recoveryLifecycleReceipt(transactionHash);
  const client = {
    chain: { id: 4221, consensusMainContract: { address: consensusAddress } },
    getTransaction: async () => finalized,
    request: async ({ method }) => {
      if (method === "eth_blockNumber") return "0x0";
      if (method === "eth_getLogs") return [artifacts.log];
      if (method === "eth_getTransactionByHash") return artifacts.transaction;
      if (method === "eth_getTransactionReceipt") return artifacts.receipt;
      throw new Error(`Unexpected method ${method}`);
    },
  };
  const step = {};
  try {
    await finalizeWhenReady(
      client,
      transactionHash,
      "External finalization",
      step,
      "ASSET_MAPPER_TEST_EXTERNAL",
      { test: step },
      output,
      1,
    );
    assert.equal(step.finalization_evm_transaction, evmHash);
    assert.equal(step.finalization_recovered_from_event, true);
    assert.equal(step.finality_status, "FINALIZED");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("external finalizer recovery scans ranges above 10,000 blocks without gaps", async () => {
  const transactionHash = `0x${"1".repeat(64)}`;
  const evmHash = `0x${"2".repeat(64)}`;
  const consensusAddress = `0x${"3".repeat(40)}`;
  const artifacts = finalizationArtifacts(
    transactionHash,
    evmHash,
    consensusAddress,
  );
  const ranges = [];
  const client = {
    chain: { consensusMainContract: { address: consensusAddress } },
    getTransaction: async () => recoveryLifecycleReceipt(transactionHash, "10128"),
    request: async ({ method, params }) => {
      if (method === "eth_blockNumber") return "0x7530";
      if (method === "eth_getLogs") {
        const range = params[0];
        ranges.push([range.fromBlock, range.toBlock]);
        return range.fromBlock === "0x7530" ? [artifacts.log] : [];
      }
      if (method === "eth_getTransactionByHash") return artifacts.transaction;
      if (method === "eth_getTransactionReceipt") return artifacts.receipt;
      throw new Error(`Unexpected method ${method}`);
    },
  };

  assert.equal(
    await recoverFinalizationEvmTransaction(
      client,
      transactionHash,
      "Chunked",
      1,
      0,
    ),
    evmHash,
  );
  assert.deepEqual(ranges, [
    ["0x2710", "0x4e1f"],
    ["0x4e20", "0x752f"],
    ["0x7530", "0x7530"],
  ]);
  for (const [fromBlock, toBlock] of ranges) {
    assert.ok(BigInt(toBlock) - BigInt(fromBlock) + 1n <= 10_000n);
  }
});

test("external finalizer recovery includes both sides of a 10,000-block boundary", async () => {
  const transactionHash = `0x${"1".repeat(64)}`;
  const evmHash = `0x${"2".repeat(64)}`;
  const consensusAddress = `0x${"3".repeat(40)}`;
  const artifacts = finalizationArtifacts(
    transactionHash,
    evmHash,
    consensusAddress,
  );

  for (const eventBlock of [19_999n, 20_000n]) {
    const ranges = [];
    const client = {
      chain: { consensusMainContract: { address: consensusAddress } },
      getTransaction: async () => recoveryLifecycleReceipt(transactionHash, "10128"),
      request: async ({ method, params }) => {
        if (method === "eth_blockNumber") return "0x4e20";
        if (method === "eth_getLogs") {
          const range = params[0];
          ranges.push([range.fromBlock, range.toBlock]);
          return BigInt(range.fromBlock) <= eventBlock &&
            eventBlock <= BigInt(range.toBlock)
            ? [artifacts.log]
            : [];
        }
        if (method === "eth_getTransactionByHash") return artifacts.transaction;
        if (method === "eth_getTransactionReceipt") return artifacts.receipt;
        throw new Error(`Unexpected method ${method}`);
      },
    };

    assert.equal(
      await recoverFinalizationEvmTransaction(
        client,
        transactionHash,
        `Boundary ${eventBlock}`,
        1,
        0,
      ),
      evmHash,
    );
    assert.deepEqual(ranges, [
      ["0x2710", "0x4e1f"],
      ["0x4e20", "0x4e20"],
    ]);
  }
});

test("external finalizer recovery rejects duplicate and reverted event proofs", async () => {
  const transactionHash = `0x${"1".repeat(64)}`;
  const evmHash = `0x${"2".repeat(64)}`;
  const consensusAddress = `0x${"3".repeat(40)}`;
  const artifacts = finalizationArtifacts(
    transactionHash,
    evmHash,
    consensusAddress,
  );
  const duplicateClient = {
    chain: { consensusMainContract: { address: consensusAddress } },
    getTransaction: async () => recoveryLifecycleReceipt(transactionHash, "0"),
    request: async ({ method }) => {
      if (method === "eth_blockNumber") return "0x2710";
      if (method === "eth_getLogs") return [artifacts.log];
      throw new Error(`Unexpected method ${method}`);
    },
  };
  await assert.rejects(
    recoverFinalizationEvmTransaction(
      duplicateClient,
      transactionHash,
      "Duplicate",
      1,
      0,
    ),
    /duplicate TransactionFinalized logs/,
  );

  const revertedClient = {
    chain: { consensusMainContract: { address: consensusAddress } },
    getTransaction: async () => recoveryLifecycleReceipt(transactionHash, "0"),
    request: async ({ method }) => {
      if (method === "eth_blockNumber") return "0x0";
      if (method === "eth_getLogs") return [artifacts.log];
      if (method === "eth_getTransactionByHash") return artifacts.transaction;
      if (method === "eth_getTransactionReceipt") {
        return { ...artifacts.receipt, status: "0x0" };
      }
      throw new Error(`Unexpected method ${method}`);
    },
  };
  await assert.rejects(
    recoverFinalizationEvmTransaction(
      revertedClient,
      transactionHash,
      "Reverted",
      1,
      0,
    ),
    /reverted, or mismatched/,
  );
});

test("external finalizer recovery derives a hash-bound activation window", () => {
  const transactionHash = `0x${"1".repeat(64)}`;
  assert.equal(
    finalizationRecoveryStartBlock(
      {
        txId: transactionHash.toUpperCase().replace("0X", "0x"),
        readStateBlockRange: { activationBlock: "17299211" },
      },
      transactionHash,
    ),
    17299083n,
  );
  assert.equal(
    finalizationRecoveryStartBlock(
      {
        tx_id: transactionHash,
        read_state_block_range: { activation_block: 64 },
      },
      transactionHash,
    ),
    0n,
  );
});

test("external finalizer recovery rejects untrusted activation anchors", () => {
  const transactionHash = `0x${"1".repeat(64)}`;
  const valid = {
    txId: transactionHash,
    readStateBlockRange: { activationBlock: "17299211" },
  };
  for (const [transaction, expected] of [
    [{ ...valid, txId: `0x${"2".repeat(64)}` }, /identifier mismatch/],
    [{ readStateBlockRange: valid.readStateBlockRange }, /omitted its identifier/],
    [{ txId: transactionHash }, /omitted read-state activation block/],
    [
      { ...valid, readStateBlockRange: { activationBlock: "017299211" } },
      /not a canonical decimal block number/,
    ],
    [
      {
        ...valid,
        readStateBlockRange: {
          activationBlock: (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString(),
        },
      },
      /outside the safe block-number range/,
    ],
    [
      {
        ...valid,
        read_state_block_range: { activation_block: "17299212" },
      },
      /activation block aliases conflict/,
    ],
  ]) {
    assert.throws(
      () => finalizationRecoveryStartBlock(transaction, transactionHash),
      expected,
    );
  }
});

test("lookup preflight accepts exact typed UserErrors through the actual viem wrapper", () => {
  for (const [label, message] of [
    ["Request", "[EXPECTED] Unknown request_id"],
    ["Asset", "[EXPECTED] Asset has not been mapped"],
  ]) {
    assert.equal(
      isExactLookupAbsentError(
        actualViemLookupError(userErrorEnvelope(message)),
        label,
      ),
      true,
    );
    const encoded = Buffer.from(
      genlayerAbi.calldata.encode(userErrorEnvelope(message)),
    ).toString("hex");
    assert.equal(
      isExactLookupAbsentError(
        { cause: { code: -32000, message: "typed", data: `0x${encoded}` } },
        label,
      ),
      true,
    );
  }
});

test("lookup preflight rejects wrapper text and malformed or adversarial ReturnData", () => {
  const message = "[EXPECTED] Unknown request_id";
  const exact = userErrorEnvelope(message);
  const validMessage = goVmResultMessage(exact);
  const wrongFingerprint = new Map([
    ["frames", []],
    ["module_instances", new Map()],
    ["extra", 1n],
  ]);
  for (const candidate of [
    new Error(message),
    { code: -32000, message: `Missing or invalid parameters. Details: ${validMessage}` },
    actualViemLookupError(exact, { code: "-32000" }),
    actualViemLookupError(userErrorEnvelope(`${message}!`)),
    actualViemLookupError(userErrorEnvelope(message, { kind: "Return" })),
    actualViemLookupError(userErrorEnvelope(message, { events: [new Map()] })),
    actualViemLookupError(
      userErrorEnvelope(message, {
        storage_changes: [[new Uint8Array([1]), new Uint8Array([2])]],
      }),
    ),
    actualViemLookupError(userErrorEnvelope(message, { fingerprint: wrongFingerprint })),
    actualViemLookupError(userErrorEnvelope(message, { extra: "decoy" })),
    actualViemLookupError(exact, { kind: "0x0" }),
    actualViemLookupError(exact, { prefix: `${validMessage} ReturnData:decoy` }),
    { code: -32000, data: "not-hex", cause: actualViemLookupError(exact) },
  ]) {
    assert.equal(isExactLookupAbsentError(candidate, "Request"), false);
  }
  assert.equal(
    isExactLookupAbsentError(actualViemLookupError(exact), "Asset"),
    false,
  );
  assert.equal(
    isExactLookupAbsentError(actualViemLookupError(exact), "UnknownLabel"),
    false,
  );
});

test("RPC proof redaction removes credentials and path/query material", () => {
  assert.equal(
    redactRpc("https://user:secret@rpc.example.com/key?token=x"),
    "https://rpc.example.com",
  );
  assert.equal(redactRpc("not a url"), "REDACTED");
});
