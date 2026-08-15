const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
    console.error('❌ FATAL: JWT_SECRET is missing or too weak in .env. Set a long random secret before starting the server.');
    process.exit(1);
}

// --- Database Connection ---
const connectDB = async () => {
    try {
        const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/tawfiq_tech_db';
        await mongoose.connect(mongoUri);
        console.log('✅ MongoDB Connected successfully...');
    } catch (err) {
        console.warn('MongoDB Connection Warning:', err.message);
        console.error('\n' +
            '╔══════════════════════════════════════════════════════════════╗\n' +
            '║  ⚠️  WARNING: Running in MEMORY FALLBACK mode (NOT MongoDB)   ║\n' +
            '║  All data will be LOST on server restart.                     ║\n' +
            '║  DO NOT use this mode in production.                          ║\n' +
            '║  Fix MONGO_URI in backend/.env to a real MongoDB Atlas URI.   ║\n' +
            '╚══════════════════════════════════════════════════════════════╝\n');
    }
};
connectDB();

// --- Memory Fallback Storage (when MongoDB is connecting/offline) ---
const memoryStore = {
    users: [],
    trips: [],
    vehicles: [],
    bids: [],
    transactions: [],
    documents: []
};

// --- Schemas & Models ---
const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    phone: { type: String, required: true },
    role: { type: String, required: true, enum: ['contractor', 'driver'] },
    status: { type: String, enum: ['online', 'offline', 'busy'], default: 'offline' },
    walletBalance: { type: Number, default: 0 },
    vehicleType: { type: String, default: '' },
    fcmToken: { type: String, default: '' },
    ratingSum: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const TripSchema = new mongoose.Schema({
    contractorId: { type: String, required: true },
    driverId: { type: String, default: null },
    driverName: { type: String, default: '' },
    vehicleType: { type: String, required: true },
    location: { type: String, required: true },
    latitude: { type: Number, default: 33.3152 },
    longitude: { type: Number, default: 44.3661 },
    driverLat: { type: Number, default: 33.3152 },
    driverLng: { type: Number, default: 44.3661 },
    date: { type: String, default: '' },
    time: { type: String, default: '' },
    rentalDays: { type: Number, default: 1 },
    notes: { type: String, default: '' },
    amount: { type: Number, default: 150 },
    status: { 
        type: String, 
        enum: ['waiting', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled'], 
        default: 'waiting' 
    },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'cash'], default: 'cash' },
    paymentMethod: { type: String, default: 'cash' },
    createdAt: { type: Date, default: Date.now }
});
const Trip = mongoose.model('Trip', TripSchema);

const VehicleSchema = new mongoose.Schema({
    ownerId: { type: String, required: true },
    type: { type: String, required: true },
    capacity: { type: Number, default: 0 },
    availableCount: { type: Number, default: 1 },
    dailyPrice: { type: Number, default: 0 },
    location: { type: String, required: true },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    notes: { type: String, default: '' },
    images: [{ type: String }],
    status: { type: String, enum: ['available', 'rented', 'inactive'], default: 'available' },
    createdAt: { type: Date, default: Date.now }
});
const Vehicle = mongoose.model('Vehicle', VehicleSchema);

const TransactionSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    amount: { type: Number, required: true },
    paymentMethod: { type: String, required: true },
    transactionId: { type: String, required: true },
    type: { type: String, enum: ['deposit', 'payment', 'withdrawal'], default: 'deposit' },
    status: { type: String, enum: ['success', 'pending', 'failed'], default: 'success' },
    createdAt: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', TransactionSchema);

const BidSchema = new mongoose.Schema({
    tripId: { type: String, required: true },
    driverId: { type: String, required: true },
    driverName: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
const Bid = mongoose.model('Bid', BidSchema);

const DocumentSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    documentType: { type: String, required: true },
    filePath: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
const DocumentModel = mongoose.model('Document', DocumentSchema);

const RatingSchema = new mongoose.Schema({
    tripId: { type: String, required: true },
    fromUserId: { type: String, required: true },
    targetId: { type: String, required: true },
    targetType: { type: String, default: 'driver' },
    stars: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});
const Rating = mongoose.model('Rating', RatingSchema);

// --- JWT Auth Middleware ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'Authentication required. Please log in again.' });
    }
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(401).json({ message: 'Session expired. Please log in again.' });
        }
        req.user = user;
        next();
    });
};

// --- Multer Configuration ---
const uploadsDir = 'uploads';
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const allowedFileTypes = /jpeg|jpg|png|webp|pdf|heic/;
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024, files: 10 }, // 10MB لكل ملف، وحد أقصى 10 ملفات
    fileFilter: (req, file, cb) => {
        const extOk = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());
        const mimeOk = /image\/|application\/pdf/.test(file.mimetype);
        if (extOk && mimeOk) {
            cb(null, true);
        } else {
            cb(new Error('نوع الملف غير مسموح به. يُسمح فقط بالصور وملفات PDF.'));
        }
    }
});

// --- Auth Routes ---
const authRouter = express.Router();

authRouter.post('/register', async (req, res) => {
    let { name, email, password, phone, role } = req.body;
    if (!email) email = `${phone}@ilogistics.com`;
    if (!name || !password || !phone || !role) {
        return res.status(400).json({ message: 'Name, password, phone, and role are required.' });
    }
    try {
        let user = await User.findOne({ $or: [{ email }, { phone }] });
        if (user) return res.status(400).json({ message: 'Email or phone already registered.' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        user = new User({ name, email, password: hashedPassword, phone, role });
        await user.save();

        const token = jwt.sign({ id: user.id || user._id, email: user.email, role: user.role }, JWT_SECRET);
        res.status(201).json({
            message: 'User registered successfully!',
            token,
            user: { id: user.id || user._id, _id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone }
        });
    } catch (err) {
        // Memory Fallback
        const existingMem = memoryStore.users.find(u => u.email === email || u.phone === phone);
        if (existingMem) return res.status(400).json({ message: 'Email or phone already registered.' });
        const userId = 'usr_' + Date.now();
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = { id: userId, _id: userId, name, email, password: hashedPassword, phone, role, walletBalance: 0 };
        memoryStore.users.push(newUser);
        const token = jwt.sign({ id: userId, email, role }, JWT_SECRET);
        res.status(201).json({
            message: 'User registered successfully!',
            token,
            user: { id: userId, _id: userId, name, email, role, phone }
        });
    }
});

authRouter.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }
    try {
        const user = await User.findOne({ $or: [{ email: email }, { phone: email }] });
        if (!user) {
            const memUser = memoryStore.users.find(u => u.email === email || u.phone === email);
            if (!memUser) return res.status(400).json({ message: 'Invalid credentials.' });
            const isMatch = await bcrypt.compare(password, memUser.password);
            if (!isMatch) return res.status(400).json({ message: 'Invalid credentials.' });
            const token = jwt.sign({ id: memUser.id, email: memUser.email, role: memUser.role }, JWT_SECRET);
            return res.status(200).json({
                message: 'Login successful!',
                token,
                user: { id: memUser.id, _id: memUser.id, name: memUser.name, email: memUser.email, role: memUser.role, phone: memUser.phone }
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials.' });

        const token = jwt.sign({ id: user.id || user._id, email: user.email, role: user.role }, JWT_SECRET);
        res.status(200).json({
            message: 'Login successful!',
            token,
            user: { id: user.id || user._id, _id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone }
        });
    } catch (err) {
        const memUser = memoryStore.users.find(u => u.email === email || u.phone === email);
        if (memUser) {
            const isMatch = bcrypt.compareSync(password, memUser.password);
            if (!isMatch) return res.status(400).json({ message: 'Invalid credentials.' });
            const token = jwt.sign({ id: memUser.id, email: memUser.email, role: memUser.role }, JWT_SECRET);
            return res.status(200).json({
                message: 'Login successful!',
                token,
                user: { id: memUser.id, _id: memUser.id, name: memUser.name, email: memUser.email, role: memUser.role, phone: memUser.phone }
            });
        }
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

authRouter.get('/profile', authenticateToken, async (req, res) => {
    const memFallback = () => {
        const memUser = memoryStore.users.find(u => u.id === req.user.id);
        if (memUser) {
            return {
                id: memUser.id, _id: memUser.id, name: memUser.name, email: memUser.email,
                role: memUser.role, phone: memUser.phone, walletBalance: memUser.walletBalance || 0,
                rating: null, totalTrips: 0
            };
        }
        return { id: req.user.id, _id: req.user.id, name: 'سائق/مقاول', email: 'user@example.com', role: req.user.role || 'contractor', phone: '07800000000', walletBalance: 0, rating: null, totalTrips: 0 };
    };
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.json(memFallback());
        }
        const totalTrips = await Trip.countDocuments({ driverId: req.user.id, status: 'completed' });
        const userObj = user.toObject();
        userObj.rating = user.ratingCount > 0 ? Math.round((user.ratingSum / user.ratingCount) * 10) / 10 : null;
        userObj.totalTrips = totalTrips;
        res.json(userObj);
    } catch (err) {
        res.json(memFallback());
    }
});

authRouter.put('/profile', authenticateToken, async (req, res) => {
    const { name, phone } = req.body;
    try {
        const updated = await User.findByIdAndUpdate(req.user.id, { name, phone });
        if (!updated) throw new Error('not in db');
        res.json({ message: 'Profile updated successfully' });
    } catch (err) {
        const memUser = memoryStore.users.find(u => u.id === req.user.id);
        if (memUser) {
            if (name) memUser.name = name;
            if (phone) memUser.phone = phone;
        }
        res.json({ message: 'Profile updated successfully' });
    }
});

app.use('/auth', authRouter);

// --- User Status & FCM Routes ---
app.put('/users/:id/status', authenticateToken, async (req, res) => {
    const { status } = req.body;
    if (req.params.id !== req.user.id) {
        return res.status(403).json({ message: 'You can only update your own status.' });
    }
    try {
        await User.findByIdAndUpdate(req.params.id, { status });
        res.json({ message: 'User status updated successfully', status });
    } catch (err) {
        const memUser = memoryStore.users.find(u => u.id === req.params.id);
        if (memUser) memUser.status = status;
        res.json({ message: 'User status updated successfully', status });
    }
});

app.put('/users/status', authenticateToken, async (req, res) => {
    const { status } = req.body;
    try {
        await User.findByIdAndUpdate(req.user.id, { status });
        res.json({ message: 'User status updated successfully', status });
    } catch (err) {
        res.json({ message: 'User status updated successfully', status });
    }
});

app.put('/users/fcm-token', authenticateToken, async (req, res) => {
    const { fcmToken } = req.body;
    try {
        await User.findByIdAndUpdate(req.user.id, { fcmToken });
        res.json({ message: 'FCM token updated successfully' });
    } catch (err) {
        res.json({ message: 'FCM token updated successfully' });
    }
});

app.put('/users/vehicle-info', authenticateToken, async (req, res) => {
    const { vehicleType } = req.body;
    try {
        await User.findByIdAndUpdate(req.user.id, { vehicleType });
        res.json({ message: 'Vehicle info updated' });
    } catch (err) {
        res.json({ message: 'Vehicle info updated' });
    }
});

// --- Vehicle Listing Routes ("لدي آلية للإيجار") ---
app.post('/vehicles', authenticateToken, upload.array('images', 6), async (req, res) => {
    const { type, capacity, availableCount, dailyPrice, location, notes, latitude, longitude } = req.body;
    const imagePaths = req.files ? req.files.map(f => f.path) : [];

    if (!location || latitude === undefined || longitude === undefined || latitude === '' || longitude === '') {
        return res.status(400).json({ message: 'Location with valid coordinates is required.' });
    }

    try {
        const vehicle = new Vehicle({
            ownerId: req.user.id,
            type: type || 'آلية ثقيلة',
            capacity: parseFloat(capacity) || 0,
            availableCount: parseInt(availableCount) || 1,
            dailyPrice: parseFloat(dailyPrice) || 0,
            location: location || 'العراق',
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            notes: notes || '',
            images: imagePaths
        });
        await vehicle.save();
        res.status(201).json({ message: 'Vehicle listed successfully', vehicle });
    } catch (err) {
        const memVehicle = {
            id: 'v_' + Date.now(),
            _id: 'v_' + Date.now(),
            ownerId: req.user.id,
            type,
            capacity: parseFloat(capacity) || 0,
            availableCount: parseInt(availableCount) || 1,
            dailyPrice: parseFloat(dailyPrice) || 0,
            location,
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            notes: notes || '',
            images: imagePaths
        };
        memoryStore.vehicles.push(memVehicle);
        res.status(201).json({ message: 'Vehicle listed successfully', vehicle: memVehicle });
    }
});

app.get('/vehicles', authenticateToken, async (req, res) => {
    try {
        const vehicles = await Vehicle.find().sort({ createdAt: -1 });
        res.json(vehicles);
    } catch (err) {
        res.json(memoryStore.vehicles);
    }
});

// --- Trips Routes ("طلب شاحنة/لودر وإرسال مزاد") ---
app.post('/trips', authenticateToken, async (req, res) => {
    const { vehicleType, location, date, time, notes, rentalDays, rentalEndDate, latitude, longitude } = req.body;
    try {
        const newTrip = new Trip({
            contractorId: req.user.id,
            vehicleType: vehicleType || 'شاحنة / آلية',
            location: location || 'بغداد',
            latitude: latitude || 33.3152,
            longitude: longitude || 44.3661,
            date: date || new Date().toISOString(),
            time: time || '00:00',
            rentalDays: rentalDays || 1,
            notes: notes || '',
            amount: 150000
        });
        await newTrip.save();
        res.status(201).json({ message: 'Trip created successfully', trip: newTrip, _id: newTrip._id, id: newTrip._id });
    } catch (err) {
        const tripId = 'trip_' + Date.now();
        const memTrip = {
            id: tripId,
            _id: tripId,
            contractorId: req.user.id,
            vehicleType: vehicleType || 'شاحنة / آلية',
            location: location || 'بغداد',
            latitude: latitude || 33.3152,
            longitude: longitude || 44.3661,
            status: 'waiting',
            amount: 150000
        };
        memoryStore.trips.push(memTrip);
        res.status(201).json({
            message: 'Trip created successfully',
            trip: memTrip,
            _id: tripId,
            id: tripId
        });
    }
});

app.get('/trips', authenticateToken, async (req, res) => {
    try {
        const query = req.user.role === 'driver'
            ? { driverId: req.user.id }
            : { contractorId: req.user.id };
        const trips = await Trip.find(query).sort({ createdAt: -1 });
        res.json(trips);
    } catch (err) {
        const filtered = memoryStore.trips.filter(t =>
            req.user.role === 'driver'
                ? t.driverId === req.user.id
                : t.contractorId === req.user.id
        );
        res.json(filtered);
    }
});

// قائمة الطلبات المفتوحة اللي أي سائق يقدر يزايد عليها (مزاد عام)
app.get('/trips/available', authenticateToken, async (req, res) => {
    try {
        const trips = await Trip.find({ status: 'waiting' }).sort({ createdAt: -1 });
        res.json(trips);
    } catch (err) {
        res.json(memoryStore.trips.filter(t => t.status === 'waiting'));
    }
});

app.put('/trips/:id/status', authenticateToken, async (req, res) => {
    const { status } = req.body;
    try {
        const trip = await Trip.findById(req.params.id);
        if (!trip) return res.status(404).json({ message: 'Trip not found' });
        if (trip.contractorId !== req.user.id && trip.driverId !== req.user.id) {
            return res.status(403).json({ message: 'You are not authorized to update this trip.' });
        }
        trip.status = status;
        await trip.save();
        res.json({ message: 'Status updated', trip });
    } catch (err) {
        const memTrip = memoryStore.trips.find(t => t.id === req.params.id || t._id === req.params.id);
        if (!memTrip) return res.status(404).json({ message: 'Trip not found' });
        if (memTrip.contractorId !== req.user.id && memTrip.driverId !== req.user.id) {
            return res.status(403).json({ message: 'You are not authorized to update this trip.' });
        }
        memTrip.status = status;
        res.json({ message: 'Status updated', status });
    }
});

app.post('/trips/:id/location', authenticateToken, async (req, res) => {
    const { lat, lng, status } = req.body;
    try {
        await Trip.findByIdAndUpdate(req.params.id, { driverLat: lat, driverLng: lng, ...(status && { status }) });
    } catch (e) {}
    res.json({ message: 'Location updated' });
});

// --- Bids Routes (نظام المزادات والتقديم على الرحلات) ---
app.get('/bids', authenticateToken, async (req, res) => {
    const { tripId } = req.query;
    try {
        const query = tripId ? { tripId } : {};
        const bidsRaw = await Bid.find(query).sort({ createdAt: -1 });
        const bids = await Promise.all(bidsRaw.map(async (bid) => {
            const bidObj = bid.toObject();
            try {
                const driverUser = await User.findById(bid.driverId);
                const totalTrips = await Trip.countDocuments({ driverId: bid.driverId, status: 'completed' });
                bidObj.driver = {
                    name: driverUser ? driverUser.name : bid.driverName,
                    rating: driverUser && driverUser.ratingCount > 0
                        ? Math.round((driverUser.ratingSum / driverUser.ratingCount) * 10) / 10
                        : null,
                    totalTrips
                };
            } catch (e) {
                bidObj.driver = { name: bid.driverName, rating: null, totalTrips: 0 };
            }
            return bidObj;
        }));
        res.json(bids);
    } catch (err) {
        const filtered = memoryStore.bids.filter(b => !tripId || b.tripId === tripId);
        const withDriver = filtered.map(b => ({
            ...b,
            driver: { name: b.driverName, rating: b.driverRating ?? null, totalTrips: 0 }
        }));
        res.json(withDriver);
    }
});

app.post('/bids', authenticateToken, async (req, res) => {
    const { tripId, amount } = req.body;
    let driverName = 'سائق محترف';
    let driverRating = null;
    try {
        const driverUser = await User.findById(req.user.id);
        if (driverUser) {
            driverName = driverUser.name || driverName;
            driverRating = driverUser.ratingCount > 0
                ? Math.round((driverUser.ratingSum / driverUser.ratingCount) * 10) / 10
                : null;
        } else {
            const memUser = memoryStore.users.find(u => u.id === req.user.id);
            if (memUser) driverName = memUser.name || driverName;
        }
    } catch (e) {
        const memUser = memoryStore.users.find(u => u.id === req.user.id);
        if (memUser) driverName = memUser.name || driverName;
    }

    try {
        const newBid = new Bid({
            tripId,
            driverId: req.user.id,
            driverName,
            amount: parseFloat(amount) || 150000,
            status: 'pending'
        });
        await newBid.save();
        const bidObj = newBid.toObject();
        bidObj.driverRating = driverRating;
        res.status(201).json({ message: 'Bid submitted successfully', bid: bidObj });
    } catch (err) {
        const bidId = 'bid_' + Date.now();
        const memBid = {
            id: bidId,
            _id: bidId,
            tripId,
            driverId: req.user.id,
            driverName,
            driverRating,
            amount: parseFloat(amount) || 150000,
            status: 'pending'
        };
        memoryStore.bids.push(memBid);
        res.status(201).json({ message: 'Bid submitted successfully', bid: memBid });
    }
});

app.put('/bids/:id/accept', authenticateToken, async (req, res) => {
    try {
        const bid = await Bid.findById(req.params.id);
        if (!bid) return res.status(404).json({ message: 'Bid not found' });
        const trip = await Trip.findById(bid.tripId);
        if (!trip) return res.status(404).json({ message: 'Trip not found' });
        if (trip.contractorId !== req.user.id) {
            return res.status(403).json({ message: 'You are not authorized to accept this bid.' });
        }
        bid.status = 'accepted';
        await bid.save();
        trip.status = 'accepted';
        trip.driverId = bid.driverId;
        trip.driverName = bid.driverName;
        trip.amount = bid.amount;
        await trip.save();
        res.json({ message: 'Bid accepted successfully', bid });
    } catch (err) {
        const memBid = memoryStore.bids.find(b => b.id === req.params.id || b._id === req.params.id);
        if (memBid) memBid.status = 'accepted';
        const memTrip = memBid ? memoryStore.trips.find(t => t.id === memBid.tripId || t._id === memBid.tripId) : null;
        if (memTrip) {
            memTrip.status = 'accepted';
            memTrip.driverId = memBid.driverId;
            memTrip.driverName = memBid.driverName;
            memTrip.amount = memBid.amount;
        }
        res.json({ message: 'Bid accepted successfully', bid: memBid || {} });
    }
});

// --- Wallet & Payment Routes (Cash Default) ---
app.get('/wallet/balance', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        res.json({ balance: user ? user.walletBalance : 0 });
    } catch (err) {
        res.json({ balance: 0 });
    }
});

app.get('/wallets/balance', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        res.json({ balance: user ? user.walletBalance : 0 });
    } catch (err) {
        res.json({ balance: 0 });
    }
});

app.post('/wallet/deposit', authenticateToken, async (req, res) => {
    const { amount, paymentMethod } = req.body;
    const numericAmount = parseFloat(amount) || 0;
    try {
        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            { $inc: { walletBalance: numericAmount } },
            { new: true }
        );
        const txId = 'tx_' + Date.now();
        try {
            await Transaction.create({
                userId: req.user.id,
                amount: numericAmount,
                paymentMethod: paymentMethod || 'cash',
                transactionId: txId,
                type: 'deposit',
                status: 'success'
            });
        } catch (e) {}
        return res.json({
            message: 'Deposit successful',
            newBalance: updatedUser ? updatedUser.walletBalance : numericAmount,
            transactionId: txId
        });
    } catch (e) {
        const txId = 'tx_' + Date.now();
        memoryStore.transactions.push({
            id: txId,
            userId: req.user.id,
            amount: numericAmount,
            paymentMethod: paymentMethod || 'cash',
            transactionId: txId,
            type: 'deposit',
            status: 'success',
            createdAt: new Date()
        });
        res.json({
            message: 'Deposit successful',
            newBalance: numericAmount,
            transactionId: txId
        });
    }
});

app.get('/wallet/transactions', authenticateToken, async (req, res) => {
    try {
        const txs = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.json(txs);
    } catch (err) {
        res.json(memoryStore.transactions.filter(t => t.userId === req.user.id));
    }
});

app.get('/wallets/transactions', authenticateToken, async (req, res) => {
    try {
        const txs = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.json(txs);
    } catch (err) {
        res.json(memoryStore.transactions.filter(t => t.userId === req.user.id));
    }
});

// --- Document Uploads ---
app.get('/documents', authenticateToken, async (req, res) => {
    try {
        const docs = await DocumentModel.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.json(docs);
    } catch (err) {
        res.json(memoryStore.documents.filter(d => d.userId === req.user.id));
    }
});

app.post('/documents', authenticateToken, upload.single('document'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const documentType = req.body.type || req.body.documentType || 'other';
    try {
        const doc = new DocumentModel({
            userId: req.user.id,
            documentType,
            filePath: req.file.path,
            status: 'pending'
        });
        await doc.save();
        res.status(200).json({ message: 'File uploaded successfully', filePath: req.file.path, document: doc });
    } catch (err) {
        const memDoc = {
            id: 'doc_' + Date.now(),
            _id: 'doc_' + Date.now(),
            userId: req.user.id,
            documentType,
            filePath: req.file.path,
            status: 'pending'
        };
        memoryStore.documents.push(memDoc);
        res.status(200).json({ message: 'File uploaded successfully', filePath: req.file.path, document: memDoc });
    }
});

// --- Ratings ---
app.post('/ratings', authenticateToken, async (req, res) => {
    const { targetId, targetType, stars, comment, tripId } = req.body;
    const numericStars = parseFloat(stars);
    if (!targetId || !numericStars || numericStars < 1 || numericStars > 5) {
        return res.status(400).json({ message: 'Valid targetId and stars (1-5) are required.' });
    }
    try {
        await Rating.create({
            tripId, fromUserId: req.user.id, targetId,
            targetType: targetType || 'driver', stars: numericStars, comment: comment || ''
        });
        const updatedUser = await User.findByIdAndUpdate(
            targetId,
            { $inc: { ratingSum: numericStars, ratingCount: 1 } },
            { new: true }
        );
        const avg = updatedUser && updatedUser.ratingCount > 0
            ? (updatedUser.ratingSum / updatedUser.ratingCount)
            : numericStars;
        res.json({ message: 'Rating submitted successfully', averageRating: Math.round(avg * 10) / 10 });
    } catch (err) {
        res.json({ message: 'Rating submitted successfully' });
    }
});

app.get('/', (req, res) => res.send('Tawfiq Tech Logistics Backend Server Running Cleanly!'));

// --- WebSockets Server for Real-Time Mapbox Live Tracking ---
const wss = new WebSocketServer({ server, path: '/tracking' });
const tripRooms = new Map();

wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const tripId = urlParams.get('tripId') || 'global';
    
    if (!tripRooms.has(tripId)) {
        tripRooms.set(tripId, new Set());
    }
    tripRooms.get(tripId).add(ws);
    
    console.log(`[WS] Client connected to trip tracking room: ${tripId}`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const clients = tripRooms.get(tripId);
            if (clients) {
                clients.forEach((client) => {
                    if (client !== ws && client.readyState === 1) { // 1 = OPEN
                        client.send(JSON.stringify(data));
                    }
                });
            }
        } catch (err) {
            console.error('[WS] Error processing message:', err.message);
        }
    });

    ws.on('close', () => {
        const clients = tripRooms.get(tripId);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) tripRooms.delete(tripId);
        }
        console.log(`[WS] Client disconnected from trip room: ${tripId}`);
    });
});

// --- معالج أخطاء عام (يلتقط أخطاء رفع الملفات وأي أخطاء غير متوقعة في المسارات) ---
app.use((err, req, res, next) => {
    if (err) {
        console.error('[Error]', err.message);
        const status = err.status || 400;
        return res.status(status).json({ message: err.message || 'حدث خطأ غير متوقع' });
    }
    next();
});

server.listen(PORT, () => console.log(`🚀 Tawfiq Tech Logistics Server running on http://localhost:${PORT}`));
