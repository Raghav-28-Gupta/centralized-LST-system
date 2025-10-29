import { MongoClient, Db, Collection } from "mongodb";
import { config } from "../config/config";
import type {
	UserPosition,
	DepositTransaction,
	WithdrawalTransaction,
} from "../types";
import { logger } from "../utils/logger";

export class Database {
	private client: MongoClient;
	private db: Db | null = null;
	private positions: Collection<UserPosition> | null = null;
	private deposits: Collection<DepositTransaction> | null = null;
	private withdrawals: Collection<WithdrawalTransaction> | null = null;

	constructor() {
		this.client = new MongoClient(config.mongoUri);
	}

	async connect(): Promise<void> {
		try {
			await this.client.connect();
			this.db = this.client.db();
			this.positions = this.db.collection("positions");
			this.deposits = this.db.collection("deposits");
			this.withdrawals = this.db.collection("withdrawals");

			logger.info("✅ Connected to MongoDB");
		} catch (error) {
			logger.error("Failed to connect to MongoDB:", error);
			throw error;
		}
	}

	async savePosition(position: UserPosition): Promise<void> {
		await this.positions!.updateOne(
			{ userPublicKey: position.userPublicKey },
			{ $set: position },
			{ upsert: true }
		);
	}

	async getPosition(userPublicKey: string): Promise<UserPosition | null> {
		return await this.positions!.findOne({ userPublicKey });
	}

	async saveDeposit(deposit: DepositTransaction): Promise<void> {
		await this.deposits!.insertOne(deposit);
	}

	async saveWithdrawal(withdrawal: WithdrawalTransaction): Promise<void> {
		await this.withdrawals!.insertOne(withdrawal);
	}

	async close(): Promise<void> {
		await this.client.close();
		logger.info("Database connection closed");
	}
}

export const db = new Database();
