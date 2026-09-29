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
