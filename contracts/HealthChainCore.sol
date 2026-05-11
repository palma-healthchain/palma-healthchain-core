// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============================================================================
//  HealthChain Core — Merkle Root Registry
//  Palma HealthChain · github.com/palma-healthchain
//  Version: 0.1.0
//
//  PURPOSE
//  -------
//  This contract is the on-chain trust anchor for Palma HealthChain.
//  It stores cryptographic commitments (Merkle roots) to sets of patient
//  health credentials, enabling any verifier to confirm a credential's
//  authenticity without any protected health information (PHI) ever
//  touching the blockchain.
//
//  WHAT IS STORED ON-CHAIN
//  ------------------------
//  - Patient DID (pseudonymous identifier — no linkage to legal identity)
//  - Merkle root (32-byte hash commitment to a credential set)
//  - Block timestamp of the anchor event
//  - Issuer DID (public — which institution anchored the root)
//  - Schema version (for forward compatibility)
//
//  WHAT IS NEVER STORED ON-CHAIN
//  ------------------------------
//  - Credential content of any kind
//  - Clinical data, diagnoses, medications, allergies
//  - Legal names, national IDs, or any personal identifiers
//  - Individual credential hashes (only the Merkle root of the set)
//
//  ARCHITECTURE NOTES
//  ------------------
//  The contract is intentionally minimal. Complex business logic, access
//  control hierarchies, and governance mechanisms belong off-chain or in
//  separate contracts. This contract does one thing: it records that a
//  specific issuer committed a specific Merkle root for a specific patient
//  DID at a specific time. That is its entire function.
//
//  UPGRADE STRATEGY
//  ----------------
//  This contract is NOT upgradeable by design. Upgradeability introduces
//  trust assumptions (who controls the upgrade key?) that are incompatible
//  with a public-good trust infrastructure. Instead:
//  - The contract version is embedded in every anchor event
//  - Future versions deploy as NEW contracts at new addresses
//  - The IssuerRegistry (separate contract) maintains a mapping of
//    contract addresses → supported schema versions
//  - Verifiers query the IssuerRegistry to find the correct contract
//    address for a given schema version
//  - Historical anchors in old contracts remain permanently verifiable
//
//  SOLIDITY COMPILER NOTE
//  ----------------------
//  Compile with evmVersion = "cancun" for Avalanche Subnet-EVM compatibility.
//  Avalanche implements the Cancun EVM fork. Do NOT use the default Solidity
//  >=0.8.30 target (Pectra) as it produces incompatible bytecode.
// ============================================================================

/**
 * @title HealthChainCore
 * @notice Immutable Merkle root registry for Palma HealthChain patient credentials.
 *         Provides tamper-evident proof of credential set authenticity
 *         without storing any protected health information on-chain.
 */
contract HealthChainCore {

    // ========================================================================
    //  CONSTANTS
    // ========================================================================

    /// @notice Deployed contract version — embedded in every anchor event
    string public constant VERSION = "0.1.0";

    /// @notice Schema version this contract supports
    /// Increment when the Merkle leaf construction algorithm changes
    uint16 public constant SCHEMA_VERSION = 1;

    /// @notice Maximum number of DID characters (prevents unbounded storage)
    uint256 public constant MAX_DID_LENGTH = 256;

    // ========================================================================
    //  STRUCTS
    // ========================================================================

    /**
     * @notice A single anchor record — one Merkle root submission
     * @dev Packed to minimize storage slots. timestamp + schemaVersion
     *      fit in one slot with issuerDid stored separately.
     */
    struct AnchorRecord {
        bytes32 merkleRoot;      // The committed Merkle root
        uint64  timestamp;       // Block timestamp of the anchor (unix seconds)
        uint16  schemaVersion;   // Schema version used to compute the root
        bool    revoked;         // True if the issuer has invalidated this anchor
        string  issuerDid;       // DID of the issuing institution
    }

    // ========================================================================
    //  STATE
    // ========================================================================

    /// @notice Contract owner — controls issuer authorization only
    /// @dev Ownership is intentionally narrow: owner cannot modify anchors,
    ///      cannot read credential data (there is none), and cannot upgrade
    ///      the contract. The only privileged action is managing the issuer set.
    address public owner;

    /// @notice Pending owner for two-step ownership transfer
    address public pendingOwner;

    /// @notice Set of authorized issuer addresses
    /// @dev address → true if the address may call anchorRoot
    mapping(address => bool) public authorizedIssuers;

    /// @notice Issuer address → human-readable institution name (informational only)
    mapping(address => string) public issuerNames;

    /// @notice Issuer address → DID of the issuing institution
    mapping(address => string) public issuerDids;

    /**
     * @notice Core storage: patientDid → ordered list of anchor records
     * @dev Records are append-only. The most recent record is at the highest
     *      index. Verifiers should query the most recent non-revoked record.
     *      Historical records remain permanently queryable.
     */
    mapping(bytes32 => AnchorRecord[]) private _anchors;

    /// @notice patientDidHash → total anchor count (avoids repeated .length calls)
    mapping(bytes32 => uint256) public anchorCount;

    // ========================================================================
    //  EVENTS
    // ========================================================================

    /**
     * @notice Emitted when a new Merkle root is anchored for a patient
     * @param patientDidHash  keccak256 of the patient DID (not the DID itself —
     *                        prevents DID enumeration by observers)
     * @param merkleRoot      The committed Merkle root
     * @param issuer          Address of the issuing institution
     * @param issuerDid       DID of the issuing institution
     * @param anchorIndex     Index of this record in the patient's anchor array
     * @param schemaVersion   Schema version used
     * @param timestamp       Block timestamp
     */
    event RootAnchored(
        bytes32 indexed patientDidHash,
        bytes32 indexed merkleRoot,
        address indexed issuer,
        string          issuerDid,
        uint256         anchorIndex,
        uint16          schemaVersion,
        uint64          timestamp
    );

    /**
     * @notice Emitted when an anchor is revoked by the issuing institution
     * @param patientDidHash  keccak256 of the patient DID
     * @param anchorIndex     Index of the revoked record
     * @param issuer          Address of the revoking institution
     * @param reason          Human-readable revocation reason (not stored on-chain)
     */
    event AnchorRevoked(
        bytes32 indexed patientDidHash,
        uint256 indexed anchorIndex,
        address indexed issuer,
        string          reason
    );

    /**
     * @notice Emitted when an issuer is authorized or deauthorized
     */
    event IssuerAuthorized(address indexed issuer, string issuerDid, string name);
    event IssuerDeauthorized(address indexed issuer, string reason);

    /**
     * @notice Ownership transfer events
     */
    event OwnershipTransferInitiated(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ========================================================================
    //  ERRORS
    // ========================================================================

    error NotOwner();
    error NotAuthorizedIssuer();
    error EmptyDid();
    error DidTooLong();
    error EmptyMerkleRoot();
    error InvalidAnchorIndex();
    error AlreadyRevoked();
    error NotAnchorIssuer();
    error ZeroAddress();
    error IssuerAlreadyAuthorized();
    error IssuerNotAuthorized();
    error NoPendingTransfer();

    // ========================================================================
    //  MODIFIERS
    // ========================================================================

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAuthorizedIssuer() {
        if (!authorizedIssuers[msg.sender]) revert NotAuthorizedIssuer();
        _;
    }

    // ========================================================================
    //  CONSTRUCTOR
    // ========================================================================

    /**
     * @param _owner Initial contract owner (governance multisig address)
     */
    constructor(address _owner) {
        if (_owner == address(0)) revert ZeroAddress();
        owner = _owner;
        emit OwnershipTransferred(address(0), _owner);
    }

    // ========================================================================
    //  CORE: ANCHOR FUNCTIONS
    // ========================================================================

    /**
     * @notice Anchor a Merkle root commitment for a patient credential set.
     *         Called by authorized issuers whenever a patient's credential
     *         set is created or updated.
     *
     * @dev The patientDid is hashed before storage to prevent on-chain DID
     *      enumeration. The hash is consistent: the same DID always produces
     *      the same hash, enabling historical lookup.
     *
     *      Merkle root construction (off-chain, defined in schema spec):
     *      For each credential C in the patient's set:
     *        leaf = SHA256(C.credentialId ∥ C.issuerDid ∥ C.assertedDate ∥ C.claimHash)
     *      root = MerkleRoot(sorted(leaves))
     *
     * @param patientDid   The patient's Palma DID (e.g. "did:palma:patient:7f2b...")
     * @param merkleRoot   32-byte Merkle root of the patient's current credential set
     */
    function anchorRoot(
        string calldata patientDid,
        bytes32         merkleRoot
    ) external onlyAuthorizedIssuer {
        _validateDid(patientDid);
        if (merkleRoot == bytes32(0)) revert EmptyMerkleRoot();

        bytes32 patientDidHash = keccak256(bytes(patientDid));
        uint256 idx = _anchors[patientDidHash].length;

        _anchors[patientDidHash].push(AnchorRecord({
            merkleRoot:    merkleRoot,
            timestamp:     uint64(block.timestamp),
            schemaVersion: SCHEMA_VERSION,
            revoked:       false,
            issuerDid:     issuerDids[msg.sender]
        }));

        anchorCount[patientDidHash] = idx + 1;

        emit RootAnchored(
            patientDidHash,
            merkleRoot,
            msg.sender,
            issuerDids[msg.sender],
            idx,
            SCHEMA_VERSION,
            uint64(block.timestamp)
        );
    }

    /**
     * @notice Revoke a specific anchor record.
     *         Used when credentials in a set are found to be erroneous,
     *         when a patient revokes consent, or when a key compromise
     *         invalidates an entire credential batch.
     *
     * @dev Only the issuer who created the anchor may revoke it.
     *      Revocation is permanent and irreversible.
     *      Revocation does NOT delete the record — it sets the revoked flag.
     *      Historical verifiers can always see that an anchor was revoked.
     *
     * @param patientDid   The patient's DID
     * @param anchorIndex  Index of the anchor record to revoke
     * @param reason       Human-readable reason (emitted in event, not stored)
     */
    function revokeAnchor(
        string calldata patientDid,
        uint256         anchorIndex,
        string calldata reason
    ) external onlyAuthorizedIssuer {
        bytes32 patientDidHash = keccak256(bytes(patientDid));
        AnchorRecord[] storage records = _anchors[patientDidHash];

        if (anchorIndex >= records.length) revert InvalidAnchorIndex();

        AnchorRecord storage record = records[anchorIndex];

        // Only the original issuing institution may revoke
        // Compare issuerDid strings (issuer addresses may change after key rotation)
        if (keccak256(bytes(record.issuerDid)) != keccak256(bytes(issuerDids[msg.sender]))) {
            revert NotAnchorIssuer();
        }

        if (record.revoked) revert AlreadyRevoked();

        record.revoked = true;

        emit AnchorRevoked(patientDidHash, anchorIndex, msg.sender, reason);
    }

    // ========================================================================
    //  READ FUNCTIONS
    // ========================================================================

    /**
     * @notice Get the most recent non-revoked anchor for a patient.
     *
     * @param patientDid  The patient's DID
     * @return merkleRoot    The most recent valid Merkle root
     * @return timestamp     When this root was anchored
     * @return schemaVersion Schema version used
     * @return issuerDid     DID of the issuing institution
     * @return anchorIndex   Index in the patient's anchor array
     *
     * @dev Returns zero values if no valid anchor exists.
     *      Iterates backwards from most recent — in practice, revocations
     *      are rare and the most recent record is almost always valid.
     */
    function getLatestRoot(string calldata patientDid)
        external
        view
        returns (
            bytes32 merkleRoot,
            uint64  timestamp,
            uint16  schemaVersion,
            string memory issuerDid,
            uint256 anchorIndex
        )
    {
        bytes32 patientDidHash = keccak256(bytes(patientDid));
        AnchorRecord[] storage records = _anchors[patientDidHash];

        // Iterate backwards to find the most recent non-revoked anchor
        for (uint256 i = records.length; i > 0; i--) {
            AnchorRecord storage r = records[i - 1];
            if (!r.revoked) {
                return (r.merkleRoot, r.timestamp, r.schemaVersion, r.issuerDid, i - 1);
            }
        }
        // No valid anchor found — return zero values
        return (bytes32(0), 0, 0, "", 0);
    }

    /**
     * @notice Get a specific anchor record by index.
     *         Used for historical verification and audit trails.
     *
     * @param patientDid   The patient's DID
     * @param anchorIndex  Index of the specific anchor record
     */
    function getAnchorAt(string calldata patientDid, uint256 anchorIndex)
        external
        view
        returns (
            bytes32 merkleRoot,
            uint64  timestamp,
            uint16  schemaVersion,
            bool    revoked,
            string memory issuerDid
        )
    {
        bytes32 patientDidHash = keccak256(bytes(patientDid));
        AnchorRecord[] storage records = _anchors[patientDidHash];

        if (anchorIndex >= records.length) revert InvalidAnchorIndex();

        AnchorRecord storage r = records[anchorIndex];
        return (r.merkleRoot, r.timestamp, r.schemaVersion, r.revoked, r.issuerDid);
    }

    /**
     * @notice Get the anchor valid at or before a given timestamp.
     *         Used for point-in-time verification — "was this credential
     *         valid on date X?"
     *
     * @param patientDid        The patient's DID
     * @param targetTimestamp   The point-in-time to query (unix seconds)
     * @return merkleRoot       The Merkle root valid at that time
     * @return timestamp        When this root was anchored
     * @return revoked          Whether this anchor was subsequently revoked
     */
    function getRootAtTime(string calldata patientDid, uint64 targetTimestamp)
        external
        view
        returns (
            bytes32 merkleRoot,
            uint64  timestamp,
            bool    revoked
        )
    {
        bytes32 patientDidHash = keccak256(bytes(patientDid));
        AnchorRecord[] storage records = _anchors[patientDidHash];

        // Iterate backwards — find the most recent anchor at or before targetTimestamp
        for (uint256 i = records.length; i > 0; i--) {
            AnchorRecord storage r = records[i - 1];
            if (r.timestamp <= targetTimestamp) {
                return (r.merkleRoot, r.timestamp, r.revoked);
            }
        }
        return (bytes32(0), 0, false);
    }

    /**
     * @notice Verify a Merkle proof against the patient's latest valid anchor.
     *         This is the primary verification function for credential verifiers.
     *
     * @dev Merkle proof verification uses the standard binary Merkle tree algorithm.
     *      Leaves must be sorted before tree construction (off-chain) to ensure
     *      deterministic roots. The leaf passed here is computed off-chain as:
     *        leaf = keccak256(abi.encodePacked(credentialId, issuerDid, assertedDate, claimHash))
     *
     * @param patientDid  The patient's DID
     * @param leaf        The Merkle leaf for the credential being verified
     * @param proof       The Merkle proof (sibling hashes from leaf to root)
     * @return valid      True if the leaf is in the committed set
     * @return timestamp  Timestamp of the anchor used for verification
     * @return revoked    Whether the anchor used is revoked (valid may be true but revoked)
     */
    function verifyCredential(
        string calldata patientDid,
        bytes32         leaf,
        bytes32[] calldata proof
    ) external view returns (bool valid, uint64 timestamp, bool revoked) {
        bytes32 patientDidHash = keccak256(bytes(patientDid));
        AnchorRecord[] storage records = _anchors[patientDidHash];

        // Find the most recent anchor (revoked or not — we report both)
        if (records.length == 0) return (false, 0, false);

        // Find most recent non-revoked anchor
        uint256 targetIdx = type(uint256).max;
        for (uint256 i = records.length; i > 0; i--) {
            if (!records[i - 1].revoked) {
                targetIdx = i - 1;
                break;
            }
        }
        if (targetIdx == type(uint256).max) return (false, 0, true);

        bool proofValid = _verifyMerkleProof(proof, records[targetIdx].merkleRoot, leaf);
        return (proofValid, records[targetIdx].timestamp, false);
    }

    /**
     * @notice Check whether a patient DID has any anchors.
     */
    function hasAnchors(string calldata patientDid) external view returns (bool) {
        return _anchors[keccak256(bytes(patientDid))].length > 0;
    }

    // ========================================================================
    //  ISSUER MANAGEMENT (owner only)
    // ========================================================================

    /**
     * @notice Authorize a new credential issuer.
     *
     * @param issuerAddress  The Ethereum address the issuer will use to sign transactions
     * @param issuerDid      The issuer's DID (e.g. "did:palma:facility:king-faisal-riyadh")
     * @param name           Human-readable institution name (informational)
     */
    function authorizeIssuer(
        address         issuerAddress,
        string calldata issuerDid,
        string calldata name
    ) external onlyOwner {
        if (issuerAddress == address(0)) revert ZeroAddress();
        if (authorizedIssuers[issuerAddress]) revert IssuerAlreadyAuthorized();
        _validateDid(issuerDid);

        authorizedIssuers[issuerAddress] = true;
        issuerDids[issuerAddress] = issuerDid;
        issuerNames[issuerAddress] = name;

        emit IssuerAuthorized(issuerAddress, issuerDid, name);
    }

    /**
     * @notice Deauthorize an issuer.
     *         The issuer can no longer anchor new roots.
     *         Existing anchors remain valid and permanently queryable.
     *
     * @param issuerAddress  The issuer's Ethereum address
     * @param reason         Human-readable reason for deauthorization
     */
    function deauthorizeIssuer(
        address         issuerAddress,
        string calldata reason
    ) external onlyOwner {
        if (!authorizedIssuers[issuerAddress]) revert IssuerNotAuthorized();

        authorizedIssuers[issuerAddress] = false;

        emit IssuerDeauthorized(issuerAddress, reason);
    }

    // ========================================================================
    //  OWNERSHIP (two-step transfer)
    // ========================================================================

    /**
     * @notice Initiate a two-step ownership transfer.
     *         The pending owner must call acceptOwnership() to complete.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferInitiated(owner, newOwner);
    }

    /**
     * @notice Complete the ownership transfer. Must be called by pendingOwner.
     */
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NoPendingTransfer();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    // ========================================================================
    //  INTERNAL HELPERS
    // ========================================================================

    /**
     * @notice Standard binary Merkle proof verification.
     * @dev Leaves are sorted before tree construction off-chain, so proof
     *      ordering follows the standard: if sibling > computed, sibling goes right.
     */
    function _verifyMerkleProof(
        bytes32[] calldata proof,
        bytes32            root,
        bytes32            leaf
    ) internal pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];
            // Sort to ensure consistent ordering regardless of tree position
            if (computed <= sibling) {
                computed = keccak256(abi.encodePacked(computed, sibling));
            } else {
                computed = keccak256(abi.encodePacked(sibling, computed));
            }
        }
        return computed == root;
    }

    /**
     * @notice Validate a DID string: non-empty and within length bounds.
     */
    function _validateDid(string calldata did) internal pure {
        bytes memory didBytes = bytes(did);
        if (didBytes.length == 0) revert EmptyDid();
        if (didBytes.length > MAX_DID_LENGTH) revert DidTooLong();
    }
}
