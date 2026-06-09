/**
 * AI Phone Booth Configuration
 *
 * This file contains all customizable settings for the AI agent:
 * - Event details and persona
 * - System instructions and prompts
 * - Model configuration
 * - Menu items and options
 * - Task definitions
 */

// ═══════════════════════════════════════════════════════════════════════════
// EVENT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export const EVENT_CONFIG = {
  /** Event name displayed in logs and stats */
  name: "The AI Summit London 2026",

  /** Event identifier used in external integrations (e.g., mixologist) */
  eventId: "ai-summit-london",

  /** Event location */
  location: "London, United Kingdom",

  /** Event date range */
  dates: "June 2026",
};

// ═══════════════════════════════════════════════════════════════════════════
// AGENT PERSONA
// ═══════════════════════════════════════════════════════════════════════════

export const AGENT_CONFIG = {
  /** Agent name */
  name: "Olivia",

  /** Agent role/title */
  role: "AI Swagkeeper",

  /** Agent personality traits (for reference - incorporated in system prompt) */
  personality: "friendly, efficient, helpful, conversational",
};


// ═══════════════════════════════════════════════════════════════════════════
// WELCOME GREETING
// ═══════════════════════════════════════════════════════════════════════════

export const WELCOME_GREETING =
  `Welcome to ${EVENT_CONFIG.name}! I'm ${AGENT_CONFIG.name}. I can answer questions about Twilio products, help you with swag questions, or take a swag order. What would you like to know?`;

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM INSTRUCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build system instructions with current inventory
 * This function is called dynamically to get fresh inventory state
 */
export function buildSystemInstructions(availableItems: string[], tshirtSizes: string[]): string {
  return `You are ${AGENT_CONFIG.name}, the ${AGENT_CONFIG.role} at ${EVENT_CONFIG.name}. You are talking to customers over the phone.

CRITICAL — PHONE CALL RULES:
- Never use markdown, bullet points, headers, or lists. Plain spoken sentences only.
- Keep every response short — 1 to 2 sentences maximum. This is a phone call, not a chat.
- No filler phrases like "Great choice!" or "Absolutely!". Get to the point.

You can help customers with three things: answer Twilio product questions, answer swag questions, and take swag orders. Do not push them to do any of these. If someone seems unsure what to do, you can gently mention they can ask about Twilio products, ask about swag, or order a swag item.

TWILIO PRODUCT QUESTIONS: You have access to Twilio's knowledge base to answer questions about Twilio products, features, APIs, pricing, and use cases. Use the knowledge search tool to find accurate information. After answering a Twilio product question, call complete_twilio_question.

SWAG QUESTION: Answer any question the customer has about Twilio swag — what items are available, sizes, colors, how to get them. After answering, call complete_swag_question.

SWAG ORDER: If the customer wants to order swag, great. Available items: ${availableItems.join(', ')}. IMPORTANT: Only T-Shirts have size options (${tshirtSizes.join(', ')}) — all other items come in one standard size. Once confirmed, call submit_swag_order and read back the order number. CRITICAL: If they try to order another item after already placing an order (submit_swag_order was already called or returns an error), politely tell them they can only order one item per visit and they're welcome to come back later for another item. Never mention the one-item limit unless they actually ask for a second item. Never push the customer to order if they haven't brought it up.

Keep personal details the customer shares in mind — name, preferences — for a more personal experience.`;
}


// ═══════════════════════════════════════════════════════════════════════════
// MODEL CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export const MODEL_CONFIG = {
  /** OpenAI model used for responses */
  model: "gpt-5.4-nano",

  /** Temperature (0-2, lower = more focused/deterministic) */
  temperature: 0.7,

  /** Max tokens per response (keep low for voice calls) */
  maxTokens: 150,

};

// ═══════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

export const TOOLS = [
  {
    type: "function" as const,
    name: "complete_swag_question",
    description:
      "Marks the swag question task as complete after answering an customer's question about Twilio swag — available items, sizes, colors, how to get them. Call this after providing an answer to any swag-related question.",
    parameters: {
      type: "object" as           const,
      properties: { question: { type: "string" } },
      required: ["question"],
    },
  },
  {
    type: "function" as const,
    name: "submit_swag_order",
    description:
      "Submit a Twilio swag order for the customer. Returns an order number — you must communicate this to the customer. CRITICAL RULE: This function can only be called ONCE per call. If you've already called it, do NOT call it again. Tell the customer they can only order one item per visit. IMPORTANT: Only T-Shirts have size variations (2XL, XL, L, M). For all other items, leave size empty. If the call fails, apologize and inform the customer.",
    parameters: {
      type: "object" as const,
      properties: {
        originalMessage: { type: "string" },
        item: {
          type: "string",
          description: "The swag item name (e.g., 'T-Shirt', 'Pen', 'Red Notebook')",
        },
        size: {
          type: "string",
          description: "T-shirt size (2XL, XL, L, M). Leave empty for non-T-shirt items.",
        },
      },
      required: ["originalMessage", "item"],
    },
  },
  {
    type: "function" as const,
    name: "complete_twilio_question",
    description:
      "Marks the Twilio product question task as complete after answering a customer's question about Twilio products, APIs, features, pricing, or use cases. Call this after providing an answer to any Twilio-related question.",
    parameters: {
      type: "object" as const,
      properties: { question: { type: "string" } },
      required: ["question"],
    },
  },
  {
    type: "function" as const,
    name: "end_call",
    description: "Terminates the current phone call. Call this when the user asks to hang up or says goodbye.",
    parameters: { type: "object" as const, properties: {}, required: [] },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// TASK TRACKING
// ═══════════════════════════════════════════════════════════════════════════

/** Task identifiers for tracking completion */
export const TASKS = {
  SWAG_ORDER: "swag_order_placed",
  SWAG_QUESTION: "swag_question_asked",
  TWILIO_QUESTION: "twilio_question_asked",
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// UI CONFIGURATION (for frontend display)
// ═══════════════════════════════════════════════════════════════════════════

export const UI_CONFIG = {
  /** Brand/header display */
  brandName: "Twilio Swag Store",

  /** Agent display name and title */
  agentDisplayName: `${AGENT_CONFIG.name} — ${AGENT_CONFIG.role}`,

  /** Background image */
  backgroundImage: "/images/swag-store.png",

  /** Hero section */
  hero: {
    title: `Meet ${AGENT_CONFIG.name}`,
    subtitle: `Your ${AGENT_CONFIG.role} — powered by Twilio`,
    imageAlt: `${AGENT_CONFIG.name} — ${AGENT_CONFIG.role}`,
  },

  /** Task cards on landing page */
  cards: [
    {
      icon: "📱",
      title: "Ask about Twilio products",
      description: "Learn about Twilio APIs, features, pricing, and use cases.",
      taskKey: TASKS.TWILIO_QUESTION,
    },
    {
      icon: "🎁",
      title: "Ask about swag",
      description: "Notebooks, pens, socks, T-shirts? Olivia knows it all.",
      taskKey: TASKS.SWAG_QUESTION,
    },
    {
      icon: "🧢",
      title: "Order Twilio swag",
      description: "Choose one item: T-shirts, notebooks, pens, socks, and more.",
      taskKey: TASKS.SWAG_ORDER,
      optional: true,
    },
  ],

  /** Task labels for live call view */
  taskLabels: {
    [TASKS.TWILIO_QUESTION]: "Twilio product",
    [TASKS.SWAG_QUESTION]: "Swag question",
    [TASKS.SWAG_ORDER]: "Swag order",
  },

  /** Attract mode popup */
  attractMode: {
    title: "Pick up to talk<br/>to our AI",
    subtitle: `Chat with ${AGENT_CONFIG.name} — ask about Twilio products or order swag!`,
  },

  /** Stats dashboard */
  stats: {
    icon: "🎁",
    title: `Twilio Swag Store — ${AGENT_CONFIG.name}`,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// FEATURE FLAGS
// ═══════════════════════════════════════════════════════════════════════════

export const FEATURES = {
  /** Enable physical order fulfillment via mixologist backend */
  enableMixologist: process.env.ENABLE_MIXOLOGIST === "true",

  /** Enable attract mode idle popup */
  enableAttractMode: process.env.ATTRACT_MODE === "true",

  /** Enable Conversation Intelligence post-call analysis */
  enableConversationIntelligence: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get tool URLs for backend endpoints
 * @param baseUrl - Base URL for API endpoints
 */
export function getToolUrls(baseUrl: string): Record<string, string> {
  return {
    complete_swag_question: `${baseUrl}/swagQuestions`,
    submit_swag_order: `${baseUrl}/swagOrder`,
    complete_twilio_question: `${baseUrl}/twilioQuestion`,
  };
}
