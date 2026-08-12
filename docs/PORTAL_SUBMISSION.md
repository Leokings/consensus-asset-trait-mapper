# Portal Submission Draft

This draft reports the successful deployment and semantic timeout separately.
Reviewers must have access to this private repository, or the repository must be
made public before submission.

**Title**

```text
Consensus Asset Admission & Trait Mapper - Reusable Intelligent Contract
```

**Notes / Description**

```text
Built and deployed an MIT-licensed Consensus Asset Admission & Trait Mapper, a reusable GenLayer Intelligent Contract. Apps submit metadata and a bounded PNG with SHA-256 commitments; immutable policy binds exact source paths and closed trait profiles.

The leader verifies both sources and selects one profile. Validators re-fetch the bytes and audit the visual judgment. Deterministic code derives class, element, rarity and power, enforces caps, sender-scopes requests and reserves identity only after MAPPED.

Includes strict JSON/PNG validation, prompt-injection defenses and deployment-bound digests, with 84 direct, 7 Python tooling and 18 JavaScript proof tests. StudioNet's harness reported MAPPED. Bradbury deployment finalized 5/5 AGREE; its semantic smoke ended in validator timeout (SDK: 1 deterministic violation + 4 timeouts; Explorer: 1 NONDET_DISAGREE + 4 timeouts) and created no state. The release harness recorded no retry. The audit makes no finalized Bradbury mapping claim.
```

Character count: **996/1000**, including the two blank-line separators inside
the code block and excluding the code-fence markers.

**Evidence entries**

1. **GitHub Repository**  
   `https://github.com/Leokings/consensus-asset-trait-mapper`

2. **GenLayer Explorer Contract**  
   `https://explorer-bradbury.genlayer.com/address/0x60F385056d8FD7d4CFcD496764Ff92EDf5Ce6Bf7`

3. **GitHub File - exact contract source**
   `https://github.com/Leokings/consensus-asset-trait-mapper/blob/9704da33003b74755315ab1d05e5f2cf8ac90501/contracts/ConsensusAssetAdmissionTraitMapper.py`

4. **GitHub File - deployment and timeout audit**
   `PROOF_AUDIT_COMMIT_PINNED_URL`

**Contribution date**

```text
08/12/2026
```

**Category**

```text
Intelligent Contracts
```

Before submission, replace the proof-audit URL after its commit, make private
evidence accessible to reviewers, preserve the semantic-timeout disclosure, and
complete the CAPTCHA manually.
