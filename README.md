# bndy-signals

Signal ingestion, interpretation, and claims - the bndy cognitive runtime.

## Overview

This service handles the intake loop for bndy:

```
Signal arrives
↓
Deterministic extraction (cheap: CSV, dates, OCR, HTML)
↓
Interpretation (versioned, cost-tracked)
↓
Claims (proposed world-state changes)
↓
Human Review
↓
Memory update
```

**Signals are not "processed". They continuously contribute to evolving world understanding.**

## Architecture

| Component | Purpose | Status |
|-----------|---------|--------|
| Step Functions | Signal workflow orchestration | ✅ `bndy-signals-workflow-dev` |
| Lambda: signal-intake | POST /signals API | ✅ Supports text + image |
| Lambda: deterministic-extractor | OCR + text extraction | ✅ Textract for images |
| Lambda: interpretation-runner | LLM claim generation | ✅ Bedrock Haiku 4.5 |
| Lambda: claim-review | POST review actions | ✅ Accept/reject/challenge |
| S3 | Raw signal storage | ✅ `bndy-signals-dev-*` |
| DynamoDB | Metadata + claims | ✅ `bndy-signals-dev` |
| Bedrock | LLM interpretation | ✅ EU inference profile |

## API Endpoints

```
POST https://9tq7w39hb2.execute-api.eu-west-2.amazonaws.com/dev/signals
GET  https://9tq7w39hb2.execute-api.eu-west-2.amazonaws.com/dev/signals/{signalId}
POST https://9tq7w39hb2.execute-api.eu-west-2.amazonaws.com/dev/signals/{signalId}/claims/{claimId}/review
```

## Key Entities

- **Signal**: Raw evidence (immutable)
- **Interpretation**: Versioned understanding of a signal
- **Claim**: Proposed world-state change
- **EvidencePack**: Corroboration across signals

## Development

```bash
npm install
npm test
npm run build
```

## Deployment

```bash
npx cdk deploy --all
```

## Related

- [bndy brain](https://github.com/flowency-live/florence/tree/main/bndy%20brain) - Knowledge base
- [bndy-frontstage](https://github.com/flowency-live/bndy-frontstage) - Dropzone UI
