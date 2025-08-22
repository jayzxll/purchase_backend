import express from 'express';
import { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as admin from 'firebase-admin';
import { config } from 'dotenv';
// Load environment variables
config();

// Define custom interface that extends Express Request
interface CustomRequest extends Request {
  user?: any;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Firebase
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
  console.log('✅ Firebase initialized');
} else {
  console.log('⚠️  Firebase config missing - some features disabled');
}

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Authentication middleware
const authMiddleware = async (req: CustomRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Android purchase verification
app.post('/api/verify/android', authMiddleware, async (req: CustomRequest, res: Response) => {
  try {
    const { purchaseToken, productId } = req.body;
    const userId = req.user.uid;

    if (!purchaseToken || !productId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

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

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Get subscription status
app.get('/api/subscription', authMiddleware, async (req: CustomRequest, res: Response) => {
  try {
    const userId = req.user.uid;
    
    if (admin.apps.length > 0) {
      const userDoc = await admin.firestore().collection('users').doc(userId).get();
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
  } catch (error) {
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});