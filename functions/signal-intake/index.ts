import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { nanoid } from 'nanoid';
import { ZodError } from 'zod';
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

    // Determine content and mime type based on signal type
    const { contentBuffer, mimeType, fileSize } = resolveContent(input);

    // Store raw content in S3
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
        Body: contentBuffer,
        ContentType: mimeType,
        Metadata: {
          signalId,
          signalType: input.signalType,
          ...(input.fileName ? { fileName: input.fileName } : {}),
        },
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
      mimeType,
      fileSize,
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

    if (error instanceof ZodError) {
      return response(400, {
        error: 'Invalid input',
        details: error.errors,
      });
    }

    return response(500, { error: 'Internal server error' });
  }
};

interface ResolvedContent {
  contentBuffer: Buffer | string;
  mimeType: string;
  fileSize: number;
}

function resolveContent(input: ReturnType<typeof CreateSignalInputSchema.parse>): ResolvedContent {
  const { signalType } = input;

  // Text-based signals
  if (signalType === 'text_paste' || signalType === 'note') {
    const content = input.content ?? '';
    return {
      contentBuffer: content,
      mimeType: 'text/plain',
      fileSize: Buffer.byteLength(content, 'utf8'),
    };
  }

  // URL signals - store the URL itself, Playwright will fetch later
  if (signalType === 'url') {
    const content = input.sourceUrl ?? '';
    return {
      contentBuffer: content,
      mimeType: 'text/uri-list',
      fileSize: Buffer.byteLength(content, 'utf8'),
    };
  }

  // Binary uploads (image, spreadsheet)
  if (input.base64Content) {
    const buffer = Buffer.from(input.base64Content, 'base64');
    const mimeType = input.mimeType ?? inferMimeType(signalType, input.fileName);
    return {
      contentBuffer: buffer,
      mimeType,
      fileSize: buffer.length,
    };
  }

  // Fallback for URL-referenced images/spreadsheets
  if (input.sourceUrl) {
    const content = input.sourceUrl;
    return {
      contentBuffer: content,
      mimeType: 'text/uri-list',
      fileSize: Buffer.byteLength(content, 'utf8'),
    };
  }

  // Should not reach here due to schema validation
  return {
    contentBuffer: '',
    mimeType: 'text/plain',
    fileSize: 0,
  };
}

function inferMimeType(signalType: string, fileName?: string): string {
  // Try to infer from file extension
  if (fileName) {
    const ext = fileName.toLowerCase().split('.').pop();
    const mimeMap: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'csv': 'text/csv',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    if (ext && mimeMap[ext]) {
      return mimeMap[ext];
    }
  }

  // Fallback by signal type
  if (signalType === 'image') {
    return 'image/jpeg';
  }
  if (signalType === 'spreadsheet') {
    return 'text/csv';
  }

  return 'application/octet-stream';
}

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
