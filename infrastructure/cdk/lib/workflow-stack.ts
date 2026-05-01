import * as cdk from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as path from 'path';

interface WorkflowStackProps extends cdk.StackProps {
  stage: string;
  signalsBucket: s3.Bucket;
  signalsTable: dynamodb.Table;
}

export class WorkflowStack extends cdk.Stack {
  public readonly signalWorkflow: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: WorkflowStackProps) {
    super(scope, id, props);

    // Dead letter queue for failed signals
    const dlq = new sqs.Queue(this, 'FailedSignalsDLQ', {
      queueName: `bndy-signals-failed-${props.stage}`,
      retentionPeriod: cdk.Duration.days(14),
    });

    // Deterministic extractor Lambda
    const extractorFn = new NodejsFunction(this, 'ExtractorFn', {
      functionName: `bndy-signals-extractor-${props.stage}`,
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../functions/deterministic-extractor/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        SIGNALS_BUCKET: props.signalsBucket.bucketName,
        SIGNALS_TABLE: props.signalsTable.tableName,
        STAGE: props.stage,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });
    props.signalsBucket.grantRead(extractorFn);
    props.signalsTable.grantReadWriteData(extractorFn);

    // Interpretation runner Lambda
    const interpreterFn = new NodejsFunction(this, 'InterpreterFn', {
      functionName: `bndy-signals-interpreter-${props.stage}`,
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../functions/interpretation-runner/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        SIGNALS_TABLE: props.signalsTable.tableName,
        STAGE: props.stage,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });
    props.signalsTable.grantReadWriteData(interpreterFn);

    // Grant Bedrock access
    interpreterFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      })
    );

    // Failure handler Lambda
    const failureHandlerFn = new NodejsFunction(this, 'FailureHandlerFn', {
      functionName: `bndy-signals-failure-handler-${props.stage}`,
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../functions/failure-handler/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        SIGNALS_TABLE: props.signalsTable.tableName,
        DLQ_URL: dlq.queueUrl,
        STAGE: props.stage,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });
    props.signalsTable.grantReadWriteData(failureHandlerFn);
    dlq.grantSendMessages(failureHandlerFn);

    // Retry configuration for transient errors
    const retryConfig: sfn.RetryProps[] = [
      {
        errors: ['Lambda.ServiceException', 'Lambda.TooManyRequestsException'],
        interval: cdk.Duration.seconds(2),
        maxAttempts: 3,
        backoffRate: 2,
      },
      {
        errors: ['States.Timeout'],
        interval: cdk.Duration.seconds(5),
        maxAttempts: 2,
        backoffRate: 2,
      },
    ];

    // Define workflow tasks with retries
    const extractTask = new tasks.LambdaInvoke(this, 'ExtractTask', {
      lambdaFunction: extractorFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: false, // We handle retries explicitly
    });
    retryConfig.forEach((config) => extractTask.addRetry(config));

    const interpretTask = new tasks.LambdaInvoke(this, 'InterpretTask', {
      lambdaFunction: interpreterFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: false,
    });
    retryConfig.forEach((config) => interpretTask.addRetry(config));

    // Success state - signal queued for review
    const successState = new sfn.Pass(this, 'QueueForReview', {
      result: sfn.Result.fromObject({ status: 'pending_review' }),
    });

    // Failure handler task
    const handleFailure = new tasks.LambdaInvoke(this, 'HandleFailure', {
      lambdaFunction: failureHandlerFn,
      payload: sfn.TaskInput.fromObject({
        signalId: sfn.JsonPath.stringAt('$.signalId'),
        error: sfn.JsonPath.stringAt('$.error'),
        cause: sfn.JsonPath.stringAt('$.cause'),
        failedStep: sfn.JsonPath.stringAt('$.failedStep'),
      }),
      outputPath: '$.Payload',
    });

    // Final fail state
    const failState = new sfn.Fail(this, 'WorkflowFailed', {
      error: 'SignalProcessingFailed',
      cause: 'Signal processing failed after retries',
    });

    handleFailure.next(failState);

    // Catch configuration - capture error details
    const extractionFailed = new sfn.Pass(this, 'ExtractionFailed', {
      parameters: {
        signalId: sfn.JsonPath.stringAt('$.signalId'),
        error: sfn.JsonPath.stringAt('$.error.Error'),
        cause: sfn.JsonPath.stringAt('$.error.Cause'),
        failedStep: 'extraction',
      },
    });
    extractionFailed.next(handleFailure);

    const interpretationFailed = new sfn.Pass(this, 'InterpretationFailed', {
      parameters: {
        signalId: sfn.JsonPath.stringAt('$.signalId'),
        error: sfn.JsonPath.stringAt('$.error.Error'),
        cause: sfn.JsonPath.stringAt('$.error.Cause'),
        failedStep: 'interpretation',
      },
    });
    interpretationFailed.next(handleFailure);

    // Add catch handlers
    extractTask.addCatch(extractionFailed, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    interpretTask.addCatch(interpretationFailed, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    // Define workflow
    const definition = extractTask
      .next(interpretTask)
      .next(successState);

    this.signalWorkflow = new sfn.StateMachine(this, 'SignalWorkflow', {
      stateMachineName: `bndy-signals-workflow-${props.stage}`,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(15),
      tracingEnabled: true,
    });

    // Outputs
    new cdk.CfnOutput(this, 'WorkflowArn', {
      value: this.signalWorkflow.stateMachineArn,
      exportName: `BndySignals-${props.stage}-WorkflowArn`,
    });

    new cdk.CfnOutput(this, 'FailedSignalsDLQUrl', {
      value: dlq.queueUrl,
      exportName: `BndySignals-${props.stage}-DLQUrl`,
    });
  }
}
