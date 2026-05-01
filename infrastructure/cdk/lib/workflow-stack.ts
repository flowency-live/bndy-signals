import * as cdk from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface WorkflowStackProps extends cdk.StackProps {
  stage: string;
  signalsBucket: s3.Bucket;
  signalsTable: dynamodb.Table;
}

export class WorkflowStack extends cdk.Stack {
  public readonly signalWorkflow: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: WorkflowStackProps) {
    super(scope, id, props);

    // Deterministic extractor Lambda
    const extractorFn = new lambda.Function(this, 'ExtractorFn', {
      functionName: `bndy-signals-extractor-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('functions/deterministic-extractor'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        SIGNALS_BUCKET: props.signalsBucket.bucketName,
        SIGNALS_TABLE: props.signalsTable.tableName,
        STAGE: props.stage,
      },
    });
    props.signalsBucket.grantRead(extractorFn);
    props.signalsTable.grantReadWriteData(extractorFn);

    // Interpretation runner Lambda
    const interpreterFn = new lambda.Function(this, 'InterpreterFn', {
      functionName: `bndy-signals-interpreter-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('functions/interpretation-runner'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        SIGNALS_TABLE: props.signalsTable.tableName,
        STAGE: props.stage,
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

    // Define workflow tasks
    const extractTask = new tasks.LambdaInvoke(this, 'ExtractTask', {
      lambdaFunction: extractorFn,
      outputPath: '$.Payload',
    });

    const interpretTask = new tasks.LambdaInvoke(this, 'InterpretTask', {
      lambdaFunction: interpreterFn,
      outputPath: '$.Payload',
    });

    const queueForReview = new sfn.Pass(this, 'QueueForReview', {
      result: sfn.Result.fromObject({ status: 'pending_review' }),
    });

    // Define workflow
    const definition = extractTask
      .next(interpretTask)
      .next(queueForReview);

    this.signalWorkflow = new sfn.StateMachine(this, 'SignalWorkflow', {
      stateMachineName: `bndy-signals-workflow-${props.stage}`,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(15),
    });

    // Outputs
    new cdk.CfnOutput(this, 'WorkflowArn', {
      value: this.signalWorkflow.stateMachineArn,
      exportName: `BndySignals-${props.stage}-WorkflowArn`,
    });
  }
}
