/**
 * Defines the weighting system for analyzing user messages.
 * A higher weight indicates a stronger signal for frustration, complexity, or urgency.
 */
export const keywordWeights = {
    // Words indicating user frustration
    frustration: {
        "not working": 3,
        "frustrated": 5,
        "useless": 5,
        "hate": 4,
        "stupid": 4,
        "doesn't work": 3,
        "can't": 2,
        "error": 2,
        "issue": 2,
        "problem": 2,
        "broken": 3,
    },
    // Words indicating a complex problem
    complexity: {
        "multiple": 2,
        "complex": 4,
        "complicated": 4,
        "several steps": 3,
        "architecture": 3,
        "integration": 3,
    },
    // Explicit requests to create a ticket or talk to a human
    explicit_triggers: {
        "create ticket": 10,
        "open ticket": 10,
        "new ticket": 10,
        "talk to an agent": 10,
        "human": 10,
        "i need more help": 10,
    },
};

export const TICKET_THRESHOLD = 8;