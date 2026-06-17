import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

interface StorageStackProps extends cdk.StackProps {
  stage: string;
}

export class StorageStack extends cdk.Stack {
  public readonly signalsBucket: s3.IBucket;
  public readonly signalsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const bucketName = `bndy-signals-${props.stage}-${this.account}`;

    // For prod, import the existing bucket (created manually before CDK was in place)
    // For dev, create new bucket under CDK management
    if (props.stage === 'prod') {
      this.signalsBucket = s3.Bucket.fromBucketName(this, 'SignalsBucket', bucketName);
    } else {
      this.signalsBucket = new s3.Bucket(this, 'SignalsBucket', {
        bucketName,
        encryption: s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        versioned: true,
        lifecycleRules: [
          {
            // Move to IA after 30 days
            transitions: [
              {
                storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                transitionAfter: cdk.Duration.days(30),
              },
            ],
          },
        ],
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
    }

    // DynamoDB table for signals, interpretations, claims
    this.signalsTable = new dynamodb.Table(this, 'SignalsTable', {
      tableName: `bndy-signals-${props.stage}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy:
        props.stage === 'prod'
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    // GSI for status queries
    this.signalsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for strength/corroboration queries
    this.signalsTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Outputs
    new cdk.CfnOutput(this, 'SignalsBucketName', {
      value: this.signalsBucket.bucketName,
      exportName: `BndySignals-${props.stage}-BucketName`,
    });

    new cdk.CfnOutput(this, 'SignalsTableName', {
      value: this.signalsTable.tableName,
      exportName: `BndySignals-${props.stage}-TableName`,
    });
  }
}
