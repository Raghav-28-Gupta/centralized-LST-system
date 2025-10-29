import { BlockchainMonitor } from "./services/blockchain-monitor";
import { config } from "./config/config";
import { db } from "./services/database"; 
import { logger } from "./utils/logger";

async function main() {
	try {
		logger.info("🚀 Starting LST System Backend...");
		logger.info("Deposit Address:", config.depositAddress);
		logger.info("LST Mint:", config.lstMintAddress);

		// Connect to database
		await db.connect();

		const monitor = new BlockchainMonitor();

		if (config.heliusApiKey) {
			await monitor.startHeliusMonitoring();
		} else {
			logger.warn("No Helius API key found. Using polling instead.");
		}

		// Graceful shutdown
		process.on("SIGINT", async () => {
			logger.info("Shutting down...");
			monitor.stop();
			await db.close(); 
			process.exit(0);
		});
	} catch (error) {
		logger.error("Failed to start:", error);
		process.exit(1);
	}
}

main().catch((error) => {
	logger.error("Fatal error:", error);
	process.exit(1);
});
