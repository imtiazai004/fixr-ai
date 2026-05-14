/**
 * AGENT 5: Follow-up Agent
 * Powered by: Google Antigravity (Simulated)
 *
 * Responsibility: Manage all post-booking automated workflows.
 * - Triggered after simulated provider arrival
 * - Sends satisfaction survey
 * - Handles rating collection
 * - Triggers payment release simulation
 * - Updates provider reputation score
 */

const FOLLOWUP_TEMPLATES = {
  ARRIVAL: (providerName) =>
    `📍 ${providerName} has arrived at your location! Please let them in. Your booking is now active.`,

  SATISFACTION: (providerName, service) =>
    `✅ Service completed! How was your experience with ${providerName} for ${service}?\n\n` +
    `Rate your experience:\n⭐ 1 - Poor  |  ⭐⭐⭐ 3 - OK  |  ⭐⭐⭐⭐⭐ 5 - Excellent`,

  PAYMENT_RELEASED: (providerName, amount) =>
    `💚 Payment of PKR ${amount} has been released to ${providerName}. Thank you for using KhidmatAI!`,

  LOW_RATING_RESPONSE: () =>
    `😔 We're sorry about your experience. A KhidmatAI support agent will follow up with you within 2 hours. Your concern has been escalated.`,

  HIGH_RATING_RESPONSE: (providerName) =>
    `🎉 Thank you for the great rating! ${providerName} has been notified and their profile score has been updated. See you next time!`,
};

function generateFollowupPlan(booking) {
  const steps = [
    {
      trigger:    'T + ETA',
      event:      'ARRIVAL_NOTIFICATION',
      delayMs:    booking.etaMinutes * 1000, // simulated: seconds = minutes
      message:    FOLLOWUP_TEMPLATES.ARRIVAL(booking.provider.name),
      action:     'NOTIFY_USER',
    },
    {
      trigger:    'T + ETA + 30s',
      event:      'SATISFACTION_SURVEY',
      delayMs:    (booking.etaMinutes + 30) * 1000,
      message:    FOLLOWUP_TEMPLATES.SATISFACTION(booking.provider.name, booking.service),
      action:     'COLLECT_RATING',
    },
    {
      trigger:    'After rating received',
      event:      'PAYMENT_RELEASE',
      delayMs:    null, // triggered by rating submission
      message:    FOLLOWUP_TEMPLATES.PAYMENT_RELEASED(booking.provider.name, booking.cost.total),
      action:     'RELEASE_PAYMENT',
    },
  ];
  return steps;
}

/**
 * Main export — called by Orchestrator
 * @param {object} bookingResult - output from Booking Agent
 * @returns {object} FollowupResult with trace
 */
function run(bookingResult) {
  const startTime = Date.now();
  const { booking } = bookingResult.output;

  if (!booking) {
    return {
      agent: 'Follow-up Agent',
      status: 'SKIPPED',
      processingMs: Date.now() - startTime,
      output: { followupPlan: [], templates: {} },
      reasoning: ['⚠️  No booking to follow up on. Agent idle.'],
    };
  }

  const followupPlan = generateFollowupPlan(booking);

  const reasoning = [
    `🔔 Follow-up Agent activated for booking ${booking.bookingId}`,
    `👷 Provider: ${booking.provider.name}`,
    `📋 Automated workflow steps planned: ${followupPlan.length}`,
    ``,
    ...followupPlan.map((step, i) =>
      `   Step ${i + 1}: [${step.event}] — Trigger: ${step.trigger}\n` +
      `             Action: ${step.action}`
    ),
    ``,
    `💳 Payment held in escrow: PKR ${booking.cost.total} — released on positive completion`,
    `📊 Provider reputation update queued after rating collection`,
    `✅ Follow-up workflow scheduled and active`,
  ];

  return {
    agent: 'Follow-up Agent',
    status: 'SUCCESS',
    processingMs: Date.now() - startTime,
    output: {
      followupPlan,
      templates: FOLLOWUP_TEMPLATES,
      escrowAmount: booking.cost.total,
    },
    reasoning,
  };
}

// Expose templates for use by frontend
module.exports = { run, FOLLOWUP_TEMPLATES };
