import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const contractAddress = "0xEEd6b1262380e63b184D56E588118d8990A6a35B";
  const contract = await ethers.getContractAt("HealthChainCore", contractAddress);

  console.log("Authorizing deployer as test issuer...");
  const tx = await contract.authorizeIssuer(
    deployer.address,
    "did:palma:facility:demo-moh-clinic-riyadh",
    "Demo MOH Clinic, Riyadh (Palma Testnet)"
  );
  await tx.wait(1);
  console.log("✓ Issuer authorized:", deployer.address);
  console.log("  Tx hash:", tx.hash);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
