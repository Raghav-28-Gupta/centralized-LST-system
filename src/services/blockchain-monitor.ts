import { Connection, PublicKey } from "@solana/web3.js";
import WebSocket from "ws";
import { config } from "../config/config";
import { TransactionHandler } from "./transaction-handler";
import { logger } from "../utils/logger";

export class BlockchainMonitor {
	private ws: WebSocket | null = null;
	private connection: Connection;
	private transactionHandler: TransactionHandler;
	private depositAddress: PublicKey;
	private processedSignatures: Set<string> = new Set();
	private isReconnecting: boolean = false;
	private pollingInterval: NodeJS.Timeout | null = null;

	constructor() {
		this.connection = new Connection(config.rpcUrl, "confirmed");
		this.transactionHandler = new TransactionHandler(this.connection);
		this.depositAddress = new PublicKey(config.depositAddress);
	}

	async startHeliusMonitoring(): Promise<void> {
		logger.info("🔍 Starting Helius WebSocket monitoring...");

		this.ws = new WebSocket(config.heliusWebsocketUrl);

		this.ws.on("open", () => {
			logger.info("✅ Connected to Helius WebSocket");
			this.isReconnecting = false;

			// Subscribe to account changes
			this.ws!.send(
				JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "accountSubscribe",
					params: [
						config.depositAddress,
						{ encoding: "jsonParsed", commitment: "confirmed" },
					],
				})
			);

			logger.info(
				"📡 Subscribed to deposit address:",
				config.depositAddress
			);
		});

		this.ws.on("message", async (data: WebSocket.Data) => {
			try {
				const message = JSON.parse(data.toString());

				// Subscription confirmed
				if (message.result && typeof message.result === "number") {
					logger.info(`✅ Subscription ID: ${message.result}`);
					return;
				}

				// Account changed - fetch recent transactions
				if (message.method === "accountNotification") {
					logger.info(
						"🔔 Account notification - checking transactions..."
					);
					await this.checkRecentTransactions();
				}
			} catch (error) {
				logger.error("WebSocket message error:", error);
			}
		});

		this.ws.on("error", (error) => {
			logger.error("❌ WebSocket error:", error);
			this.reconnect();
		});

		this.ws.on("close", () => {
			logger.warn("⚠️ WebSocket closed. Reconnecting...");
			this.reconnect();
		});

		// Backup polling every 10 seconds
		this.startPolling();
	}

	private startPolling(): void {
		this.pollingInterval = setInterval(
			() => this.checkRecentTransactions(),
			10000
		);
		logger.info("🔄 Backup polling started (every 10s)");
	}

	private async checkRecentTransactions(): Promise<void> {
		try {
			const signatures = await this.connection.getSignaturesForAddress(
				this.depositAddress,
				{ limit: 5 }
			);

			for (const sig of signatures) {
				if (this.processedSignatures.has(sig.signature)) continue;

				const tx = await this.connection.getParsedTransaction(
					sig.signature,
					{ maxSupportedTransactionVersion: 0, commitment: "confirmed" }
				);

				if (tx) await this.handleTransaction(tx);
			}
		} catch (error) {
			logger.error("Polling error:", error);
		}
	}

	private async handleTransaction(tx: any): Promise<void> {
		try {
			const signature = tx?.transaction?.signatures?.[0];
			if (!signature || this.processedSignatures.has(signature)) return;

			// Skip failed transactions
			if (tx?.meta?.err) {
				this.processedSignatures.add(signature);
				return;
			}

			// Get all instructions (main + inner)
			const instructions = [
				...(tx?.transaction?.message?.instructions || []),
				...(tx?.meta?.innerInstructions?.flatMap(
					(g: any) => g.instructions || []
				) || []),
			];

			// Find SOL transfer to our deposit address
			for (const ix of instructions) {
				const programId = ix?.programId?.toString() || ix?.programId;
				const parsed = ix?.parsed;

				// System Program transfer
				if (
					programId === "11111111111111111111111111111111" &&
					parsed?.type === "transfer" &&
					parsed?.info?.destination === config.depositAddress
				) {
					const { source, lamports } = parsed.info;

					logger.info(
						`💰 Deposit detected: ${lamports / 1e9} SOL from ${source}`
					);

					// Mark as processed first
					this.processedSignatures.add(signature);

					// Clean up old signatures (keep last 1000)
					if (this.processedSignatures.size > 1000) {
						const oldest = this.processedSignatures.values().next().value;
						this.processedSignatures.delete(oldest!);
					}

					// Handle deposit
					await this.transactionHandler.handleDeposit({
						signature,
						userPublicKey: source,
						amount: lamports,
						timestamp: Date.now(),
					});

					logger.info(`✅ Deposit processed successfully!`);
					return;
				}
			}

			// No deposit found, mark as processed
			this.processedSignatures.add(signature);
		} catch (error) {
			logger.error("Error handling transaction:", error);
		}
	}

	private reconnect(): void {
		if (this.isReconnecting) return;
		this.isReconnecting = true;

		setTimeout(() => {
			logger.info("⏳ Reconnecting...");
			this.startHeliusMonitoring();
		}, 5000);
	}

	public stop(): void {
		if (this.ws) this.ws.close();
		if (this.pollingInterval) clearInterval(this.pollingInterval);
		logger.info("🛑 Monitoring stopped");
	}
}
