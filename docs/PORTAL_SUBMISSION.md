# Portal Submission Draft

Use this only after a real finalized Bradbury record exists and reviewers can access the evidence.

**Title**

```text
Consensus Asset Admission & Trait Mapper — Reusable Intelligent Contract
```

**Notes / Description**

```text
Built an MIT-licensed Consensus Asset Admission & Trait Mapper, a reusable GenLayer Intelligent Contract for games. A caller submits public metadata and an asset image with SHA-256 commitments. Each collection is immutably bound to exact metadata and image host/path prefixes. Results are MAPPED, AMBIGUOUS, INELIGIBLE_COLLECTION, UNSUPPORTED_ASSET, METADATA_CONFLICT, SOURCE_UNAVAILABLE, INTEGRITY_FAILURE, INVALID_SOURCE_FORMAT, or CONTENT_LIMIT.

This uses real vision consensus, not a backend classifier. The leader fetches the committed bytes and selects only one closed trait profile. Validators independently re-fetch the evidence and audit the exact proposal. Deterministic code derives class, element, rarity, and power from the profile, enforces caps, sender-scopes requests, and reserves an asset only after MAPPED. Includes prompt-injection defenses, strict JSON/source limits, 57 direct tests, finality-enforcing integration/deployment tooling, documentation, and MIT reuse rights.
```

**Evidence entries**

1. **GitHub Repository**  
   `PRIVATE_REPOSITORY_URL`

2. **GenLayer Explorer Contract**  
   `BRADBURY_EXPLORER_URL`

3. **GitHub File — exact contract source**  
   `COMMIT_PINNED_CONTRACT_URL`

4. **GitHub File — finalized deployment proof**  
   `COMMIT_PINNED_DEPLOYMENT_JSON_URL`

**Contribution date**

```text
08/12/2026
```

**Category**

```text
Intelligent Contracts
```

Before submission, replace every placeholder, confirm the deployment proof records successful finalized execution and validator evidence, make private evidence accessible to reviewers, and complete the CAPTCHA manually.
