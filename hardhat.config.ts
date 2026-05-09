import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";

dotenv.config();

// ─── NETWORK CONSTANTS ───────────────────────────────────────────────────────
// Avalanche Fuji testnet (public test network)
const FUJI_RPC   = "https://api.avax-test.network/ext/bc/C/rpc";
const FUJI_CHAIN = 43113;

// Avalanche C-Chain mainnet (used for reference; we deploy to a subnet in prod)
const MAINNET_RPC   = "https://api.avax.network/ext/bc/C/rpc";
const MAINNET_CHAIN = 43114;

// Local Hardhat network (for unit tests)
const LOCAL_CHAIN = 31337;

// ─── KEY MANAGEMENT ──────────────────────────────────────────────────────────
// Private keys are loaded from environment variables — NEVER hardcode them.
// Copy .env.example to .env and populate before deploying.
const DEPLOYER_KEY  = process.env.DEPLOYER_PRIVATE_KEY  || "0x" + "0".repeat(64);
const OWNER_ADDRESS = process.env.OWNER_ADDRESS          || "0x0000000000000000000000000000000000000001";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,     // Optimized for deployment cost (lower runs) vs call cost (higher runs)
                       // 200 is the standard OpenZeppelin default and appropriate for a registry
      },
      // ─── CRITICAL: Set evmVersion to cancun ───────────────────────────────
      // Avalanche Subnet-EVM implements the Cancun EVM fork.
      // Solidity >=0.8.30 defaults to Pectra, which produces incompatible bytecode.
      // This setting is MANDATORY for Avalanche deployment.
      // See: https://github.com/ava-labs/subnet-evm (README, compiler note)
      evmVersion: "cancun",
    },
  },

  networks: {
    // ── Local development ──
    hardhat: {
      chainId: LOCAL_CHAIN,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: LOCAL_CHAIN,
    },

    // ── Avalanche Fuji Testnet ──
    // Fund your deployer address at https://faucet.avax.network/
    fuji: {
      url: FUJI_RPC,
      chainId: FUJI_CHAIN,
      accounts: [DEPLOYER_KEY],
      gasPrice: 25_000_000_000,   // 25 gwei — Fuji minimum
      gas: 3_000_000,
    },

    // ── Avalanche C-Chain Mainnet ──
    // Not used for production deployment (we use a dedicated L1 subnet)
    // Included for reference and for C-Chain verification if needed
    avalanche: {
      url: MAINNET_RPC,
      chainId: MAINNET_CHAIN,
      accounts: [DEPLOYER_KEY],
      gasPrice: 25_000_000_000,
    },

    // ── HealthChain L1 Subnet (production) ──
    // Populated after subnet deployment in Phase 2
    // healthchainL1: {
    //   url: process.env.HEALTHCHAIN_L1_RPC || "",
    //   chainId: parseInt(process.env.HEALTHCHAIN_L1_CHAIN_ID || "0"),
    //   accounts: [DEPLOYER_KEY],
    //   gasPrice: 1_000_000_000,   // 1 gwei — subnet base fee (configurable)
    // },
  },

  // ─── CONTRACT VERIFICATION ──────────────────────────────────────────────
  // Avalanche uses the Routescan explorer API for contract verification
  etherscan: {
    apiKey: {
      avalancheFujiTestnet: process.env.SNOWTRACE_API_KEY || "verifyContract",
      avalanche:            process.env.SNOWTRACE_API_KEY || "verifyContract",
    },
    customChains: [
      {
        network: "avalancheFujiTestnet",
        chainId: FUJI_CHAIN,
        urls: {
          apiURL:     "https://api.routescan.io/v2/network/testnet/evm/43113/etherscan",
          browserURL: "https://testnet.snowtrace.io",
        },
      },
    ],
  },

  // ─── GAS REPORTING ──────────────────────────────────────────────────────
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    token: "AVAX",
  },

  // ─── PATHS ──────────────────────────────────────────────────────────────
  paths: {
    sources:   "./contracts",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
