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
} from '@aws-sdk/lib-dynamodb';
import { nanoid } from 'nanoid';
import {
  DeterministicExtraction,
  Interpretation,
  SourceCost,
  Claim,
} from '../shared/entities';

const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const TABLE = process.env.SIGNALS_TABLE!;
const MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';
const PROMPT_VERSION = 'interpret-v1';

interface InterpreterInput {
  signalId: string;
  extraction: DeterministicExtraction;
}

interface InterpreterOutput {
  signalId: string;
  interpretationId: string;
  claims: Claim[];
}

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
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  );

  const responseBody = JSON.parse(
    new TextDecoder().decode(bedrockResponse.body)
  );
  const reasoning = responseBody.content[0].text;

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

  // Create interpretation
  const interpretationId = `intp_${nanoid(8)}`;
  const now = new Date().toISOString();

  // TODO: Parse reasoning into structured claims
  const claims: Claim[] = [];

  const interpretation: Interpretation = {
    interpretationId,
    signalId,
    version: 1,
    deterministicExtraction: extraction,
    llmInterpretation: {
      modelUsed: MODEL_ID,
      modelProvider: 'bedrock',
      promptVersion: PROMPT_VERSION,
      reasoning,
      rawResponse: JSON.stringify(responseBody),
    },
    sourceCost,
    claims,
    uncertainties: [],
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

  // Link to signal
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `SIGNAL#${signalId}`,
        SK: `INTP#${interpretationId}`,
        interpretationId,
        version: 1,
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

${extraction.rawText ?? 'No text content available'}

What does this tell us about the live music world?

Generate claims about:
- Events that exist (artist performing at venue on date)
- Artists mentioned
- Venues mentioned
- Dates and times
- Ticket sources

For each claim, indicate your confidence:
- STRONG: Multiple clear indicators
- MODERATE: Single clear indicator
- WEAK: Implied or uncertain

Also note any uncertainties - things you're not sure about.

Format your response as reasoning about what this evidence tells us.`;
}

function calculateCost(tokensIn: number, tokensOut: number): number {
  // Claude 3 Haiku pricing (as of 2024)
  const inputCostPer1k = 0.00025;
  const outputCostPer1k = 0.00125;
  return (tokensIn / 1000) * inputCostPer1k + (tokensOut / 1000) * outputCostPer1k;
}
