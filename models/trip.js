/**
 * Trip Model - Backend (Node.js/Mongoose Example)
 *
 * This file demonstrates the required backend schema changes for the Trips collection.
 * Adapt to your backend framework (Express/Mongoose, NestJS/TypeORM, Django, etc.)
 */

// ===== Mongoose Schema (MongoDB) =====
/*
const mongoose = require('mongoose');

const tripSchema = new mongoose.Schema({
  // Existing fields
  vehicleType: { type: String, required: true },
  location: { type: String, required: true },
  date: { type: Date, required: true },           // Rental start date
  time: { type: String, required: true },
  notes: { type: String, default: '' },
  status: {
    type: String,
    enum: ['pending', 'bidding', 'assigned', 'in_progress', 'completed', 'cancelled'],
    default: 'pending'
  },
  contractorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },

  // ═══════════════════════════════════════════════════════════════
  // NEW FIELDS - Rental Duration Logic
  // ═══════════════════════════════════════════════════════════════
  rentalDays: { type: Number, required: true, min: 1 },   // Number of rental days (from frontend)
  rentalEndDate: { type: Date, required: true },          // Calculated: date + rentalDays

  // Pricing - Server-side calculated, NOT trusted from client
  totalPrice: { type: Number, default: 0 },               // Calculated on bid acceptance
  driverDailyRate: { type: Number },                      // Driver's rate per day (from driver profile)
}, { timestamps: true });

// Virtual for trip duration in days
tripSchema.virtual('durationDays').get(function() {
  return this.rentalDays;
});

// Index for queries
tripSchema.index({ contractorId: 1, status: 1 });
tripSchema.index({ driverId: 1, status: 1 });
tripSchema.index({ date: 1 });

module.exports = mongoose.model('Trip', tripSchema);
*/

// ===== Controller: POST /api/trips =====
/**
 * Creates a new trip with rental duration logic.
 *
 * Request Body:
 * {
 *   vehicleType: "Truck 3 Ton",
 *   location: "Riyadh, Saudi Arabia",
 *   date: "2026-07-15T00:00:00.000Z",  // ISO 8601 start date
 *   time: "08:00",
 *   notes: "Fragile cargo",
 *   rentalDays: 5,                      // NEW: Required integer >= 1
 *   rentalEndDate: "2026-07-20T00:00:00.000Z"  // NEW: ISO 8601 (optional, validated)
 * }
 *
 * Response: Created trip object with calculated rentalEndDate
 */

// Example Express controller
/*
const createTrip = async (req, res) => {
  try {
    const {
      vehicleType,
      location,
      date,
      time,
      notes,
      rentalDays,
      rentalEndDate  // Optional - client sends but server validates
    } = req.body;

    // 1. VALIDATE rentalDays
    if (!rentalDays || !Number.isInteger(rentalDays) || rentalDays < 1) {
      return res.status(400).json({
        message: 'rentalDays is required and must be a positive integer'
      });
    }

    // 2. PARSE & VALIDATE start date
    const startDate = new Date(date);
    if (isNaN(startDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    // 3. CALCULATE rentalEndDate on SERVER (authoritative)
    const calculatedEndDate = new Date(startDate);
    calculatedEndDate.setDate(calculatedEndDate.getDate() + rentalDays);

    // 4. VALIDATE client-provided rentalEndDate if present
    if (rentalEndDate) {
      const clientEndDate = new Date(rentalEndDate);
      // Allow small timezone differences (1 day tolerance)
      const diffDays = Math.abs((clientEndDate - calculatedEndDate) / (1000 * 60 * 60 * 24));
      if (diffDays > 1) {
        return res.status(400).json({
          message: 'rentalEndDate does not match rentalDays calculation'
        });
      }
    }

    // 5. CREATE trip with SERVER-CALCULATED end date
    const trip = await Trip.create({
      vehicleType,
      location,
      date: startDate,
      time,
      notes: notes || '',
      rentalDays,
      rentalEndDate: calculatedEndDate,  // Server authoritative
      contractorId: req.user._id,
      status: 'pending',
    });

    res.status(201).json(trip);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
*/

// ===== Pricing Logic: POST /api/bids / PUT /api/bids/:bidId/accept =====
/**
 * CRITICAL: Pricing is calculated on SERVER SIDE, never trusted from client.
 *
 * Formula: Total Trip Price = Driver's Daily Rate × rentalDays
 *
 * Flow:
 * 1. Driver submits bid with their daily rate (or uses profile rate)
 * 2. Contractor accepts bid
 * 3. Server calculates totalPrice = driverDailyRate * trip.rentalDays
 * 4. Server saves totalPrice on trip document
 */

// Example: Accept Bid Controller
/*
const acceptBid = async (req, res) => {
  try {
    const { bidId } = req.params;
    const bid = await Bid.findById(bidId).populate('tripId driverId');

    if (!bid) return res.status(404).json({ message: 'Bid not found' });
    if (bid.tripId.status !== 'bidding') {
      return res.status(400).json({ message: 'Trip not in bidding state' });
    }

    // Get driver's daily rate (from driver profile or bid)
    const driver = await User.findById(bid.driverId);
    const driverDailyRate = driver.dailyRate || bid.dailyRate;  // Fallback to bid rate

    if (!driverDailyRate || driverDailyRate <= 0) {
      return res.status(400).json({ message: 'Driver daily rate not configured' });
    }

    // ═══════════════════════════════════════════════════════════════
    // SERVER-SIDE PRICING CALCULATION (Authoritative)
    // ═══════════════════════════════════════════════════════════════
    const rentalDays = bid.tripId.rentalDays;
    const totalPrice = driverDailyRate * rentalDays;

    // Update trip with pricing and assignment
    bid.tripId.driverId = bid.driverId;
    bid.tripId.driverDailyRate = driverDailyRate;
    bid.tripId.totalPrice = totalPrice;
    bid.tripId.status = 'assigned';
    await bid.tripId.save();

    bid.status = 'accepted';
    await bid.save();

    // Reject other bids
    await Bid.updateMany(
      { tripId: bid.tripId._id, _id: { $ne: bidId } },
      { status: 'rejected' }
    );

    res.json({ trip: bid.tripId, totalPrice, driverDailyRate, rentalDays });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
*/

// ===== TypeScript Interface (for NestJS/TypeScript backends) =====
/*
export interface TripDocument {
  _id: string;
  vehicleType: string;
  location: string;
  date: Date;              // Rental start date
  time: string;
  notes: string;
  status: 'pending' | 'bidding' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  contractorId: string;
  driverId?: string;
  vehicleId?: string;

  // NEW FIELDS
  rentalDays: number;      // Required, >= 1
  rentalEndDate: Date;     // Calculated: date + rentalDays days

  // Pricing (server-side only)
  totalPrice?: number;     // = driverDailyRate * rentalDays
  driverDailyRate?: number;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTripDto {
  vehicleType: string;
  location: string;
  date: string;            // ISO 8601
  time: string;
  notes?: string;
  rentalDays: number;      // Required, >= 1
  rentalEndDate?: string;  // Optional, ISO 8601 (validated against rentalDays)
}

export interface BidAcceptanceResponse {
  trip: TripDocument;
  totalPrice: number;
  driverDailyRate: number;
  rentalDays: number;
}
*/

// ===== Database Migration (SQL Example - PostgreSQL) =====
/*
-- Add rental fields to trips table
ALTER TABLE trips
ADD COLUMN rental_days INTEGER NOT NULL DEFAULT 1 CHECK (rental_days >= 1),
ADD COLUMN rental_end_date TIMESTAMP WITH TIME ZONE NOT NULL;

-- Add pricing fields
ALTER TABLE trips
ADD COLUMN total_price DECIMAL(10,2) DEFAULT 0,
ADD COLUMN driver_daily_rate DECIMAL(10,2);

-- Index for rental queries
CREATE INDEX idx_trips_rental_dates ON trips(date, rental_end_date);
*/

// ===== Validation Rules Summary =====
/*
FIELD           | REQUIRED | SOURCE      | VALIDATION
----------------|----------|-------------|---------------------------
vehicleType     | YES      | Client      | Non-empty string
location        | YES      | Client      | Non-empty string
date            | YES      | Client      | Valid ISO 8601, >= today
time            | YES      | Client      | HH:mm format
notes           | NO       | Client      | String, max 500 chars
rentalDays      | YES      | Client      | Integer >= 1
rentalEndDate   | NO*      | Client      | If provided, must = date + rentalDays
----------------|----------|-------------|---------------------------
totalPrice      | NO       | SERVER      | = driverDailyRate * rentalDays
driverDailyRate | NO       | SERVER      | From driver profile
rentalEndDate   | YES      | SERVER      | Authoritative: date + rentalDays
*/

// ===== Frontend Payload Example =====
/*
POST /api/trips
Content-Type: application/json
Authorization: Bearer <token>

{
  "vehicleType": "شاحنة 3 طن",
  "location": "الرياض، السعودية",
  "date": "2026-07-15T00:00:00.000Z",
  "time": "08:00",
  "notes": "بضاعة قابلة للكسر",
  "rentalDays": 5,
  "rentalEndDate": "2026-07-20T00:00:00.000Z"
}

Response (201 Created):
{
  "_id": "trip_abc123",
  "vehicleType": "شاحنة 3 طن",
  "location": "الرياض، السعودية",
  "date": "2026-07-15T00:00:00.000Z",
  "time": "08:00",
  "notes": "بضاعة قابلة للكسر",
  "rentalDays": 5,
  "rentalEndDate": "2026-07-20T00:00:00.000Z",
  "status": "pending",
  "contractorId": "user_xyz",
  "createdAt": "2026-07-03T10:30:00.000Z",
  "updatedAt": "2026-07-03T10:30:00.000Z"
}
*/

// ===== Security Notes =====
/*
1. NEVER trust rentalEndDate from client - ALWAYS calculate on server
2. NEVER trust totalPrice from client - ALWAYS calculate on bid acceptance
3. Validate rentalDays >= 1 and is integer
4. Validate start date is not in the past
5. Use database constraints (CHECK rental_days >= 1)
6. Rate-limit trip creation to prevent spam
7. Ensure contractorId comes from authenticated user, not request body
*/