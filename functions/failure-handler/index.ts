import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});

const TABLE = process.env.SIGNALS_TABLE!;
const DLQ_URL = process.env.DLQ_URL!;

interface FailureInput {
  signalId: string;
  error: string;
  cause: string;
  failedStep: 'extraction' | 'interpretation';
}

interface FailureOutput {
  signalId: string;
  status: 'failed';
  failedStep: string;
  sentToDLQ: boolean;
}

export const handler: Handler<FailureInput, FailureOutput> = async (event) => {
  const { signalId, error, cause, failedStep } = event;
  const now = new Date().toISOString();

  console.error('Signal processing failed:', {
    signalId,
    error,
    cause,
    failedStep,
  });

  // Update signal status to failed
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `SIGNAL#${signalId}`, SK: '#METADATA' },
      UpdateExpression:
        'SET #status = :status, GSI1PK = :gsi1pk, failedAt = :failedAt, failureReason = :reason, failedStep = :step',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'failed',
        ':gsi1pk': 'STATUS#failed',
        ':failedAt': now,
        ':reason': `${error}: ${cause}`,
        ':step': failedStep,
      },
    })
  );

  // Send to DLQ for investigation/retry
  let sentToDLQ = false;
  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: DLQ_URL,
        MessageBody: JSON.stringify({
          signalId,
          error,
          cause,
          failedStep,
          failedAt: now,
        }),
        MessageAttributes: {
          signalId: {
            DataType: 'String',
            StringValue: signalId,
          },
          failedStep: {
            DataType: 'String',
            StringValue: failedStep,
          },
        },
      })
    );
    sentToDLQ = true;
  } catch (sqsError) {
    console.error('Failed to send to DLQ:', sqsError);
  }

  return {
    signalId,
    status: 'failed',
    failedStep,
    sentToDLQ,
  };
};
