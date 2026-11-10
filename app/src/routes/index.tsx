import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { IPaymentAllocationPlan } from "../server/models/allocation/IPaymentAllocationPlan";
import { cn } from "cn";
import { Alert, AlertDescription } from "../components/ui/alert";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../components/ui/field";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";
import { Textarea } from "../components/ui/textarea";

interface IWorkspace {
  schoolName: string;
  currency: string;
  bursar: string;
  eventCount: number;
  families: {
    familyId: string;
    familyReference: string;
    learners: { admission_no: string; first_name: string }[];
    outstandingMinor: number;
    invoices: {
      invoiceId: string;
      category: string;
      dueOn: string;
      currency: string;
      dueMinor: number;
      paidMinor: number;
      remainingMinor: number;
      payments: {
        source: string;
        reference: string;
        date: string;
        amountMinor: number;
        policyVersion: number;
        decision: {
          actorId: string;
          reason: string;
          resolvedAt: string;
        } | null;
        raw: { file: string; data: string }[];
      }[];
    }[];
  }[];
  holds: {
    schoolId: string;
    eventKey: string;
    fingerprint: string;
    source: string;
    sourceReference: string;
    amountMinor: number;
    netAmountMinor: number;
    currency: string;
    occurredAt: string | null;
    occurredOn: string | null;
    paymentReference: string | null;
    holdReason: string;
    resolutionEligible: boolean;
    resolution?: {
      familyId: string;
      actorId: string;
      reason: string;
      resolvedAt: string;
    };
    allocationPending?: boolean;
    raw: { file: string; data: string }[];
  }[];
}

interface IPreview {
  plan: IPaymentAllocationPlan;
  previewedAt: string;
}

export const Route = createFileRoute("/")({ component: BursarScreen });

function BursarScreen() {
  const [workspace, setWorkspace] = useState<IWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedFamilyId, setSelectedFamilyId] = useState("");
  const [selectedHoldId, setSelectedHoldId] = useState("");
  const [resolutionFamilyId, setResolutionFamilyId] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<IPreview | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refreshWorkspace(): Promise<IWorkspace | null> {
    setLoading(true);
    try {
      const response = await fetch("/api/bursar");
      const payload = (await response.json()) as IWorkspace | { error: string };
      if (!response.ok || "error" in payload)
        throw new Error(
          "error" in payload
            ? payload.error
            : "Could not load the bursar workspace.",
        );
      setWorkspace(payload);
      setLoadError("");
      return payload;
    } catch (cause) {
      setLoadError(
        cause instanceof Error
          ? cause.message
          : "Could not load the bursar workspace.",
      );
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => refreshWorkspace());
  }, []);

  const families = useMemo(() => workspace?.families ?? [], [workspace]);
  const selectedFamily = families.find(
    (family) => family.familyId === selectedFamilyId,
  );
  const selectedHold = workspace?.holds.find(
    (hold) => `${hold.eventKey}:${hold.fingerprint}` === selectedHoldId,
  );
  const filteredFamilies = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return families;
    return families.filter((family) =>
      [
        family.familyReference,
        ...family.learners.flatMap((learner) => [
          learner.admission_no,
          learner.first_name,
        ]),
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [families, query]);

  async function requestPreview() {
    if (!selectedHold || !resolutionFamilyId) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const result = await postAction<IPreview>({
        action: "preview",
        eventKey: selectedHold.eventKey,
        fingerprint: selectedHold.fingerprint,
        familyId: resolutionFamilyId,
      });
      setPreview(result);
    } catch (cause) {
      setPreview(null);
      setError(errorText(cause));
    } finally {
      setWorking(false);
    }
  }

  async function confirmResolution() {
    if (!selectedHold || !resolutionFamilyId || !preview) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await postAction({
        action: "resolve",
        eventKey: selectedHold.eventKey,
        fingerprint: selectedHold.fingerprint,
        familyId: resolutionFamilyId,
        reason,
        expectedPolicyVersion: preview.plan.policyVersion,
        expectedPlan: preview.plan,
      });
      setMessage(
        "Family decision saved. The account balance now includes this payment.",
      );
      setSelectedFamilyId(resolutionFamilyId);
      setSelectedHoldId("");
      setResolutionFamilyId("");
      setPreview(null);
      setReason("");
      await refreshWorkspace();
    } catch (cause) {
      const failure = errorText(cause);
      if (
        failure.includes("policy changed") ||
        failure.includes("balances changed after preview")
      ) {
        setPreview(null);
        await requestPreview();
        setMessage(
          "The allocation changed after the preview. Review the refreshed plan and confirm again.",
        );
      } else {
        setError(failure);
        const refreshedWorkspace = await refreshWorkspace();
        const refreshedHold = refreshedWorkspace?.holds.find(
          (hold) => hold.eventKey === selectedHold.eventKey,
        );
        if (refreshedHold?.allocationPending)
          setMessage(
            "Decision recorded; allocation pending. Use Retry allocation on the saved decision.",
          );
      }
    } finally {
      setWorking(false);
    }
  }

  async function retryAllocation(hold: IWorkspace["holds"][number]) {
    if (!hold.resolution) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const result = await postAction({
        action: "resolve",
        eventKey: hold.eventKey,
        fingerprint: hold.fingerprint,
        familyId: hold.resolution.familyId,
        reason: hold.resolution.reason,
      });
      void result;
      setMessage("Allocation completed. The family balance has been updated.");
      await refreshWorkspace();
    } catch (cause) {
      setError(`Decision recorded; allocation pending. ${errorText(cause)}`);
    } finally {
      setWorking(false);
    }
  }

  const actionableHolds = (workspace?.holds ?? []).filter(
    (hold) => hold.resolutionEligible && !hold.allocationPending,
  );
  const blockedHolds = (workspace?.holds ?? []).filter(
    (hold) => !hold.resolutionEligible,
  );
  const pendingHolds = (workspace?.holds ?? []).filter(
    (hold) => hold.allocationPending,
  );

  return (
    <main className="min-h-screen bg-muted/30 text-foreground">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              {workspace?.schoolName ?? "School fees"}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              Bursar workspace
            </h1>
          </div>
          <Badge variant="secondary">
            {workspace?.bursar ?? "Assessment demo bursar"}
          </Badge>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <section className="flex flex-col gap-5" aria-label="Family accounts">
          <Card>
            <CardHeader>
              <CardTitle>Find a family</CardTitle>
              <CardDescription>
                Search by family reference, learner admission number, or learner
                name.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Input
                aria-label="Search families"
                placeholder="e.g. FAM-201, ADM-1041, Amani"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div
                className="max-h-60 flex flex-col gap-2 overflow-y-auto"
                role="listbox"
                aria-label="Family search results"
              >
                {filteredFamilies.map((family) => (
                  <button
                    key={family.familyId}
                    type="button"
                    role="option"
                    aria-selected={selectedFamilyId === family.familyId}
                    onClick={() => setSelectedFamilyId(family.familyId)}
                    className={cn(
                      "w-full rounded-lg border px-4 py-3 text-left transition",
                      selectedFamilyId === family.familyId
                        ? "border-primary bg-accent"
                        : "border-border bg-background hover:bg-accent",
                    )}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span>
                        <span className="block font-medium">
                          {family.familyReference}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {family.learners
                            .map(
                              (learner) =>
                                `${learner.first_name} · ${learner.admission_no}`,
                            )
                            .join("  /  ")}
                        </span>
                      </span>
                      <span className="text-right text-sm">
                        <span className="block text-muted-foreground">
                          Outstanding
                        </span>
                        <span className="font-semibold">
                          {money(family.outstandingMinor, workspace?.currency)}
                        </span>
                      </span>
                    </span>
                  </button>
                ))}
                {filteredFamilies.length === 0 && (
                  <p className="py-4 text-sm text-muted-foreground">
                    No family matches that search.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {selectedFamily ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3">
                  <span>{selectedFamily.familyReference}</span>
                  <span className="text-lg">
                    {money(
                      selectedFamily.outstandingMinor,
                      workspace?.currency,
                    )}{" "}
                    outstanding
                  </span>
                </CardTitle>
                <CardDescription>
                  {selectedFamily.learners
                    .map(
                      (learner) =>
                        `${learner.first_name} (${learner.admission_no})`,
                    )
                    .join(", ")}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {selectedFamily.invoices.map((invoice) => (
                  <article
                    key={invoice.invoiceId}
                    className="rounded-lg border p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-medium">
                          {humanize(invoice.category)} · {invoice.invoiceId}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Due {date(invoice.dueOn)}
                        </p>
                      </div>
                      <Badge
                        variant={
                          invoice.remainingMinor === 0 ? "secondary" : "outline"
                        }
                      >
                        {invoice.remainingMinor === 0 ? "Paid" : "Balance due"}
                      </Badge>
                    </div>
                    <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                      <Amount
                        label="Due"
                        value={money(invoice.dueMinor, invoice.currency)}
                      />
                      <Amount
                        label="Paid"
                        value={money(invoice.paidMinor, invoice.currency)}
                      />
                      <Amount
                        label="Remaining"
                        value={money(invoice.remainingMinor, invoice.currency)}
                      />
                    </dl>
                    {invoice.payments.length > 0 && (
                      <Separator className="my-4" />
                    )}
                    <div className="flex flex-col gap-3">
                      {invoice.payments.map((payment, index) => (
                        <div
                          key={`${payment.reference}-${index}`}
                          className="text-sm"
                        >
                          <p className="font-medium">
                            {payment.source === "mpesa"
                              ? "M-Pesa"
                              : "Bank transfer"}{" "}
                            · {payment.reference}
                          </p>
                          <p className="text-muted-foreground">
                            {money(payment.amountMinor, invoice.currency)} ·{" "}
                            {dateTime(payment.date)} · policy v
                            {payment.policyVersion}
                          </p>
                          {payment.decision && (
                            <p className="mt-1 text-muted-foreground">
                              Family decision by Assessment demo bursar on{" "}
                              {dateTime(payment.decision.resolvedAt)}:{" "}
                              {payment.decision.reason}
                            </p>
                          )}
                          {payment.raw.length > 0 && (
                            <details className="mt-1 text-muted-foreground">
                              <summary className="cursor-pointer">
                                View original statement evidence
                              </summary>
                              <RawEvidence rows={payment.raw} />
                            </details>
                          )}
                        </div>
                      ))}
                      {invoice.payments.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No payments have been applied to this invoice.
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent>
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>Choose a family</EmptyTitle>
                    <EmptyDescription>
                      See invoice balances and the payment evidence behind them.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </CardContent>
            </Card>
          )}
        </section>

        <aside className="flex flex-col gap-5" aria-label="Payment review">
          <Card>
            <CardHeader>
              <CardTitle>
                Needs a family decision{" "}
                <Badge className="ml-2" variant="outline">
                  {actionableHolds.length}
                </Badge>
              </CardTitle>
              <CardDescription>
                Oldest payments first. Check the source evidence before
                assigning a family.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {actionableHolds.map((hold) => (
                <HoldCard
                  key={`${hold.eventKey}:${hold.fingerprint}`}
                  hold={hold}
                  selected={
                    selectedHoldId === `${hold.eventKey}:${hold.fingerprint}`
                  }
                  onSelect={() => {
                    setSelectedHoldId(`${hold.eventKey}:${hold.fingerprint}`);
                    setPreview(null);
                    setResolutionFamilyId("");
                    setMessage("");
                    setError("");
                  }}
                />
              ))}
              {actionableHolds.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No payments need a family decision.
                </p>
              )}
            </CardContent>
          </Card>

          {pendingHolds.length > 0 && (
            <Card className="border-border">
              <CardHeader>
                <CardTitle>Decision recorded; allocation pending</CardTitle>
                <CardDescription>
                  The family decision is saved. Retry applies the same decision
                  safely.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {pendingHolds.map((hold) => (
                  <div
                    key={hold.eventKey}
                    className="flex items-center justify-between gap-3 rounded border p-3 text-sm"
                  >
                    <span>
                      {hold.sourceReference} · {hold.resolution?.familyId}
                    </span>
                    <Button
                      size="sm"
                      disabled={working}
                      onClick={() => void retryAllocation(hold)}
                    >
                      Retry allocation
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {selectedHold && (
            <Card>
              <CardHeader>
                <CardTitle>Review payment</CardTitle>
                <CardDescription>
                  Assign only when the evidence supports the family.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="rounded-lg bg-muted p-4 text-sm">
                  <p className="font-medium">
                    {selectedHold.source === "mpesa"
                      ? "M-Pesa"
                      : "Bank statement"}{" "}
                    · {selectedHold.sourceReference}
                  </p>
                  <p className="mt-1">
                    {money(selectedHold.netAmountMinor, selectedHold.currency)}{" "}
                    net ·{" "}
                    {dateTime(
                      selectedHold.occurredAt ?? selectedHold.occurredOn ?? "",
                    )}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Reference received:{" "}
                    {selectedHold.paymentReference ?? "No reference supplied"}.
                    Held because: {humanize(selectedHold.holdReason)}.
                  </p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-muted-foreground">
                      View original provider details
                    </summary>
                    <RawEvidence rows={selectedHold.raw} />
                  </details>
                </div>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="family-select">
                      Family to assign
                    </FieldLabel>
                    <select
                      id="family-select"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                      value={resolutionFamilyId}
                      onChange={(event) => {
                        setResolutionFamilyId(event.target.value);
                        setPreview(null);
                      }}
                    >
                      <option value="">Choose a family</option>
                      {families.map((family) => (
                        <option key={family.familyId} value={family.familyId}>
                          {family.familyReference} ·{" "}
                          {family.learners
                            .map((learner) => learner.first_name)
                            .join(", ")}
                        </option>
                      ))}
                    </select>
                  </Field>
                </FieldGroup>
                <Button
                  disabled={!resolutionFamilyId || working}
                  onClick={() => void requestPreview()}
                >
                  {working
                    ? "Preparing preview…"
                    : "Preview invoice allocation"}
                </Button>
                {preview && (
                  <AllocationPreview
                    preview={preview}
                    currency={selectedHold.currency}
                  />
                )}
                {preview && (
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="decision-reason">
                        Why does the evidence support this family?
                      </FieldLabel>
                      <Textarea
                        id="decision-reason"
                        maxLength={500}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="For example: Parent confirmed transfer reference against learner admission record."
                      />
                      <FieldDescription>
                        Record the evidence you checked, not an assumption.
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                )}
                {preview && (
                  <Button
                    className="w-full"
                    disabled={working || reason.trim().length < 5}
                    onClick={() => void confirmResolution()}
                  >
                    {working
                      ? "Saving decision…"
                      : "Confirm family and apply payment"}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {blockedHolds.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Blocked for follow-up</CardTitle>
                <CardDescription>
                  These records need another source or school action. No family
                  assignment is available here.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {blockedHolds.map((hold) => (
                  <HoldCard
                    key={`${hold.eventKey}:${hold.fingerprint}`}
                    hold={hold}
                    selected={false}
                    onSelect={() => undefined}
                    blocked
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
      <div
        className="mx-auto max-w-7xl flex flex-col gap-2 px-5 pb-8"
        aria-live="polite"
      >
        {loading && (
          <p className="text-sm text-muted-foreground">
            Loading family accounts and payment evidence…
          </p>
        )}
        {loadError && (
          <Alert variant="destructive">
            <AlertDescription>
              {loadError} Check setup instructions, then reload the page.
            </AlertDescription>
          </Alert>
        )}
        {workspace?.eventCount === 0 && (
          <Alert>
            <AlertDescription>
              No payments are loaded yet. Load the school configuration and
              payment fixtures to populate this review screen.
            </AlertDescription>
          </Alert>
        )}
        {message && (
          <Alert>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </main>
  );
}

function HoldCard({
  hold,
  selected,
  onSelect,
  blocked = false,
}: {
  hold: IWorkspace["holds"][number];
  selected: boolean;
  onSelect: () => void;
  blocked?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        selected && "border-primary bg-accent",
      )}
    >
      <button
        type="button"
        className="w-full text-left"
        onClick={onSelect}
        disabled={blocked}
      >
        <span className="flex items-start justify-between gap-3">
          <span>
            <span className="block font-medium">{hold.sourceReference}</span>
            <span className="text-sm text-muted-foreground">
              {hold.paymentReference ?? "No payment reference"} ·{" "}
              {dateTime(hold.occurredAt ?? hold.occurredOn ?? "")}
            </span>
          </span>
          <Badge variant={blocked ? "destructive" : "outline"}>
            {money(hold.netAmountMinor, hold.currency)}
          </Badge>
        </span>
        <span className="mt-2 block text-sm text-muted-foreground">
          {blocked
            ? blockedFollowUp(hold.holdReason)
            : humanize(hold.holdReason)}
        </span>
      </button>
      {hold.raw.length > 0 && (
        <details className="mt-2 text-sm text-muted-foreground">
          <summary className="cursor-pointer">View source evidence</summary>
          <RawEvidence rows={hold.raw} />
        </details>
      )}
    </div>
  );
}

function AllocationPreview({
  preview,
  currency,
}: {
  preview: IPreview;
  currency: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm">
      <h3 className="font-semibold">
        Allocation preview · policy v{preview.plan.policyVersion}
      </h3>
      <ul className="mt-2 flex flex-col gap-1">
        {preview.plan.allocations.map((allocation) => (
          <li key={allocation.invoiceId} className="flex justify-between gap-2">
            <span>{allocation.invoiceId}</span>
            <span>{money(allocation.amountMinor, currency)}</span>
          </li>
        ))}
      </ul>
      {preview.plan.remainderMinor > 0 && (
        <p className="mt-2">
          Remaining after invoices:{" "}
          {money(preview.plan.remainderMinor, currency)} ·{" "}
          {preview.plan.remainderTreatment === "refund_hold"
            ? "held for school review"
            : "credited under policy"}
        </p>
      )}
      {preview.plan.allocations.length === 0 &&
        preview.plan.remainderMinor === 0 && (
          <p className="mt-2">No invoice allocation is needed.</p>
        )}
      <p className="mt-2 text-muted-foreground">
        Confirming will record this family decision and apply these amounts.
      </p>
    </div>
  );
}

function Amount({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
}

function RawEvidence({ rows }: { rows: { file: string; data: string }[] }) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      {rows.map((row, index) => (
        <div key={`${row.file}-${index}`}>
          <p>{row.file}</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
            {row.data}
          </pre>
        </div>
      ))}
    </div>
  );
}

async function postAction<T = unknown>(
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("/api/bursar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T | { error: string };
  if (
    !response.ok ||
    (typeof payload === "object" && payload !== null && "error" in payload)
  )
    throw new Error(
      typeof payload === "object" && payload !== null && "error" in payload
        ? payload.error
        : "The request failed.",
    );
  return payload;
}

function errorText(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : "The request failed. Try again.";
}

function money(amountMinor: number, currency = "KES"): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function date(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en-KE", { dateStyle: "medium" }).format(parsed);
}

function dateTime(value: string): string {
  if (!value) return "Date not supplied";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en-KE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Africa/Nairobi",
      }).format(parsed);
}

function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toLocaleUpperCase());
}

function blockedFollowUp(reason: string): string {
  const followUps: Record<string, string> = {
    currency_conversion_unavailable:
      "Currency cannot be converted under current school settings. Ask the school to confirm accepted currency or conversion handling.",
    event_conflict:
      "Conflicting source records exist. Reconcile the provider statement before taking action.",
    source_validation_issue:
      "Source details need correction or confirmation by the payment provider or school.",
    school_mismatch:
      "This payment does not belong to the configured school. Verify the receiving account.",
  };
  return (
    followUps[reason] ??
    "Check the original provider record and school payment setup."
  );
}
