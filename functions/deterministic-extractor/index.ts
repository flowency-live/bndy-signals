import { Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { TextractClient, DetectDocumentTextCommand } from '@aws-sdk/client-textract';
import { DeterministicExtraction, Signal } from '../shared/entities';

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const textract = new TextractClient({});

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

  // Perform extraction based on signal type
  let extraction: DeterministicExtraction;

  if (signal.signalType === 'image' && isImageMimeType(signal.mimeType)) {
    // Use Textract for image OCR
    extraction = await extractFromImage(signal);
  } else {
    // Text-based extraction
    extraction = await extractFromText(signal);
  }

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

function isImageMimeType(mimeType?: string): boolean {
  if (!mimeType) return false;
  return mimeType.startsWith('image/');
}

async function extractFromImage(signal: Signal): Promise<DeterministicExtraction> {
  console.log(`Extracting text from image: ${signal.rawContentS3Key}`);

  try {
    // Use Textract to detect text in the image
    const textractResult = await textract.send(
      new DetectDocumentTextCommand({
        Document: {
          S3Object: {
            Bucket: BUCKET,
            Name: signal.rawContentS3Key,
          },
        },
      })
    );

    // Extract all LINE blocks (readable text lines)
    const lines: string[] = [];
    for (const block of textractResult.Blocks || []) {
      if (block.BlockType === 'LINE' && block.Text) {
        lines.push(block.Text);
      }
    }

    const ocrText = lines.join('\n');
    console.log(`Textract extracted ${lines.length} lines, ${ocrText.length} chars`);

    // If no text was extracted, this is a failure - don't send empty content to LLM
    if (lines.length === 0 || ocrText.trim().length === 0) {
      throw new Error('Textract returned no readable text from image');
    }

    return {
      rawText: ocrText,
      ocrText,
      metadata: {
        extractedAt: new Date().toISOString(),
        source: 'textract',
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown Textract error';
    console.error('Textract OCR failed:', errorMessage);

    // Throw to trigger Step Functions failure handling
    // This will set signal status to 'extraction_failed' via the failure handler
    throw new Error(`OCR extraction failed: ${errorMessage}`);
  }
}

async function extractFromText(signal: Signal): Promise<DeterministicExtraction> {
  // Get raw content from S3
  const s3Result = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: signal.rawContentS3Key,
    })
  );

  const rawContent = await s3Result.Body?.transformToString();

  return {
    rawText: rawContent,
    metadata: {
      extractedAt: new Date().toISOString(),
    },
  };
}
