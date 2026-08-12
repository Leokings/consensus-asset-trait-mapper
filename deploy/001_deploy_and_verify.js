import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { abi as genlayerAbi } from "genlayer-js";
import { keccak256, stringToHex } from "viem";

const CONTRACT_PATH = path.resolve(
  process.cwd(),
  "contracts",
  "ConsensusAssetAdmissionTraitMapper.py",
);
const LIVE_POLICY_PATH = path.resolve(
  process.cwd(),
  "examples",
  "live-policy.json",
);
const HARNESS_PATH = path.resolve(
  process.cwd(),
  "deploy",
  "001_deploy_and_verify.js",
);
const NETWORK = {
  chainId: 4221,
  name: "Genlayer Bradbury Testnet",
  rpc: "https://rpc-bradbury.genlayer.com",
};
const CONTRACT_VERSION = "2.0.1";
const POLICY_SCHEMA = "CONSENSUS_ASSET_ADMISSION_TRAIT_MAPPING_V2";
const DIGEST_DOMAIN = "GENLAYER_CONSENSUS_ASSET_ADMISSION_TRAIT_MAPPER";
const RUNNER = "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6";
const BRADBURY_DEPLOYMENT_EVM_GAS_LIMIT = 60_000_000n;
const FINALIZE_TRANSACTION_SELECTOR = "0xb2efda83";
const TRANSACTION_FINALIZED_EVENT_TOPIC = keccak256(
  stringToHex("TransactionFinalized(bytes32)"),
).toLowerCase();
const MAX_LOG_QUERY_BLOCKS = 10_000n;
const FINALIZATION_RECOVERY_REORG_MARGIN = 128n;
const MAX_SAFE_BLOCK_NUMBER = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_DEPLOYMENT_INPUT_BYTES = 50_000;
const EXPECTED_GENVM_CHAIN_ID = 1;
const LIVE_POLICY_SHA256 =
  "bc6ad57ad407259df3c76aa13d5116822810847eb4e17847ea69e5b24e863f9f";
const LIVE_ADMISSION_RULES =
  "Admit only a single clearly visible standalone dark heavy plate cuirass with a bright orange fire crystal mounted in the chest on a plain neutral background; reject characters, multiple objects, light armor, non-fire crystals, or unclear images.";
const LIVE_COLLECTION_SOURCE = Object.freeze({
  collection_id: "demo:emberguard-armor",
  image_domain: "raw.githubusercontent.com",
  image_path_prefix:
    "/Leokings/genlayer-ic-public-fixtures/c5a1fb7503d2af3e3ec7dfae47830940f6ab9cd5/fixtures/assets/",
  metadata_domain: "raw.githubusercontent.com",
  metadata_path_prefix:
    "/Leokings/genlayer-ic-public-fixtures/225251710d96fa4349c3c5d98ea6b6873ee1959e/fixtures/metadata/",
});
const LIVE_TRAIT_PROFILE = Object.freeze({
  class_id: "HEAVY_ARMOR",
  description:
    "A standalone dark heavy plate cuirass whose central chest setting contains a clearly visible bright orange fire crystal.",
  element_id: "FIRE",
  power_tier: 2,
  profile_id: "EMBERGUARD_HEAVY_ARMOR_FIRE_R3_P2",
  rarity_tier: 3,
});
const EXACT_LIVE_POLICY = Object.freeze({
  admission_rules: LIVE_ADMISSION_RULES,
  class_power_caps: { HEAVY_ARMOR: 2 },
  collection_sources: [LIVE_COLLECTION_SOURCE],
  max_power_tier: 2,
  max_rarity_tier: 3,
  policy_id: "EMBERGUARD-HEAVY-ARMOR-ADMISSION",
  policy_version: "1",
  trait_profiles: [LIVE_TRAIT_PROFILE],
});
const STATUS_NAMES = new Map([
  [5, "ACCEPTED"],
  [7, "FINALIZED"],
  [11, "READY_TO_FINALIZE"],
]);
const RESULT_NAMES = new Map([
  [1, "AGREE"],
  [6, "MAJORITY_AGREE"],
]);
const EXECUTION_NAMES = new Map([[1, "FINISHED_WITH_RETURN"]]);

function jsonString(value) {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === "bigint" ? item.toString() : item),
  );
}

function plainValue(value) {
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, item]) => [String(key), plainValue(item)]),
    );
  }
  if (Array.isArray(value)) return value.map((item) => plainValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, plainValue(item)]),
    );
  }
  return typeof value === "bigint" ? value.toString() : value;
}

function mapValue(value, key) {
  return value instanceof Map ? value.get(key) : value?.[key];
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalJson(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

export function redactRpc(value) {
  try {
    const url = new URL(String(value || ""));
    return `${url.protocol}//${url.host}`;
  } catch {
    return "REDACTED";
  }
}

function normalized(value, names) {
  if (typeof value === "number") return names.get(value) || String(value);
  if (typeof value === "bigint") {
    return names.get(Number(value)) || value.toString();
  }
  return String(value || "").trim().toUpperCase();
}

function assertHash(value, name) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(value || ""))) {
    throw new Error(`${name} is not a transaction hash`);
  }
}

function assertAddress(value, name) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(value || ""))) {
    throw new Error(`${name} is not an address`);
  }
}

function assertDigest(value, name) {
  if (!/^[0-9a-f]{64}$/.test(String(value || ""))) {
    throw new Error(`${name} is not canonical lowercase SHA-256/Keccak hex`);
  }
}

function receiptList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function executionSucceeded(value) {
  const result = normalized(value, EXECUTION_NAMES);
  return result === "FINISHED_WITH_RETURN" || result === "SUCCESS";
}

function assertValidatorQuorum(receipt, label) {
  const round = receipt?.lastRound || receipt?.last_round || {};
  const validators = round?.roundValidators || round?.round_validators || [];
  const voteNames = round?.validatorVotesName || round?.validator_votes_name || [];
  const votes = round?.validatorVotes || round?.validator_votes || [];
  const revealed = Number(round?.votesRevealed ?? round?.votes_revealed ?? 0);
  if (!Array.isArray(validators) || validators.length < 3) {
    throw new Error(`${label} did not expose a validator quorum`);
  }
  const positives = validators.reduce((count, _validator, index) => {
    const named = String(voteNames[index] || "").trim().toUpperCase();
    return count + (named === "AGREE" || Number(votes[index]) === 1 ? 1 : 0);
  }, 0);
  if (
    revealed < validators.length ||
    positives < Math.floor(validators.length / 2) + 1
  ) {
    throw new Error(
      `${label} lacked revealed majority agreement: ${jsonString(round)}`,
    );
  }
}

function assertPositiveReceipt(receipt, label, allowIdle = false) {
  const status = normalized(
    receipt?.statusName ?? receipt?.status_name ?? receipt?.status,
    STATUS_NAMES,
  );
  const result = normalized(
    receipt?.resultName ?? receipt?.result_name ?? receipt?.result,
    RESULT_NAMES,
  );
  const consensus = receipt?.consensus_data || {};
  const participants = [
    ...receiptList(consensus.leader_receipt),
    ...receiptList(consensus.validators),
  ];
  const execution =
    receipt?.txExecutionResultName ??
    receipt?.tx_execution_result_name ??
    receipt?.txExecutionResult ??
    participants[0]?.execution_result;
  const provisionalIdle =
    allowIdle &&
    ["ACCEPTED", "READY_TO_FINALIZE"].includes(status) &&
    result === "IDLE";
  if (!["ACCEPTED", "READY_TO_FINALIZE", "FINALIZED"].includes(status)) {
    throw new Error(`${label} has status ${status}`);
  }
  if (!["AGREE", "MAJORITY_AGREE"].includes(result) && !provisionalIdle) {
    throw new Error(`${label} lacks positive consensus`);
  }
  if (!executionSucceeded(execution)) {
    throw new Error(`${label} execution failed: ${jsonString(receipt)}`);
  }
  for (const participant of participants) {
    if (
      participant?.execution_result !== undefined &&
      !executionSucceeded(participant.execution_result)
    ) {
      throw new Error(`${label} participant execution failed`);
    }
  }
  assertValidatorQuorum(receipt, label);
}

function consensusSummary(receipt) {
  const consensus = receipt?.consensus_data || {};
  const round = receipt?.lastRound || receipt?.last_round || {};
  const validators = round?.roundValidators || round?.round_validators || [];
  const voteNames = round?.validatorVotesName || round?.validator_votes_name || [];
  const votes = round?.validatorVotes || round?.validator_votes || [];
  const resultHashes =
    round?.validatorResultHash || round?.validator_result_hash || [];
  let participants = [
    ...receiptList(consensus.leader_receipt),
    ...receiptList(consensus.validators),
  ].map((item) => ({
    address: item?.node_config?.address || null,
    execution: item?.execution_result ?? null,
    vote: item?.vote ?? null,
  }));
  if (!participants.length && Array.isArray(validators)) {
    participants = validators.map((address, index) => ({
      address,
      execution: null,
      vote: voteNames[index] ?? votes[index] ?? null,
      result_hash: resultHashes[index] ?? null,
    }));
  }
  return {
    status:
      receipt?.statusName ?? receipt?.status_name ?? receipt?.status ?? null,
    result:
      receipt?.resultName ?? receipt?.result_name ?? receipt?.result ?? null,
    execution:
      receipt?.txExecutionResultName ??
      receipt?.tx_execution_result_name ??
      receipt?.txExecutionResult ??
      null,
    round: round?.round ?? null,
    validators,
    votes: voteNames.length ? voteNames : votes,
    result_hashes: resultHashes,
    votes_committed: round?.votesCommitted ?? round?.votes_committed ?? null,
    votes_revealed: round?.votesRevealed ?? round?.votes_revealed ?? null,
    participants,
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function keccakText(value) {
  return keccak256(stringToHex(value)).slice(2);
}

function lengthFrame(value) {
  return `${Buffer.byteLength(value, "utf8")}:${value}`;
}

function protocolDigest(tag, parts) {
  return keccakText(
    [DIGEST_DOMAIN, tag, ...parts].map((item) => lengthFrame(String(item))).join(""),
  );
}

export function computePolicyDigest(canonicalPolicyJson) {
  return keccakText(`${POLICY_SCHEMA}:${canonicalPolicyJson}`);
}

export function computeMappingDigests({
  genvmChainId,
  contractAddress,
  sender,
  policyDigest,
  fixture,
  expected,
}) {
  const canonicalGenvmChainId = Number(genvmChainId);
  if (
    !Number.isSafeInteger(canonicalGenvmChainId) ||
    canonicalGenvmChainId <= 0
  ) {
    throw new Error("GenVM chain ID must be a positive safe integer");
  }
  const contract = String(contractAddress).toLowerCase();
  const submitter = String(sender).toLowerCase();
  assertAddress(contract, "contract address");
  assertAddress(submitter, "sender");
  assertDigest(policyDigest, "policy digest");
  const assetDigest = protocolDigest("ASSET", [
    String(canonicalGenvmChainId),
    contract,
    policyDigest,
    fixture.collection_id,
    fixture.token_reference,
  ]);
  const requestDigest = protocolDigest("REQUEST", [
    String(canonicalGenvmChainId),
    contract,
    submitter,
    policyDigest,
    fixture.request_id,
    fixture.collection_id,
    fixture.token_reference,
    fixture.metadata_url,
    fixture.metadata_sha256,
    fixture.image_url,
    fixture.image_sha256,
  ]);
  const resultDigest = protocolDigest("RESULT", [
    String(canonicalGenvmChainId),
    contract,
    submitter,
    policyDigest,
    assetDigest,
    requestDigest,
    expected.status,
    expected.reason_code,
    expected.profile_id,
    expected.class_id,
    expected.element_id,
    String(expected.rarity_tier),
    String(expected.power_tier),
  ]);
  return {
    asset_digest: assetDigest,
    request_digest: requestDigest,
    result_digest: resultDigest,
  };
}

function requiredEnvironment(names) {
  const missing = names.filter((name) => !String(process.env[name] || "").trim());
  if (missing.length) {
    throw new Error(`Missing required environment: ${missing.join(", ")}`);
  }
}

function requiredValue(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  const upper = value.toUpperCase();
  if (
    ["TODO", "TBD", "NOT_RUN"].includes(upper) ||
    ["PLACEHOLDER", "REPLACE_WITH", "EXACT_HOST", "SHA256_HEX", "FULL_40_CHARACTER"].some(
      (marker) => upper.includes(marker),
    )
  ) {
    throw new Error(`${name} contains a placeholder`);
  }
  return value;
}

function requiredRawValue(name) {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  const upper = value.trim().toUpperCase();
  if (
    ["TODO", "TBD", "NOT_RUN"].includes(upper) ||
    [
      "PLACEHOLDER",
      "REPLACE_WITH",
      "EXACT_HOST",
      "SHA256_HEX",
      "FULL_40_CHARACTER",
    ].some((marker) => upper.includes(marker))
  ) {
    throw new Error(`${name} contains a placeholder`);
  }
  return value;
}

function verifySourceCommit(
  sourceCommit,
  code,
  livePolicyBytes,
  harnessBytes,
) {
  let head;
  let committedSource;
  let committedPolicy;
  let committedHarness;
  let dirty;
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim().toLowerCase();
    committedSource = execFileSync(
      "git",
      ["show", `${sourceCommit}:contracts/ConsensusAssetAdmissionTraitMapper.py`],
      { cwd: process.cwd(), maxBuffer: 2_000_000 },
    );
    committedPolicy = execFileSync(
      "git",
      ["show", `${sourceCommit}:examples/live-policy.json`],
      { cwd: process.cwd(), maxBuffer: 2_000_000 },
    );
    committedHarness = execFileSync(
      "git",
      ["show", `${head}:deploy/001_deploy_and_verify.js`],
      { cwd: process.cwd(), maxBuffer: 2_000_000 },
    );
    execFileSync("git", ["merge-base", "--is-ancestor", sourceCommit, head], {
      cwd: process.cwd(),
      stdio: "ignore",
    });
    dirty = execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=no"],
      { cwd: process.cwd(), encoding: "utf8" },
    ).trim();
  } catch (error) {
    throw new Error(`Unable to verify the release source commit: ${String(error)}`);
  }
  if (!committedSource.equals(Buffer.from(code, "utf8"))) {
    throw new Error("Contract source differs from the source_commit Git object");
  }
  if (!committedPolicy.equals(livePolicyBytes)) {
    throw new Error(
      "examples/live-policy.json differs from the source_commit Git object",
    );
  }
  if (!committedHarness.equals(harnessBytes)) {
    throw new Error(
      "Bradbury proof harness differs from the checked-out proof-harness commit",
    );
  }
  if (dirty) {
    throw new Error(
      `Tracked working tree is dirty; commit the release before deployment: ${dirty}`,
    );
  }
  return head;
}

function parseJson(name, value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${String(error)}`);
  }
}

function canonicalIdentifier(value, name, maximum = 128) {
  const text = String(value || "");
  if (
    !text ||
    text.length > maximum ||
    text !== text.trim() ||
    !/^[A-Za-z0-9._:/-]+$/.test(text)
  ) {
    throw new Error(`${name} is not a canonical bounded identifier`);
  }
  return text;
}

function canonicalHttpsUrl(value, name) {
  const text = String(value || "");
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${name} is not a URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.hostname !== url.hostname.toLowerCase() ||
    url.href !== text
  ) {
    throw new Error(
      `${name} must be canonical HTTPS without credentials, port, query, or fragment`,
    );
  }
  return url;
}

function fixtureFromEnvironment() {
  const fixture = {
    request_id: canonicalIdentifier(requiredValue("ASSET_MAPPER_REQUEST_ID"), "request_id", 80),
    collection_id: canonicalIdentifier(requiredValue("ASSET_MAPPER_COLLECTION_ID"), "collection_id", 64),
    token_reference: canonicalIdentifier(requiredValue("ASSET_MAPPER_TOKEN_REFERENCE"), "token_reference", 128),
    metadata_url: requiredValue("ASSET_MAPPER_METADATA_URL"),
    metadata_sha256: requiredValue("ASSET_MAPPER_METADATA_SHA256").toLowerCase(),
    image_url: requiredValue("ASSET_MAPPER_IMAGE_URL"),
    image_sha256: requiredValue("ASSET_MAPPER_IMAGE_SHA256").toLowerCase(),
  };
  canonicalHttpsUrl(fixture.metadata_url, "metadata_url");
  canonicalHttpsUrl(fixture.image_url, "image_url");
  assertDigest(fixture.metadata_sha256, "metadata_sha256");
  assertDigest(fixture.image_sha256, "image_sha256");
  return fixture;
}

function expectedFromEnvironment() {
  const expected = {
    status: requiredValue("ASSET_MAPPER_EXPECTED_STATUS"),
    reason_code: requiredValue("ASSET_MAPPER_EXPECTED_REASON"),
    profile_id: canonicalIdentifier(requiredValue("ASSET_MAPPER_EXPECTED_PROFILE"), "profile_id", 64),
    class_id: canonicalIdentifier(requiredValue("ASSET_MAPPER_EXPECTED_CLASS"), "class_id", 64),
    element_id: canonicalIdentifier(requiredValue("ASSET_MAPPER_EXPECTED_ELEMENT"), "element_id", 64),
    rarity_tier: Number(requiredValue("ASSET_MAPPER_EXPECTED_RARITY")),
    power_tier: Number(requiredValue("ASSET_MAPPER_EXPECTED_POWER")),
  };
  if (
    expected.status !== "MAPPED" ||
    expected.reason_code !== "ASSET_ADMITTED_AND_MAPPED"
  ) {
    throw new Error("The Bradbury release proof must require exact MAPPED output");
  }
  if (
    !Number.isSafeInteger(expected.rarity_tier) ||
    expected.rarity_tier < 1 ||
    !Number.isSafeInteger(expected.power_tier) ||
    expected.power_tier < 1
  ) {
    throw new Error("Expected mapped tiers must be positive safe integers");
  }
  return expected;
}

export function assertPolicyFixture(policy, fixture, expected) {
  const expectedKeys = [
    "admission_rules",
    "class_power_caps",
    "collection_sources",
    "max_power_tier",
    "max_rarity_tier",
    "policy_id",
    "policy_version",
    "trait_profiles",
  ];
  if (
    !policy ||
    typeof policy !== "object" ||
    Array.isArray(policy) ||
    jsonString(Object.keys(policy).sort()) !== jsonString(expectedKeys)
  ) {
    throw new Error("Policy must use exactly the V2 policy fields");
  }
  if (
    jsonString(canonicalJson(policy)) !==
    jsonString(canonicalJson(EXACT_LIVE_POLICY))
  ) {
    throw new Error(
      "Bradbury release policy must exactly match the single-source, single-profile committed live policy",
    );
  }
  if (
    policy.policy_id !== "EMBERGUARD-HEAVY-ARMOR-ADMISSION" ||
    policy.policy_version !== "1" ||
    policy.admission_rules !== LIVE_ADMISSION_RULES ||
    policy.collection_sources.length !== 1 ||
    policy.trait_profiles.length !== 1
  ) {
    throw new Error(
      "Bradbury release policy ID, version, admission rules, source, and profile must be exact",
    );
  }
  const source = policy.collection_sources?.find(
    (item) => item?.collection_id === fixture.collection_id,
  );
  if (!source) throw new Error("Exact fixture collection is absent from the policy");
  const metadataUrl = canonicalHttpsUrl(fixture.metadata_url, "metadata_url");
  const imageUrl = canonicalHttpsUrl(fixture.image_url, "image_url");
  if (
    metadataUrl.hostname !== source.metadata_domain ||
    !metadataUrl.pathname.startsWith(source.metadata_path_prefix) ||
    imageUrl.hostname !== source.image_domain ||
    !imageUrl.pathname.startsWith(source.image_path_prefix)
  ) {
    throw new Error("Fixture URLs are outside the exact collection source bindings");
  }
  const profile = policy.trait_profiles?.find(
    (item) => item?.profile_id === expected.profile_id,
  );
  if (
    !profile ||
    profile.class_id !== expected.class_id ||
    profile.element_id !== expected.element_id ||
    Number(profile.rarity_tier) !== expected.rarity_tier ||
    Number(profile.power_tier) !== expected.power_tier
  ) {
    throw new Error("Expected semantic result is not one immutable policy profile");
  }
  if (
    Number(policy.class_power_caps?.[expected.class_id]) < expected.power_tier ||
    Number(policy.max_power_tier) < expected.power_tier ||
    Number(policy.max_rarity_tier) < expected.rarity_tier
  ) {
    throw new Error("Expected semantic result exceeds immutable policy caps");
  }
}

async function fetchPinned(url, digest, label, acceptedMediaTypes, maximumBytes) {
  const response = await fetch(url, {
    headers: {
      Accept: acceptedMediaTypes.join(", "),
      "Accept-Encoding": "identity",
    },
    redirect: "manual",
  });
  if (response.status !== 200 || response.redirected || response.url !== url) {
    throw new Error(`${label} is unavailable or redirected`);
  }
  const mediaType = String(response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!acceptedMediaTypes.includes(mediaType)) {
    throw new Error(`${label} media type is ${mediaType}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (!body.length || body.length > maximumBytes || sha256(body) !== digest) {
    throw new Error(`${label} bytes do not match the bounded digest commitment`);
  }
  return {
    body,
    proof: {
      url,
      sha256: digest,
      size_bytes: body.length,
      content_type: mediaType,
      http_status: response.status,
      redirected: false,
      retrieved_at: new Date().toISOString(),
    },
  };
}

export async function verifyRemoteFixture(fixture) {
  const metadata = await fetchPinned(
    fixture.metadata_url,
    fixture.metadata_sha256,
    "Metadata fixture",
    ["application/json", "text/plain"],
    16_000,
  );
  const image = await fetchPinned(
    fixture.image_url,
    fixture.image_sha256,
    "Image fixture",
    ["image/jpeg", "image/png", "image/webp"],
    524_288,
  );
  const parsed = parseJson("metadata fixture", metadata.body.toString("utf8"));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    parsed.collection_id !== fixture.collection_id ||
    parsed.token_reference !== fixture.token_reference ||
    parsed.image !== fixture.image_url
  ) {
    throw new Error("Metadata fixture does not bind collection, token, and image exactly");
  }
  return { metadata: metadata.proof, image: image.proof };
}

function outputPathFromEnvironment() {
  const configured = requiredValue("ASSET_MAPPER_DEPLOY_OUTPUT");
  const candidate = path.resolve(process.cwd(), configured);
  const expectedParent = path.resolve(process.cwd(), "deployments");
  if (path.dirname(candidate) !== expectedParent || path.extname(candidate) !== ".json") {
    throw new Error(
      "ASSET_MAPPER_DEPLOY_OUTPUT must be a JSON file directly in deployments/",
    );
  }
  return candidate;
}

function checkpointBase({
  client,
  genvmChainId,
  code,
  sourceCommit,
  policyInput,
  policy,
  fixture,
  expected,
  fixtureProof,
  livePolicyBytes,
  harnessBytes,
  proofHarnessCommit,
}) {
  const sourceSha256 = sha256(Buffer.from(code, "utf8"));
  const canonicalPolicyJson = JSON.stringify(canonicalJson(policy));
  return {
    schema_version: "4.0",
    record_status: "IN_PROGRESS",
    project: "consensus-asset-trait-mapper",
    repository: "https://github.com/Leokings/consensus-asset-trait-mapper",
    recorded_at: new Date().toISOString(),
    network: {
      evm_chain_id: Number(client.chain?.id),
      genvm_chain_id: genvmChainId,
      name: String(client.chain?.name || ""),
      rpc: redactRpc(client.chain?.rpcUrls?.default?.http?.[0]),
    },
    source: {
      commit: sourceCommit,
      sha256: sourceSha256,
      bytes: Buffer.byteLength(code, "utf8"),
      runner: RUNNER,
      contract_version: CONTRACT_VERSION,
      policy_schema: POLICY_SCHEMA,
      commit_git_objects_verified: [
        "contracts/ConsensusAssetAdmissionTraitMapper.py",
        "examples/live-policy.json",
      ],
      proof_harness_commit: proofHarnessCommit,
      proof_harness_git_object_verified: "deploy/001_deploy_and_verify.js",
      harness_sha256: sha256(harnessBytes),
    },
    constructor: {
      args: [policyInput],
      policy_input_sha256: sha256(Buffer.from(policyInput, "utf8")),
      canonical_policy_json: canonicalPolicyJson,
      expected_policy_digest: computePolicyDigest(canonicalPolicyJson),
      live_policy_sha256: LIVE_POLICY_SHA256,
      live_policy_bytes: livePolicyBytes.length,
      live_policy_git_object_verified: true,
    },
    fixture,
    fixture_http_proof: fixtureProof,
    expected_result: expected,
    deployment: {},
    semantic_smoke: {},
  };
}

function loadCheckpoint(outputPath, expected) {
  if (!existsSync(outputPath)) return expected;
  let current;
  try {
    current = JSON.parse(readFileSync(outputPath, "utf8"));
  } catch (error) {
    throw new Error(`Refusing to overwrite unreadable checkpoint: ${String(error)}`);
  }
  const stableFieldsMatch =
    current?.schema_version === expected.schema_version &&
    current?.project === expected.project &&
    current?.network?.evm_chain_id === expected.network.evm_chain_id &&
    current?.network?.genvm_chain_id === expected.network.genvm_chain_id &&
    current?.source?.commit === expected.source.commit &&
    current?.source?.sha256 === expected.source.sha256 &&
    current?.constructor?.policy_input_sha256 ===
      expected.constructor.policy_input_sha256 &&
    jsonString(current?.fixture) === jsonString(expected.fixture) &&
    jsonString(current?.expected_result) === jsonString(expected.expected_result);
  if (!stableFieldsMatch) {
    throw new Error(
      "Refusing to overwrite a checkpoint for different source, network, policy, fixture, or expected result",
    );
  }
  return current;
}

function saveCheckpoint(outputPath, checkpoint) {
  checkpoint.recorded_at = new Date().toISOString();
  const temporary = `${outputPath}.tmp`;
  writeFileSync(temporary, JSON.stringify(plainValue(checkpoint), null, 2) + "\n", {
    flag: "w",
  });
  renameSync(temporary, outputPath);
}

function envOrCheckpoint(envName, checkpointValue) {
  const supplied = String(process.env[envName] || "").trim();
  if (
    supplied &&
    checkpointValue &&
    supplied.toLowerCase() !== String(checkpointValue).toLowerCase()
  ) {
    throw new Error(`${envName} conflicts with the checkpoint`);
  }
  return supplied || checkpointValue || "";
}

async function retryRead(label, operation, attempts = 24) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  }
  throw new Error(`${label} failed after retries: ${String(lastError)}`);
}

export async function waitReceipt(
  client,
  hash,
  status,
  label,
  allowIdle = false,
  attempts = status === "FINALIZED" ? 360 : 240,
  intervalMs = 5_000,
) {
  const acceptedStatuses =
    status === "ACCEPTED"
      ? new Set(["ACCEPTED", "READY_TO_FINALIZE", "FINALIZED"])
      : new Set([status]);
  let lastStatus = "UNKNOWN";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let receipt;
    try {
      receipt = await client.getTransaction({ hash });
    } catch (error) {
      if (attempt === attempts) {
        throw new Error(`${label} lifecycle read failed: ${String(error)}`);
      }
      if (intervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      continue;
    }
    if (!receipt) {
      lastStatus = "NOT_FOUND";
    } else {
      lastStatus = normalized(
        receipt?.statusName ?? receipt?.status_name ?? receipt?.status,
        STATUS_NAMES,
      );
      if (acceptedStatuses.has(lastStatus)) {
        assertPositiveReceipt(receipt, label, allowIdle);
        return receipt;
      }
    }
    if (attempt < attempts && intervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error(
    `${label} did not reach ${status}; last lifecycle status was ${lastStatus}`,
  );
}

async function read(
  client,
  address,
  functionName,
  args = [],
  transactionHashVariant = "latest-final",
) {
  return client.readContract({
    address,
    functionName,
    args,
    jsonSafeReturn: true,
    transactionHashVariant,
  });
}

function transactionAddress(transaction) {
  return String(
    transaction?.recipient ?? transaction?.to_address ?? transaction?.toAddress ?? "",
  ).toLowerCase();
}

function transactionSender(transaction) {
  const sender = String(
    transaction?.sender ?? transaction?.from_address ?? transaction?.fromAddress ?? "",
  );
  assertAddress(sender, "transaction sender");
  return sender.toLowerCase();
}

async function verifiedTransaction(client, hash, label, verify) {
  return retryRead(`${label} provenance`, async () => {
    const transaction = await client.getTransaction({ hash });
    if (!transaction) throw new Error("Transaction not found");
    verify(transaction);
    return transaction;
  });
}

function assertDeploymentProvenance(transaction, address, code, args) {
  const decoded = transaction?.txDataDecoded ?? transaction?.tx_data_decoded;
  const constructorArgs = decoded?.constructorArgs ?? decoded?.constructor_args;
  const leaderOnly = decoded?.leaderOnly ?? decoded?.leader_only;
  if (
    transactionAddress(transaction) !== address.toLowerCase() ||
    String(decoded?.type || "").toLowerCase() !== "deploy" ||
    leaderOnly !== false ||
    decoded?.code !== code ||
    jsonString(plainValue(mapValue(constructorArgs, "args") || [])) !==
      jsonString(args)
  ) {
    throw new Error("Deployment transaction provenance mismatch");
  }
  return transactionSender(transaction);
}

function assertCallProvenance(transaction, address, args, expectedSender) {
  const decoded = transaction?.txDataDecoded ?? transaction?.tx_data_decoded;
  const callData = decoded?.callData ?? decoded?.call_data;
  const leaderOnly = decoded?.leaderOnly ?? decoded?.leader_only;
  const sender = transactionSender(transaction);
  if (
    transactionAddress(transaction) !== address.toLowerCase() ||
    String(decoded?.type || "").toLowerCase() !== "call" ||
    leaderOnly !== false ||
    mapValue(callData, "method") !== "map_asset" ||
    jsonString(plainValue(mapValue(callData, "args") || [])) !== jsonString(args) ||
    sender !== expectedSender.toLowerCase()
  ) {
    throw new Error("Mapping transaction target, method, arguments, or sender mismatch");
  }
  return sender;
}

function expectedFinalizationCalldata(hash) {
  return `${FINALIZE_TRANSACTION_SELECTOR}${hash.slice(2)}`.toLowerCase();
}

function assertExactFinalizationLog(
  log,
  consensusAddress,
  transactionHash,
  evmHash,
  label,
) {
  const topics = log?.topics;
  if (
    !log ||
    log.removed === true ||
    String(log.address || "").toLowerCase() !== consensusAddress ||
    String(log.transactionHash || "").toLowerCase() !== evmHash.toLowerCase() ||
    !Array.isArray(topics) ||
    topics.length !== 2 ||
    String(topics[0] || "").toLowerCase() !==
      TRANSACTION_FINALIZED_EVENT_TOPIC ||
    String(topics[1] || "").toLowerCase() !== transactionHash.toLowerCase() ||
    String(log.data ?? "").toLowerCase() !== "0x"
  ) {
    throw new Error(`${label} contains a malformed TransactionFinalized log`);
  }
}

function canonicalSafeBlockNumber(value, label) {
  let block;
  if (typeof value === "bigint") {
    block = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${label} is not a safe integer`);
    }
    block = BigInt(value);
  } else if (/^(?:0|[1-9][0-9]*)$/.test(String(value ?? ""))) {
    block = BigInt(value);
  } else {
    throw new Error(`${label} is not a canonical decimal block number`);
  }
  if (block < 0n || block > MAX_SAFE_BLOCK_NUMBER) {
    throw new Error(`${label} is outside the safe block-number range`);
  }
  return block;
}

export function finalizationRecoveryStartBlock(transaction, transactionHash) {
  assertHash(transactionHash, "finalization recovery GenLayer transaction hash");
  if (!transaction || typeof transaction !== "object") {
    throw new Error("Finalization recovery GenLayer transaction is absent");
  }

  const identifiers = [
    mapValue(transaction, "txId"),
    mapValue(transaction, "tx_id"),
    mapValue(transaction, "hash"),
    mapValue(transaction, "transactionHash"),
    mapValue(transaction, "transaction_hash"),
  ].filter((value) => value !== undefined && value !== null && value !== "");
  if (identifiers.length === 0) {
    throw new Error("Finalization recovery transaction omitted its identifier");
  }
  for (const identifier of identifiers) {
    assertHash(identifier, "finalization recovery transaction identifier");
    if (String(identifier).toLowerCase() !== transactionHash.toLowerCase()) {
      throw new Error("Finalization recovery transaction identifier mismatch");
    }
  }

  const ranges = [
    mapValue(transaction, "readStateBlockRange"),
    mapValue(transaction, "read_state_block_range"),
  ].filter((value) => value !== undefined && value !== null);
  const activationValues = [];
  for (const range of ranges) {
    for (const key of ["activationBlock", "activation_block"]) {
      const value = mapValue(range, key);
      if (value !== undefined && value !== null && value !== "") {
        activationValues.push(value);
      }
    }
  }
  if (activationValues.length === 0) {
    throw new Error(
      "Finalization recovery transaction omitted read-state activation block",
    );
  }
  const activationBlocks = activationValues.map((value) =>
    canonicalSafeBlockNumber(value, "read-state activation block"),
  );
  if (activationBlocks.some((block) => block !== activationBlocks[0])) {
    throw new Error("Finalization recovery activation block aliases conflict");
  }
  return activationBlocks[0] > FINALIZATION_RECOVERY_REORG_MARGIN
    ? activationBlocks[0] - FINALIZATION_RECOVERY_REORG_MARGIN
    : 0n;
}

export async function verifyFinalizationEvmTransaction(
  client,
  evmHash,
  transactionHash,
  label,
  attempts = 24,
) {
  assertHash(evmHash, `${label} finalization EVM hash`);
  const consensusAddress = String(
    client.chain?.consensusMainContract?.address || "",
  ).toLowerCase();
  assertAddress(consensusAddress, "consensus contract");
  const expectedInput = expectedFinalizationCalldata(transactionHash);
  await retryRead(
    `${label} EVM finalization`,
    async () => {
      const transaction = await client.request({
        method: "eth_getTransactionByHash",
        params: [evmHash],
      });
      const receipt = await client.request({
        method: "eth_getTransactionReceipt",
        params: [evmHash],
      });
      if (
        !transaction ||
        String(transaction.hash || "").toLowerCase() !== evmHash.toLowerCase() ||
        String(transaction.to || "").toLowerCase() !== consensusAddress ||
        String(transaction.input ?? transaction.data ?? "").toLowerCase() !==
          expectedInput
      ) {
        throw new Error("Finalization EVM transaction target or calldata mismatch");
      }
      if (
        !receipt ||
        String(receipt.transactionHash || "").toLowerCase() !==
          evmHash.toLowerCase() ||
        String(receipt.to || "").toLowerCase() !== consensusAddress ||
        String(receipt.status || "").toLowerCase() !== "0x1"
      ) {
        throw new Error("Finalization EVM receipt is absent, reverted, or mismatched");
      }
      if (!Array.isArray(receipt.logs)) {
        throw new Error("Finalization EVM receipt omitted logs");
      }
      const matchingLogs = receipt.logs.filter((log) => {
        const topics = log?.topics;
        return (
          Array.isArray(topics) &&
          String(topics[0] || "").toLowerCase() ===
            TRANSACTION_FINALIZED_EVENT_TOPIC &&
          String(topics[1] || "").toLowerCase() ===
            transactionHash.toLowerCase()
        );
      });
      if (matchingLogs.length !== 1) {
        throw new Error(
          `Finalization EVM receipt exposed ${matchingLogs.length} exact TransactionFinalized logs; expected one`,
        );
      }
      assertExactFinalizationLog(
        matchingLogs[0],
        consensusAddress,
        transactionHash,
        evmHash,
        label,
      );
      return true;
    },
    attempts,
  );
}

export async function recoverFinalizationEvmTransaction(
  client,
  transactionHash,
  label,
  attempts = 24,
  intervalMs = 5_000,
) {
  assertHash(transactionHash, `${label} GenLayer transaction hash`);
  const consensusAddress = String(
    client.chain?.consensusMainContract?.address || "",
  ).toLowerCase();
  assertAddress(consensusAddress, "consensus contract");
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let logs;
    try {
      const genlayerTransaction = await client.getTransaction({
        hash: transactionHash,
      });
      const recoveryStartBlock = finalizationRecoveryStartBlock(
        genlayerTransaction,
        transactionHash,
      );
      const latestValue = await client.request({ method: "eth_blockNumber" });
      if (!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(String(latestValue || ""))) {
        throw new Error("eth_blockNumber returned a non-canonical hex quantity");
      }
      const latestBlock = BigInt(latestValue);
      if (latestBlock > MAX_SAFE_BLOCK_NUMBER) {
        throw new Error("eth_blockNumber is outside the safe block-number range");
      }
      if (recoveryStartBlock > latestBlock) {
        throw new Error("read-state activation block is ahead of the latest EVM block");
      }
      logs = [];
      for (
        let fromBlock = recoveryStartBlock;
        fromBlock <= latestBlock;
        fromBlock += MAX_LOG_QUERY_BLOCKS
      ) {
        const toBlock =
          fromBlock + MAX_LOG_QUERY_BLOCKS - 1n < latestBlock
            ? fromBlock + MAX_LOG_QUERY_BLOCKS - 1n
            : latestBlock;
        const chunk = await client.request({
          method: "eth_getLogs",
          params: [
            {
              address: consensusAddress,
              fromBlock: `0x${fromBlock.toString(16)}`,
              toBlock: `0x${toBlock.toString(16)}`,
              topics: [
                TRANSACTION_FINALIZED_EVENT_TOPIC,
                transactionHash.toLowerCase(),
              ],
            },
          ],
        });
        if (!Array.isArray(chunk)) {
          throw new Error(
            `${label} TransactionFinalized log chunk query was not an array`,
          );
        }
        logs.push(...chunk);
        if (logs.length > 1) {
          break;
        }
      }
    } catch (error) {
      if (attempt === attempts) {
        throw new Error(
          `${label} TransactionFinalized log recovery failed: ${String(error)}`,
        );
      }
      if (intervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      continue;
    }
    if (logs.length > 1) {
      throw new Error(
        `${label} has duplicate TransactionFinalized logs; refusing ambiguous recovery`,
      );
    }
    if (logs.length === 1) {
      const evmHash = String(logs[0]?.transactionHash || "").toLowerCase();
      assertHash(evmHash, `${label} recovered finalization EVM hash`);
      assertExactFinalizationLog(
        logs[0],
        consensusAddress,
        transactionHash,
        evmHash,
        label,
      );
      await verifyFinalizationEvmTransaction(
        client,
        evmHash,
        transactionHash,
        label,
        attempts,
      );
      return evmHash;
    }
    if (attempt < attempts && intervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error(`${label} has no recoverable TransactionFinalized log`);
}

export async function finalizeWhenReady(
  client,
  transactionHash,
  label,
  step,
  envPrefix,
  checkpoint,
  outputPath,
  verificationAttempts = 24,
) {
  let successfulEvmHash = envOrCheckpoint(
    `${envPrefix}_FINALIZATION_EVM_TX`,
    step.finalization_evm_transaction,
  );
  let broadcastEvmHash = String(
    step.finalization_broadcast_transaction || "",
  ).trim();
  if (broadcastEvmHash) {
    assertHash(
      broadcastEvmHash,
      `${envPrefix}_FINALIZATION_BROADCAST_TX`,
    );
  }
  if (successfulEvmHash) {
    await verifyFinalizationEvmTransaction(
      client,
      successfulEvmHash,
      transactionHash,
      label,
      verificationAttempts,
    );
  }
  for (let attempt = 0; attempt < 720; attempt += 1) {
    const transaction = await retryRead(
      `${label} finality status`,
      () => client.getTransaction({ hash: transactionHash }),
      3,
    );
    const status = normalized(
      transaction?.statusName ?? transaction?.status_name ?? transaction?.status,
      STATUS_NAMES,
    );
    if (status === "FINALIZED") {
      if (!successfulEvmHash) {
        successfulEvmHash = await recoverFinalizationEvmTransaction(
          client,
          transactionHash,
          label,
          verificationAttempts,
        );
        step.finalization_evm_transaction = successfulEvmHash;
        step.finalization_recovered_from_event = true;
        saveCheckpoint(outputPath, checkpoint);
        console.log(
          `${envPrefix}_FINALIZATION_EVM_TX=${successfulEvmHash}`,
        );
      }
      await verifyFinalizationEvmTransaction(
        client,
        successfulEvmHash,
        transactionHash,
        label,
        verificationAttempts,
      );
      const receipt = await waitReceipt(
        client,
        transactionHash,
        "FINALIZED",
        label,
      );
      step.finality_status = "FINALIZED";
      step.finalization_evm_transaction = successfulEvmHash;
      step.finalized_consensus = consensusSummary(receipt);
      step.finalized_receipt = plainValue(receipt);
      saveCheckpoint(outputPath, checkpoint);
      return receipt;
    }
    if (status === "READY_TO_FINALIZE") {
      if (!successfulEvmHash && !broadcastEvmHash) {
        try {
          broadcastEvmHash = await client.finalizeTransaction({
            txId: transactionHash,
          });
        } catch (error) {
          const latest = await retryRead(
            `${label} status after finalization error`,
            () => client.getTransaction({ hash: transactionHash }),
            3,
          );
          const latestStatus = normalized(
            latest?.statusName ?? latest?.status_name ?? latest?.status,
            STATUS_NAMES,
          );
          if (latestStatus === "FINALIZED") {
            successfulEvmHash = await recoverFinalizationEvmTransaction(
              client,
              transactionHash,
              label,
              verificationAttempts,
            );
            step.finalization_evm_transaction = successfulEvmHash;
            step.finalization_recovered_from_event = true;
            saveCheckpoint(outputPath, checkpoint);
            continue;
          }
          throw new Error(
            `${label} finalization broadcast outcome is unknown; resume with ` +
              `${envPrefix}_FINALIZATION_EVM_TX. ${String(error)}`,
          );
        }
        assertHash(
          broadcastEvmHash,
          `${envPrefix}_FINALIZATION_BROADCAST_TX`,
        );
        step.finalization_broadcast_transaction = broadcastEvmHash;
        saveCheckpoint(outputPath, checkpoint);
        console.log(
          `${envPrefix}_FINALIZATION_BROADCAST_TX=${broadcastEvmHash}`,
        );
      }
      if (!successfulEvmHash) {
        try {
          await verifyFinalizationEvmTransaction(
            client,
            broadcastEvmHash,
            transactionHash,
            label,
            verificationAttempts,
          );
          successfulEvmHash = broadcastEvmHash;
          step.finalization_evm_transaction = successfulEvmHash;
          step.finalization_recovered_from_event = false;
          saveCheckpoint(outputPath, checkpoint);
          console.log(
            `${envPrefix}_FINALIZATION_EVM_TX=${successfulEvmHash}`,
          );
        } catch (verificationError) {
          const latest = await retryRead(
            `${label} status after finalization-proof failure`,
            () => client.getTransaction({ hash: transactionHash }),
            3,
          );
          const latestStatus = normalized(
            latest?.statusName ?? latest?.status_name ?? latest?.status,
            STATUS_NAMES,
          );
          if (latestStatus !== "FINALIZED") {
            throw new Error(
              `${label} finalization broadcast did not produce one successful exact finalization proof: ${String(verificationError)}`,
            );
          }
          const recovered = await recoverFinalizationEvmTransaction(
            client,
            transactionHash,
            label,
            verificationAttempts,
          );
          successfulEvmHash = recovered;
          step.finalization_evm_transaction = recovered;
          step.finalization_recovered_from_event = true;
          if (recovered.toLowerCase() !== broadcastEvmHash.toLowerCase()) {
            step.unsuccessful_or_superseded_broadcast_transaction =
              broadcastEvmHash;
          }
          saveCheckpoint(outputPath, checkpoint);
        }
      }
      continue;
    }
    if (status !== "ACCEPTED") {
      throw new Error(`${label} entered unexpected status ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`${label} did not become ready to finalize`);
}

async function withBradburyDeploymentGasCeiling(client, operation) {
  if (typeof client.estimateTransactionGas !== "function") {
    throw new Error("Client does not expose estimateTransactionGas");
  }
  const original = client.estimateTransactionGas;
  client.estimateTransactionGas = async () => BRADBURY_DEPLOYMENT_EVM_GAS_LIMIT;
  try {
    return await operation(BRADBURY_DEPLOYMENT_EVM_GAS_LIMIT);
  } finally {
    client.estimateTransactionGas = original;
  }
}

function assertSchema(schema) {
  const constructorNames = ["policy_json"];
  const methodNames = [
    "get_mapping",
    "get_mapping_by_asset",
    "get_mapping_by_request",
    "get_mapping_count",
    "get_policy",
    "map_asset",
  ];
  if (
    schema?.ctor?.params?.length !== constructorNames.length ||
    schema.ctor.params.some(
      (item, index) => item?.[0] !== constructorNames[index],
    )
  ) {
    throw new Error(`Unexpected constructor schema: ${jsonString(schema)}`);
  }
  const methods = schema?.methods || {};
  if (
    Object.keys(methods).length !== methodNames.length ||
    methodNames.some((name) => !methods[name]) ||
    methods.map_asset.readonly !== false
  ) {
    throw new Error(`Unexpected public schema: ${jsonString(schema)}`);
  }
}

function deployedAddress(receipt) {
  const address =
    receipt?.data?.contract_address ||
    receipt?.txDataDecoded?.contractAddress ||
    receipt?.tx_data_decoded?.contract_address;
  assertAddress(address, "deployed contract address");
  return address;
}

export function returnedMappingId(transaction) {
  const receipts = receiptList(transaction?.consensus_data?.leader_receipt);
  const ids = [];
  for (const receipt of receipts) {
    const result = plainValue(receipt?.result);
    if (String(mapValue(result, "status") || "").toLowerCase() !== "return") {
      continue;
    }
    const readable = mapValue(mapValue(result, "payload"), "readable");
    if (!/^[1-9][0-9]*$/.test(String(readable || ""))) {
      throw new Error(
        `Leader receipt omitted a positive mapping ID: ${jsonString(result)}`,
      );
    }
    const id = Number(readable);
    if (!Number.isSafeInteger(id)) {
      throw new Error("Leader receipt mapping ID exceeds the safe integer range");
    }
    ids.push(id);
  }
  if (!ids.length || ids.some((id) => id !== ids[0])) {
    throw new Error(
      `Leader receipts do not expose one consistent mapping ID: ${jsonString(receipts)}`,
    );
  }
  return ids[0];
}

export function traceMappingId(trace) {
  if (trace?.result_code !== 0) {
    throw new Error(`Execution trace did not finish with a return: ${jsonString(trace)}`);
  }
  const returnData = String(trace?.return_data || "").trim();
  if (!/^(?:0x)?[0-9a-fA-F]+$/.test(returnData)) {
    throw new Error("Execution trace omitted hex-encoded return data");
  }
  const normalizedData = returnData.startsWith("0x")
    ? returnData.slice(2)
    : returnData;
  if (normalizedData.length % 2 !== 0) {
    throw new Error("Execution trace return data has odd hex length");
  }
  const decoded = genlayerAbi.calldata.decode(
    Uint8Array.from(Buffer.from(normalizedData, "hex")),
  );
  const expectedKeys = [
    "data",
    "events",
    "fingerprint",
    "kind",
    "storage_changes",
  ];
  if (
    !(decoded instanceof Map) ||
    decoded.size !== expectedKeys.length ||
    expectedKeys.some((key) => !decoded.has(key))
  ) {
    throw new Error("Execution trace return must be the exact GenVM Return envelope");
  }
  const fingerprint = decoded.get("fingerprint");
  const fingerprintKeys = ["frames", "module_instances"];
  const storageChanges = decoded.get("storage_changes");
  if (
    decoded.get("kind") !== "Return" ||
    !Array.isArray(decoded.get("events")) ||
    !(fingerprint instanceof Map) ||
    fingerprint.size !== fingerprintKeys.length ||
    fingerprintKeys.some((key) => !fingerprint.has(key)) ||
    !Array.isArray(fingerprint.get("frames")) ||
    !(fingerprint.get("module_instances") instanceof Map) ||
    !Array.isArray(storageChanges) ||
    storageChanges.some(
      (change) =>
        !Array.isArray(change) ||
        change.length !== 2 ||
        !(change[0] instanceof Uint8Array) ||
        !(change[1] instanceof Uint8Array),
    )
  ) {
    throw new Error("Execution trace return has invalid GenVM Return envelope field types");
  }
  const data = decoded.get("data");
  if (
    typeof data !== "bigint" ||
    data < 1n ||
    data > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error(
      "Execution trace returned an invalid positive safe-integer mapping ID",
    );
  }
  return Number(data);
}

async function transactionReturnedMappingId(client, transaction, hash, label) {
  try {
    return { mapping_id: returnedMappingId(transaction), source: "leader_receipt" };
  } catch (receiptError) {
    if (typeof client.debugTraceTransaction !== "function") {
      throw new Error(
        `${label} omitted return provenance and debug trace is unavailable: ${String(receiptError)}`,
      );
    }
    const finalRound = Number(
      transaction?.lastRound?.round ?? transaction?.last_round?.round ?? 0,
    );
    if (!Number.isSafeInteger(finalRound) || finalRound < 0) {
      throw new Error(`${label} exposed an invalid consensus round`);
    }
    const mappingId = await retryRead(`${label} return trace`, async () => {
      const trace = await client.debugTraceTransaction({ hash, round: finalRound });
      return traceMappingId(trace);
    });
    return { mapping_id: mappingId, source: "debug_trace" };
  }
}

function recordsEqual(left, right) {
  return jsonString(canonicalJson(plainValue(left))) ===
    jsonString(canonicalJson(plainValue(right)));
}

export function assertExactRecord(
  record,
  mappingId,
  fixture,
  expected,
  sender,
  digests,
) {
  const bindings = {
    mapping_id: mappingId,
    submitter: sender.toLowerCase(),
    request_id: fixture.request_id,
    collection_id: fixture.collection_id,
    token_reference: fixture.token_reference,
    metadata_url: fixture.metadata_url,
    metadata_sha256: fixture.metadata_sha256,
    image_url: fixture.image_url,
    image_sha256: fixture.image_sha256,
    asset_digest: digests.asset_digest,
    request_digest: digests.request_digest,
    status: expected.status,
    reason_code: expected.reason_code,
    profile_id: expected.profile_id,
    class_id: expected.class_id,
    element_id: expected.element_id,
    rarity_tier: expected.rarity_tier,
    power_tier: expected.power_tier,
    result_digest: digests.result_digest,
  };
  for (const [field, expectedValue] of Object.entries(bindings)) {
    let actual = record?.[field];
    if (field === "submitter") {
      actual = String(actual || "").toLowerCase();
    } else if (["mapping_id", "rarity_tier", "power_tier"].includes(field)) {
      actual = Number(actual);
    }
    if (actual !== expectedValue) {
      throw new Error(
        `Exact mapping mismatch for ${field}: ${jsonString(actual)} != ${jsonString(expectedValue)}`,
      );
    }
  }
}

const EXACT_ABSENT_LOOKUP_MESSAGES = Object.freeze({
  Asset: "[EXPECTED] Asset has not been mapped",
  Request: "[EXPECTED] Unknown request_id",
});

function decodeHexReturnData(value) {
  if (typeof value !== "string" || !/^(?:0x)?[0-9a-fA-F]+$/.test(value)) {
    return null;
  }
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (!normalized || normalized.length % 2 !== 0) return null;
  return Uint8Array.from(Buffer.from(normalized, "hex"));
}

function decodeGoVmResultReturnData(value) {
  if (typeof value !== "string") return null;
  if ((value.match(/ReturnData:/g) || []).length !== 1) return null;
  const match = value.match(
    /^execution failed: &genvm\.VMResult\{Kind:0x1, ReturnData:\[\]uint8\{(0x[0-9a-f]{1,2}(?:, 0x[0-9a-f]{1,2})*)\}(?:, [\s\S]*)?\}$/,
  );
  if (!match) return null;
  return Uint8Array.from(
    match[1].split(", ").map((item) => Number.parseInt(item.slice(2), 16)),
  );
}

function exactUserErrorEnvelope(bytes, expectedMessage) {
  let decoded;
  try {
    decoded = genlayerAbi.calldata.decode(bytes);
  } catch {
    return false;
  }
  const expectedKeys = ["data", "events", "fingerprint", "kind", "storage_changes"];
  if (
    !(decoded instanceof Map) ||
    decoded.size !== expectedKeys.length ||
    expectedKeys.some((key) => !decoded.has(key)) ||
    decoded.get("data") !== expectedMessage ||
    decoded.get("kind") !== "UserError"
  ) {
    return false;
  }
  const events = decoded.get("events");
  const storageChanges = decoded.get("storage_changes");
  const fingerprint = decoded.get("fingerprint");
  return (
    Array.isArray(events) &&
    events.length === 0 &&
    Array.isArray(storageChanges) &&
    storageChanges.length === 0 &&
    fingerprint instanceof Map &&
    fingerprint.size === 2 &&
    fingerprint.has("frames") &&
    fingerprint.has("module_instances") &&
    Array.isArray(fingerprint.get("frames")) &&
    fingerprint.get("module_instances") instanceof Map
  );
}

export function isExactLookupAbsentError(error, label) {
  const expectedMessage = EXACT_ABSENT_LOOKUP_MESSAGES[label];
  if (!expectedMessage) return false;
  const payloads = [];
  const seen = new Set();
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
    if (seen.has(current)) return false;
    seen.add(current);
    if (current.code === -32000) {
      if (current.data !== undefined && current.data !== null) {
        const bytes = decodeHexReturnData(current.data);
        if (!bytes) return false;
        payloads.push(bytes);
      }
      const bytes = decodeGoVmResultReturnData(current.message);
      if (bytes) payloads.push(bytes);
    }
    current = current.cause;
  }
  return (
    payloads.length > 0 &&
    payloads.every((bytes) => exactUserErrorEnvelope(bytes, expectedMessage))
  );
}

async function assertLookupAbsent(
  client,
  address,
  functionName,
  args,
  label,
) {
  for (const variant of ["latest-nonfinal", "latest-final"]) {
    let existing;
    try {
      existing = await read(client, address, functionName, args, variant);
    } catch (error) {
      if (!isExactLookupAbsentError(error, label)) {
        throw new Error(
          `${label} ${variant} absence check was inconclusive: ${String(error)}`,
        );
      }
      continue;
    }
    throw new Error(
      `${label} already exists at ${variant}: ${jsonString(existing)}; ` +
        "recover the original transaction instead of resubmitting",
    );
  }
}

export async function submitExactMapping(
  client,
  address,
  deployer,
  policyDigest,
  fixture,
  expected,
  checkpoint,
  outputPath,
) {
  const step = checkpoint.semantic_smoke;
  const args = [
    fixture.request_id,
    fixture.collection_id,
    fixture.token_reference,
    fixture.metadata_url,
    fixture.metadata_sha256,
    fixture.image_url,
    fixture.image_sha256,
  ];
  let hash = envOrCheckpoint("ASSET_MAPPER_MAPPING_TX", step.transaction);
  if (hash) assertHash(hash, "ASSET_MAPPER_MAPPING_TX");
  if (!hash) {
    if (step.submission_intent_recorded === true) {
      throw new Error(
        "Semantic mapping has a durable submission intent but no transaction hash; " +
          "recover ASSET_MAPPER_MAPPING_TX or use a fresh deployment/output instead of resubmitting",
      );
    }
    await assertLookupAbsent(
      client,
      address,
      "get_mapping_by_request",
      [deployer, fixture.request_id],
      "Request",
    );
    await assertLookupAbsent(
      client,
      address,
      "get_mapping_by_asset",
      [fixture.collection_id, fixture.token_reference],
      "Asset",
    );
    step.submission_intent_recorded = true;
    step.call = { method: "map_asset", args, sender: deployer };
    saveCheckpoint(outputPath, checkpoint);
    hash = await client.writeContract({
      address,
      functionName: "map_asset",
      args,
      value: 0n,
      leaderOnly: false,
    });
    assertHash(hash, "ASSET_MAPPER_MAPPING_TX");
    step.transaction = hash;
    saveCheckpoint(outputPath, checkpoint);
    console.log(`ASSET_MAPPER_MAPPING_TX=${hash}`);
  }
  if (!step.submission_intent_recorded) {
    step.submission_intent_recorded = true;
    step.call = { method: "map_asset", args, sender: deployer };
    step.transaction = hash;
    saveCheckpoint(outputPath, checkpoint);
  }

  const accepted = await waitReceipt(client, hash, "ACCEPTED", "Exact semantic mapping");
  const transaction = await verifiedTransaction(
    client,
    hash,
    "Exact semantic mapping",
    (candidate) => assertCallProvenance(candidate, address, args, deployer),
  );
  const sender = transactionSender(transaction);
  const returned = await transactionReturnedMappingId(
    client,
    transaction,
    hash,
    "Exact semantic mapping",
  );
  const digests = computeMappingDigests({
    genvmChainId: checkpoint.network.genvm_chain_id,
    contractAddress: address,
    sender,
    policyDigest,
    fixture,
    expected,
  });
  const record = await retryRead("Transaction-bound mapping", () =>
    read(client, address, "get_mapping", [returned.mapping_id], "latest-nonfinal"),
  );
  assertExactRecord(
    record,
    returned.mapping_id,
    fixture,
    expected,
    sender,
    digests,
  );
  const byRequest = await retryRead("Sender/request mapping", () =>
    read(
      client,
      address,
      "get_mapping_by_request",
      [sender, fixture.request_id],
      "latest-nonfinal",
    ),
  );
  const byAsset = await retryRead("Global asset mapping", () =>
    read(
      client,
      address,
      "get_mapping_by_asset",
      [fixture.collection_id, fixture.token_reference],
      "latest-nonfinal",
    ),
  );
  if (!recordsEqual(record, byRequest) || !recordsEqual(record, byAsset)) {
    throw new Error("Mapping lookup indexes do not identify the transaction-bound record");
  }
  Object.assign(step, {
    transaction: hash,
    sender,
    decoded_provenance: {
      type: "call",
      target: address.toLowerCase(),
      method: "map_asset",
      args,
      sender,
      leader_only: false,
      verified: true,
    },
    mapping_id: returned.mapping_id,
    mapping_id_provenance: returned.source,
    transaction_gas_limit:
      transaction?.gaslimit ?? transaction?.gasLimit ?? null,
    accepted_consensus: consensusSummary(accepted),
    accepted_receipt: plainValue(accepted),
    digests,
    provisional_record: plainValue(record),
  });
  saveCheckpoint(outputPath, checkpoint);

  await finalizeWhenReady(
    client,
    hash,
    "Exact semantic mapping",
    step,
    "ASSET_MAPPER_MAPPING",
    checkpoint,
    outputPath,
  );
  const finalized = await retryRead("Finalized transaction-bound mapping", () =>
    read(client, address, "get_mapping", [returned.mapping_id], "latest-final"),
  );
  assertExactRecord(
    finalized,
    returned.mapping_id,
    fixture,
    expected,
    sender,
    digests,
  );
  const finalByRequest = await retryRead("Finalized sender/request mapping", () =>
    read(
      client,
      address,
      "get_mapping_by_request",
      [sender, fixture.request_id],
      "latest-final",
    ),
  );
  const finalByAsset = await retryRead("Finalized global asset mapping", () =>
    read(
      client,
      address,
      "get_mapping_by_asset",
      [fixture.collection_id, fixture.token_reference],
      "latest-final",
    ),
  );
  if (
    !recordsEqual(finalized, finalByRequest) ||
    !recordsEqual(finalized, finalByAsset)
  ) {
    throw new Error("Finalized mapping indexes differ from the finalized record");
  }
  step.finalized_record = plainValue(finalized);
  saveCheckpoint(outputPath, checkpoint);
}

function assertNetwork(client) {
  const selectedRpc = String(
    client.chain?.rpcUrls?.default?.http?.[0] || "",
  ).replace(/\/$/, "");
  if (
    Number(client.chain?.id) !== NETWORK.chainId ||
    String(client.chain?.name || "") !== NETWORK.name ||
    selectedRpc !== NETWORK.rpc
  ) {
    throw new Error(
      `Refusing deployment on ${client.chain?.name}/${client.chain?.id}/${redactRpc(selectedRpc)}`,
    );
  }
  if (requiredValue("ASSET_MAPPER_DEPLOY_NETWORK") !== "testnet_bradbury") {
    throw new Error("ASSET_MAPPER_DEPLOY_NETWORK must be testnet_bradbury");
  }
  const genvmChainId = Number(
    requiredValue("ASSET_MAPPER_EXPECTED_GENVM_CHAIN_ID"),
  );
  if (genvmChainId !== EXPECTED_GENVM_CHAIN_ID) {
    throw new Error(
      `ASSET_MAPPER_EXPECTED_GENVM_CHAIN_ID must be ${EXPECTED_GENVM_CHAIN_ID} for this pinned Bradbury proof`,
    );
  }
  return genvmChainId;
}

export default async function deployAndVerify(client) {
  const genvmChainId = assertNetwork(client);
  requiredEnvironment([
    "ASSET_MAPPER_DEPLOY_OUTPUT",
    "ASSET_MAPPER_SOURCE_COMMIT",
    "ASSET_MAPPER_EXPECTED_GENVM_CHAIN_ID",
    "ASSET_MAPPER_POLICY_JSON",
    "ASSET_MAPPER_REQUEST_ID",
    "ASSET_MAPPER_COLLECTION_ID",
    "ASSET_MAPPER_TOKEN_REFERENCE",
    "ASSET_MAPPER_METADATA_URL",
    "ASSET_MAPPER_METADATA_SHA256",
    "ASSET_MAPPER_IMAGE_URL",
    "ASSET_MAPPER_IMAGE_SHA256",
    "ASSET_MAPPER_EXPECTED_STATUS",
    "ASSET_MAPPER_EXPECTED_REASON",
    "ASSET_MAPPER_EXPECTED_PROFILE",
    "ASSET_MAPPER_EXPECTED_CLASS",
    "ASSET_MAPPER_EXPECTED_ELEMENT",
    "ASSET_MAPPER_EXPECTED_RARITY",
    "ASSET_MAPPER_EXPECTED_POWER",
  ]);
  const outputPath = outputPathFromEnvironment();
  const sourceCommit = requiredValue("ASSET_MAPPER_SOURCE_COMMIT").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error("ASSET_MAPPER_SOURCE_COMMIT must be a full lowercase commit SHA");
  }
  const code = readFileSync(CONTRACT_PATH, "utf8");
  const livePolicyBytes = readFileSync(LIVE_POLICY_PATH);
  const livePolicyText = livePolicyBytes.toString("utf8");
  const harnessBytes = readFileSync(HARNESS_PATH);
  if (!code.startsWith(`# { "Depends": "${RUNNER}" }`)) {
    throw new Error("Pinned runner header mismatch");
  }
  if (sha256(livePolicyBytes) !== LIVE_POLICY_SHA256) {
    throw new Error("Local examples/live-policy.json bytes do not match the pinned release SHA-256");
  }
  const proofHarnessCommit = verifySourceCommit(
    sourceCommit,
    code,
    livePolicyBytes,
    harnessBytes,
  );
  const policyInput = requiredRawValue("ASSET_MAPPER_POLICY_JSON");
  if (policyInput !== livePolicyText) {
    throw new Error(
      "ASSET_MAPPER_POLICY_JSON must equal the exact committed examples/live-policy.json bytes, including its final newline",
    );
  }
  const policy = parseJson("ASSET_MAPPER_POLICY_JSON", policyInput);
  const fixture = fixtureFromEnvironment();
  const expected = expectedFromEnvironment();
  assertPolicyFixture(policy, fixture, expected);
  const fixtureProof = await verifyRemoteFixture(fixture);
  const constructorArgs = [policyInput];
  const deploymentInputBytes =
    Buffer.byteLength(code, "utf8") +
    Buffer.byteLength(jsonString(constructorArgs), "utf8");
  if (deploymentInputBytes >= MAX_DEPLOYMENT_INPUT_BYTES) {
    throw new Error(
      `Deployment input is ${deploymentInputBytes} bytes; portable ceiling is below ${MAX_DEPLOYMENT_INPUT_BYTES}`,
    );
  }
  const checkpoint = loadCheckpoint(
    outputPath,
    checkpointBase({
      client,
      genvmChainId,
      code,
      sourceCommit,
      policyInput,
      policy,
      fixture,
      expected,
      fixtureProof,
      livePolicyBytes,
      harnessBytes,
      proofHarnessCommit,
    }),
  );
  checkpoint.source.proof_harness_commit = proofHarnessCommit;
  checkpoint.source.proof_harness_git_object_verified =
    "deploy/001_deploy_and_verify.js";
  checkpoint.source.harness_sha256 = sha256(harnessBytes);
  checkpoint.deployment_input_bytes = deploymentInputBytes;
  checkpoint.fixture_http_proof = fixtureProof;
  saveCheckpoint(outputPath, checkpoint);

  let deploymentHash = envOrCheckpoint(
    "ASSET_MAPPER_DEPLOYMENT_TX",
    checkpoint.deployment.transaction,
  );
  if (deploymentHash) assertHash(deploymentHash, "ASSET_MAPPER_DEPLOYMENT_TX");
  if (!deploymentHash) {
    if (checkpoint.deployment.submission_intent_recorded === true) {
      throw new Error(
        "Deployment has a durable submission intent but no transaction hash; " +
          "recover ASSET_MAPPER_DEPLOYMENT_TX or use a fresh output instead of redeploying",
      );
    }
    checkpoint.deployment.submission_intent_recorded = true;
    checkpoint.deployment.constructor_args = constructorArgs;
    checkpoint.deployment.evm_gas_ceiling =
      BRADBURY_DEPLOYMENT_EVM_GAS_LIMIT.toString();
    saveCheckpoint(outputPath, checkpoint);
    deploymentHash = await withBradburyDeploymentGasCeiling(client, () =>
      client.deployContract({
        code,
        args: constructorArgs,
        leaderOnly: false,
      }),
    );
    assertHash(deploymentHash, "ASSET_MAPPER_DEPLOYMENT_TX");
    checkpoint.deployment.transaction = deploymentHash;
    saveCheckpoint(outputPath, checkpoint);
    console.log(`ASSET_MAPPER_DEPLOYMENT_TX=${deploymentHash}`);
  }
  if (!checkpoint.deployment.submission_intent_recorded) {
    checkpoint.deployment.submission_intent_recorded = true;
    checkpoint.deployment.constructor_args = constructorArgs;
    checkpoint.deployment.evm_gas_ceiling =
      BRADBURY_DEPLOYMENT_EVM_GAS_LIMIT.toString();
    checkpoint.deployment.transaction = deploymentHash;
    saveCheckpoint(outputPath, checkpoint);
  }

  const deploymentAccepted = await waitReceipt(
    client,
    deploymentHash,
    "ACCEPTED",
    "Deployment",
    true,
  );
  const address = deployedAddress(deploymentAccepted);
  const configuredAddress = envOrCheckpoint(
    "ASSET_MAPPER_CONTRACT_ADDRESS",
    checkpoint.deployment.contract_address,
  );
  if (configuredAddress && configuredAddress.toLowerCase() !== address.toLowerCase()) {
    throw new Error("ASSET_MAPPER_CONTRACT_ADDRESS conflicts with deployment receipt");
  }
  const deploymentTransaction = await verifiedTransaction(
    client,
    deploymentHash,
    "Deployment",
    (candidate) => assertDeploymentProvenance(candidate, address, code, constructorArgs),
  );
  const deployer = assertDeploymentProvenance(
    deploymentTransaction,
    address,
    code,
    constructorArgs,
  );
  Object.assign(checkpoint.deployment, {
    transaction: deploymentHash,
    contract_address: address,
    deployer,
    decoded_provenance: {
      type: "deploy",
      recipient: address.toLowerCase(),
      source_sha256: checkpoint.source.sha256,
      constructor_args: constructorArgs,
      sender: deployer,
      leader_only: false,
      verified: true,
    },
    transaction_gas_limit:
      deploymentTransaction?.gaslimit ?? deploymentTransaction?.gasLimit ?? null,
    accepted_consensus: consensusSummary(deploymentAccepted),
    accepted_receipt: plainValue(deploymentAccepted),
  });
  checkpoint.contract_address = address;
  saveCheckpoint(outputPath, checkpoint);
  console.log(`ASSET_MAPPER_CONTRACT_ADDRESS=${address}`);

  await finalizeWhenReady(
    client,
    deploymentHash,
    "Deployment",
    checkpoint.deployment,
    "ASSET_MAPPER_DEPLOYMENT",
    checkpoint,
    outputPath,
  );
  const deployedCode = await retryRead("Finalized deployed source", () =>
    client.getContractCode(address),
  );
  if (deployedCode !== code) {
    throw new Error("Finalized deployed source differs from local source");
  }
  const schema = await retryRead("Finalized contract schema", () =>
    client.getContractSchema(address),
  );
  assertSchema(schema);
  const onchainPolicy = await retryRead("Finalized immutable policy", () =>
    read(client, address, "get_policy", [], "latest-final"),
  );
  const canonicalPolicyJson = checkpoint.constructor.canonical_policy_json;
  const expectedPolicyDigest = checkpoint.constructor.expected_policy_digest;
  if (
    onchainPolicy?.contract_version !== CONTRACT_VERSION ||
    onchainPolicy?.policy_schema !== POLICY_SCHEMA ||
    onchainPolicy?.policy_json !== canonicalPolicyJson ||
    onchainPolicy?.policy_digest !== expectedPolicyDigest
  ) {
    throw new Error(`Unexpected finalized policy: ${jsonString(onchainPolicy)}`);
  }
  assertPolicyFixture(JSON.parse(onchainPolicy.policy_json), fixture, expected);
  checkpoint.policy = plainValue(onchainPolicy);
  checkpoint.policy_digest = onchainPolicy.policy_digest;
  saveCheckpoint(outputPath, checkpoint);

  if (!checkpoint.semantic_smoke.transaction) {
    const count = Number(
      await retryRead("Fresh finalized mapping count", () =>
        read(client, address, "get_mapping_count", [], "latest-final"),
      ),
    );
    if (!Number.isSafeInteger(count) || count !== 0) {
      throw new Error(
        `Fresh proof deployment has mapping count ${count}; use a fresh deployment/output`,
      );
    }
  }

  await submitExactMapping(
    client,
    address,
    deployer,
    onchainPolicy.policy_digest,
    fixture,
    expected,
    checkpoint,
    outputPath,
  );

  checkpoint.record_status = "COMPLETE";
  checkpoint.finalized = true;
  checkpoint.transactions = {
    deployment: checkpoint.deployment.transaction,
    semantic_mapping: checkpoint.semantic_smoke.transaction,
  };
  checkpoint.finalization_evm_transactions = {
    deployment: checkpoint.deployment.finalization_evm_transaction,
    semantic_mapping: checkpoint.semantic_smoke.finalization_evm_transaction,
  };
  checkpoint.finalization_broadcast_transactions = {
    deployment:
      checkpoint.deployment.finalization_broadcast_transaction || null,
    semantic_mapping:
      checkpoint.semantic_smoke.finalization_broadcast_transaction || null,
  };
  checkpoint.digests = {
    evm_chain_id: checkpoint.network.evm_chain_id,
    genvm_chain_id: checkpoint.network.genvm_chain_id,
    source_sha256: checkpoint.source.sha256,
    policy_input_sha256: checkpoint.constructor.policy_input_sha256,
    policy_digest: checkpoint.policy_digest,
    ...checkpoint.semantic_smoke.digests,
  };
  checkpoint.limitations = {
    collection_authenticity_boundary:
      "Exact immutable source host/path bindings; not token ownership or legal-rights proof.",
    redirect_destination_observable: false,
    public_evidence_only: true,
    vision_consensus_correlated_error_possible: true,
    mapping_scope: "ONE_CLOSED_POLICY_PROFILE_ONLY",
    deployment_evm_gas_ceiling: BRADBURY_DEPLOYMENT_EVM_GAS_LIMIT.toString(),
    deployment_evm_gas_ceiling_scope: "DEPLOYMENT_ESTIMATION_ONLY",
    release_policy_scope:
      "EXACT_COMMITTED_SINGLE_SOURCE_SINGLE_PROFILE_EMBERGUARD_POLICY",
  };
  saveCheckpoint(outputPath, checkpoint);
  console.log(`ASSET_MAPPER_DEPLOYMENT_RESULT=${jsonString(checkpoint)}`);
}
