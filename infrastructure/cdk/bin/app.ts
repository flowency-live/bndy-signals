#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/storage-stack';
import { ApiStack } from '../lib/api-stack';
import { WorkflowStack } from '../lib/workflow-stack';
import { SourceRunnerStack } from '../lib/source-runner-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'eu-west-2',
};

const stage = app.node.tryGetContext('stage') ?? 'dev';

const storageStack = new StorageStack(app, `BndySignals-Storage-${stage}`, {
  env,
  stage,
});

const workflowStack = new WorkflowStack(app, `BndySignals-Workflow-${stage}`, {
  env,
  stage,
  signalsBucket: storageStack.signalsBucket,
  signalsTable: storageStack.signalsTable,
});

new ApiStack(app, `BndySignals-Api-${stage}`, {
  env,
  stage,
  signalsBucket: storageStack.signalsBucket,
  signalsTable: storageStack.signalsTable,
  signalWorkflow: workflowStack.signalWorkflow,
});

// Source Runner stack - standalone, imports S3 bucket by name
new SourceRunnerStack(app, `BndySourceRunner-${stage}`, {
  env,
  stage,
  // Uses existing signals bucket via import (no dependency on StorageStack)
});
