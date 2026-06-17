/**
 * Intelligence Module
 *
 * LLM-powered resolution for review items (#70).
 */

export * from './types';
export * from './resolver';
export * from './gather-candidates';
export * from './gather-evidence';
export * from './llm-resolve';
export * from './apply-decision';
export * from './review-item-storage';
// CLI is not re-exported - run directly via npm scripts
