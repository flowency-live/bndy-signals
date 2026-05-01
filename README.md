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

| Component | Purpose |
|-----------|---------|
| Step Functions | Signal workflow orchestration |
| Lambda | Individual processing steps |
| S3 | Raw signal storage |
| DynamoDB | Signal, interpretation, claim metadata |
| Bedrock | LLM interpretation |

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
