/**
 * Bid Model - Backend (Node.js/Mongoose Example)
 * Demonstrates server-side pricing enforcement
 */

// ===== Mongoose Schema =====
/*
const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema({
  tripId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Driver's proposed daily rate (NOT total price)
  dailyRate: { type: Number, required: true, min: 0 },

  // Calculated by server on acceptance
  totalPrice: { type: Number, default: 0 },

  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'withdrawn'],
    default: 'pending'
  },

  // Optional: driver's note
  note: { type: String, default: '' },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

bidSchema.index({ tripId: 1, driverId: 1 }, { unique: true });
bidSchema.index({ tripId: 1, status: 1 });

module.exports = mongoose.model('Bid', bidSchema);
*/

// ===== Controller: POST /api/bids =====
/**
 * Driver submits a bid with their DAILY RATE (not total price).
 *
 * Request Body:
 * {
 *   "tripId": "trip_abc123",
 *   "dailyRate": 500  // SAR per day
 * }
 *
 * Server validates:
 * - Trip exists and is in 'bidding' status
 * - Driver hasn't already bid
 * - dailyRate > 0
 */
const createBid = async (req, res) => {
  try {
    const { tripId, dailyRate } = req.body;
    const driverId = req.user._id;

    // Validate trip
    const trip = await Trip.findById(tripId);
    if (!trip) return res.status(404).json({ message: 'Trip not found' });
    if (trip.status !== 'bidding') {
      return res.status(400).json({ message: 'Trip is not accepting bids' });
    }

    // Check existing bid
    const existing = await Bid.findOne({ tripId, driverId });
    if (existing) return res.status(400).json({ message: 'Already bid on this trip' });

    // Validate dailyRate
    if (!dailyRate || dailyRate <= 0) {
      return res.status(400).json({ message: 'Daily rate must be positive' });
    }

    const bid = await Bid.create({ tripId, driverId, dailyRate });
    res.status(201).json(bid);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===== Controller: PUT /api/bids/:bidId/accept =====
/**
 * Contractor accepts a bid. SERVER calculates total price.
 *
 * Formula: totalPrice = bid.dailyRate * trip.rentalDays
 *
 * This is the CRITICAL security point - client NEVER sends totalPrice.
 */
const acceptBid = async (req, res) => {
  try {
    const { bidId } = req.params;
    const contractorId = req.user._id;

    const bid = await Bid.findById(bidId).populate('tripId');
    if (!bid) return res.status(404).json({ message: 'Bid not found' });

    const trip = bid.tripId;

    // Authorization: only trip owner can accept
    if (trip.contractorId.toString() !== contractorId.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (trip.status !== 'bidding') {
      return res.status(400).json({ message: 'Trip not in bidding state' });
    }

    // ═══════════════════════════════════════════════════════════════
    // SERVER-SIDE PRICING CALCULATION - AUTHORITATIVE
    // ═══════════════════════════════════════════════════════════════
    const totalPrice = bid.dailyRate * trip.rentalDays;

    // Update trip with assignment and pricing
    trip.driverId = bid.driverId;
    trip.driverDailyRate = bid.dailyRate;
    trip.totalPrice = totalPrice;
    trip.status = 'assigned';
    await trip.save();

    bid.status = 'accepted';
    bid.totalPrice = totalPrice;
    await bid.save();

    // Reject other bids
    await Bid.updateMany(
      { tripId: trip._id, _id: { $ne: bidId } },
      { status: 'rejected' }
    );

    res.json({
      trip,
      pricing: {
        dailyRate: bid.dailyRate,
        rentalDays: trip.rentalDays,
        totalPrice: totalPrice
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===== Frontend Integration Notes =====
/*
FLUTTER FRONTEND (bids_service.dart):

// Submit bid - sends DAILY RATE only
static Future<Map<String, dynamic>> submitBid({
  required String tripId,
  required double dailyRate,  // NOT total amount!
}) async {
  return await ApiClient.submitBid(tripId: tripId, dailyRate: dailyRate);
}

// Accept bid - response includes server-calculated totalPrice
static Future<Map<String, dynamic>> acceptBid(String bidId) async {
  return await ApiClient.acceptBid(bidId);
  // Response: { trip: {...}, pricing: { dailyRate, rentalDays, totalPrice } }
}

BACKEND API CLIENT (api_client.dart):

static Future<Map<String, dynamic>> submitBid({
  required String tripId,
  required double dailyRate,
}) async {
  final response = await _dio.post('/bids', data: {
    'tripId': tripId,
    'dailyRate': dailyRate,  // Key: dailyRate NOT amount
  });
  return response.data;
}

static Future<Map<String, dynamic>> acceptBid(String bidId) async {
  final response = await _dio.put('/bids/$bidId/accept');
  return response.data;
}
*/

// ===== API Contract Summary =====
/*
ENDPOINT                 | METHOD | REQUEST BODY           | RESPONSE PRICING
-------------------------|--------|------------------------|------------------------
/api/trips               | POST   | { rentalDays: 5 }      | { rentalDays: 5, rentalEndDate: "..." }
/api/bids                | POST   | { tripId, dailyRate }  | { dailyRate, status: "pending" }
/api/bids/:id/accept     | PUT    | {}                     | { pricing: { dailyRate, rentalDays, totalPrice } }
*/

// ===== Database Constraints =====
/*
-- Trips table
ALTER TABLE trips ADD CONSTRAINT chk_rental_days CHECK (rental_days >= 1);

-- Bids table
ALTER TABLE bids ADD CONSTRAINT chk_daily_rate CHECK (daily_rate > 0);
ALTER TABLE bids ADD CONSTRAINT chk_total_price CHECK (total_price >= 0);
*/