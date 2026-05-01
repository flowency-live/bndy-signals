# bndy-signals Project Context

## What This Is

The cognitive runtime for bndy - signal ingestion, interpretation, and claims.

**Signals are not "processed". They continuously contribute to evolving world understanding.**

## Key Concepts

| Concept | Meaning |
|---------|---------|
| Signal | Raw evidence (Facebook paste, poster image, URL) |
| Interpretation | Versioned understanding of a signal |
| Claim | Proposed world-state change |
| EvidencePack | Corroboration across multiple signals |

## Architecture

```
Signal → Step Functions Workflow → DynamoDB/S3
         ├── Deterministic extraction (cheap)
         ├── LLM interpretation (cost-tracked)
         └── Claims generated
```

## Directory Structure

```
functions/           # Lambda handlers
  signal-intake/     # POST /signals
  deterministic-extractor/
  interpretation-runner/
  shared/
    entities/        # TypeScript interfaces
    extractors/      # CSV, HTML, date, OCR

infrastructure/cdk/  # AWS CDK stacks
  lib/
    storage-stack.ts
    api-stack.ts
    workflow-stack.ts

workflows/           # Step Functions definitions
prompts/             # LLM prompt templates
```

## Testing

TDD is non-negotiable. Every Lambda has co-located tests.

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

## Deployment

```bash
npx cdk deploy --all  # Deploy to AWS
```

## Related Documentation

- [bndy brain](https://github.com/flowency-live/florence/tree/main/bndy%20brain) - Full knowledge base
- [Cognitive Runtime](../bndy%20brain/11-runtime/cognitive-runtime.md) - Runtime philosophy
- [Interpretation Model](../bndy%20brain/05-entities/interpretation-model.md) - Entity spec
- [Evidence Pack Model](../bndy%20brain/05-entities/evidence-pack-model.md) - Corroboration

## Cost Tracking

Every interpretation MUST record:
- `modelCost`: USD
- `tokensIn`: Input tokens
- `tokensOut`: Output tokens
- `runtimeMs`: Execution time

## Phase 1 Constraints

- All signals go to human review (no auto-accept)
- No source profiles (manual dropzone only)
- No auto-merge of evidence packs
