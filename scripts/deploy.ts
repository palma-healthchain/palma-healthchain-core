import { ethers, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
//  HealthChain Core — Fuji Testnet Deployment Script
//  Palma HealthChain · github.com/palma-healthchain
//
//  USAGE
//  -----
//  1. Copy .env.example to .env and populate:
//       DEPLOYER_PRIVATE_KEY=0x...
//       OWNER_ADDRESS=0x...       (governance multisig — NOT the deployer)
//       SNOWTRACE_API_KEY=...     (for contract verification)
//
//  2. Fund deployer address with test AVAX:
//       https://faucet.avax.network/
//
//  3. Deploy:
//       npx hardhat run scripts/deploy.ts --network fuji
//
//  4. Verify (automatically attempted at end of script):
//       npx hardhat verify --network fuji <CONTRACT_ADDRESS> <OWNER_ADDRESS>
//
//  WHAT THIS SCRIPT DOES
//  ---------------------
//  - Deploys HealthChainCore with the configured owner address
//  - Optionally authorizes a test issuer (for testnet only)
//  - Saves the deployment record to deployments/<network>/<timestamp>.json
//  - Attempts contract verification on Snowtrace/Routescan
//  - Prints a complete summary of all deployed contract addresses and tx hashes
// ============================================================================

interface DeploymentRecord {
  network:         string;
  chainId:         number;
  contractName:    string;
  contractAddress: string;
  deployTxHash:    string;
  deployerAddress: string;
  ownerAddress:    string;
  blockNumber:     number;
  timestamp:       string;
  contractVersion: string;
  schemaVersion:   number;
}

async function main() {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  HealthChain Core — Deployment");
  console.log("  Palma HealthChain · github.com/palma-healthchain");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── Pre-flight checks ────────────────────────────────────────────────────

  const [deployer] = await ethers.getSigners();
  const networkName = network.name;
  const chainId = (await ethers.provider.getNetwork()).chainId;

  const ownerAddress = process.env.OWNER_ADDRESS;
  if (!ownerAddress || ownerAddress === "0x0000000000000000000000000000000000000001") {
    throw new Error(
      "OWNER_ADDRESS not set in .env\n" +
      "The owner address should be a governance multisig, NOT the deployer wallet.\n" +
      "For testnet, use a separate address you control."
    );
  }

  const deployerBalance = await ethers.provider.getBalance(deployer.address);
  const balanceInAVAX = ethers.formatEther(deployerBalance);

  console.log("Network:          ", networkName);
  console.log("Chain ID:         ", chainId.toString());
  console.log("Deployer:         ", deployer.address);
  console.log("Deployer balance: ", balanceInAVAX, "AVAX");
  console.log("Owner (post-deploy):", ownerAddress);
  console.log();

  if (deployerBalance < ethers.parseEther("0.1")) {
    throw new Error(
      `Deployer balance too low (${balanceInAVAX} AVAX). ` +
      "Fund at https://faucet.avax.network/ for Fuji testnet."
    );
  }

  // ── Deploy ───────────────────────────────────────────────────────────────

  console.log("Deploying HealthChainCore...");

  const Factory = await ethers.getContractFactory("HealthChainCore");
  const contract = await Factory.deploy(ownerAddress);

  console.log("  Transaction hash:", contract.deploymentTransaction()?.hash);
  console.log("  Waiting for confirmation...");

  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  const deployTx = contract.deploymentTransaction()!;
  const receipt = await deployTx.wait(2); // Wait 2 confirmations

  const deployBlock = receipt!.blockNumber;
  const contractVersion = await contract.VERSION();
  const schemaVersion = await contract.SCHEMA_VERSION();

  console.log("\n✓ HealthChainCore deployed!");
  console.log("  Address:         ", contractAddress);
  console.log("  Block:           ", deployBlock);
  console.log("  Contract version:", contractVersion);
  console.log("  Schema version:  ", schemaVersion.toString());
  console.log("  Owner:           ", await contract.owner());

  // ── Testnet: authorize a test issuer ─────────────────────────────────────

  if (networkName === "fuji") {
    const testIssuerAddress = process.env.TEST_ISSUER_ADDRESS;
    const testIssuerDid     = process.env.TEST_ISSUER_DID || "did:palma:facility:test-institution";
    const testIssuerName    = process.env.TEST_ISSUER_NAME || "Palma Test Institution";

    if (testIssuerAddress) {
      console.log("\nAuthorizing test issuer on Fuji testnet...");

      // Note: this only works if the deployer IS the owner (common on testnet)
      // On mainnet/production, issuer authorization goes through governance
      if (deployer.address.toLowerCase() === ownerAddress.toLowerCase()) {
        const authTx = await contract.authorizeIssuer(
          testIssuerAddress,
          testIssuerDid,
          testIssuerName
        );
        await authTx.wait(1);
        console.log("✓ Test issuer authorized:", testIssuerAddress);
        console.log("  Issuer DID:", testIssuerDid);
      } else {
        console.log(
          "  Skipping test issuer authorization — deployer is not the owner.\n" +
          "  Owner must call authorizeIssuer() separately."
        );
      }
    }
  }

  // ── Save deployment record ────────────────────────────────────────────────

  const record: DeploymentRecord = {
    network:         networkName,
    chainId:         Number(chainId),
    contractName:    "HealthChainCore",
    contractAddress,
    deployTxHash:    deployTx.hash,
    deployerAddress: deployer.address,
    ownerAddress,
    blockNumber:     deployBlock,
    timestamp:       new Date().toISOString(),
    contractVersion,
    schemaVersion:   Number(schemaVersion),
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments", networkName);
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}_HealthChainCore.json`;
  const filepath = path.join(deploymentsDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(record, null, 2));

  // Also update the "latest" symlink
  const latestPath = path.join(deploymentsDir, "latest.json");
  fs.writeFileSync(latestPath, JSON.stringify(record, null, 2));

  console.log("\n✓ Deployment record saved:");
  console.log("  ", filepath);

  // ── Contract verification ─────────────────────────────────────────────────

  if (networkName !== "hardhat" && networkName !== "localhost") {
    console.log("\nAttempting contract verification on Snowtrace/Routescan...");
    console.log("  (Waiting 15 seconds for indexer to catch up)");
    await new Promise(resolve => setTimeout(resolve, 15_000));

    try {
      await run("verify:verify", {
        address:              contractAddress,
        constructorArguments: [ownerAddress],
        contract:             "contracts/HealthChainCore.sol:HealthChainCore",
      });
      console.log("✓ Contract verified on explorer");
    } catch (err: any) {
      if (err.message?.includes("Already Verified")) {
        console.log("✓ Contract already verified");
      } else {
        console.warn("⚠ Verification failed (can retry manually):", err.message);
        console.log(
          "  Manual verification command:\n" +
          `  npx hardhat verify --network ${networkName} ${contractAddress} "${ownerAddress}"`
        );
      }
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Network:          ", networkName);
  console.log("  Contract:         ", contractAddress);
  console.log("  Owner:            ", ownerAddress);
  console.log("  Tx hash:          ", deployTx.hash);

  if (networkName === "fuji") {
    console.log(`\n  Explorer: https://testnet.snowtrace.io/address/${contractAddress}`);
  }

  console.log("\n  Next steps:");
  console.log("  1. Update HEALTHCHAIN_CORE_ADDRESS in your .env");
  console.log("  2. Authorize issuers via contract.authorizeIssuer()");
  console.log("  3. Run the testnet verification scenario (scripts/demo.ts)");
  console.log("  4. Publish contract address in the healthchain-core GitHub README");
  console.log();
}

main().catch((err) => {
  console.error("\n✗ Deployment failed:", err);
  process.exit(1);
});
