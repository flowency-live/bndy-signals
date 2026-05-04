import { Handler } from 'aws-lambda';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  PutCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { customAlphabet } from 'nanoid';

const alphanumeric = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const nanoid = customAlphabet(alphanumeric, 8);
import { z } from 'zod';
import {
  DeterministicExtraction,
  Interpretation,
  SourceCost,
  Claim,
  ClaimType,
  Strength,
  EventCandidate,
  ClaimReference,
  Ambiguity,
  AmbiguityType,
} from '../shared/entities';
import { findMatchingEntities, EntityCandidate } from '../entity-resolver';

const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE = process.env.SIGNALS_TABLE!;
const MODEL_ID = process.env.BEDROCK_MODEL_ID!;
const PROMPT_VERSION = 'interpret-v2';

interface InterpreterInput {
  signalId: string;
  extraction: DeterministicExtraction;
}

// Simplified event candidate data for pack-builder and clarification-generator
interface EventCandidateForPack {
  candidateId: string;
  proposedName: string;
  proposedDate?: string;
  proposedVenueName?: string;
  proposedArtistNames: string[];
  sourceClaimIds: string[];  // Claims linked to this candidate
  ambiguities: Array<{
    ambiguityType: string;
    description: string;
    affectedClaimIds: string[];
  }>;
}

interface InterpreterOutput {
  signalId: string;
  interpretationId: string;
  claims: Claim[];
  invalidClaimCount: number;
  eventCandidateIds: string[];
  // Event candidates with data needed by pack-builder
  eventCandidates: EventCandidateForPack[];
}

interface ParseResult {
  success: boolean;
  output?: LLMOutput;
  error?: string;
  rawResponse: string;
}

// Schema for Claude's structured output
const LLMClaimSchema = z.object({
  type: z.enum([
    'event_exists',
    'artist_performs',
    'venue_hosts',
    'event_date',
    'event_time',
    'ticket_source',
    'artist_exists',
    'venue_exists',
  ]),
  subject: z.string(),
  predicate: z.string(),
  object: z.string().optional(),
  value: z.string().optional(),
  strength: z.enum(['weak', 'moderate', 'strong']),
  reasoning: z.string(),
});

// AI-native: LLM proposes event candidates directly, not just atomic claims
const LLMEventCandidateSchema = z.object({
  proposedName: z.string(),
  proposedDate: z.string().nullable().optional(),
  proposedTime: z.string().nullable().optional(),
  proposedVenueName: z.string().nullable().optional(),
  proposedArtistNames: z.array(z.string()),
  reasoning: z.string(),
  ambiguities: z.array(z.string()),
  sourceClaimRefs: z.array(z.string()), // References to claim types used
});

// AI-native: LLM identifies clarification questions
const LLMClarificationQuestionSchema = z.object({
  questionType: z.enum([
    'entity_match',
    'date_confirm',
    'venue_location',
    'artist_identity',
    'event_time',
  ]),
  question: z.string(),
  options: z.array(z.string()).optional(),
  relatedClaimTypes: z.array(z.string()),
});

const LLMOutputSchema = z.object({
  summary: z.string(),
  claims: z.array(LLMClaimSchema),
  eventCandidates: z.array(LLMEventCandidateSchema).optional(),
  clarificationQuestions: z.array(LLMClarificationQuestionSchema).optional(),
  uncertainties: z.array(z.string()),
});

type LLMOutput = z.infer<typeof LLMOutputSchema>;
type LLMEventCandidate = z.infer<typeof LLMEventCandidateSchema>;
type LLMClarificationQuestion = z.infer<typeof LLMClarificationQuestionSchema>;

export const handler: Handler<InterpreterInput, InterpreterOutput> = async (
  event
) => {
  const { signalId, extraction } = event;
  const startTime = Date.now();

  // Update status
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `SIGNAL#${signalId}`, SK: '#METADATA' },
      UpdateExpression: 'SET #status = :status, GSI1PK = :gsi1pk',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'interpreting',
        ':gsi1pk': 'STATUS#interpreting',
      },
    })
  );

  // Build prompt with current date context
  const currentDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const prompt = buildInterpretationPrompt(extraction, currentDate);

  // Call Bedrock
  const bedrockResponse = await bedrock.send(
    new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  );

  const responseBody = JSON.parse(
    new TextDecoder().decode(bedrockResponse.body)
  );
  const rawResponse = responseBody.content[0].text;

  // Calculate costs
  const runtimeMs = Date.now() - startTime;
  const tokensIn = responseBody.usage?.input_tokens ?? 0;
  const tokensOut = responseBody.usage?.output_tokens ?? 0;
  const modelCost = calculateCost(tokensIn, tokensOut);

  const sourceCost: SourceCost = {
    modelCost,
    tokensIn,
    tokensOut,
    runtimeMs,
  };

  // Parse structured output
  const parseResult = parseStructuredOutput(rawResponse);
  const interpretationId = `intp_${nanoid()}`;
  const now = new Date().toISOString();

  // Handle parse failure - don't silently succeed with empty claims
  if (!parseResult.success || !parseResult.output) {
    const failedInterpretation = {
      interpretationId,
      signalId,
      version: 1,
      deterministicExtraction: extraction,
      llmInterpretation: {
        modelUsed: MODEL_ID,
        modelProvider: 'bedrock',
        promptVersion: PROMPT_VERSION,
        reasoning: `Parse failed: ${parseResult.error}`,
        rawResponse,
      },
      sourceCost,
      claims: [],
      uncertainties: ['LLM response could not be parsed as structured JSON'],
      status: 'parse_failed' as const,
      parseError: parseResult.error,
      createdAt: now,
    };

    // Store failed interpretation for review
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `INTP#${interpretationId}`,
          SK: '#METADATA',
          GSI1PK: 'STATUS#parse_failed',
          GSI1SK: `INTP#${interpretationId}`,
          ...failedInterpretation,
        },
      })
    );

    // Update signal status to failed (schema-compliant)
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `SIGNAL#${signalId}`, SK: '#METADATA' },
        UpdateExpression:
          'SET #status = :status, GSI1PK = :gsi1pk, currentInterpretationId = :intpId, failedStep = :step, failedAt = :failedAt, failureReason = :reason',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'failed',
          ':gsi1pk': 'STATUS#failed',
          ':intpId': interpretationId,
          ':step': 'interpretation',
          ':failedAt': now,
          ':reason': `Parse failed: ${parseResult.error}`,
        },
      })
    );

    // Throw error to trigger Step Functions failure handling
    // Note: failure handler will update status again (to same value), which is fine
    throw new Error(`Interpretation parse failed: ${parseResult.error}`);
  }

  const llmOutput = parseResult.output;

  // Separate valid and invalid claims (track invalid, don't silently drop)
  const validClaims: Claim[] = [];
  const invalidClaims: Array<{ claim: z.infer<typeof LLMClaimSchema>; reason: string }> = [];

  for (const llmClaim of llmOutput.claims) {
    if (!llmClaim.object && !llmClaim.value) {
      invalidClaims.push({ claim: llmClaim, reason: 'Missing object and value' });
    } else {
      validClaims.push({
        claimId: `clm_${nanoid()}`,
        claimType: llmClaim.type as ClaimType,
        subject: llmClaim.subject,
        predicate: llmClaim.predicate,
        object: llmClaim.object,
        value: llmClaim.value,
        strength: llmClaim.strength as Strength,
        strengthReasoning: llmClaim.reasoning,
        interpretationId,
        signalId,
        status: 'proposed' as const,
        createdAt: now,
      });
    }
  }

  // Log invalid claims for debugging
  if (invalidClaims.length > 0) {
    console.warn(`Filtered ${invalidClaims.length} invalid claims:`, JSON.stringify(invalidClaims));
  }

  // Process AI-proposed event candidates with entity resolution
  const eventCandidateIds: string[] = [];
  const eventCandidates: EventCandidate[] = [];

  if (llmOutput.eventCandidates && llmOutput.eventCandidates.length > 0) {
    for (const llmCandidate of llmOutput.eventCandidates) {
      const candidateId = `cand_${nanoid()}`;
      eventCandidateIds.push(candidateId);

      // Map LLM ambiguities to Ambiguity schema
      const ambiguities: Ambiguity[] = llmCandidate.ambiguities.map((desc) => ({
        ambiguityType: inferAmbiguityType(desc),
        description: desc,
        affectedClaimIds: [],
      }));

      // Build source claim references
      const sourceClaims: ClaimReference[] = validClaims
        .filter(c => llmCandidate.sourceClaimRefs.includes(c.claimType))
        .map(c => ({
          claimId: c.claimId,
          claimType: c.claimType,
          value: c.value || c.object || c.subject,
          status: 'proposed' as const,
        }));

      // Entity resolution for venue
      let proposedVenueId: string | undefined;
      if (llmCandidate.proposedVenueName) {
        const venueMatches = await findMatchingEntities('venue', llmCandidate.proposedVenueName, ddb);
        const firstVenueMatch = venueMatches[0];
        if (venueMatches.length === 1 && firstVenueMatch) {
          proposedVenueId = firstVenueMatch.entity.entityId;
        } else if (venueMatches.length > 1) {
          // Multiple matches - add ambiguity for chat resolution
          const locations = venueMatches.map(m => {
            const venue = m.entity as { address?: { city?: string } };
            return venue.address?.city || 'unknown location';
          }).join(', ');
          ambiguities.push({
            ambiguityType: 'entity_match',
            description: `Multiple venues match "${llmCandidate.proposedVenueName}": ${locations}`,
            affectedClaimIds: [],
          });
        }
      }

      // Entity resolution for artists
      const proposedArtistIds: string[] = [];
      for (const artistName of llmCandidate.proposedArtistNames) {
        const artistMatches = await findMatchingEntities('artist', artistName, ddb);
        const firstArtistMatch = artistMatches[0];
        if (artistMatches.length === 1 && firstArtistMatch) {
          proposedArtistIds.push(firstArtistMatch.entity.entityId);
        } else if (artistMatches.length > 1) {
          ambiguities.push({
            ambiguityType: 'entity_match',
            description: `Multiple artists match "${artistName}"`,
            affectedClaimIds: [],
          });
        }
        // If no match, artist will be created when candidate is ratified
      }

      const eventCandidate: EventCandidate = {
        candidateId,
        candidateType: 'event',
        signalId,
        interpretationId,
        proposedName: llmCandidate.proposedName,
        proposedDate: llmCandidate.proposedDate,
        proposedTime: llmCandidate.proposedTime,
        proposedVenueId,
        proposedArtistIds,
        reasoning: llmCandidate.reasoning, // LLM explains why this is an event
        sourceClaims,
        completeness: calculateCandidateCompleteness(llmCandidate),
        missingFields: getMissingFields(llmCandidate),
        ambiguities,
        verificationStatus: 'unverified',
        status: 'proposed',
        createdAt: now,
        updatedAt: now,
      };

      eventCandidates.push(eventCandidate);
    }
  }

  const interpretation: Interpretation = {
    interpretationId,
    signalId,
    version: 1,
    deterministicExtraction: extraction,
    llmInterpretation: {
      modelUsed: MODEL_ID,
      modelProvider: 'bedrock',
      promptVersion: PROMPT_VERSION,
      reasoning: llmOutput.summary,
      rawResponse,
    },
    sourceCost,
    claims: validClaims,
    uncertainties: [
      ...llmOutput.uncertainties,
      ...(invalidClaims.length > 0 ? [`${invalidClaims.length} claim(s) filtered due to missing object/value`] : []),
    ],
    invalidClaimCount: invalidClaims.length,
    eventCandidateIds: eventCandidateIds.length > 0 ? eventCandidateIds : undefined,
    status: 'pending_review',
    createdAt: now,
  };

  // Use validClaims for storage
  const claims = validClaims;

  // Store interpretation
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `INTP#${interpretationId}`,
        SK: '#METADATA',
        GSI1PK: 'STATUS#pending_review',
        GSI1SK: `INTP#${interpretationId}`,
        ...interpretation,
      },
    })
  );

  // Store claims individually for querying
  if (claims.length > 0) {
    const claimItems = claims.map((claim) => ({
      PutRequest: {
        Item: {
          PK: `CLAIM#${claim.claimId}`,
          SK: '#METADATA',
          GSI1PK: `STATUS#${claim.status}`,
          GSI1SK: `CLAIM#${claim.claimId}`,
          GSI2PK: `SIGNAL#${signalId}`,
          GSI2SK: `CLAIM#${claim.claimId}`,
          ...claim,
        },
      },
    }));

    // BatchWrite in chunks of 25
    for (let i = 0; i < claimItems.length; i += 25) {
      const batch = claimItems.slice(i, i + 25);
      await ddb.send(
        new BatchWriteCommand({
          RequestItems: { [TABLE]: batch },
        })
      );
    }
  }

  // Store event candidates (AI-proposed)
  if (eventCandidates.length > 0) {
    const candidateItems = eventCandidates.map((candidate) => ({
      PutRequest: {
        Item: {
          PK: `CANDIDATE#${candidate.candidateId}`,
          SK: '#METADATA',
          GSI1PK: `STATUS#${candidate.status}`,
          GSI1SK: `CANDIDATE#${candidate.candidateId}`,
          GSI2PK: `SIGNAL#${signalId}`,
          GSI2SK: `CANDIDATE#${candidate.candidateId}`,
          ...candidate,
        },
      },
    }));

    // BatchWrite in chunks of 25
    for (let i = 0; i < candidateItems.length; i += 25) {
      const batch = candidateItems.slice(i, i + 25);
      await ddb.send(
        new BatchWriteCommand({
          RequestItems: { [TABLE]: batch },
        })
      );
    }

    console.log(`Stored ${eventCandidates.length} AI-proposed event candidates`);
  }

  // Link interpretation to signal
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `SIGNAL#${signalId}`,
        SK: `INTP#${interpretationId}`,
        interpretationId,
        version: 1,
        claimCount: claims.length,
        eventCandidateCount: eventCandidates.length,
        createdAt: now,
      },
    })
  );

  // Update signal status
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `SIGNAL#${signalId}`, SK: '#METADATA' },
      UpdateExpression:
        'SET #status = :status, GSI1PK = :gsi1pk, currentInterpretationId = :intpId, interpretationCount = interpretationCount + :one',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'pending_review',
        ':gsi1pk': 'STATUS#pending_review',
        ':intpId': interpretationId,
        ':one': 1,
      },
    })
  );

  // Build event candidates data for pack-builder and clarification-generator
  // Use eventCandidates array which has sourceClaims with claimIds and ambiguities
  const eventCandidatesForPack: EventCandidateForPack[] = eventCandidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    proposedName: candidate.proposedName,
    proposedDate: candidate.proposedDate,
    proposedVenueName: llmOutput.eventCandidates?.find(
      (lc) => lc.proposedName === candidate.proposedName
    )?.proposedVenueName,
    proposedArtistNames: llmOutput.eventCandidates?.find(
      (lc) => lc.proposedName === candidate.proposedName
    )?.proposedArtistNames || [],
    sourceClaimIds: candidate.sourceClaims.map((sc) => sc.claimId),
    ambiguities: candidate.ambiguities,
  }));

  return {
    signalId,
    interpretationId,
    claims,
    invalidClaimCount: invalidClaims.length,
    eventCandidateIds,
    eventCandidates: eventCandidatesForPack,
  };
};

// Helper to infer ambiguity type from description
function inferAmbiguityType(description: string): AmbiguityType {
  const lower = description.toLowerCase();
  if (lower.includes('venue') || lower.includes('location') || lower.includes('which')) {
    return 'entity_match';
  }
  if (lower.includes('year') || lower.includes('date') || lower.includes('inferred')) {
    return 'date_uncertain';
  }
  if (lower.includes('conflict') || lower.includes('disagree')) {
    return 'conflicting';
  }
  return 'incomplete';
}

// Calculate completeness from LLM candidate
function calculateCandidateCompleteness(candidate: LLMEventCandidate): 'complete' | 'partial' {
  const hasName = Boolean(candidate.proposedName);
  const hasDate = Boolean(candidate.proposedDate);
  const hasVenue = Boolean(candidate.proposedVenueName);
  const hasArtists = candidate.proposedArtistNames.length > 0;

  return hasName && hasDate && hasVenue && hasArtists ? 'complete' : 'partial';
}

// Get missing fields from LLM candidate
function getMissingFields(candidate: LLMEventCandidate): string[] {
  const missing: string[] = [];
  if (!candidate.proposedName) missing.push('name');
  if (!candidate.proposedDate) missing.push('date');
  if (!candidate.proposedVenueName) missing.push('venue');
  if (candidate.proposedArtistNames.length === 0) missing.push('artists');
  return missing;
}

// Helper to compute the next May 15 from a given date for dynamic example
function inferNextMay15(currentDate: string): string {
  const date = new Date(currentDate);
  // Roll over to next year if: after May, or in May and past the 15th
  const year =
    date.getMonth() > 4 || (date.getMonth() === 4 && date.getDate() > 15)
      ? date.getFullYear() + 1
      : date.getFullYear();
  return `${year}-05-15`;
}

function buildInterpretationPrompt(extraction: DeterministicExtraction, currentDate: string): string {
  const exampleDate = inferNextMay15(currentDate);
  const exampleYear = exampleDate.slice(0, 4);

  return `You are analyzing evidence about live music events.

<context>
Current date: ${currentDate}

CRITICAL - Date inference rules (YOU MUST ALWAYS INFER DATES):
- "next saturday", "this saturday", "saturday" → Calculate the actual date from ${currentDate}
- "next friday", "this friday", etc. → Same - always convert to YYYY-MM-DD format
- "15th May", "May 15" without year → Use the next occurrence from ${currentDate}
- Mark inferred dates as strength "weak" and note in uncertainties
- You MUST provide proposedDate in YYYY-MM-DD format whenever ANY date reference exists
- "next saturday" from ${currentDate} = calculate it (e.g., if today is Sunday, next Saturday is 6 days away)

Time handling:
- If no time given, leave proposedTime empty (do NOT guess)
- Times on posters are always event START time (not "doors")
- These are grassroots venues - no "doors time" concept
</context>

This content was extracted from a signal (user-submitted evidence):

<content>
${extraction.rawText ?? 'No text content available'}
</content>

Analyze this evidence and generate structured claims about the live music world.

You MUST respond with valid JSON in this exact format:
{
  "summary": "Brief explanation of what this evidence tells us",
  "claims": [
    {
      "type": "event_exists|artist_performs|venue_hosts|event_date|event_time|ticket_source|artist_exists|venue_exists",
      "subject": "The entity making or receiving the claim",
      "predicate": "The relationship or action",
      "object": "The target entity or value",
      "value": "Optional specific value (date, time, URL)",
      "strength": "weak|moderate|strong",
      "reasoning": "Why you believe this claim at this strength"
    }
  ],
  "eventCandidates": [
    {
      "proposedName": "Full event name",
      "proposedDate": "YYYY-MM-DD if known",
      "proposedTime": "HH:MM if known",
      "proposedVenueName": "Venue name as stated in evidence",
      "proposedArtistNames": ["Artist names as stated"],
      "reasoning": "Why you propose this event based on the evidence",
      "ambiguities": ["Any uncertainties about this event"],
      "sourceClaimRefs": ["event_exists", "event_date", etc]
    }
  ],
  "clarificationQuestions": [
    {
      "questionType": "entity_match|date_confirm|venue_location|artist_identity|event_time",
      "question": "Human-readable question to resolve ambiguity",
      "options": ["Option 1", "Option 2"],
      "relatedClaimTypes": ["venue_hosts"]
    }
  ],
  "uncertainties": ["Things you are not sure about"]
}

IMPORTANT RULES:
1. If this evidence describes an event, you MUST include an eventCandidates entry
2. If NO TIME is provided, you MUST add an event_time clarificationQuestion asking "What time does this event start?"
3. If venue could match multiple locations, add a venue_location clarificationQuestion
4. Always include clarificationQuestions for missing critical info (time is critical for events)

Claim types (predicate is REQUIRED for all types):
- event_exists: An event is happening (subject=event name, predicate=exists, object=description)
- artist_performs: An artist is performing (subject=artist, predicate=performs_at, object=event/venue)
- venue_hosts: A venue is hosting (subject=venue, predicate=hosts, object=event)
- event_date: Event has a date (subject=event, predicate=on_date, value=YYYY-MM-DD)
- event_time: Event has a time (subject=event, predicate=at_time, value=HH:MM)
- ticket_source: Tickets available (subject=event, predicate=tickets_at, object=source name, value=URL)
- artist_exists: Artist mentioned (subject=artist name, predicate=is_artist, object=genre/type if known)
- venue_exists: Venue mentioned (subject=venue name, predicate=is_venue, object=location if known)

Strength levels:
- strong: Multiple clear indicators or authoritative source
- moderate: Single clear indicator
- weak: Implied or uncertain, needs corroboration

Example for "STINGRAY LIVE AT THE RIGGER THURSDAY 15TH MAY 8PM" (given current date ${currentDate}):
{
  "summary": "Announcement for Stingray performing at The Rigger on May 15th",
  "claims": [
    {
      "type": "event_exists",
      "subject": "Stingray Live",
      "predicate": "exists",
      "object": "Live music event",
      "strength": "moderate",
      "reasoning": "Single announcement, appears to be event promotion"
    },
    {
      "type": "artist_performs",
      "subject": "Stingray",
      "predicate": "performs_at",
      "object": "The Rigger",
      "strength": "moderate",
      "reasoning": "Artist name clearly stated in event title"
    },
    {
      "type": "venue_hosts",
      "subject": "The Rigger",
      "predicate": "hosts",
      "object": "Stingray Live",
      "strength": "moderate",
      "reasoning": "Venue name clearly stated, but no address to confirm identity"
    },
    {
      "type": "event_date",
      "subject": "Stingray Live",
      "predicate": "on_date",
      "object": "${exampleDate}",
      "value": "${exampleDate}",
      "strength": "weak",
      "reasoning": "Date given as 'Thursday 15th May' - year inferred as next occurrence from current date"
    },
    {
      "type": "event_time",
      "subject": "Stingray Live",
      "predicate": "at_time",
      "object": "20:00",
      "value": "20:00",
      "strength": "moderate",
      "reasoning": "Time clearly stated as 8PM"
    },
    {
      "type": "artist_exists",
      "subject": "Stingray",
      "predicate": "is_artist",
      "object": "Live music performer",
      "strength": "moderate",
      "reasoning": "Artist name clearly stated in event announcement"
    },
    {
      "type": "venue_exists",
      "subject": "The Rigger",
      "predicate": "is_venue",
      "object": "Live music venue",
      "strength": "moderate",
      "reasoning": "Venue name stated but location not specified"
    }
  ],
  "eventCandidates": [
    {
      "proposedName": "Stingray Live at The Rigger",
      "proposedDate": "${exampleDate}",
      "proposedTime": "20:00",
      "proposedVenueName": "The Rigger",
      "proposedArtistNames": ["Stingray"],
      "reasoning": "The poster announces a live music event with artist, venue, date and time clearly stated",
      "ambiguities": ["Venue location not specified - multiple venues may share this name", "Year inferred from current date"],
      "sourceClaimRefs": ["event_exists", "artist_performs", "venue_hosts", "event_date", "event_time"]
    }
  ],
  "clarificationQuestions": [
    {
      "questionType": "venue_location",
      "question": "Which 'The Rigger' is this event at?",
      "options": [],
      "relatedClaimTypes": ["venue_hosts"]
    }
  ],
  "uncertainties": [
    "Year not specified - inferred as ${exampleYear} from current date ${currentDate}",
    "Venue location unknown - cannot confirm which 'The Rigger' this is"
  ]
}

Now analyze the content above and respond with JSON only.`;
}

function parseStructuredOutput(rawResponse: string): ParseResult {
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
    const output = LLMOutputSchema.parse(parsed);
    return { success: true, output, rawResponse };
  } catch (error) {
    console.error('Failed to parse LLM output:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown parse error',
      rawResponse,
    };
  }
}

function calculateCost(tokensIn: number, tokensOut: number): number {
  // Pricing from env (defaults to Haiku 4.5: $0.80/M in, $4/M out)
  const inputCostPer1k = parseFloat(process.env.MODEL_INPUT_COST_PER_1K || '0.0008');
  const outputCostPer1k = parseFloat(process.env.MODEL_OUTPUT_COST_PER_1K || '0.004');
  return (tokensIn / 1000) * inputCostPer1k + (tokensOut / 1000) * outputCostPer1k;
}
