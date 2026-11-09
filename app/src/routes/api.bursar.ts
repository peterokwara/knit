import { createFileRoute } from "@tanstack/react-router";
import type { IExpectedPaymentAllocationPreview } from "../server/models/allocation/IExpectedPaymentAllocationPreview";

export const Route = createFileRoute("/api/bursar")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { getBursarWorkspace } =
            await import("../server/bursarWorkspace.server");
          return Response.json(getBursarWorkspace());
        } catch (error) {
          return errorResponse(error);
        }
      },
      POST: async ({ request }) => {
        try {
          const body: unknown = await request.json();
          if (!isObject(body) || typeof body.action !== "string")
            return Response.json(
              { error: "Choose an action." },
              { status: 400 },
            );
          const services = await import("../server/bursarWorkspace.server");
          if (body.action === "preview")
            return Response.json(
              services.previewBursarResolution({
                eventKey: text(body.eventKey),
                fingerprint: text(body.fingerprint),
                familyId: text(body.familyId),
              }),
            );
          if (body.action === "resolve")
            return Response.json(
              services.confirmBursarResolution({
                eventKey: text(body.eventKey),
                fingerprint: text(body.fingerprint),
                familyId: text(body.familyId),
                reason: text(body.reason),
                ...(body.expectedPolicyVersion === undefined
                  ? {}
                  : {
                      expectedPolicyVersion: number(body.expectedPolicyVersion),
                    }),
                ...(body.expectedPlan === undefined
                  ? {}
                  : { expectedPlan: expectedPlan(body.expectedPlan) }),
              }),
            );
          return Response.json({ error: "Unknown action." }, { status: 400 });
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error("Required information is missing.");
  return value;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new Error("The policy preview is invalid. Refresh it and try again.");
  return value;
}

function expectedPlan(value: unknown): IExpectedPaymentAllocationPreview {
  if (!isObject(value) || !Array.isArray(value.allocations))
    throw new Error(
      "The allocation preview is invalid. Refresh it and try again.",
    );
  const treatments = ["none", "credit", "refund_hold"];
  if (
    typeof value.policyVersion !== "number" ||
    !Number.isSafeInteger(value.policyVersion) ||
    typeof value.remainderMinor !== "number" ||
    !Number.isSafeInteger(value.remainderMinor) ||
    typeof value.remainderTreatment !== "string" ||
    !treatments.includes(value.remainderTreatment)
  )
    throw new Error(
      "The allocation preview is invalid. Refresh it and try again.",
    );
  const allocations = value.allocations.map((allocation) => {
    if (
      !isObject(allocation) ||
      typeof allocation.invoiceId !== "string" ||
      typeof allocation.amountMinor !== "number" ||
      !Number.isSafeInteger(allocation.amountMinor)
    )
      throw new Error(
        "The allocation preview is invalid. Refresh it and try again.",
      );
    return {
      invoiceId: allocation.invoiceId,
      amountMinor: allocation.amountMinor,
    };
  });
  return {
    policyVersion: value.policyVersion,
    allocations,
    remainderMinor: value.remainderMinor,
    remainderTreatment:
      value.remainderTreatment as IExpectedPaymentAllocationPreview["remainderTreatment"],
  };
}

function errorResponse(error: unknown): Response {
  const message =
    error instanceof Error ? error.message : "The request failed.";
  const status = message.includes("not loaded") ? 503 : 400;
  return Response.json({ error: message }, { status });
}
