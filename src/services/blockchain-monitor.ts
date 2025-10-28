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

	constructor() {
		this.connection = new Connection(config.rpcUrl, "confirmed");
		this.transactionHandler = new TransactionHandler(this.connection);
		this.depositAddress = new PublicKey(config.depositAddress);
	}

	// Method 1: Using Helius Enhanced WebSocket (Recommended)
	async startHeliusMonitoring(): Promise<void> {
		logger.info("🔍 Starting Helius WebSocket monitoring...");

		this.ws = new WebSocket(config.heliusWebsocketUrl);

		this.ws.on("open", () => {
			logger.info("✅ Connected to Helius WebSocket");

			// Subscribe to transactions for your deposit address
			const subscribeMessage = {
				jsonrpc: "2.0",
				id: 1,
				method: "transactionSubscribe",
				params: [
					{
						accountInclude: [config.depositAddress], // Monitor this address
						accountRequired: [config.depositAddress],
					},
					{
						commitment: "confirmed",
						encoding: "jsonParsed",
						transactionDetails: "full",
						showRewards: false,
						maxSupportedTransactionVersion: 0,
					},
				],
			};

			this.ws!.send(JSON.stringify(subscribeMessage));
			logger.info(
				"📡 Subscribed to deposit address:",
				config.depositAddress
			);
		});

		this.ws.on("message", async (data: WebSocket.Data) => {
			try {
				const message = JSON.parse(data.toString());

				if (message.method === "transactionNotification") {
					const transaction = message.params.result.transaction;
					await this.handleIncomingTransaction(transaction);
				}
			} catch (error) {
				logger.error("Error processing WebSocket message:", error);
			}
		});

		this.ws.on("error", (error) => {
			logger.error("WebSocket error:", error);
			this.reconnect();
		});

		this.ws.on("close", () => {
			logger.warn("WebSocket closed. Reconnecting...");
			this.reconnect();
		});
	}

	// Method 2: Polling (Fallback if no Helius)
	async startPollingMonitoring(): Promise<void> {
		logger.info("🔍 Starting polling monitoring...");

		setInterval(async () => {
			try {
				const signatures =
					await this.connection.getSignaturesForAddress(
						this.depositAddress,
						{ limit: 10 }
					);

				for (const sig of signatures) {
					const tx = await this.connection.getParsedTransaction(
						sig.signature,
						{
							maxSupportedTransactionVersion: 0,
						}
					);

					if (tx) {
						await this.handleIncomingTransaction(tx);
					}
				}
			} catch (error) {
				logger.error("Polling error:", error);
			}
		}, 10000); // Poll every 10 seconds
	}

	private async handleIncomingTransaction(transaction: any): Promise<void> {
		try {
			logger.info("📥 New transaction detected!");

			// Parse transaction to extract SOL transfer
			const instructions = transaction.meta?.innerInstructions || [];
			const mainInstructions =
				transaction.transaction?.message?.instructions || [];

			for (const instruction of [
				...mainInstructions,
				...instructions.flatMap((i: any) => i.instructions),
			]) {
				if (
					instruction.programId?.toString() ===
					"11111111111111111111111111111111"
				) {
					// System Program (SOL transfer)

					const parsed = instruction.parsed;
					if (parsed?.type === "transfer") {
						const destination = parsed.info.destination;
						const source = parsed.info.source;
						const lamports = parsed.info.lamports;

						// Check if SOL was sent TO our deposit address
						if (destination === config.depositAddress) {
							logger.info(
								`💰 Deposit detected: ${
									lamports / 1e9
								} SOL from ${source}`
							);

							await this.transactionHandler.handleDeposit({
								signature:
									transaction.transaction.signatures[0],
								userPublicKey: source,
								amount: lamports,
								timestamp: Date.now(),
							});
						}

						// Check if LST tokens were sent TO our address (withdrawal)
						// This would be detected via token transfer monitoring
					}
				}
			}
		} catch (error) {
			logger.error("Error handling transaction:", error);
		}
	}

	private reconnect(): void {
		setTimeout(() => {
			logger.info("Attempting to reconnect...");
			this.startHeliusMonitoring();
		}, 5000);
	}

	public stop(): void {
		if (this.ws) {
			this.ws.close();
		}
	}
}
