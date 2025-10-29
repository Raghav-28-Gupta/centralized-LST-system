import { Connection, PublicKey } from "@solana/web3.js";
import WebSocket from "ws";
import { config } from "../config/config";
import { TransactionHandler } from "./transaction-handler";
import { logger } from "../utils/logger.ts";

export class BlockchainMonitor {
	private ws: WebSocket | null = null;
	private connection: Connection;
	private transactionHandler: TransactionHandler;
	private depositAddress: PublicKey;
	// In-memory store to avoid double-processing. (Can also replace with DB/cache for production.
	private processedSignatures: Set<string> = new Set();
	private isReconnecting: boolean = false;
	private pollingInterval: NodeJS.Timeout | null = null;

	constructor() {
		// Use 'finalized' for stronger finality guarantees on reads
		this.connection = new Connection(config.rpcUrl, "finalized");
		this.transactionHandler = new TransactionHandler(this.connection);
		this.depositAddress = new PublicKey(config.depositAddress);
	}

	// Method: Using Helius Enhanced WebSocket (Recommended)
	async startHeliusMonitoring(): Promise<void> {
		logger.info("Starting Helius WebSocket monitoring...");

		this.ws = new WebSocket(config.heliusWebsocketUrl);

		this.ws.on("open", () => {
			logger.info("Connected to Helius WebSocket");
			this.isReconnecting = false;

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
						commitment: "finalized", // stronger finality
						encoding: "jsonParsed",
						transactionDetails: "full",
						showRewards: false,
						maxSupportedTransactionVersion: 0,
					},
				],
			};

			this.ws!.send(JSON.stringify(subscribeMessage));
			logger.info("Subscribed to deposit address:", config.depositAddress);
		});

		this.ws.on("message", async (data: WebSocket.Data) => {
			try {
				const message = JSON.parse(data.toString());

				// Log raw message for debugging
				logger.debug(
					"WebSocket message received:",
					JSON.stringify(message, null, 2)
				);

				if (message.method === "transactionNotification") {
					// Helius may include transaction under params.result.transaction
					const transaction =
						message.params?.result?.transaction ?? message.params?.result;
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

		// START POLLING AS BACKUP (every 5 seconds)
		logger.info("🔄 Starting backup polling (every 5 seconds)...");
		this.startBackupPolling();
	}

	private startBackupPolling(): void {
		this.pollingInterval = setInterval(async () => {
			try {
				logger.debug("🔄 Polling for new transactions...");

				const signatures = await this.connection.getSignaturesForAddress(
					this.depositAddress,
					{ limit: 5 } // Check last 5 transactions
				);

				for (const sig of signatures) {
					// Skip if already processed
					if (this.processedSignatures.has(sig.signature)) {
						continue;
					}

					logger.info(
						`📥 Found new transaction via polling: ${sig.signature}`
					);

					const tx = await this.connection.getParsedTransaction(
						sig.signature,
						{
							maxSupportedTransactionVersion: 0,
							commitment: "confirmed",
						}
					);

					if (tx) {
						await this.handleIncomingTransaction(tx);
					}
				}
			} catch (error) {
				logger.error("Polling error:", error);
			}
		}, 5000); // Poll every 5 seconds
	}

	private async handleIncomingTransaction(transaction: any): Promise<void> {
		let signature = "";
		try {
			logger.info("📥 Processing transaction...");

			// Extract signature
			signature =
				transaction?.transaction?.signatures?.[0] ||
				transaction?.signatures?.[0] ||
				transaction?.signature ||
				"";

			if (!signature) {
				logger.warn("Transaction has no signature; skipping.");
				return;
			}

			// Deduplicate
			if (this.processedSignatures.has(signature)) {
				logger.debug(`Skipping duplicate: ${signature}`);
				return;
			}

			logger.info(`🔍 Analyzing transaction: ${signature}`);

			// Verify transaction succeeded
			const meta = transaction?.meta;
			if (meta && meta.err) {
				logger.warn(
					`Transaction ${signature} failed with error, skipping.`
				);
				this.processedSignatures.add(signature);
				return;
			}

			// Log transaction structure for debugging
			logger.debug("Transaction structure:", {
				hasMeta: !!transaction?.meta,
				hasTransaction: !!transaction?.transaction,
				hasMessage: !!transaction?.transaction?.message,
				hasInstructions: !!transaction?.transaction?.message?.instructions,
				instructionCount:
					transaction?.transaction?.message?.instructions?.length || 0,
			});

			// Parse instructions - handle different response formats
			let allInstructions: any[] = [];

			// Get main instructions
			const mainInstructions = transaction?.transaction?.message?.instructions || [];
			allInstructions.push(...mainInstructions);

			// Get inner instructions (from meta)
			const innerInstrGroups = transaction?.meta?.innerInstructions || [];
			for (const group of innerInstrGroups) {
				if (group.instructions) {
					allInstructions.push(...group.instructions);
				}
			}

			logger.info(
				`Found ${allInstructions.length} total instructions to analyze`
			);

			// Check each instruction
			let foundTransfer = false;
			for (let i = 0; i < allInstructions.length; i++) {
				const instruction = allInstructions[i];

				// Get program ID (handle different formats)
				const programIdStr =
					instruction?.programId?.toString?.() ||
					instruction?.programId ||
					"";

				logger.debug(`Instruction ${i}: programId=${programIdStr}, type=${instruction?.parsed?.type}`);

				// Check if this is a System Program instruction (SOL transfer)
				if (programIdStr === "11111111111111111111111111111111") {
					const parsed = instruction?.parsed;

					logger.debug(`System Program instruction found:`, {
						type: parsed?.type,
						hasInfo: !!parsed?.info,
						destination: parsed?.info?.destination,
						source: parsed?.info?.source,
					});

					if (parsed?.type === "transfer" && parsed?.info) {
						foundTransfer = true;
						const destination = parsed.info.destination;
						const source = parsed.info.source;
						const lamports = parsed.info.lamports;

						logger.info(
							`💸 Transfer: ${source?.slice(
								0,
								8
							)}... -> ${destination?.slice(0, 8)}... (${
								lamports / 1e9
							} SOL)`
						);

						// Check if TO our deposit address
						if (destination === config.depositAddress) {
							logger.info(`🎯 MATCH! This is a deposit to our address!`);
							logger.info(
								`💰 DEPOSIT DETECTED: ${
									lamports / 1e9
								} SOL from ${source}`
							);

							// Mark as processed BEFORE handling
							this.processedSignatures.add(signature);

							// Clean up old signatures
							if (this.processedSignatures.size > 1000) {
								const first = this.processedSignatures
									.values()
									.next().value;
								this.processedSignatures.delete(first!);
							}

							try {
								await this.transactionHandler.handleDeposit({
									signature,
									userPublicKey: source,
									amount: lamports,
									timestamp: Date.now(),
								});
								logger.info(`✅ Deposit processed successfully!`);
							} catch (error) {
								logger.error(`❌ Failed to process deposit:`, error);
							}

							return; // Exit after handling
						} else {
							logger.debug(
								`Not our address. Destination: ${destination}, Our address: ${config.depositAddress}`
							);
						}
					}
				}
			}

			if (!foundTransfer) {
				logger.debug(`No SOL transfer found in transaction ${signature}`);
				// Still mark as processed to avoid re-checking
				this.processedSignatures.add(signature);
			}
		} catch (error) {
			logger.error("❌ Error handling transaction:", error);
			if (error instanceof Error) {
				logger.error("Error details:", error.message);
				logger.error("Stack:", error.stack);
			}
			// Mark as processed even on error to avoid infinite loops
			if (signature) {
				this.processedSignatures.add(signature);
			}
		}
	}

	private reconnect(): void {
		if (this.isReconnecting) return;
		this.isReconnecting = true;
		setTimeout(() => {
			logger.info("Attempting to reconnect...");
			this.startHeliusMonitoring();
		}, 5000);
	}

	public stop(): void {
		if (this.ws) {
			this.ws.close();
		}
		if (this.pollingInterval) {
			clearInterval(this.pollingInterval);
		}
	}
}
