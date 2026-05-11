import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const contractAddress = "0x77706C1771a7e6C47eBCADDbc5A2e284B0Df51a4";
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
