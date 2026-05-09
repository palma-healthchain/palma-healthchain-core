# HealthChain Core

**Merkle root registry smart contract — Palma HealthChain trust layer**

> Open-source · MIT License · Non-commercial · Standards-based  
> Part of the [Palma HealthChain](https://github.com/palma-healthchain) project

---

## What this is

HealthChain Core is the on-chain component of Palma HealthChain — an open-source trust infrastructure for patient-held health credentials in Saudi Arabia.

The smart contract does one thing: it records cryptographic commitments (Merkle roots) to sets of patient health credentials, enabling any verifier to confirm a credential's authenticity without any protected health information (PHI) ever touching the blockchain.

**What is stored on-chain:** patient DID (pseudonymous), Merkle root, block timestamp, issuer DID, schema version.  
**What is never stored on-chain:** credential content, clinical data, legal names, national IDs, or any personal health information.

## Architecture

```
Hospital EHR (Nphies-connected)
    ↓ FHIR R4 resources
PalmaAI pipeline
    ↓ SD-JWT-VC credentials
Patient Wallet (OID4VCI)
    ↓ Merkle root
HealthChainCore.anchorRoot()   ← this contract
    ↓
Avalanche L1 subnet (immutable record)

Verification flow:
Verifier ← OID4VP ← Patient Wallet
    ↓ Merkle proof
HealthChainCore.verifyCredential()
```

Full architecture: [Palma HealthChain Whitepaper v0.1](../palma-whitepaper/)

## Avalanche compiler note

**Critical:** Avalanche Subnet-EVM implements the **Cancun** EVM fork. Solidity ≥ 0.8.30 defaults to the Pectra EVM target, which produces incompatible bytecode. All compilation must use `evmVersion: "cancun"` (set in `hardhat.config.ts`).

## Quick start

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Run tests
npm test

# Run local demo (full credential lifecycle)
npm run demo:local

# Deploy to Fuji testnet
cp .env.example .env
# populate .env with your keys
npm run deploy:fuji

# Run testnet demo
npm run demo:fuji
```

## Contract interface

```solidity
// Anchor a Merkle root for a patient credential set
function anchorRoot(string calldata patientDid, bytes32 merkleRoot) external;

// Get the most recent valid root
function getLatestRoot(string calldata patientDid) external view
    returns (bytes32 merkleRoot, uint64 timestamp, uint16 schemaVersion,
             string memory issuerDid, uint256 anchorIndex);

// Verify a credential's Merkle proof
function verifyCredential(string calldata patientDid, bytes32 leaf, bytes32[] calldata proof)
    external view returns (bool valid, uint64 timestamp, bool revoked);

// Revoke an anchor (issuer only, permanent)
function revokeAnchor(string calldata patientDid, uint256 anchorIndex,
                      string calldata reason) external;

// Issuer management (owner only)
function authorizeIssuer(address issuerAddress, string calldata issuerDid,
                         string calldata name) external;
```

## Merkle leaf construction

Each credential in a patient's set contributes one Merkle leaf:

```
leaf = keccak256(abi.encodePacked(credentialId, issuerDid, assertedDate, claimHash))
```

Where `claimHash` is a hash of the full SD-JWT credential payload including all disclosure hashes. Leaves are sorted before tree construction for deterministic roots.

## Fuji testnet deployment

| | |
|---|---|
| Network | Avalanche Fuji Testnet |
| Chain ID | 43113 |
| Contract | *(published after initial deployment)* |
| Explorer | https://testnet.snowtrace.io |

## Design decisions

**Immutable contract** — no proxy, no upgrade key. Future versions deploy as new contracts. Historical anchors are permanently verifiable. See whitepaper Section 6 for the upgrade strategy.

**No PHI on-chain** — demonstrated by construction: the contract has no fields, events, or state that could contain clinical information. Patient DID is pseudonymous. Merkle roots are opaque.

**Minimal Solidity** — the contract is intentionally simple. Every line that doesn't exist cannot contain a vulnerability. Complex business logic belongs off-chain.

**Two-step ownership** — ownership transfer requires both initiation and acceptance, preventing accidental transfer to a wrong address.

## License

MIT — see [LICENSE](LICENSE)

## Part of Palma HealthChain

- [`palma-healthchain/healthchain-core`](https://github.com/palma-healthchain/healthchain-core) — this repo
- [`palma-healthchain/palma-schema`](https://github.com/palma-healthchain/palma-schema) — credential type registry
- [`palma-healthchain/palmaai-pipeline`](https://github.com/palma-healthchain/palmaai-pipeline) — FHIR-to-credential pipeline
- [`palma-healthchain/palma-whitepaper`](https://github.com/palma-healthchain/palma-whitepaper) — technical whitepaper
