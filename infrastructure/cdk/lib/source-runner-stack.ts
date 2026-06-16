/**
 * SourceRunnerStack
 *
 * CDK stack for the source runner infrastructure.
 * ADR-026: Deploy as Lambda, not ECS/Fargate.
 *
 * Resources:
 * - DynamoDB table: bndy-source-state-{stage} (entity resolution state)
 * - DynamoDB table: bndy-source-review-{stage} (review items)
 * - Lambda: KLMA runner (plain Node, zip deploy)
 * - Lambda: On The Case runner (with @sparticuz/chromium)
 * - Lambda: gigs-news runner (with @sparticuz/chromium)
 * - Lambda: Scenic Eye runner (with @sparticuz/chromium)
 * - EventBridge rules: daily schedules → Lambda
 *
 * S3 bucket for snapshots: imports existing bndy-signals-{stage}-{account} bucket
 */

import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';

interface SourceRunnerStackProps extends cdk.StackProps {
  stage: string;
  /**
   * S3 bucket name for storing source run outputs.
   * Default: bndy-signals-{stage}-{account}
   */
  signalsBucketName?: string;
  /**
   * bndy API base URL.
   * Default: https://api.bndy.co.uk
   */
  bndyApiBase?: string;
}

export class SourceRunnerStack extends cdk.Stack {
  public readonly sourceStateTable: dynamodb.Table;
  public readonly sourceReviewTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: SourceRunnerStackProps) {
    super(scope, id, props);

    const { stage, bndyApiBase = 'https://api.bndy.co.uk' } = props;

    // Import existing S3 bucket by name
    const signalsBucketName =
      props.signalsBucketName ?? `bndy-signals-${stage}-${this.account}`;
    const signalsBucket = s3.Bucket.fromBucketName(
      this,
      'SignalsBucket',
      signalsBucketName
    );

    // ---------------------------------------------------------------------
    // DynamoDB Tables
    // ---------------------------------------------------------------------

    // Source state table (entity resolution cache)
    this.sourceStateTable = new dynamodb.Table(this, 'SourceStateTable', {
      tableName: `bndy-source-state-${stage}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy:
        stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Source review table (review items from ambiguous resolutions)
    this.sourceReviewTable = new dynamodb.Table(this, 'SourceReviewTable', {
      tableName: `bndy-source-review-${stage}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy:
        stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // GSI for querying open review items by status
    this.sourceReviewTable.addGlobalSecondaryIndex({
      indexName: 'GSI1-Status',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Common environment variables
    const commonEnv = {
      NODE_ENV: 'production',
      STAGE: stage,
      SOURCE_STATE_TABLE: this.sourceStateTable.tableName,
      SOURCE_REVIEW_TABLE: this.sourceReviewTable.tableName,
      BNDY_SOURCE_RUNS_BUCKET: signalsBucketName,
      BNDY_API_BASE: bndyApiBase,
    };

    // ---------------------------------------------------------------------
    // KLMA Lambda (plain Node, zip deploy)
    // ADR-026: Structured sources → plain Lambda, no Docker
    // ---------------------------------------------------------------------

    const klmaFn = new nodejs.NodejsFunction(this, 'KlmaRunnerFn', {
      functionName: `bndy-klma-runner-${stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../src/source-runner/lambda/klma-handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: commonEnv,
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Grant permissions
    this.sourceStateTable.grantReadWriteData(klmaFn);
    this.sourceReviewTable.grantReadWriteData(klmaFn);
    signalsBucket.grantReadWrite(klmaFn, 'source-runs/*');

    // KLMA schedule: 09:00 UK = 08:00 UTC (BST)
    const klmaRule = new events.Rule(this, 'KlmaSchedule', {
      ruleName: `bndy-klma-schedule-${stage}`,
      description: 'Run KLMA source runner daily at ~09:00 UK time',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '8',
      }),
      enabled: stage === 'prod',
    });

    klmaRule.addTarget(new targets.LambdaFunction(klmaFn));

    // ---------------------------------------------------------------------
    // On The Case Lambda (with @sparticuz/chromium)
    // ADR-026: JS-rendered sources → Lambda with bundled Chromium
    //
    // NOTE: @sparticuz/chromium bundles Linux binaries. Deploy from CI
    // (GitHub Actions on ubuntu-latest), NOT from Windows local dev.
    // Local testing uses regular puppeteer; Lambda uses @sparticuz/chromium.
    // ---------------------------------------------------------------------

    const onTheCaseFn = new nodejs.NodejsFunction(this, 'OnTheCaseRunnerFn', {
      functionName: `bndy-onthecase-runner-${stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../src/source-runner/lambda/onthecase-handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 2048, // More memory for Chromium
      environment: commonEnv,
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        // Include chromium binary for Lambda
        nodeModules: ['@sparticuz/chromium', 'puppeteer-core'],
      },
    });

    // Grant permissions
    this.sourceStateTable.grantReadWriteData(onTheCaseFn);
    this.sourceReviewTable.grantReadWriteData(onTheCaseFn);
    signalsBucket.grantReadWrite(onTheCaseFn, 'source-runs/*');

    // On The Case schedule: 04:05 UK = 03:05 UTC (BST)
    const onTheCaseRule = new events.Rule(this, 'OnTheCaseSchedule', {
      ruleName: `bndy-onthecase-schedule-${stage}`,
      description: 'Run On The Case source runner daily at ~04:05 UK time',
      schedule: events.Schedule.cron({
        minute: '5',
        hour: '3',
      }),
      enabled: stage === 'prod',
    });

    onTheCaseRule.addTarget(new targets.LambdaFunction(onTheCaseFn));

    // ---------------------------------------------------------------------
    // gigs-news Lambda (with @sparticuz/chromium)
    // ADR-026: JS-rendered sources → Lambda with bundled Chromium
    //
    // NOTE: @sparticuz/chromium bundles Linux binaries. Deploy from CI
    // (GitHub Actions on ubuntu-latest), NOT from Windows local dev.
    // ---------------------------------------------------------------------

    const gigsNewsFn = new nodejs.NodejsFunction(this, 'GigsNewsRunnerFn', {
      functionName: `bndy-gigs-news-runner-${stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../src/source-runner/lambda/gigs-news-handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 2048, // More memory for Chromium
      environment: commonEnv,
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        // Include chromium binary for Lambda
        nodeModules: ['@sparticuz/chromium', 'puppeteer-core'],
      },
    });

    // Grant permissions
    this.sourceStateTable.grantReadWriteData(gigsNewsFn);
    this.sourceReviewTable.grantReadWriteData(gigsNewsFn);
    signalsBucket.grantReadWrite(gigsNewsFn, 'source-runs/*');

    // gigs-news schedule: 09:00 UK = 08:00 UTC (BST)
    // Per handoff: weekly content, daily check for updates
    const gigsNewsRule = new events.Rule(this, 'GigsNewsSchedule', {
      ruleName: `bndy-gigs-news-schedule-${stage}`,
      description: 'Run gigs-news source runner daily at ~09:00 UK time',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '8',
      }),
      enabled: stage === 'prod',
    });

    gigsNewsRule.addTarget(new targets.LambdaFunction(gigsNewsFn));

    // ---------------------------------------------------------------------
    // Scenic Eye Lambda (with @sparticuz/chromium)
    // ADR-026: JS-rendered sources → Lambda with bundled Chromium
    //
    // NOTE: @sparticuz/chromium bundles Linux binaries. Deploy from CI
    // (GitHub Actions on ubuntu-latest), NOT from Windows local dev.
    //
    // IMPORTANT: Scenic Eye is frequently stale - most runs import 0 gigs.
    // This is expected behaviour (Neil often hasn't posted the new week).
    // ---------------------------------------------------------------------

    const scenicEyeFn = new nodejs.NodejsFunction(this, 'ScenicEyeRunnerFn', {
      functionName: `bndy-sceniceye-runner-${stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../src/source-runner/lambda/sceniceye-handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 2048, // More memory for Chromium
      environment: commonEnv,
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        // Include chromium binary for Lambda
        nodeModules: ['@sparticuz/chromium', 'puppeteer-core'],
      },
    });

    // Grant permissions
    this.sourceStateTable.grantReadWriteData(scenicEyeFn);
    this.sourceReviewTable.grantReadWriteData(scenicEyeFn);
    signalsBucket.grantReadWrite(scenicEyeFn, 'source-runs/*');

    // Scenic Eye schedule: 09:30 UK = 08:30 UTC (BST)
    // Offset from other sources to avoid concurrent runs
    const scenicEyeRule = new events.Rule(this, 'ScenicEyeSchedule', {
      ruleName: `bndy-sceniceye-schedule-${stage}`,
      description: 'Run Scenic Eye source runner daily at ~09:30 UK time',
      schedule: events.Schedule.cron({
        minute: '30',
        hour: '8',
      }),
      enabled: stage === 'prod',
    });

    scenicEyeRule.addTarget(new targets.LambdaFunction(scenicEyeFn));

    // ---------------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------------

    new cdk.CfnOutput(this, 'SourceStateTableName', {
      value: this.sourceStateTable.tableName,
      exportName: `BndySourceRunner-${stage}-StateTable`,
    });

    new cdk.CfnOutput(this, 'SourceReviewTableName', {
      value: this.sourceReviewTable.tableName,
      exportName: `BndySourceRunner-${stage}-ReviewTable`,
    });

    new cdk.CfnOutput(this, 'KlmaFunctionArn', {
      value: klmaFn.functionArn,
      exportName: `BndySourceRunner-${stage}-KlmaFn`,
    });

    new cdk.CfnOutput(this, 'OnTheCaseFunctionArn', {
      value: onTheCaseFn.functionArn,
      exportName: `BndySourceRunner-${stage}-OnTheCaseFn`,
    });

    new cdk.CfnOutput(this, 'GigsNewsFunctionArn', {
      value: gigsNewsFn.functionArn,
      exportName: `BndySourceRunner-${stage}-GigsNewsFn`,
    });

    new cdk.CfnOutput(this, 'ScenicEyeFunctionArn', {
      value: scenicEyeFn.functionArn,
      exportName: `BndySourceRunner-${stage}-ScenicEyeFn`,
    });
  }
}
