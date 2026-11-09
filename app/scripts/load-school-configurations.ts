import { readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { SqliteHelper } from "../src/server/utils/sqliteHelper";
import type { IApprovedPolicyChange } from "../src/server/models/configuration/IApprovedPolicyChange";
import type { IInitialSchoolConfiguration } from "../src/server/models/configuration/IInitialSchoolConfiguration";
import type { ISchoolConfiguration } from "../src/server/models/configuration/ISchoolConfiguration";
import { SchoolConfigurationService } from "../src/server/services/schoolConfigurationService";
import { SqliteSchoolConfigurationService } from "../src/server/services/sqliteSchoolConfigurationService";
import {
  parseInstant,
  validateConfiguration,
} from "../src/server/utils/configurationValidation";

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${label} must be non-empty text`);
  return value;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function readInitialConfigurations(
  directory: string,
): IInitialSchoolConfiguration[] {
  const rows = readJson(path.join(directory, "config_history.json"));
  if (!Array.isArray(rows))
    throw new Error("config_history.json must contain an array");
  return rows.map((value: unknown) => {
    const row = object(value, "configuration fixture");
    if (row.version !== 1)
      throw new Error(
        "Only initial version 1 is supported in config_history.json",
      );
    const configuration = object(
      row.config,
      "config",
    ) as unknown as ISchoolConfiguration;
    validateConfiguration(configuration);
    return {
      schoolId: text(row.school_id, "school_id"),
      effectiveAt: text(row.effective_from, "effective_from"),
      createdBy: text(row.created_by, "created_by"),
      reason: text(row.change_reason, "change_reason"),
      configuration,
    };
  });
}

function readApprovedChange(directory: string): IApprovedPolicyChange {
  const row = object(
    readJson(path.join(directory, "change_requests/CR-118.json")),
    "change request",
  );
  const patch = object(row.patch, "patch");
  const allocation = object(patch.allocation, "allocation");
  const categories = allocation.category_priority;
  if (
    !Array.isArray(categories) ||
    !categories.every((value: unknown) => typeof value === "string")
  )
    throw new Error("category_priority must be a list of names");
  return {
    changeId: text(row.change_request, "change_request"),
    schoolId: text(row.school_id, "school_id"),
    expectedVersion: 1,
    effectiveAt: text(row.effective_from, "effective_from"),
    requestedBy: text(row.requested_by, "requested_by"),
    approvedBy: text(row.approved_by, "approved_by"),
    reason: text(row.reason, "reason"),
    categoryPriority: categories,
  };
}

const fixtureDirectory = path.resolve(
  import.meta.dirname,
  "../../fixtures/school",
);
const initialConfigurations = readInitialConfigurations(fixtureDirectory);
const approvedChange = readApprovedChange(fixtureDirectory);
const database = SqliteHelper.openConnection();
try {
  const store = new SqliteSchoolConfigurationService(database);
  const service = new SchoolConfigurationService(store);
  for (const input of initialConfigurations) {
    const existing = store.getVersion(input.schoolId, 1);
    if (existing) {
      if (
        !isDeepStrictEqual(existing.configuration, input.configuration) ||
        existing.effectiveAt !==
          new Date(parseInstant(input.effectiveAt)).toISOString() ||
        existing.createdBy !== input.createdBy ||
        existing.reason !== input.reason
      ) {
        throw new Error(
          `Existing initial configuration differs for ${input.schoolId}; no settings were overwritten`,
        );
      }
    } else {
      service.createSchool(input);
    }
  }

  const existingChange = store.getVersion(
    approvedChange.schoolId,
    approvedChange.expectedVersion + 1,
  );
  if (existingChange) {
    const expected = structuredClone(
      service.getVersion(
        approvedChange.schoolId,
        approvedChange.expectedVersion,
      ).configuration,
    );
    expected.allocation.category_priority = approvedChange.categoryPriority;
    const approval = service.getChange(approvedChange.changeId);
    const expectedApproval = {
      ...approvedChange,
      effectiveAt: new Date(
        parseInstant(approvedChange.effectiveAt),
      ).toISOString(),
    };
    if (
      !isDeepStrictEqual(existingChange.configuration, expected) ||
      existingChange.changeId !== approvedChange.changeId ||
      existingChange.effectiveAt !== expectedApproval.effectiveAt ||
      !isDeepStrictEqual(approval, expectedApproval)
    ) {
      throw new Error(
        "Existing policy version differs from CR-118; no settings were overwritten",
      );
    }
  } else {
    service.applyChange(approvedChange);
  }
  console.log(
    "School configuration fixtures and CR-118 are present; existing versions were not overwritten.",
  );
} finally {
  SqliteHelper.closeConnection(database);
}
