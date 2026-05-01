import { Handler } from 'aws-lambda';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  PutCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { customAlphabet } from 'nanoid';

const alphanumeric = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const nanoid = customAlphabet(alphanumeric, 8);
import { z } from 'zod';
import {
  DeterministicExtraction,
  Interpretation,
  SourceCost,
  Claim,
  ClaimType,
  Strength,
} from '../shared/entities';

const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE = process.env.SIGNALS_TABLE!;
const MODEL_ID = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';
const PROMPT_VERSION = 'interpret-v2';

interface InterpreterInput {
  signalId: string;
  extraction: DeterministicExtraction;
}

interface InterpreterOutput {
  signalId: string;
  interpretationId: string;
  claims: Claim[];
}

// Schema for Claude's structured output
const LLMClaimSchema = z.object({
  type: z.enum([
    'event_exists',
    'artist_performs',
    'venue_hosts',
    'event_date',
    'event_time',
    'ticket_source',
    'artist_exists',
    'venue_exists',
  ]),
  subject: z.string(),
  predicate: z.string(),
  object: z.string().optional(),
  value: z.string().optional(),
  strength: z.enum(['weak', 'moderate', 'strong']),
  reasoning: z.string(),
});

const LLMOutputSchema = z.object({
  summary: z.string(),
  claims: z.array(LLMClaimSchema),
  uncertainties: z.array(z.string()),
});

type LLMOutput = z.infer<typeof LLMOutputSchema>;

export const handler: Handler<InterpreterInput, InterpreterOutput> = async (
  event
) => {
  const { signalId, extraction } = event;
  const startTime = Date.now();

  // Update status
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `SIGNAL#${signalId}`, SK: '#METADATA' },
      UpdateExpression: 'SET #status = :status, GSI1PK = :gsi1pk',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'interpreting',
        ':gsi1pk': 'STATUS#interpreting',
      },
    })
  );

  // Build prompt
  const prompt = buildInterpretationPrompt(extraction);

  // Call Bedrock
  const bedrockResponse = await bedrock.send(
    new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  );

  const responseBody = JSON.parse(
    new TextDecoder().decode(bedrockResponse.body)
  );
  const rawResponse = responseBody.content[0].text;

  // Calculate costs
  const runtimeMs = Date.now() - startTime;
  const tokensIn = responseBody.usage?.input_tokens ?? 0;
  const tokensOut = responseBody.usage?.output_tokens ?? 0;
  const modelCost = calculateCost(tokensIn, tokensOut);

  const sourceCost: SourceCost = {
    modelCost,
    tokensIn,
    tokensOut,
    runtimeMs,
  };

  // Parse structured output
  const llmOutput = parseStructuredOutput(rawResponse);

  // Create interpretation
  const interpretationId = `intp_${nanoid()}`;
  const now = new Date().toISOString();

  // Convert LLM claims to Claim records
  const claims: Claim[] = llmOutput.claims.map((llmClaim) => ({
    claimId: `clm_${nanoid()}`,
    claimType: llmClaim.type as ClaimType,
    subject: llmClaim.subject,
    predicate: llmClaim.predicate,
    object: llmClaim.object,
    value: llmClaim.value,
    strength: llmClaim.strength as Strength,
    strengthReasoning: llmClaim.reasoning,
    interpretationId,
    signalId,
    status: 'proposed' as const,
    createdAt: now,
  }));

  const interpretation: Interpretation = {
    interpretationId,
    signalId,
    version: 1,
    deterministicExtraction: extraction,
    llmInterpretation: {
      modelUsed: MODEL_ID,
      modelProvider: 'bedrock',
      promptVersion: PROMPT_VERSION,
      reasoning: llmOutput.summary,
      rawResponse,
    },
    sourceCost,
    claims,
    uncertainties: llmOutput.uncertainties,
    status: 'pending_review',
    createdAt: now,
  };

  // Store interpretation
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `INTP#${interpretationId}`,
        SK: '#METADATA',
        GSI1PK: 'STATUS#pending_review',
        GSI1SK: `INTP#${interpretationId}`,
        ...interpretation,
      },
    })
  );

  // Store claims individually for querying
  if (claims.length > 0) {
    const claimItems = claims.map((claim) => ({
      PutRequest: {
        Item: {
          PK: `CLAIM#${claim.claimId}`,
          SK: '#METADATA',
          GSI1PK: `STATUS#${claim.status}`,
          GSI1SK: `CLAIM#${claim.claimId}`,
          GSI2PK: `SIGNAL#${signalId}`,
          GSI2SK: `CLAIM#${claim.claimId}`,
          ...claim,
        },
      },
    }));

    // BatchWrite in chunks of 25
    for (let i = 0; i < claimItems.length; i += 25) {
      const batch = claimItems.slice(i, i + 25);
      await ddb.send(
        new BatchWriteCommand({
          RequestItems: { [TABLE]: batch },
        })
      );
    }
  }

  // Link interpretation to signal
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `SIGNAL#${signalId}`,
        SK: `INTP#${interpretationId}`,
        interpretationId,
        version: 1,
        claimCount: claims.length,
        createdAt: now,
      },
    })
  );

  // Update signal status
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `SIGNAL#${signalId}`, SK: '#METADATA' },
      UpdateExpression:
        'SET #status = :status, GSI1PK = :gsi1pk, currentInterpretationId = :intpId, interpretationCount = interpretationCount + :one',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'pending_review',
        ':gsi1pk': 'STATUS#pending_review',
        ':intpId': interpretationId,
        ':one': 1,
      },
    })
  );

  return {
    signalId,
    interpretationId,
    claims,
  };
};

function buildInterpretationPrompt(extraction: DeterministicExtraction): string {
  return `You are analyzing evidence about live music events.

This content was extracted from a signal (user-submitted evidence):

<content>
${extraction.rawText ?? 'No text content available'}
</content>

Analyze this evidence and generate structured claims about the live music world.

You MUST respond with valid JSON in this exact format:
{
  "summary": "Brief explanation of what this evidence tells us",
  "claims": [
    {
      "type": "event_exists|artist_performs|venue_hosts|event_date|event_time|ticket_source|artist_exists|venue_exists",
      "subject": "The entity making or receiving the claim",
      "predicate": "The relationship or action",
      "object": "The target entity or value",
      "value": "Optional specific value (date, time, URL)",
      "strength": "weak|moderate|strong",
      "reasoning": "Why you believe this claim at this strength"
    }
  ],
  "uncertainties": ["Things you are not sure about"]
}

Claim types:
- event_exists: An event is happening (subject=event name, object=description)
- artist_performs: An artist is performing (subject=artist, predicate=performs_at, object=event/venue)
- venue_hosts: A venue is hosting (subject=venue, predicate=hosts, object=event)
- event_date: Event has a date (subject=event, predicate=on_date, value=YYYY-MM-DD)
- event_time: Event has a time (subject=event, predicate=at_time, value=HH:MM)
- ticket_source: Tickets available (subject=event, predicate=tickets_at, object=source name, value=URL)
- artist_exists: Artist mentioned (subject=artist name, object=any identifiers)
- venue_exists: Venue mentioned (subject=venue name, object=location if known)

Strength levels:
- strong: Multiple clear indicators or authoritative source
- moderate: Single clear indicator
- weak: Implied or uncertain, needs corroboration

Example for "STINGRAY LIVE AT THE RIGGER THURSDAY 15TH MAY 8PM":
{
  "summary": "Announcement for Stingray performing at The Rigger on May 15th",
  "claims": [
    {
      "type": "event_exists",
      "subject": "Stingray Live",
      "predicate": "exists",
      "object": "Live music event",
      "strength": "moderate",
      "reasoning": "Single announcement, appears to be event promotion"
    },
    {
      "type": "artist_performs",
      "subject": "Stingray",
      "predicate": "performs_at",
      "object": "The Rigger",
      "strength": "moderate",
      "reasoning": "Artist name clearly stated in event title"
    },
    {
      "type": "venue_hosts",
      "subject": "The Rigger",
      "predicate": "hosts",
      "object": "Stingray Live",
      "strength": "moderate",
      "reasoning": "Venue name clearly stated, but no address to confirm identity"
    },
    {
      "type": "event_date",
      "subject": "Stingray Live",
      "predicate": "on_date",
      "object": "2026-05-15",
      "value": "2026-05-15",
      "strength": "weak",
      "reasoning": "Date given as 'Thursday 15th May' - year inferred as next occurrence"
    },
    {
      "type": "event_time",
      "subject": "Stingray Live",
      "predicate": "at_time",
      "object": "20:00",
      "value": "20:00",
      "strength": "moderate",
      "reasoning": "Time clearly stated as 8PM"
    }
  ],
  "uncertainties": [
    "Year not specified - inferred as 2026",
    "Venue location unknown - cannot confirm which 'The Rigger' this is",
    "Unclear if 8PM is doors or start time"
  ]
}

Now analyze the content above and respond with JSON only.`;
}

function parseStructuredOutput(rawResponse: string): LLMOutput {
  // Try to extract JSON from response
  let jsonStr = rawResponse;

  // Handle markdown code blocks
  const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch?.[1]) {
    jsonStr = jsonMatch[1].trim();
  }

  // Try to find JSON object
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return LLMOutputSchema.parse(parsed);
  } catch (error) {
    // Fallback: return empty claims with error noted
    console.error('Failed to parse LLM output:', error);
    return {
      summary: 'Failed to parse structured output',
      claims: [],
      uncertainties: ['LLM response could not be parsed as structured JSON'],
    };
  }
}

function calculateCost(tokensIn: number, tokensOut: number): number {
  // Claude Haiku 4.5 pricing ($0.80/M in, $4/M out)
  const inputCostPer1k = 0.0008;
  const outputCostPer1k = 0.004;
  return (tokensIn / 1000) * inputCostPer1k + (tokensOut / 1000) * outputCostPer1k;
}
