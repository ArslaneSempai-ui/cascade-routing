# Vendor export fixtures

Every file in this folder is **synthetic**: written by hand against the published response
schema of each vendor, for the adapters' tests. No file was produced by a vendor, no document
behind them exists, and no person, company, address or number in them is real. Each JSON
carries a `_synthetic` key saying so.

The schemas they follow, and where they were read on 2026-09-29:

| Vendor | Shape | Read from |
|---|---|---|
| Amazon Textract | AnalyzeDocument (FORMS, QUERIES), AnalyzeExpense, AnalyzeID | `clients/client-textract/src/models/models_0.ts` in aws/aws-sdk-js-v3 (Apache-2.0) |
| Google Document AI | Document JSON | `google/cloud/documentai/v1/document.proto` in googleapis/googleapis (Apache-2.0) |
| Azure AI Document Intelligence | AnalyzeResult, API 2024-11-30 | `specification/ai/data-plane/DocumentIntelligence` in Azure/azure-rest-api-specs (MIT) |

The vendors' own documentation samples were not copied: their pages were not reachable from
the environment this was written in, and a sample invented here carries no licence question.

`cases.csv` is the labelled file the tests grade against; its header declares a kind per
field (`total:amount`). `mapping.json` maps each field to a selector per vendor.

## Fixtures added by the review of 2026-09-29

Each one is synthetic like the others, hand-written (or, for the snake_case copy, generated
from a hand-written one) against the same schemas and read from the same sources as the
table above; each carries `_synthetic`. Each folder is a readable export folder on its own,
so a test can hand it to `readExports` without touching the folders above.

| Folder or file | Item | What it is | Schema |
|---|---|---|---|
| `documentai-snake-case/INV-001.json` | 16 | `documentai/INV-001.json` with every key in snake_case, as proto-plus `to_dict()` and `MessageToDict(preserving_proto_field_name=True)` write it; generated from that file, so the two cannot drift | Document, proto field names |
| `documentai-normalized/NRM-001.json` | 30 | entities whose `normalizedValue` carries a typed value and no `text`: `moneyValue` (whole, fractional, negative), `dateValue`, `datetimeValue`, `floatValue`, `integerValue`, `booleanValue`, one with `text` beside the money, and two with an empty `normalizedValue` (one mentioned, one anchored only) | Document, `NormalizedValue` oneof |
| `textract-id-two-sides/ID-002.json` | 17 | AnalyzeID with two `IdentityDocuments`, the back of the licence first: fields not printed on a side come back with an empty `Text` | AnalyzeID |
| `textract-queries-all-pages/INV-004.json` | 18 | AnalyzeDocument QUERIES run with `Pages: ["*"]`: the same alias has one QUERY block per page; page one has no answer for the invoice number, page two has it; the total is answered on both pages with different confidences | AnalyzeDocument, `Query.Pages` |
| `textract-expense-groups/RCP-002.json` | 31 | AnalyzeExpense with `GroupProperties`: NAME, ADDRESS and TAX_PAYER_ID once for the VENDOR group and once for RECEIVER_BILL_TO, the tax id equal in both, plus ungrouped TOTAL and INVOICE_RECEIPT_ID | AnalyzeExpense, `ExpenseField.GroupProperties` (`Types`, `Id`) |
| `azure-address/ADR-001.json` | 29 | three address fields: one with `streetAddress` next to `houseNumber` and `road` plus `unit`, `countryRegion`, `suburb` and `level`; one with a `poBox`; one with `cityDistrict` and `stateDistrict` | AnalyzeResult 2024-11-30, `AddressValue` |
| `failed/textract-exception.json` | 32 | the JSON-protocol exception body of a failed synchronous Textract call (`__type`, `Message`) | AWS JSON protocol error |
| `failed/textract-error-envelope.json` | 32 | the `Error: { Code, Message }` envelope the AWS CLI and SDK v2 write | AWS CLI / SDK v2 error envelope |
| `failed/textract-job-failed.json` | 32 | a `GetDocumentAnalysis` response whose `JobStatus` is FAILED, with `StatusMessage` and no Blocks | GetDocumentAnalysis |
| `failed/azure-status-failed.json` | 32 | an operation result with `status: "failed"`, its `error` (code, message, innererror) and no `analyzeResult` | AnalyzeOperation 2024-11-30 |
| `failed/azure-error.json` | 32 | the bare `{ "error": { "code", "message" } }` body of a request the service refused | Azure error response |
| `failed/documentai-error.json` | 32 | `google.rpc.Status` in its JSON form (`code`, `message`, `status`), what a failed process call returns in place of a Document | google.rpc.Status |

The `failed/` files are not keyed by case id: the tests copy them under case names of their
own next to copies of `textract/RCP-001.json` to build a folder of twenty successes and five
failures.
