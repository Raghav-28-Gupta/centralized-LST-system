import { Connection } from "@solana/web3.js";
import { TokenManager } from "./token-manager";
import type { DepositTransaction, WithdrawalTransaction } from "../types";
import { logger } from "../utils/logger.ts";
import { db } from "./database.ts";

export class TransactionHandler {
	private tokenManager: TokenManager;

	constructor(connection: Connection) {
		this.tokenManager = new TokenManager(connection);
	}

	async handleDeposit(deposit: DepositTransaction): Promise<void> {
		try {
			logger.info(`Processing deposit: ${deposit.amount / 1e9} SOL from ${deposit.userPublicKey}`);

			// Mint LST tokens to user
			const mintSignature = await this.tokenManager.mintLSTToUser(
				deposit.userPublicKey,
				deposit.amount
			);

			// Log the position (you can add DB later if needed)
			this.logUserPosition({
				userPublicKey: deposit.userPublicKey,
				solDeposited: deposit.amount,
				lstTokensReceived: deposit.amount, // 1:1 initially
				depositTimestamp: deposit.timestamp
			});

			logger.info(`Deposit processed successfully. Mint signature: ${mintSignature}`);
		} catch (error) {
			logger.error("Error handling deposit:", error);
			// Implement retry logic or alert admin
		}
	}

	async handleWithdrawal(withdrawal: WithdrawalTransaction): Promise<void> {
		try {
			logger.info(`Processing withdrawal: ${withdrawal.lstAmount / 1e9} lstSOL from ${withdrawal.userPublicKey}`);

			// Burn LST tokens and return SOL
			const burnSignature = await this.tokenManager.burnLSTAndReturnSOL(
				withdrawal.userPublicKey,
				withdrawal.lstAmount
			);

			logger.info(`Withdrawal processed successfully. Burn signature: ${burnSignature}`);
		} catch (error) {
			logger.error("Error handling withdrawal:", error);
		}
	}

	private logUserPosition(position: any): void {
		logger.info("User position:", {
			user: position.userPublicKey,
			solDeposited: `${position.solDeposited / 1e9} SOL`,
			lstTokens: `${position.lstTokensReceived / 1e9} lstSOL`,
			timestamp: new Date(position.depositTimestamp).toISOString()
		});
	}
}
