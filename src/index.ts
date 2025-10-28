import { BlockchainMonitor } from "./services/blockchain-monitor";
import { config } from "./config/config";
import { logger } from "./utils/logger";

async function main() {
	logger.info("🚀 Starting LST System Backend...");
	logger.info("Deposit Address:", config.depositAddress);
	logger.info("LST Mint:", config.lstMintAddress);

	const monitor = new BlockchainMonitor();

	// Use Helius WebSocket if API key is available
	if (config.heliusApiKey) {
		await monitor.startHeliusMonitoring();
	} else {
		logger.warn("No Helius API key found. Using polling instead.");
		await monitor.startPollingMonitoring();
	}

	// Graceful shutdown
	process.on("SIGINT", () => {
		logger.info("Shutting down...");
		monitor.stop();
		process.exit(0);
	});
}

main().catch((error) => {
	logger.error("Fatal error:", error);
	process.exit(1);
});
