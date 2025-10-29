import { Connection, PublicKey } from "@solana/web3.js";
import WebSocket from "ws";
import { config } from "../config/config";
import { TransactionHandler } from "./transaction-handler";
import { logger } from "../utils/logger.ts";
import { SignatureKind } from "typescript";

export class BlockchainMonitor {
	private ws: WebSocket | null = null;
	private connection: Connection;
	private transactionHandler: TransactionHandler;
	private depositAddress: PublicKey;
	// In-memory store to avoid double-processing. (Can also replace with DB/cache for production.
	private processedSignatures: Set<string> = new Set();

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
	}

	// Removed polling fallback to avoid duplicate/competing processing. If you need a fallback, implement an idempotent polling pass that checks the same processed-signature store (preferably a durable DB).

	private async handleIncomingTransaction(transaction: any): Promise<void> {
		let signature: string | undefined;
		try {
			logger.info("New transaction detected!");

			// Extract a canonical signature for deduplication (Helius WebSocket payloads can have different shapes depending on encoding/version)
			const signature =
				transaction?.transaction?.signatures?.[0] ||
				transaction?.signatures?.[0] ||
				transaction?.signature ||
				transaction?.signer ||
				"";

			if (!signature) {
				logger.warn("Transaction has no signature; skipping processing.");
				return;
			}

			// Deduplicate
			if (this.processedSignatures.has(signature)) {
				logger.info("Skipping already-processed signature:", signature);
				return;
			}

			// Verify transaction succeeded
			const meta = transaction?.meta ?? transaction?.transaction?.meta ?? null;
			if (meta && meta.err) {
				logger.warn(`Transaction ${signature} failed (meta.err), skipping.`);
				// Optionally mark as processed to avoid re-checking repeatedly
				this.processedSignatures.add(signature);
				return;
			}

			// Parse transaction to extract SOL transfer (Checkout Solana instruction hierarchy)
			const innerInstrGroups = transaction.meta?.innerInstructions || [];   //Triggered by smart contracts
			const mainInstructions = transaction.transaction?.message?.instructions || [];

			const allInstructions = [
				...mainInstructions,
				...innerInstrGroups.flatMap((g: any) => g.instructions || []),
			];

			for (const instruction of allInstructions) {
				// System Program (native SOL transfers) program id is the all-zero string
				const programIdStr = instruction.programId?.toString?.() ?? instruction.programId;
				if (programIdStr === "11111111111111111111111111111111") {      
					// Some parsed shapes put parsed on the instruction; others differ.
					const parsed = instruction.parsed ?? instruction;
					if (parsed?.type === "transfer" || parsed?.info?.destination) {
						const destination = parsed.info.destination;
						const source = parsed.info.source;
						const lamports = parsed.info.lamports;

						// Only act on transfers TO our deposit address
						if (destination === config.depositAddress) {
							logger.info(`Deposit detected: ${lamports / 1e9} SOL from ${source} (sig: ${signature})`);

							// Mark as processed BEFORE external actions to reduce race conditions.
							this.processedSignatures.add(signature);

							await this.transactionHandler.handleDeposit({
								signature,
								userPublicKey: source,
								amount: lamports,
								timestamp: Date.now(),
							});
						}
					}
				}
				// Note: Add token program handling here for LST withdrawals if needed.
			}
		} catch (error) {
			logger.error("Error handling transaction:", error);
			if(signature) {
				this.processedSignatures.add(signature);
			}
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
