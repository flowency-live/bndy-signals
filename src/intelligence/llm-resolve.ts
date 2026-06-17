/**
 * LLM Resolution Step
 *
 * Calls Bedrock Claude with the resolution context and returns structured decision.
 * Tracks cost per CLAUDE.md mandate.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  ResolutionContext,
  LLMResolutionOutput,
  LLMResolutionOutputSchema,
  ResolverConfig,
  CandidateEvidence,
  ReviewItemInput,
} from './types';

// Bedrock client (initialized lazily)
let bedrockClient: BedrockRuntimeClient | null = null;

function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({});
  }
  return bedrockClient;
}

export interface LLMResolveResult {
  output: LLMResolutionOutput;
  cost: {
    modelId: string;
    tokensIn: number;
    tokensOut: number;
    runtimeMs: number;
    estimatedCostUSD: number;
  };
}

/**
 * Call Bedrock Claude to resolve a review item against candidates.
 *
 * @param context - Resolution context (item + candidates with evidence)
 * @param config - Resolver configuration
 * @returns LLM decision with cost tracking
 */
export async function llmResolve(
  context: ResolutionContext,
  config: ResolverConfig
): Promise<LLMResolveResult> {
  const startTime = Date.now();
  const bedrock = getBedrockClient();

  // Build prompts
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(context);

  // Call Bedrock
  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: config.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })
  );

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const rawResponse = responseBody.content[0].text;

  // Calculate cost
  const runtimeMs = Date.now() - startTime;
  const tokensIn = responseBody.usage?.input_tokens ?? 0;
  const tokensOut = responseBody.usage?.output_tokens ?? 0;
  const estimatedCostUSD = calculateCost(tokensIn, tokensOut, config.modelId);

  // Parse response
  const output = parseResolutionOutput(rawResponse);

  return {
    output,
    cost: {
      modelId: config.modelId,
      tokensIn,
      tokensOut,
      runtimeMs,
      estimatedCostUSD,
    },
  };
}

/**
 * Build the system prompt for the resolver.
 * Based on the intent from intelligence-resolver-spec.md.
 */
export function buildSystemPrompt(): string {
  return `You resolve a live-music entity (artist or venue) against candidate records in bndy, a UK grassroots gig database.

Decide if the item IS one of the candidates (match), is genuinely new (create), is several acts (split), or can't be told (uncertain).

**Gig-geography footprint is the strongest signal:** a band that gigs a region is almost certainly the same as a same-name candidate whose footprint is that region; a same name in a *different* region is a different band.

An act qualifier (Band/Duo/Acoustic, or a known bespoke act name) means the SAME artist in a different configuration — match the underlying artist and return the act, never invent a new artist for it.

A social handle, when present on both sides, is strong.

Be conservative: prefer \`uncertain\` over a wrong \`match\`; never \`match\` two same-name records with disjoint footprints.

Output ONLY valid JSON with this exact structure:
{
  "decision": "match | create | split | uncertain",
  "entityId": "<bndy id if match>",
  "splitInto": ["<id-or-new>", "..."],
  "act": "<act name if an act-variant, e.g. 'Acoustic Duo'>",
  "confidence": 0-100,
  "reasoning": "<one or two sentences>",
  "evidenceUsed": ["footprint", "fbHandle", "..."]
}`;
}

/**
 * Build the user prompt with the review item and candidate evidence.
 */
export function buildUserPrompt(context: ResolutionContext): string {
  const { item, candidates } = context;

  let prompt = `## Review Item

**Type:** ${item.entityType}
**Name:** ${item.entityName}
**Source:** ${item.sourceId}
**Reason for review:** ${item.reason}

### Source Context
`;

  // Add source context
  if (item.sourceContext.venueName) {
    prompt += `- **Venue:** ${item.sourceContext.venueName}\n`;
  }
  if (item.sourceContext.venueRegion) {
    prompt += `- **Region:** ${item.sourceContext.venueRegion}\n`;
  }
  if (item.sourceContext.date) {
    prompt += `- **Date:** ${item.sourceContext.date}\n`;
  }
  if (item.sourceContext.coActs && item.sourceContext.coActs.length > 0) {
    prompt += `- **Co-Acts:** ${item.sourceContext.coActs.join(', ')}\n`;
  }
  if (item.sourceContext.sourceDefaultRegion) {
    prompt += `- **Source Default Region:** ${item.sourceContext.sourceDefaultRegion}\n`;
  }

  prompt += `\n## Candidates (${candidates.length})\n\n`;

  // Add each candidate with evidence
  for (const candidate of candidates) {
    prompt += formatCandidateEvidence(candidate);
  }

  return prompt;
}

/**
 * Format a single candidate's evidence for the prompt.
 */
function formatCandidateEvidence(candidate: CandidateEvidence): string {
  let text = `### ${candidate.name} (${candidate.id})\n`;
  text += `- **Similarity:** ${candidate.similarity}%\n`;

  if (candidate.location) {
    text += `- **Location:** ${candidate.location}\n`;
  }

  if (candidate.fbHandle) {
    text += `- **FB Handle:** ${candidate.fbHandle}\n`;
  }

  if (candidate.genres && candidate.genres.length > 0) {
    text += `- **Genres:** ${candidate.genres.join(', ')}\n`;
  }

  if (candidate.footprint) {
    const { regions, totalEvents } = candidate.footprint;
    text += `- **Footprint:** ${totalEvents} events\n`;

    // Sort regions by weight (descending)
    const sortedRegions = Object.entries(regions)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5); // Top 5 regions

    if (sortedRegions.length > 0) {
      text += `  - Regions: ${sortedRegions.map(([r, w]) => `${r} (${w.toFixed(1)})`).join(', ')}\n`;
    }
  }

  text += '\n';
  return text;
}

/**
 * Parse the LLM response into a structured output.
 */
function parseResolutionOutput(rawResponse: string): LLMResolutionOutput {
  // Try to extract JSON from response
  let jsonStr = rawResponse;

  // Handle markdown code blocks
  const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch?.[1]) {
    jsonStr = jsonMatch[1].trim();
  }

  // Try to find JSON object
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const output = LLMResolutionOutputSchema.parse(parsed);
    return output;
  } catch (error) {
    console.error('[INTELLIGENCE] Failed to parse LLM output:', error);
    console.error('[INTELLIGENCE] Raw response:', rawResponse);

    // Return uncertain as fallback
    return {
      decision: 'uncertain',
      confidence: 0,
      reasoning: `Failed to parse LLM response: ${error instanceof Error ? error.message : 'unknown error'}`,
      evidenceUsed: [],
    };
  }
}

/**
 * Calculate estimated cost for Bedrock Claude models.
 * Pricing (per 1M tokens):
 * - Haiku 4.5: $0.80 in, $4.00 out
 * - Sonnet: $3 in, $15 out
 */
function calculateCost(tokensIn: number, tokensOut: number, modelId: string): number {
  // Haiku 4.5 pricing (default - same as interpretation-runner)
  let inputCostPerMillion = 0.80;
  let outputCostPerMillion = 4.0;

  // Sonnet pricing
  if (modelId.includes('sonnet')) {
    inputCostPerMillion = 3.0;
    outputCostPerMillion = 15.0;
  }

  return (tokensIn / 1_000_000) * inputCostPerMillion + (tokensOut / 1_000_000) * outputCostPerMillion;
}
