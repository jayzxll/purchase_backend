import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import admin from 'firebase-admin';
import morgan from 'morgan';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Import our error handlers
import { errorHandler, asyncHandler, AppError } from './utils/errorHandler';

// Load environment variables based on environment
if (process.env.NODE_ENV === 'production') {
  config({ path: '.env.production' });
} else {
  config({ path: '.env.development' });
}

// Define custom interface that extends Express Request
interface CustomRequest extends Request {
  user?: any;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL 
    : 'http://localhost:3001',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Other middleware
app.use(express.json({ limit: '10kb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Initialize Firebase
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    console.log('✅ Firebase initialized');
  } catch (error) {
    console.error('❌ Firebase initialization error:', error);
    process.exit(1); // Exit if Firebase fails to initialize
  }
} else {
  console.log('⚠️  Firebase config missing - some features disabled');
}

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    service: 'purchase-backend'
  });
});

// Authentication middleware
const authMiddleware = async (req: CustomRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new AppError('Authentication token required', 401));
    }
    
    const token = authHeader.replace('Bearer ', '');
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    next(new AppError('Invalid or expired token', 401));
  }
};

// Android purchase verification
app.post('/api/verify/android', authMiddleware, asyncHandler(async (req: CustomRequest, res: Response) => {
  const { purchaseToken, productId } = req.body;
  
  if (!purchaseToken || !productId) {
    throw new AppError('Missing required fields: purchaseToken and productId', 400);
  }

  const userId = req.user.uid;
  console.log(`Verifying purchase for user: ${userId}`);

  // For now, just log and return success - you'll add real validation later
  console.log('Purchase details:', { purchaseToken, productId, userId });

  // Save to Firestore (if Firebase is configured)
  if (admin.apps.length > 0) {
    await admin.firestore().collection('users').doc(userId).set({
      subscription: {
        type: productId.includes('vip') ? 'vip' : 
              productId.includes('premium') ? 'premium' : 'basic',
        purchase_date: new Date(),
        expiry_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        status: 'active',
        last_updated: new Date(),
      }
    }, { merge: true });
  }

  res.json({ 
    success: true, 
    message: 'Purchase verified (simulated)',
    expiry_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  });
}));

// Get subscription status
app.get('/api/subscription', authMiddleware, asyncHandler(async (req: CustomRequest, res: Response) => {
  const userId = req.user.uid;
  
  if (admin.apps.length > 0) {
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      throw new AppError('User not found', 404);
    }
    
    const subscription = userDoc.data()?.subscription;
    
    if (subscription) {
      const isActive = new Date() < new Date(subscription.expiry_date);
      res.json({ 
        hasSubscription: isActive, 
        subscription: { ...subscription, is_active: isActive } 
      });
      return;
    }
  }
  
  res.json({ hasSubscription: false });
}));

// 404 handler for undefined routes
app.all('*', (req: Request, res: Response, next: NextFunction) => {
  next(new AppError(`Route ${req.originalUrl} not found`, 404));
});

// Global error handling middleware (MUST be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});