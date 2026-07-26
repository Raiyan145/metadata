/**
 * ============================================================================
 * /api/analyze — Secure Gemini-powered image metadata endpoint
 * ============================================================================
 *
 * Receives ONE base64-encoded image at a time (the frontend loops through
 * a batch and calls this endpoint once per image — see script.js), sends it
 * to Gemini with a structured-output schema, and returns clean, normalized
 * stock-marketplace metadata as JSON.
 *
 * SECURITY: The Gemini API key lives only in process.env.GEMINI_API_KEY on
 * the server. It is never sent to, or readable by, the browser. This file
 * also intentionally does NOT send permissive CORS headers — the API and
 * the frontend are served from the same Vercel project/origin, so no
 * cross-origin access is needed, and leaving CORS closed stops other sites
 * from quietly spending your Gemini quota.
 *
 * This is a plain Vercel Node.js function (no framework). Vercel parses
 * JSON request bodies into `req.body` automatically — no extra setup
 * required. Function duration is configured in vercel.json.
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

// NOTE ON MODEL CHOICE:
// "gemini-2.5-flash" is used here because it was explicitly requested for
// this project. As of mid-2026 Google has marked it as deprecated with a
// scheduled shutdown date of October 16, 2026, in favor of "gemini-3.5-flash".
// The model name is isolated in this single constant — to upgrade, change
// this one line (the request/response shape is unchanged between versions).
const GEMINI_MODEL = 'gemini-2.5-flash-lite';

// Legacy "generateContent" endpoint — Google explicitly recommends staying on
// this endpoint (rather than the newer Interactions API) for stateless,
// single-turn production workloads like this one.
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_RETRIES = 2; // retries on top of the first attempt
const RETRY_BASE_DELAY_MS = 900;
const REQUEST_TIMEOUT_MS = 28000; // stay under vercel.json's 30s maxDuration

// ----------------------------------------------------------------------------
// Handler
// ----------------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[analyze] Missing GEMINI_API_KEY environment variable.');
    return res.status(500).json({
      success: false,
      error: 'Server is not configured yet. Add GEMINI_API_KEY in your Vercel project settings.',
    });
  }

  const body = req.body || {};
  const { image, mimeType, fileName } = body;

  if (!image || typeof image !== 'string') {
    return res.status(400).json({ success: false, error: 'No image data was received.' });
  }

  if (!mimeType || !SUPPORTED_MIME_TYPES.includes(mimeType)) {
    return res.status(400).json({
      success: false,
      error: 'Unsupported image type. Please upload JPG, PNG, or WEBP files.',
    });
  }

  // Rough safety check on payload size (base64 is ~33% larger than binary).
  // The client resizes images before sending, so this should rarely trigger —
  // it exists as a guardrail against misuse of the endpoint directly.
  const approxBytes = (image.length * 3) / 4;
  if (approxBytes > 15 * 1024 * 1024) {
    return res.status(413).json({
      success: false,
      error: 'Image is too large. Please use an image under 15MB.',
    });
  }

  try {
    const metadata = await analyzeImageWithGemini({ base64Image: image, mimeType, apiKey });
    return res.status(200).json({ success: true, fileName: fileName || null, data: metadata });
  } catch (error) {
    console.error('[analyze] Gemini analysis failed:', error);
    const status = error.statusCode || 502;
    return res.status(status).json({
      success: false,
      error: error.message || 'Failed to analyze this image. Please try again.',
    });
  }
}

// ----------------------------------------------------------------------------
// Gemini request
// ----------------------------------------------------------------------------

async function analyzeImageWithGemini({ base64Image, mimeType, apiKey }) {
  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: buildPrompt() },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Image,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.55,
      topP: 0.92,
      topK: 40,
      responseMimeType: 'application/json',
      responseSchema: buildResponseSchema(),
    },
  };

  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const rawText = await callGemini(requestBody, apiKey);
      const parsed = JSON.parse(rawText);
      return normalizeMetadata(parsed);
    } catch (error) {
      lastError = error;
      const canRetry = attempt < MAX_RETRIES && error.retryable;
      if (!canRetry) break;
      await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError || new Error('Unknown error while analyzing the image.');
}

async function callGemini(requestBody, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (networkError) {
    const err = new Error('Could not reach the Gemini API. Please try again.');
    err.retryable = true;
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorPayload = await safeReadJson(response);
    const message = errorPayload?.error?.message || `Gemini API error (status ${response.status}).`;
    const err = new Error(message);
    // Retry on rate limits and server-side errors; fail fast on bad requests/auth.
    err.retryable = response.status === 429 || response.status >= 500;
    err.statusCode = response.status === 429 ? 429 : 502;
    throw err;
  }

  const payload = await response.json();
  const text = extractText(payload);

  if (!text) {
    const blockReason = payload?.promptFeedback?.blockReason;
    const err = new Error(
      blockReason
        ? `Gemini declined to analyze this image (${blockReason}).`
        : 'Gemini returned an empty response.'
    );
    err.retryable = !blockReason;
    throw err;
  }

  return text;
}

function extractText(payload) {
  const candidate = payload?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  return parts
    .map((part) => part.text || '')
    .join('')
    .trim();
}

async function safeReadJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ----------------------------------------------------------------------------
// Prompt
// ----------------------------------------------------------------------------

function buildPrompt() {
  return `You are an elite metadata strategist for stock photography and vector marketplaces (Adobe Stock, Shutterstock, iStock, Freepik, Dreamstime, Alamy). You have reviewed hundreds of thousands of accepted submissions and know exactly what makes an asset discoverable, licensable, and unlikely to be rejected.

Study the attached image closely, then produce complete, submission-ready metadata as a single JSON object matching the provided response schema exactly.

Field-by-field guidance:
- title: 60-70 characters. Literal and descriptive — state what is actually shown (subject, setting, action). No camera jargon, no keyword stuffing, no ALL CAPS.
- shortDescription: one clean sentence, under 20 words, usable as an alt-text style caption.
- longDescription: 2-3 natural sentences (35-60 words) a buyer would read to judge fit. Cover subject, setting/context, and mood or likely use case.
- keywords: EXACTLY 50 keywords, ordered most-to-least relevant. Mix specific nouns (what/who is shown), broader concepts (themes, industries, emotions), and real buyer-search terms (e.g. "copy space", "banner background") ONLY when genuinely true of the image. Lowercase, no hashtags, no duplicate word stems, no keyword stuffing.
- category / subcategory: a sensible general taxonomy (e.g. Business, Nature, Food & Drink, People, Technology, Travel, Health, Abstract, Architecture, Animals).
- adobeStockCategory: the single closest match from Adobe Stock's real categories (Animals, Buildings and Architecture, Business, Drinks, The Environment, States of Mind, Food, Graphic Resources, Hobbies and Leisure, Industry, Landscapes, Lifestyle, People, Plants and Flowers, Culture and Religion, Science, Social Issues, Sports, Technology, Transport, Travel).
- shutterstockCategory: the single closest match from Shutterstock's real top-level categories (Abstract, Animals/Wildlife, Arts, Backgrounds/Textures, Beauty/Fashion, Buildings/Landmarks, Business/Finance, Education, Food and Drink, Healthcare/Medical, Holidays, Industrial, Interiors, Nature, Objects, Parks/Outdoor, People, Religion, Science, Signs/Symbols, Sports/Recreation, Technology, Transportation, Vintage).
- freepikCategory: the single closest match from Freepik's real categories (Business, Technology, Nature, Food, Travel, Fashion, Health, Sports, Education, Art, Animals, People, Holidays, Abstract, Industry).
- imageStyle: pick what genuinely applies (e.g. Photography, Illustration, 3D Render, Vector, Flat Lay, Candid, Studio, Documentary, Macro, Aerial, Minimalist).
- subject: the primary subject in a few words.
- mood: the emotional tone (e.g. calm, energetic, professional, playful, dramatic, cozy).
- colors: 3-6 dominant colors as plain color names (e.g. "warm amber", "deep teal", "off-white").
- composition: one brief phrase on framing (e.g. "rule-of-thirds, shallow depth of field, subject left-aligned").
- lighting: one brief phrase (e.g. "soft natural window light", "golden hour backlight", "even studio softbox").
- orientation: exactly one of "Horizontal", "Vertical", or "Square", based on the image's actual aspect ratio.
- copySpace: state where usable negative space exists for text overlay (e.g. "Yes - upper right third"), or "Minimal", or "None" if the frame is fully busy.
- commercialUseSuggestions: 1-2 sentences on realistic commercial applications (e.g. website hero banners, ad campaigns, packaging, blog headers) specific to what is actually in the image.
- editorialOrCommercial: exactly one of "Commercial", "Editorial", or "Both". Choose "Editorial" if there are recognizable brands/logos, trademarked characters, or identifiable people/private property that would need a release you cannot confirm. Otherwise "Commercial". Use "Both" only when genuinely ambiguous.
- aiConfidenceScore: 0-100 honest confidence in this analysis given image clarity. Vary this realistically — an ambiguous abstract shot should score lower than an unambiguous, sharply composed product photo.
- bestMarketplace: the single marketplace (Adobe Stock, Shutterstock, iStock, Freepik, Dreamstime, or Alamy) most likely to perform best for this specific image.
- seoScore: 0-100 honest self-assessment of how well the title/description/keywords you produced are optimized for search discoverability.
- keywordQualityScore: 0-100 honest self-assessment of the specificity, relevance, and diversity of the 50 keywords (not simply whether there are 50).
- metadataQualityScore: 0-100 honest overall assessment of how complete and marketplace-ready this metadata set is.

Score fields must vary realistically with the actual image - do not default every score to 90+. A blurry, generic, or ambiguous image should score lower than a sharp, clearly composed, clearly licensable one.

Respond with ONLY the JSON object described by the schema. No commentary, no markdown formatting, no text before or after it.`;
}

function buildResponseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING' },
      shortDescription: { type: 'STRING' },
      longDescription: { type: 'STRING' },
      keywords: { type: 'ARRAY', items: { type: 'STRING' } },
      category: { type: 'STRING' },
      subcategory: { type: 'STRING' },
      adobeStockCategory: { type: 'STRING' },
      shutterstockCategory: { type: 'STRING' },
      freepikCategory: { type: 'STRING' },
      imageStyle: { type: 'STRING' },
      subject: { type: 'STRING' },
      mood: { type: 'STRING' },
      colors: { type: 'ARRAY', items: { type: 'STRING' } },
      composition: { type: 'STRING' },
      lighting: { type: 'STRING' },
      orientation: { type: 'STRING', enum: ['Horizontal', 'Vertical', 'Square'] },
      copySpace: { type: 'STRING' },
      commercialUseSuggestions: { type: 'STRING' },
      editorialOrCommercial: { type: 'STRING', enum: ['Commercial', 'Editorial', 'Both'] },
      aiConfidenceScore: { type: 'NUMBER' },
      bestMarketplace: { type: 'STRING' },
      seoScore: { type: 'NUMBER' },
      keywordQualityScore: { type: 'NUMBER' },
      metadataQualityScore: { type: 'NUMBER' },
    },
    propertyOrdering: [
      'title', 'shortDescription', 'longDescription', 'keywords', 'category', 'subcategory',
      'adobeStockCategory', 'shutterstockCategory', 'freepikCategory', 'imageStyle', 'subject',
      'mood', 'colors', 'composition', 'lighting', 'orientation', 'copySpace',
      'commercialUseSuggestions', 'editorialOrCommercial', 'aiConfidenceScore', 'bestMarketplace',
      'seoScore', 'keywordQualityScore', 'metadataQualityScore',
    ],
    required: [
      'title', 'shortDescription', 'longDescription', 'keywords', 'category', 'subcategory',
      'adobeStockCategory', 'shutterstockCategory', 'freepikCategory', 'imageStyle', 'subject',
      'mood', 'colors', 'composition', 'lighting', 'orientation', 'copySpace',
      'commercialUseSuggestions', 'editorialOrCommercial', 'aiConfidenceScore', 'bestMarketplace',
      'seoScore', 'keywordQualityScore', 'metadataQualityScore',
    ],
  };
}

// ----------------------------------------------------------------------------
// Response normalization
// ----------------------------------------------------------------------------

function normalizeMetadata(raw) {
  const clampScore = (value) => {
    const num = Number(value);
    if (Number.isNaN(num)) return 0;
    return Math.max(0, Math.min(100, Math.round(num)));
  };

  const cleanString = (value, fallback = '') =>
    typeof value === 'string' && value.trim() ? value.trim() : fallback;

  const cleanKeywords = Array.isArray(raw.keywords)
    ? dedupe(raw.keywords.map((k) => cleanString(k).toLowerCase()).filter(Boolean)).slice(0, 50)
    : [];

  const cleanColors = Array.isArray(raw.colors)
    ? dedupe(raw.colors.map((c) => cleanString(c)).filter(Boolean)).slice(0, 8)
    : [];

  const orientation = ['Horizontal', 'Vertical', 'Square'].includes(raw.orientation)
    ? raw.orientation
    : 'Horizontal';

  const editorialOrCommercial = ['Commercial', 'Editorial', 'Both'].includes(raw.editorialOrCommercial)
    ? raw.editorialOrCommercial
    : 'Commercial';

  return {
    title: cleanString(raw.title, 'Untitled Image'),
    shortDescription: cleanString(raw.shortDescription),
    longDescription: cleanString(raw.longDescription),
    keywords: cleanKeywords,
    category: cleanString(raw.category, 'Uncategorized'),
    subcategory: cleanString(raw.subcategory),
    adobeStockCategory: cleanString(raw.adobeStockCategory),
    shutterstockCategory: cleanString(raw.shutterstockCategory),
    freepikCategory: cleanString(raw.freepikCategory),
    imageStyle: cleanString(raw.imageStyle),
    subject: cleanString(raw.subject),
    mood: cleanString(raw.mood),
    colors: cleanColors,
    composition: cleanString(raw.composition),
    lighting: cleanString(raw.lighting),
    orientation,
    copySpace: cleanString(raw.copySpace, 'None'),
    commercialUseSuggestions: cleanString(raw.commercialUseSuggestions),
    editorialOrCommercial,
    aiConfidenceScore: clampScore(raw.aiConfidenceScore),
    bestMarketplace: cleanString(raw.bestMarketplace),
    seoScore: clampScore(raw.seoScore),
    keywordQualityScore: clampScore(raw.keywordQualityScore),
    metadataQualityScore: clampScore(raw.metadataQualityScore),
  };
}

function dedupe(list) {
  return Array.from(new Set(list));
}
