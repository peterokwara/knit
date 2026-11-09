import type { DatabaseSync } from "node:sqlite";
import type { IDatabaseRow } from "../models/database/IDatabaseRow";
import type { IPaymentReviewResolution } from "../models/ingestion/IPaymentReviewResolution";
import type { IPaymentReviewResolutionStore } from "../models/ingestion/IPaymentReviewResolutionStore";
import { parseInstant } from "../utils/configurationValidation";
import { readInteger, readText } from "../utils/sqliteValues";
import { SqliteHelper } from "../utils/sqliteHelper";

const allowedHoldReasons: IPaymentReviewResolution["originalHoldReason"][] = [
  "missing_reference",
  "unknown_reference",
  "ambiguous_reference",
];

function isReviewableHoldReason(
  value: string,
): value is IPaymentReviewResolution["originalHoldReason"] {
  return allowedHoldReasons.some((reason) => reason === value);
}

/** Persist immutable payment review decisions in SQLite. */
export class SqlitePaymentReviewResolutionStore implements IPaymentReviewResolutionStore {
  /** Database connection that owns the payment and resolution records. */
  private readonly _database: DatabaseSync;

  /**
   * Create the resolution store around an initialized connection.
   * @param database SQLite connection containing the protected payment schema.
   */
  constructor(database: DatabaseSync) {
    this._database = database;
  }

  /**
   * Read a decision for one exact provider event variant.
   * @param schoolId School that owns the payment.
   * @param eventKey Stable provider event identity.
   * @param fingerprint Exact event variant fingerprint.
   * @returns Saved decision, when one exists.
   */
  getResolution(
    schoolId: string,
    eventKey: string,
    fingerprint: string,
  ): IPaymentReviewResolution | undefined {
    const row = SqliteHelper.queryOne(
      this._database,
      `SELECT * FROM payment_review_resolutions
      WHERE school_id = ? AND event_key = ? AND fingerprint = ?`,
      schoolId,
      eventKey,
      fingerprint,
    );
    return row ? this.toResolution(row) : undefined;
  }

  /**
   * Read all bursar decisions for one school in stable order.
   * @param schoolId School whose decisions should be returned.
   * @returns Saved decisions.
   */
  getResolutions(schoolId: string): IPaymentReviewResolution[] {
    return SqliteHelper.query(
      this._database,
      `SELECT * FROM payment_review_resolutions WHERE school_id = ?
      ORDER BY event_key, fingerprint`,
      schoolId,
    ).map((row) => this.toResolution(row));
  }

  /**
   * Save the first decision, return an identical retry, or reject a conflict.
   * @param resolution Bursar decision and event identity.
   * @returns Durable decision with a canonical UTC timestamp.
   */
  recordResolution(
    resolution: IPaymentReviewResolution,
  ): IPaymentReviewResolution {
    const normalized = {
      ...resolution,
      resolvedAt: new Date(parseInstant(resolution.resolvedAt)).toISOString(),
    };
    if (!isReviewableHoldReason(normalized.originalHoldReason))
      throw new Error("Unsupported payment hold reason for resolution");

    return SqliteHelper.inTransaction(this._database, () => {
      const existing = this.getResolution(
        normalized.schoolId,
        normalized.eventKey,
        normalized.fingerprint,
      );
      if (existing) {
        if (this.sameDecision(existing, normalized)) return existing;
        throw new Error(
          "A different resolution already exists for this payment",
        );
      }

      SqliteHelper.execute(
        this._database,
        `INSERT INTO payment_review_resolutions
        (school_id, event_key, fingerprint, family_id, source_reference,
         original_hold_reason, actor_id, reason, resolved_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        normalized.schoolId,
        normalized.eventKey,
        normalized.fingerprint,
        normalized.familyId,
        normalized.sourceReference,
        normalized.originalHoldReason,
        normalized.actorId,
        normalized.reason,
        parseInstant(normalized.resolvedAt),
      );
      return normalized;
    });
  }

  /**
   * Compare the decision fields while retaining the first timestamp on retries.
   * @param saved Existing durable decision.
   * @param requested New caller decision.
   * @returns Whether both records express the same decision.
   */
  private sameDecision(
    saved: IPaymentReviewResolution,
    requested: IPaymentReviewResolution,
  ): boolean {
    return (
      saved.schoolId === requested.schoolId &&
      saved.eventKey === requested.eventKey &&
      saved.fingerprint === requested.fingerprint &&
      saved.familyId === requested.familyId &&
      saved.sourceReference === requested.sourceReference &&
      saved.originalHoldReason === requested.originalHoldReason &&
      saved.actorId === requested.actorId &&
      saved.reason === requested.reason
    );
  }

  /**
   * Decode a persisted row into a validated resolution record.
   * @param row SQLite result row.
   * @returns Typed resolution.
   */
  private toResolution(row: IDatabaseRow): IPaymentReviewResolution {
    const originalHoldReason = readText(row, "original_hold_reason");
    if (!isReviewableHoldReason(originalHoldReason))
      throw new Error("Invalid payment review hold reason in database");
    return {
      schoolId: readText(row, "school_id"),
      eventKey: readText(row, "event_key"),
      fingerprint: readText(row, "fingerprint"),
      familyId: readText(row, "family_id"),
      sourceReference: readText(row, "source_reference"),
      originalHoldReason,
      actorId: readText(row, "actor_id"),
      reason: readText(row, "reason"),
      resolvedAt: new Date(readInteger(row, "resolved_at_ms")).toISOString(),
    };
  }
}
