import { Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DeterministicExtraction, Signal } from '../shared/entities';

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const BUCKET = process.env.SIGNALS_BUCKET!;
const TABLE = process.env.SIGNALS_TABLE!;

interface ExtractorInput {
  signalId: string;
}

interface ExtractorOutput {
  signalId: string;
  extraction: DeterministicExtraction;
}

export const handler: Handler<ExtractorInput, ExtractorOutput> = async (
  event
) => {
  const { signalId } = event;

  // Get signal metadata
  const signalResult = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `SIGNAL#${signalId}`, SK: '#METADATA' },
    })
  );

  const signal = signalResult.Item as Signal;
  if (!signal) {
    throw new Error(`Signal not found: ${signalId}`);
  }

  // Update status
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `SIGNAL#${signalId}`, SK: '#METADATA' },
      UpdateExpression: 'SET #status = :status, GSI1PK = :gsi1pk',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'extracting',
        ':gsi1pk': 'STATUS#extracting',
      },
    })
  );

  // Get raw content from S3
  const s3Result = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: signal.rawContentS3Key,
    })
  );

  const rawContent = await s3Result.Body?.transformToString();

  // Perform deterministic extraction based on signal type
  const extraction: DeterministicExtraction = {
    rawText: rawContent,
    metadata: {
      extractedAt: new Date().toISOString(),
    },
  };

  // TODO: Add type-specific extraction:
  // - CSV/XLS: Parse rows/columns
  // - HTML: Readability extraction
  // - Image: OCR
  // - Dates: date-fns parsing

  // Update signal with extraction complete
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `SIGNAL#${signalId}`, SK: '#METADATA' },
      UpdateExpression: 'SET #status = :status, GSI1PK = :gsi1pk',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'extracted',
        ':gsi1pk': 'STATUS#extracted',
      },
    })
  );

  return {
    signalId,
    extraction,
  };
};
