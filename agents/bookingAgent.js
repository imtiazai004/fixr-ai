/**
 * AGENT 4: Booking Agent
 * Powered by: Google Antigravity (Simulated)
 *
 * Responsibility: Simulate the complete booking lifecycle.
 * - Generates a unique Booking ID
 * - Calculates ETA based on distance and urgency
 * - Builds a cost breakdown
 * - Updates system state (PENDING → CONFIRMED → EN_ROUTE)
 * - Returns a booking receipt object
 */

const VISIT_FEE_BASE = {
  'AC Technician':  800,
  'Electrician':    500,
  'Plumber':        400,
  'Carpenter':      600,
  'Painter':        700,
  'Car Mechanic':   600,
  'Bike Mechanic':  350,
  'Tyre Repair':    200,
  'Medical Store':  0,
  'Grocery':        0,
  'Laundry':        300,
  'Cook / Chef':    800,
  'Maid / Cleaner': 400,
};

function generateBookingId() {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `BK-${ts}-${rand}`;
}

function calculateETA(distanceKm, urgency) {
  // Base: 5 min + 4 min per km
  let base = Math.round(5 + distanceKm * 4);
  if (urgency === 'HIGH')   base = Math.round(base * 0.6); // 40% faster dispatch
  if (urgency === 'LOW')    base = Math.round(base * 1.2);
  return Math.max(base, 10); // minimum 10 min
}

function buildCostBreakdown(provider, service) {
  const visitFee    = VISIT_FEE_BASE[service] || 500;
  const serviceFee  = Math.round(visitFee * 0.1); // 10% platform fee
  const total       = visitFee + serviceFee;
  return { visitFee, platformFee: serviceFee, total, currency: 'PKR' };
}

function getScheduledTime(timePreference) {
  const now = new Date();
  const options = { hour: '2-digit', minute: '2-digit', hour12: true };

  if (timePreference === 'NOW' || timePreference === 'TODAY') {
    return 'Today, ' + now.toLocaleTimeString('en-US', options);
  }
  if (timePreference === 'MORNING') {
    const morning = new Date(now);
    morning.setHours(9, 0, 0, 0);
    return 'Tomorrow Morning, ' + morning.toLocaleTimeString('en-US', options);
  }
  if (timePreference === 'TOMORROW') {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return 'Tomorrow, ' + tomorrow.toLocaleTimeString('en-US', options);
  }
  return 'Today, As Soon As Possible';
}

/**
 * Main export — called by Orchestrator
 * @param {object} rankingResult - output from Ranking Agent
 * @param {object} intent        - output from Intent Agent
 * @returns {object} BookingResult with trace
 */
function run(rankingResult, intent) {
  const startTime  = Date.now();
  const { topPick } = rankingResult.output;

  if (!topPick) {
    return {
      agent: 'Booking Agent',
      status: 'FAILED',
      processingMs: Date.now() - startTime,
      output: { booking: null },
      reasoning: ['❌ No provider available. Cannot create booking.'],
    };
  }

  const bookingId   = generateBookingId();
  const eta         = calculateETA(topPick.distance || 5, intent.urgency);
  const cost        = buildCostBreakdown(topPick, intent.service);
  const scheduled   = getScheduledTime(intent.timePreference);

  const booking = {
    bookingId,
    status:        'CONFIRMED',
    provider:      topPick,
    service:       intent.service,
    location:      intent.location,
    scheduledFor:  scheduled,
    etaMinutes:    eta,
    cost,
    createdAt:     new Date().toISOString(),
    timeline: [
      { status: 'REQUESTED',  time: 'Just now',        icon: '📝' },
      { status: 'MATCHED',    time: '2 seconds ago',   icon: '🤝' },
      { status: 'CONFIRMED',  time: 'Just now',        icon: '✅' },
      { status: 'EN_ROUTE',   time: `In ~${eta} min`,  icon: '🚗' },
      { status: 'ARRIVED',    time: 'Estimated',       icon: '📍' },
      { status: 'COMPLETED',  time: 'After service',   icon: '🎉' },
    ],
  };

  const reasoning = [
    `📋 Booking ID generated: ${bookingId}`,
    `👷 Provider confirmed: ${topPick.name} (${topPick.phone})`,
    `📍 Service location: ${intent.location}`,
    `🕐 Scheduled: ${scheduled}`,
    `🚗 ETA: ${eta} minutes${intent.urgency === 'HIGH' ? ' (EMERGENCY fast-track applied)' : ''}`,
    `💰 Cost breakdown:`,
    `   Visit Fee:     PKR ${cost.visitFee}`,
    `   Platform Fee:  PKR ${cost.platformFee} (10%)`,
    `   ─────────────────────`,
    `   Total:         PKR ${cost.total}`,
    `✅ Booking status: CONFIRMED → dispatching provider`,
  ];

  return {
    agent: 'Booking Agent',
    status: 'SUCCESS',
    processingMs: Date.now() - startTime,
    output: { booking },
    reasoning,
  };
}

module.exports = { run };
