# Verification record

Verified on 26 October 2026.

- All 19 Node test cases passed, including the suite of 180 independently authored evidence fixtures.
- Local HTTP server delivery, persistence across restart, invalid data rejection, and traversal protection passed.
- Browser checks covered a confirmed skipped guardrail, an executed-but-unobserved guardrail, successful fallback recovery, policy revision approval, retained historical policy versions, ledger search and filters, and validation report percentages.
- The interface was inspected at desktop (1440 px) and narrow mobile (390 px) widths. The mobile overview had no horizontal overflow.
- The browser-visible validation showed 180/180 cases passing, 100% confirmed omission precision, 100% recall for evidence-supported omissions, 42.9% recall across all known true omissions, and 100% unverified classification accuracy.

The lower overall recall is intentional: unobservable omissions remain unverified instead of being asserted as fact. These results describe synthetic fixtures and the bounded model. They do not establish production accuracy or performance.
