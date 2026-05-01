import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { nanoid } from 'nanoid';
import { CreateSignalInputSchema, Signal } from '../shared/entities';

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sfn = new SFNClient({});

const BUCKET = process.env.SIGNALS_BUCKET!;
const TABLE = process.env.SIGNALS_TABLE!;
const WORKFLOW_ARN = process.env.SIGNAL_WORKFLOW_ARN!;

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = JSON.parse(event.body ?? '{}');
    const input = CreateSignalInputSchema.parse(body);

    const signalId = `sgnl_${nanoid(8)}`;
    const now = new Date().toISOString();
    const s3Key = `signals/${signalId}/raw`;

    // Store raw content in S3
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
        Body: body.content ?? '',
        ContentType: input.mimeType ?? 'text/plain',
      })
    );

    // Create signal record
    const signal: Signal = {
      signalId,
      signalType: input.signalType,
      rawContentS3Key: s3Key,
      sourceUrl: input.sourceUrl,
      sourceDescription: input.sourceDescription,
      submittedBy: input.submittedBy,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      status: 'received',
      receivedAt: now,
      interpretationCount: 0,
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `SIGNAL#${signalId}`,
          SK: '#METADATA',
          GSI1PK: `STATUS#${signal.status}`,
          GSI1SK: `SIGNAL#${signalId}`,
          ...signal,
        },
      })
    );

    // Start workflow
    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: WORKFLOW_ARN,
        name: signalId,
        input: JSON.stringify({ signalId }),
      })
    );

    return response(201, { signalId, status: 'received' });
  } catch (error) {
    console.error('Signal intake error:', error);
    return response(500, { error: 'Internal server error' });
  }
};

function response(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}
