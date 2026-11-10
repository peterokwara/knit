# Payment journey

```mermaid
flowchart TD
    A[Parent pays by M-Pesa or bank transfer] --> B[Receive and record provider data]
    B --> C[Identify repeated transactions and count each payment once]
    C --> D{Can the reference identify one family?}
    D -- Yes --> E{Is the payment eligible for allocation?}
    D -- No --> F[Hold for bursar review]
    F --> G[Bursar checks evidence, chooses a family and records a reason]
    G --> E
    E -- Yes --> H[Allocate to open invoices using the school policy]
    H --> I[Save the allocation and policy version]
    I --> J[Bursar sees invoice balances and payment evidence]
    E -- No --> K[Hold for separate follow-up, for example USD without a configured exchange rate]
    R[Provider reports a reversal] --> S[Keep the original records and the reversal]
    S --> T[Recalculate the affected balances when the account is read]
    T --> J
```

Reversals can arrive before or after the original payment. Only eligible reference-related holds can be resolved by choosing a family; currency mismatches and conflicting records require separate follow-up. A later policy change does not rewrite an existing allocation: the saved plan retains the policy version used when it was made. The server calculates the effect of reversals when reading balances; the system does not save a separate correction ledger.
