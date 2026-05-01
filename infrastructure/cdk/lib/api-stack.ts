import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';

interface ApiStackProps extends cdk.StackProps {
  stage: string;
  signalsBucket: s3.Bucket;
  signalsTable: dynamodb.Table;
  signalWorkflow: sfn.StateMachine;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Signal intake Lambda
    const signalIntakeFn = new lambda.Function(this, 'SignalIntakeFn', {
      functionName: `bndy-signals-intake-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('functions/signal-intake'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        SIGNALS_BUCKET: props.signalsBucket.bucketName,
        SIGNALS_TABLE: props.signalsTable.tableName,
        SIGNAL_WORKFLOW_ARN: props.signalWorkflow.stateMachineArn,
        STAGE: props.stage,
      },
    });

    // Grant permissions
    props.signalsBucket.grantReadWrite(signalIntakeFn);
    props.signalsTable.grantReadWriteData(signalIntakeFn);
    props.signalWorkflow.grantStartExecution(signalIntakeFn);

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

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      exportName: `BndySignals-${props.stage}-ApiUrl`,
    });
  }
}
