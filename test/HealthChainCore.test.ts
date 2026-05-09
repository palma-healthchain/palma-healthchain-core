import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { HealthChainCore } from "../typechain-types";
import { keccak256, toUtf8Bytes, solidityPackedKeccak256 } from "ethers";

// ─── MERKLE TREE UTILITIES ────────────────────────────────────────────────────
// These helpers mirror the off-chain Merkle construction logic that PalmaAI
// will implement in the production pipeline. Tests use these to generate valid
// proofs and roots.

/**
 * Compute a single Merkle leaf from credential components.
 * Mirrors the specification in the whitepaper Section 6.1.
 */
function computeLeaf(
  credentialId: string,
  issuerDid: string,
  assertedDate: string,
  claimHash: string
): string {
  return solidityPackedKeccak256(
    ["string", "string", "string", "bytes32"],
    [credentialId, issuerDid, assertedDate, claimHash]
  );
}

/**
 * Compute a Merkle root from a set of leaves (sorted for determinism).
 */
function computeMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return ethers.ZeroHash;
  if (leaves.length === 1) return leaves[0];

  const sorted = [...leaves].sort();
  let level = sorted;

  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) {
        next.push(level[i]); // Odd leaf carries up
      } else {
        const [a, b] = [level[i], level[i + 1]].sort();
        next.push(solidityPackedKeccak256(["bytes32", "bytes32"], [a, b]));
      }
    }
    level = next;
  }
  return level[0];
}

/**
 * Generate a Merkle proof for a specific leaf in a set.
 */
function generateProof(leaves: string[], targetLeaf: string): string[] {
  const sorted = [...leaves].sort();
  let idx = sorted.indexOf(targetLeaf);
  if (idx === -1) throw new Error("Leaf not in set");

  const proof: string[] = [];
  let level = sorted;

  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) {
        if (i === idx) {
          // This leaf carries up — no sibling to add
          idx = next.length;
        }
        next.push(level[i]);
      } else {
        if (i === idx || i + 1 === idx) {
          const sibling = i === idx ? level[i + 1] : level[i];
          proof.push(sibling);
          idx = next.length;
        }
        const [a, b] = [level[i], level[i + 1]].sort();
        next.push(solidityPackedKeccak256(["bytes32", "bytes32"], [a, b]));
      }
    }
    level = next;
  }
  return proof;
}

// ─── TEST FIXTURES ────────────────────────────────────────────────────────────

const PATIENT_DID  = "did:palma:patient:7f2b4a9e1c3d5f8b";
const ISSUER_DID   = "did:palma:facility:king-faisal-riyadh";
const ISSUER_NAME  = "King Faisal Specialist Hospital, Riyadh";

// Sample credentials for Merkle tree construction
const CRED_1 = {
  id: "urn:uuid:allergy-001",
  issuerDid: ISSUER_DID,
  date: "2024-03-15",
  claimHash: ethers.id("AllergyIntolerance:Amoxicillin:high"),
};

const CRED_2 = {
  id: "urn:uuid:immunization-001",
  issuerDid: ISSUER_DID,
  date: "2023-09-15",
  claimHash: ethers.id("Immunization:COVID19:completed"),
};

const CRED_3 = {
  id: "urn:uuid:condition-001",
  issuerDid: ISSUER_DID,
  date: "2022-01-10",
  claimHash: ethers.id("Condition:T2Diabetes:active"),
};

// ─── TEST SUITE ───────────────────────────────────────────────────────────────

describe("HealthChainCore", () => {
  let contract: HealthChainCore;
  let owner: SignerWithAddress;
  let issuer: SignerWithAddress;
  let issuer2: SignerWithAddress;
  let verifier: SignerWithAddress;
  let stranger: SignerWithAddress;

  // Pre-computed leaves and roots for the sample credential set
  let leaf1: string, leaf2: string, leaf3: string;
  let merkleRoot3: string; // Root of all three credentials

  beforeEach(async () => {
    [owner, issuer, issuer2, verifier, stranger] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("HealthChainCore");
    contract = await Factory.deploy(owner.address);
    await contract.waitForDeployment();

    // Authorize the primary issuer
    await contract.connect(owner).authorizeIssuer(issuer.address, ISSUER_DID, ISSUER_NAME);

    // Pre-compute Merkle leaves
    leaf1 = computeLeaf(CRED_1.id, CRED_1.issuerDid, CRED_1.date, CRED_1.claimHash);
    leaf2 = computeLeaf(CRED_2.id, CRED_2.issuerDid, CRED_2.date, CRED_2.claimHash);
    leaf3 = computeLeaf(CRED_3.id, CRED_3.issuerDid, CRED_3.date, CRED_3.claimHash);
    merkleRoot3 = computeMerkleRoot([leaf1, leaf2, leaf3]);
  });

  // ── Deployment ────────────────────────────────────────────────────────────

  describe("Deployment", () => {
    it("sets the correct owner", async () => {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("exposes the correct version", async () => {
      expect(await contract.VERSION()).to.equal("0.1.0");
    });

    it("exposes the correct schema version", async () => {
      expect(await contract.SCHEMA_VERSION()).to.equal(1);
    });

    it("reverts if deployed with zero address owner", async () => {
      const Factory = await ethers.getContractFactory("HealthChainCore");
      await expect(Factory.deploy(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(contract, "ZeroAddress");
    });
  });

  // ── Issuer Management ─────────────────────────────────────────────────────

  describe("Issuer management", () => {
    it("authorizes a new issuer (owner only)", async () => {
      const tx = await contract.connect(owner)
        .authorizeIssuer(issuer2.address, "did:palma:facility:riyadh-medical", "Riyadh Medical City");

      await expect(tx)
        .to.emit(contract, "IssuerAuthorized")
        .withArgs(issuer2.address, "did:palma:facility:riyadh-medical", "Riyadh Medical City");

      expect(await contract.authorizedIssuers(issuer2.address)).to.be.true;
    });

    it("reverts if non-owner tries to authorize an issuer", async () => {
      await expect(
        contract.connect(stranger).authorizeIssuer(issuer2.address, "did:palma:facility:test", "Test")
      ).to.be.revertedWithCustomError(contract, "NotOwner");
    });

    it("reverts if authorizing an already-authorized issuer", async () => {
      await expect(
        contract.connect(owner).authorizeIssuer(issuer.address, ISSUER_DID, ISSUER_NAME)
      ).to.be.revertedWithCustomError(contract, "IssuerAlreadyAuthorized");
    });

    it("deauthorizes an issuer", async () => {
      const tx = await contract.connect(owner).deauthorizeIssuer(issuer.address, "Key compromise");
      await expect(tx).to.emit(contract, "IssuerDeauthorized").withArgs(issuer.address, "Key compromise");
      expect(await contract.authorizedIssuers(issuer.address)).to.be.false;
    });

    it("deauthorized issuer cannot anchor new roots", async () => {
      await contract.connect(owner).deauthorizeIssuer(issuer.address, "Test deauth");
      await expect(
        contract.connect(issuer).anchorRoot(PATIENT_DID, merkleRoot3)
      ).to.be.revertedWithCustomError(contract, "NotAuthorizedIssuer");
    });

    it("deauthorized issuer's previous anchors remain valid", async () => {
      await contract.connect(issuer).anchorRoot(PATIENT_DID, merkleRoot3);
      await contract.connect(owner).deauthorizeIssuer(issuer.address, "Test deauth");

      const [root] = await contract.getLatestRoot(PATIENT_DID);
      expect(root).to.equal(merkleRoot3);
    });
  });

  // ── Anchoring ─────────────────────────────────────────────────────────────

  describe("Anchoring roots", () => {
    it("anchors a Merkle root and emits RootAnchored", async () => {
      const tx = await contract.connect(issuer).anchorRoot(PATIENT_DID, merkleRoot3);

      await expect(tx)
        .to.emit(contract, "RootAnchored")
        .withArgs(
          keccak256(toUtf8Bytes(PATIENT_DID)),
          merkleRoot3,
          issuer.address,
          ISSUER_DID,
          0,           // first anchor index
          1,           // schema version
          await ethers.provider.getBlock("latest").then(b => b!.timestamp)
        );
    });

    it("reverts if unauthorized address tries to anchor", async () => {
      await expect(
        contract.connect(stranger).anchorRoot(PATIENT_DID, merkleRoot3)
      ).to.be.revertedWithCustomError(contract, "NotAuthorizedIssuer");
    });

    it("reverts if merkleRoot is zero", async () => {
      await expect(
        contract.connect(issuer).anchorRoot(PATIENT_DID, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(contract, "EmptyMerkleRoot");
    });

    it("reverts if patientDid is empty", async () => {
      await expect(
        contract.connect(issuer).anchorRoot("", merkleRoot3)
      ).to.be.revertedWithCustomError(contract, "EmptyDid");
    });

    it("reverts if patientDid exceeds MAX_DID_LENGTH", async () => {
      const longDid = "did:palma:patient:" + "x".repeat(250);
      await expect(
        contract.connect(issuer).anchorRoot(longDid, merkleRoot3)
      ).to.be.revertedWithCustomError(contract, "DidTooLong");
    });

    it("allows multiple anchors for the same patient (credential set updates)", async () => {
      await contract.connect(issuer).anchorRoot(PATIENT_DID, merkleRoot3);
      const updatedRoot = computeMerkleRoot([leaf1, leaf2]);
      await contract.connect(issuer).anchorRoot(PATIENT_DID, updatedRoot);

      expect(await contract.anchorCount(keccak256(toUtf8Bytes(PATIENT_DID)))).to.equal(2);
    });

    it("correctly tracks hasAnchors", async () => {
      expect(await contract.hasAnchors(PATIENT_DID)).to.be.false;
      await contract.connect(issuer).anchorRoot(PATIENT_DID, merkleRoot3);
      expect(await contract.hasAnchors(PATIENT_DID)).to.be.true;
    });
  });

  // ── Retrieval ─────────────────────────────────────────────────────────────

  describe("Root retrieval", () => {
    beforeEach(async () => {
      await contract.connect(issuer).anchorRoot(PATIENT_DID, merkleRoot3);
    });

    it("getLatestRoot returns the most recent valid root", async () => {
      const [root, , , issuerDid] = await contract.getLatestRoot(PATIENT_DID);
      expect(root).to.equal(merkleRoot3);
      expect(issuerDid).to.equal(ISSUER_DID);
    });

    it("getLatestRoot returns zero values for unknown patient", async () => {
      const [root] = await contract.getLatestRoot("did:palma:patient:unknown");
      expect(root).to.equal(ethers.ZeroHash);
    });

    it("getAnchorAt returns the correct record", async () => {
      const [root, , , revoked, issuerDid] = await contract.getAnchorAt(PATIENT_DID, 0);
      expect(root).to.equal(merkleRoot3);
      expect(revoked).to.be.false;
      expect(issuerDid).to.equal(ISSUER_DID);
    });

    it("getAnchorAt reverts on invalid index", async () => {
      await expect(contract.getAnchorAt(PATIENT_DID, 99))
        .to.be.revertedWithCustomError(contract, "InvalidAnchorIndex");
    });

    it("getRootAtTime returns the correct historical root", async () => {
      const block = await ethers.provider.getBlock("latest");
      const [root] = await contract.getRootAtTime(PATIENT_DID, block!.timestamp);
      expect(root).to.equal(merkleRoot3);
    });

    it("getRootAtTime returns zero for a timestamp before any anchor", async () => {
      const [root] = await contract.getRootAtTime(PATIENT_DID, 1000); // unix timestamp well before
      expect(root).to.equal(ethers.ZeroHash);
    });

    it("getLatestRoot returns most recent after multiple updates", async () => {
      const root2 = computeMerkleRoot([leaf1, leaf2]);
      await contract.connect(issuer).anchorRoot(PATIENT_DID, root2);

      const [latestRoot, , , , index] = await contract.getLatestRoot(PATIENT_DID);
      expect(latestRoot).to.equal(root2);
      expect(index).to.equal(1);
    });
  });

  // ── Verification ──────────────────────────────────────────────────────────

  describe("Merkle proof verification", () => {
    beforeEach(async () => {
      await contract.connect(issuer).anchorRoot(PATIENT_DID, merkleRoot3);
    });

    it("verifies a valid proof for leaf1 (allergy credential)", async () => {
      const proof = generateProof([leaf1, leaf2, leaf3], leaf1);
      const [valid, , revoked] = await contract.verifyCredential(PATIENT_DID, leaf1, proof);
      expect(valid).to.be.true;
      expect(revoked).to.be.false;
    });

    it("verifies a valid proof for leaf2 (immunization credential)", async () => {
      const proof = generateProof([leaf1, leaf2, leaf3], leaf2);
      const [valid] = await contract.verifyCredential(PATIENT_DID, leaf2, proof);
      expect(valid).to.be.true;
    });

    it("verifies a valid proof for leaf3 (condition credential)", async () => {
      const proof = generateProof([leaf1, leaf2, leaf3], leaf3);
      const [valid] = await contract.verifyCredential(PATIENT_DID, leaf3, proof);
      expect(valid).to.be.true;
    });

    it("rejects a tampered proof (wrong sibling)", async () => {
      const proof = generateProof([leaf1, leaf2, leaf3], leaf1);
      proof[0] = ethers.id("tampered"); // replace first sibling
      const [valid] = await contract.verifyCredential(PATIENT_DID, leaf1, proof);
      expect(valid).to.be.false;
    });

    it("rejects a valid proof against the wrong leaf", async () => {
      const proof = generateProof([leaf1, leaf2, leaf3], leaf1);
      const [valid] = await contract.verifyCredential(PATIENT_DID, leaf2, proof);
      expect(valid).to.be.false;
    });

    it("rejects verification for a patient with no anchors", async () => {
      const proof = generateProof([leaf1, leaf2, leaf3], leaf1);
      const [valid] = await contract.verifyCredential("did:palma:patient:unknown", leaf1, proof);
      expect(valid).to.be.false;
    });

    it("verifies against the most recent anchor after an update", async () => {
      // Update: patient adds a new credential, root changes
      const leaf4 = computeLeaf("urn:uuid:med-001", ISSUER_DID, "2025-01-01", ethers.id("Medication:Metformin:active"));
      const newRoot = computeMerkleRoot([leaf1, leaf2, leaf3, leaf4]);
      await contract.connect(issuer).anchorRoot(PATIENT_DID, newRoot);

      // leaf4 is now provable (new root)
      const proof4 = generateProof([leaf1, leaf2, leaf3, leaf4], leaf4);
      const [valid4] = await contract.verifyCredential(PATIENT_DID, leaf4, proof4);
      expect(valid4).to.be.true;

      // leaf1 proof against old root is now invalid (different root is current)
      const oldProof1 = generateProof([leaf1, leaf2, leaf3], leaf1);
      const [valid1old] = await contract.verifyCredential(PATIENT_DID, leaf1, oldProof1);
      expect(valid1old).to.be.false;

      // leaf1 proof against new root is valid
      const newProof1 = generateProof([leaf1, leaf2, leaf3, leaf4], leaf1);
      const [valid1new] = await contract.verifyCredential(PATIENT_DID, leaf1, newProof1);
      expect(valid1new).to.be.true;
    });
  });

  // ── Revocation ────────────────────────────────────────────────────────────

  describe("Anchor revocation", () => {
    beforeEach(async () => {
      await contract.connect(issuer).anchorRoot(PATIENT_DID, merkleRoot3);
    });

    it("issuer can revoke their own anchor", async () => {
      const tx = await contract.connect(issuer).revokeAnchor(PATIENT_DID, 0, "Subpotent batch detected");
      await expect(tx)
        .to.emit(contract, "AnchorRevoked")
        .withArgs(keccak256(toUtf8Bytes(PATIENT_DID)), 0, issuer.address, "Subpotent batch detected");

      const [, , , revoked] = await contract.getAnchorAt(PATIENT_DID, 0);
      expect(revoked).to.be.true;
    });

    it("getLatestRoot skips revoked anchors", async () => {
      await contract.connect(issuer).revokeAnchor(PATIENT_DID, 0, "Error");
      const [root] = await contract.getLatestRoot(PATIENT_DID);
      expect(root).to.equal(ethers.ZeroHash); // No valid anchors remain
    });

    it("verification fails against a revoked anchor", async () => {
      await contract.connect(issuer).revokeAnchor(PATIENT_DID, 0, "Error");
      const proof = generateProof([leaf1, leaf2, leaf3], leaf1);
      const [valid, , revoked] = await contract.verifyCredential(PATIENT_DID, leaf1, proof);
      expect(valid).to.be.false;
    });

    it("a new anchor after revocation is queryable", async () => {
      await contract.connect(issuer).revokeAnchor(PATIENT_DID, 0, "Error");
      const newRoot = computeMerkleRoot([leaf1, leaf2]);
      await contract.connect(issuer).anchorRoot(PATIENT_DID, newRoot);

      const [root, , , , index] = await contract.getLatestRoot(PATIENT_DID);
      expect(root).to.equal(newRoot);
      expect(index).to.equal(1);
    });

    it("reverts if revoking an already-revoked anchor", async () => {
      await contract.connect(issuer).revokeAnchor(PATIENT_DID, 0, "First revocation");
      await expect(
        contract.connect(issuer).revokeAnchor(PATIENT_DID, 0, "Second revocation")
      ).to.be.revertedWithCustomError(contract, "AlreadyRevoked");
    });

    it("reverts if a different issuer tries to revoke another issuer's anchor", async () => {
      await contract.connect(owner).authorizeIssuer(
        issuer2.address, "did:palma:facility:jeddah-national", "Jeddah National Hospital"
      );
      await expect(
        contract.connect(issuer2).revokeAnchor(PATIENT_DID, 0, "Hostile revocation")
      ).to.be.revertedWithCustomError(contract, "NotAnchorIssuer");
    });

    it("reverts on invalid anchor index during revocation", async () => {
      await expect(
        contract.connect(issuer).revokeAnchor(PATIENT_DID, 99, "Bad index")
      ).to.be.revertedWithCustomError(contract, "InvalidAnchorIndex");
    });
  });

  // ── Ownership ─────────────────────────────────────────────────────────────

  describe("Two-step ownership transfer", () => {
    it("initiates ownership transfer to a new owner", async () => {
      const tx = await contract.connect(owner).transferOwnership(stranger.address);
      await expect(tx)
        .to.emit(contract, "OwnershipTransferInitiated")
        .withArgs(owner.address, stranger.address);
      expect(await contract.pendingOwner()).to.equal(stranger.address);
    });

    it("completes ownership transfer when pendingOwner calls acceptOwnership", async () => {
      await contract.connect(owner).transferOwnership(stranger.address);
      const tx = await contract.connect(stranger).acceptOwnership();
      await expect(tx)
        .to.emit(contract, "OwnershipTransferred")
        .withArgs(owner.address, stranger.address);
      expect(await contract.owner()).to.equal(stranger.address);
    });

    it("reverts if wrong address calls acceptOwnership", async () => {
      await contract.connect(owner).transferOwnership(stranger.address);
      await expect(
        contract.connect(issuer).acceptOwnership()
      ).to.be.revertedWithCustomError(contract, "NoPendingTransfer");
    });

    it("reverts if non-owner tries to initiate transfer", async () => {
      await expect(
        contract.connect(stranger).transferOwnership(stranger.address)
      ).to.be.revertedWithCustomError(contract, "NotOwner");
    });
  });

  // ── Gas estimation ────────────────────────────────────────────────────────

  describe("Gas usage", () => {
    it("reports gas for anchorRoot", async () => {
      const tx = await contract.connect(issuer).anchorRoot.estimateGas(PATIENT_DID, merkleRoot3);
      console.log(`    anchorRoot gas estimate: ${tx.toString()}`);
      // A health credential anchor should be well under 100k gas on Avalanche
      expect(tx).to.be.lessThan(200_000n);
    });

    it("reports gas for verifyCredential (3-leaf tree, 2-step proof)", async () => {
      await contract.connect(issuer).anchorRoot(PATIENT_DID, merkleRoot3);
      const proof = generateProof([leaf1, leaf2, leaf3], leaf1);
      const gas = await contract.verifyCredential.estimateGas(PATIENT_DID, leaf1, proof);
      console.log(`    verifyCredential gas estimate: ${gas.toString()}`);
    });
  });
});
