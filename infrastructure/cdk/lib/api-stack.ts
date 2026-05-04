import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as path from 'path';

interface ApiStackProps extends cdk.StackProps {
  stage: string;
  signalsBucket: s3.Bucket;
  signalsTable: dynamodb.Table;
  signalWorkflow: sfn.StateMachine;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Signal intake Lambda (POST /signals)
    const signalIntakeFn = new NodejsFunction(this, 'SignalIntakeFn', {
      functionName: `bndy-signals-intake-${props.stage}`,
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../functions/signal-intake/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        SIGNALS_BUCKET: props.signalsBucket.bucketName,
        SIGNALS_TABLE: props.signalsTable.tableName,
        SIGNAL_WORKFLOW_ARN: props.signalWorkflow.stateMachineArn,
        STAGE: props.stage,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Signal get Lambda (GET /signals/{signalId})
    const signalGetFn = new NodejsFunction(this, 'SignalGetFn', {
      functionName: `bndy-signals-get-${props.stage}`,
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../functions/signal-get/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
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

    // Claim review Lambda (POST /signals/{signalId}/claims/{claimId}/review)
    const claimReviewFn = new NodejsFunction(this, 'ClaimReviewFn', {
      functionName: `bndy-signals-claim-review-${props.stage}`,
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../functions/claim-review/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        SIGNALS_TABLE: props.signalsTable.tableName,
        STAGE: props.stage,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Event candidate API Lambda (GET/POST /candidates)
    const eventCandidateApiFn = new NodejsFunction(this, 'EventCandidateApiFn', {
      functionName: `bndy-signals-event-candidate-api-${props.stage}`,
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../functions/event-candidate-api/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        SIGNALS_TABLE: props.signalsTable.tableName,
        STAGE: props.stage,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Grant permissions
    props.signalsBucket.grantReadWrite(signalIntakeFn);
    props.signalsTable.grantReadWriteData(signalIntakeFn);
    props.signalWorkflow.grantStartExecution(signalIntakeFn);

    props.signalsBucket.grantRead(signalGetFn);
    props.signalsTable.grantReadData(signalGetFn);

    props.signalsTable.grantReadWriteData(claimReviewFn);

    props.signalsTable.grantReadWriteData(eventCandidateApiFn);

    // API Gateway
    const api = new apigateway.RestApi(this, 'SignalsApi', {
      restApiName: `bndy-signals-api-${props.stage}`,
      description: 'bndy signals intake API',
      deployOptions: {
        stageName: props.stage,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // POST /signals
    const signals = api.root.addResource('signals');
    signals.addMethod(
      'POST',
      new apigateway.LambdaIntegration(signalIntakeFn)
    );

    // GET /signals/{signalId}
    const signal = signals.addResource('{signalId}');
    signal.addMethod(
      'GET',
      new apigateway.LambdaIntegration(signalGetFn)
    );

    // POST /signals/{signalId}/claims/{claimId}/review
    const claims = signal.addResource('claims');
    const claim = claims.addResource('{claimId}');
    const review = claim.addResource('review');
    review.addMethod(
      'POST',
      new apigateway.LambdaIntegration(claimReviewFn)
    );

    // Event Candidate API routes
    // GET /candidates
    const candidates = api.root.addResource('candidates');
    candidates.addMethod(
      'GET',
      new apigateway.LambdaIntegration(eventCandidateApiFn)
    );

    // GET /candidates/{candidateId}
    const candidate = candidates.addResource('{candidateId}');
    candidate.addMethod(
      'GET',
      new apigateway.LambdaIntegration(eventCandidateApiFn)
    );

    // POST /candidates/{candidateId}/ratify
    const ratify = candidate.addResource('ratify');
    ratify.addMethod(
      'POST',
      new apigateway.LambdaIntegration(eventCandidateApiFn)
    );

    // POST /candidates/{candidateId}/reject
    const reject = candidate.addResource('reject');
    reject.addMethod(
      'POST',
      new apigateway.LambdaIntegration(eventCandidateApiFn)
    );

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      exportName: `BndySignals-${props.stage}-ApiUrl`,
    });
  }
}
