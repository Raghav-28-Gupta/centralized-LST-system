import { Connection } from "@solana/web3.js";
import { TokenManager } from "./token-manager";
import { YieldGenerator } from "./yield-generator";
import type { DepositTransaction, WithdrawalTransaction } from "../types";
import { logger } from "../utils/logger.ts";
import { db } from "./database.ts";

export class TransactionHandler {
	private tokenManager: TokenManager;
	private yieldGenerator: YieldGenerator;

	constructor(connection: Connection) {
		this.tokenManager = new TokenManager(connection);
		this.yieldGenerator = new YieldGenerator();
	}

	async handleDeposit(deposit: DepositTransaction): Promise<void> {
		try {
			logger.info(`Processing deposit: ${deposit.amount / 1e9} SOL from ${deposit.userPublicKey}`);

			// 1. Save to database FIRST (for audit trial)
			await db.saveDeposit(deposit);

			// 2. Mint LST tokens to user
			const mintSignature = await this.tokenManager.mintLSTToUser(
				deposit.userPublicKey,
				deposit.amount
			);

			// 3. Store user position in database (MongoDB/PostgreSQL)
			await db.savePosition({
				userPublicKey: deposit.userPublicKey,
				solDeposited: deposit.amount,
				lstTokensReceived: deposit.amount, // 1:1 initially
				depositTimestamp: deposit.timestamp,
				yieldAccrued: 0,
			});

			// 4. Start yield generation for this user
			await this.yieldGenerator.startYieldGeneration(
				deposit.userPublicKey,
				deposit.amount
			);

			logger.info(
				`✅ Deposit processed successfully. Mint signature: ${mintSignature}`
			);
		} catch (error) {
			logger.error("Error handling deposit:", error);
			// Implement retry logic or alert admin
		}
	}

	async handleWithdrawal(withdrawal: WithdrawalTransaction): Promise<void> {
		try {
			logger.info(`Processing withdrawal: ${withdrawal.lstAmount / 1e9} lstSOL from ${withdrawal.userPublicKey}`);

			// 1. Save to database FIRST
			await db.saveWithdrawal(withdrawal);

			// 2. Burn LST tokens and return SOL
			const burnSignature = await this.tokenManager.burnLSTAndReturnSOL(
				withdrawal.userPublicKey,
				withdrawal.lstAmount
			);

			// 3. Update database
			const position = await db.getPosition(withdrawal.userPublicKey);
			if (position) {
				position.lstTokensReceived -= withdrawal.lstAmount;
				await db.savePosition(position);
			}

			logger.info(
				`✅ Withdrawal processed successfully. Burn signature: ${burnSignature}`
			);
		} catch (error) {
			logger.error("Error handling withdrawal:", error);
		}
	}
}
