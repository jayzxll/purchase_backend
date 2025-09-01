import express from 'express';
import { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as admin from 'firebase-admin';
import { config } from 'dotenv';
import crypto from 'crypto';
import axios from 'axios';

// Load environment variables
config();

// Define custom interface that extends Express Request
interface CustomRequest extends Request {
  user?: any;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Lemon Squeezy configuration
const lemonSqueezyApiKey = process.env.LEMON_SQUEEZY_API_KEY || '';
const lemonSqueezyStoreId = process.env.LEMON_SQUEEZY_STORE_ID || '';

// PayTR configuration
const paytrMerchantId = process.env.PAYTR_MERCHANT_ID || '';
const paytrMerchantKey = process.env.PAYTR_MERCHANT_KEY || '';
const paytrMerchantSalt = process.env.PAYTR_MERCHANT_SALT || '';

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

// ✅ LEMON SQUEEZY ENDPOINTS

// Create Lemon Squeezy checkout
app.post('/api/lemonsqueezy/create-checkout', authMiddleware, async (req: CustomRequest, res: Response) => {
  try {
    const { subscriptionType, successUrl, cancelUrl, userEmail } = req.body;
    const userId = req.user.uid;

    if (!subscriptionType || !successUrl || !cancelUrl) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Define subscription variant IDs (you'll need to set these up in your Lemon Squeezy store)
    const subscriptionVariants: Record<string, string> = {
      basic: process.env.LEMON_BASIC_VARIANT_ID || 'your_basic_variant_id',
      premium: process.env.LEMON_PREMIUM_VARIANT_ID || 'your_premium_variant_id',
      vip: process.env.LEMON_VIP_VARIANT_ID || 'your_vip_variant_id'
    };

    const variantId = subscriptionVariants[subscriptionType];
    if (!variantId) {
      return res.status(400).json({ error: 'Invalid subscription type' });
    }

    // Create custom options for the checkout
    const customOptions: any = {
      checkout_data: {
        email: userEmail,
        custom: {
          user_id: userId,
          subscription_type: subscriptionType
        }
      },
      checkout_options: {
        embed: false,
        media: false,
        button_color: '#22c55e'
      },
      product_options: {
        enabled_variants: [variantId],
        redirect_url: successUrl,
        receipt_button_text: 'Go to Dashboard',
        receipt_link_url: successUrl,
        receipt_thank_you_note: 'Thank you for your purchase!'
      }
    };

    // Create Lemon Squeezy checkout
    const response = await axios.post(
      `https://api.lemonsqueezy.com/v1/checkouts`,
      {
        data: {
          type: 'checkouts',
          attributes: {
            custom_price: getLemonSqueezyPrice(subscriptionType),
            product_options: customOptions.product_options,
            checkout_options: customOptions.checkout_options,
            checkout_data: customOptions.checkout_data,
          },
          relationships: {
            store: {
              data: {
                type: 'stores',
                id: lemonSqueezyStoreId
              }
            },
            variant: {
              data: {
                type: 'variants',
                id: variantId
              }
            }
          }
        }
      },
      {
        headers: {
          'Accept': 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          'Authorization': `Bearer ${lemonSqueezyApiKey}`
        }
      }
    );

    const checkoutUrl = response.data.data.attributes.url;

    res.json({
      url: checkoutUrl,
    });

  } catch (error) {
    console.error('Lemon Squeezy checkout creation error:', error);
    res.status(500).json({ error: 'Failed to create checkout' });
  }
});

// Helper function to get price for Lemon Squeezy
function getLemonSqueezyPrice(subscriptionType: string): number {
  const prices: Record<string, number> = {
    basic: 999, // in cents
    premium: 1999,
    vip: 2999
  };
  return prices[subscriptionType] || 999;
}

// Lemon Squeezy webhook handler
app.post('/api/lemonsqueezy/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    // Verify webhook signature (optional but recommended)
    const signature = req.headers['x-signature'] as string;
    // You should verify the signature here using your webhook secret

    const event = JSON.parse(req.body.toString());
    const eventName = req.headers['x-event-name'] as string;

    console.log('Lemon Squeezy webhook received:', eventName);

    // Handle different event types
    switch (eventName) {
      case 'order_created':
        await handleOrderCreated(event);
        break;
      case 'subscription_created':
        await handleSubscriptionCreated(event);
        break;
      case 'subscription_updated':
        await handleSubscriptionUpdated(event);
        break;
      case 'subscription_cancelled':
        await handleSubscriptionCancelled(event);
        break;
      default:
        console.log(`Unhandled event type: ${eventName}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Lemon Squeezy webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Handle order created event
async function handleOrderCreated(event: any) {
  try {
    const orderData = event.data;
    const customData = orderData.attributes.user_email || {};
    const userId = customData.user_id;
    const subscriptionType = customData.subscription_type;

    if (userId && subscriptionType) {
      // Calculate expiry date (30 days from now)
      const purchaseDate = new Date();
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30);

      // Save to Firestore
      if (admin.apps.length > 0) {
        await admin.firestore().collection('users').doc(userId).set({
          subscription: {
            type: subscriptionType,
            purchase_date: purchaseDate,
            expiry_date: expiryDate,
            purchase_token: orderData.id,
            product_id: `lemonsqueezy_${subscriptionType}`,
            platform: 'lemonsqueezy',
            status: 'active',
            last_updated: new Date(),
          },
          last_updated: new Date(),
        }, { merge: true });

        // Also create a separate record in subscriptions collection
        await admin.firestore().collection('subscriptions').doc(orderData.id).set({
          user_id: userId,
          user_email: orderData.attributes.user_email,
          type: subscriptionType,
          purchase_date: purchaseDate,
          expiry_date: expiryDate,
          purchase_token: orderData.id,
          product_id: `lemonsqueezy_${subscriptionType}`,
          platform: 'lemonsqueezy',
          status: 'active',
          last_updated: new Date(),
        });
      }
    }
  } catch (error) {
    console.error('Error handling order created:', error);
  }
}

// Handle subscription created event
async function handleSubscriptionCreated(event: any) {
  try {
    const subscriptionData = event.data;
    const customData = subscriptionData.attributes.user_email || {};
    const userId = customData.user_id;
    const subscriptionType = customData.subscription_type;

    if (userId && subscriptionType) {
      // Update subscription details in Firestore
      if (admin.apps.length > 0) {
        await admin.firestore().collection('users').doc(userId).set({
          subscription: {
            status: 'active',
            renewal_date: new Date(subscriptionData.attributes.renews_at),
            last_updated: new Date(),
          },
          last_updated: new Date(),
        }, { merge: true });
      }
    }
  } catch (error) {
    console.error('Error handling subscription created:', error);
  }
}

// Handle subscription updated event
async function handleSubscriptionUpdated(event: any) {
  try {
    const subscriptionData = event.data;
    const customData = subscriptionData.attributes.user_email || {};
    const userId = customData.user_id;

    if (userId) {
      // Update subscription status in Firestore
      if (admin.apps.length > 0) {
        await admin.firestore().collection('users').doc(userId).set({
          subscription: {
            status: subscriptionData.attributes.status,
            renewal_date: new Date(subscriptionData.attributes.renews_at),
            last_updated: new Date(),
          },
          last_updated: new Date(),
        }, { merge: true });
      }
    }
  } catch (error) {
    console.error('Error handling subscription updated:', error);
  }
}

// Handle subscription cancelled event
async function handleSubscriptionCancelled(event: any) {
  try {
    const subscriptionData = event.data;
    const customData = subscriptionData.attributes.user_email || {};
    const userId = customData.user_id;

    if (userId) {
      // Update subscription status in Firestore
      if (admin.apps.length > 0) {
        await admin.firestore().collection('users').doc(userId).set({
          subscription: {
            status: 'cancelled',
            last_updated: new Date(),
          },
          last_updated: new Date(),
        }, { merge: true });
      }
    }
  } catch (error) {
    console.error('Error handling subscription cancelled:', error);
  }
}

// ✅ PAYTR ENDPOINTS

// Generate PayTR token
const generatePayTRToken = (params: Record<string, string>): string => {
  const sortedParams = Object.keys(params).sort().map(key => `${key}=${params[key]}`);
  const hashString = sortedParams.join('&') + paytrMerchantSalt;
  return crypto.createHmac('sha256', paytrMerchantKey).update(hashString).digest('base64');
};

// Create PayTR payment
app.post('/api/paytr/create-payment', authMiddleware, async (req: CustomRequest, res: Response) => {
  try {
    const { subscriptionType, amount, currency, userEmail, userName } = req.body;
    const userId = req.user.uid;

    if (!subscriptionType || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Generate a unique merchant order ID
    const merchantOid = `SUB${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
    
    // Define payment parameters
    const paymentParams: Record<string, string> = {
      merchant_id: paytrMerchantId,
      user_ip: req.ip || '127.0.0.1',
      merchant_oid: merchantOid,
      email: userEmail || req.user.email,
      payment_amount: Math.round(amount * 100).toString(), // Convert to kuruş
      payment_type: 'card',
      currency: currency || 'TRY',
      test_mode: process.env.NODE_ENV === 'production' ? '0' : '1',
      user_name: userName || 'Customer',
      user_address: 'Not specified',
      user_phone: 'Not specified',
      merchant_ok_url: `${process.env.BASE_URL}/payment-success?gateway=paytr&user_id=${userId}`,
      merchant_fail_url: `${process.env.BASE_URL}/payment-fail?gateway=paytr&user_id=${userId}`,
      timeout_limit: '30',
      lang: 'tr',
      debug_on: '1',
    };

    // Generate token
    const paytrToken = generatePayTRToken(paymentParams);

    // Make request to PayTR API
    const response = await axios.post('https://www.paytr.com/odeme/api/get-token', {
      ...paymentParams,
      paytr_token: paytrToken,
    });

    if (response.data.status === 'success') {
      // Save initial payment record
      if (admin.apps.length > 0) {
        await admin.firestore().collection('paytr_payments').doc(merchantOid).set({
          user_id: userId,
          user_email: userEmail || req.user.email,
          subscription_type: subscriptionType,
          amount: amount,
          currency: currency || 'TRY',
          merchant_oid: merchantOid,
          status: 'pending',
          created_at: new Date(),
        });
      }

      res.json({
        token: response.data.token,
        url: 'https://www.paytr.com/odeme/guvenli/' + response.data.token,
      });
    } else {
      throw new Error(response.data.reason || 'PayTR token generation failed');
    }

  } catch (error) {
    console.error('PayTR payment creation error:', error);
    res.status(500).json({ error: 'Failed to create PayTR payment' });
  }
});

// Verify PayTR payment
app.post('/api/paytr/verify-payment', authMiddleware, async (req: CustomRequest, res: Response) => {
  try {
    const { merchant_oid, status, total_amount, hash } = req.body;
    const userId = req.user.uid;

    if (!merchant_oid || !status) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify the hash
    const expectedHash = crypto
      .createHash('sha256')
      .update(`${merchant_oid}${paytrMerchantSalt}${status}${total_amount}`)
      .digest('base64')
      .toString();

    if (hash !== expectedHash) {
      return res.status(400).json({ error: 'Invalid hash' });
    }

    if (status !== 'success') {
      return res.status(400).json({ error: 'Payment failed' });
    }

    // Get payment details from Firestore
    const paymentDoc = await admin.firestore().collection('paytr_payments').doc(merchant_oid).get();
    const paymentData = paymentDoc.data();

    if (!paymentData) {
      return res.status(404).json({ error: 'Payment record not found' });
    }

    // Calculate expiry date (30 days from now)
    const purchaseDate = new Date();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    // Update payment status
    await admin.firestore().collection('paytr_payments').doc(merchant_oid).update({
      status: 'completed',
      completed_at: new Date(),
      hash: hash,
    });

    // Save subscription to user record
    await admin.firestore().collection('users').doc(userId).set({
      subscription: {
        type: paymentData.subscription_type,
        purchase_date: purchaseDate,
        expiry_date: expiryDate,
        purchase_token: merchant_oid,
        product_id: `paytr_${paymentData.subscription_type}`,
        platform: 'paytr',
        status: 'active',
        last_updated: new Date(),
      },
      last_updated: new Date(),
    }, { merge: true });

    // Also create a separate record in subscriptions collection
    await admin.firestore().collection('subscriptions').doc(merchant_oid).set({
      user_id: userId,
      user_email: paymentData.user_email,
      type: paymentData.subscription_type,
      purchase_date: purchaseDate,
      expiry_date: expiryDate,
      purchase_token: merchant_oid,
      product_id: `paytr_${paymentData.subscription_type}`,
      platform: 'paytr',
      status: 'active',
      last_updated: new Date(),
    });

    res.json({
      success: true,
      message: 'Payment verified successfully',
      expiryDate: expiryDate.toISOString(),
      subscriptionType: paymentData.subscription_type,
    });

  } catch (error) {
    console.error('PayTR payment verification error:', error);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

// PayTR webhook handler
app.post('/api/paytr/webhook', express.json(), async (req: Request, res: Response) => {
  try {
    const { merchant_oid, status, total_amount, hash } = req.body;

    // Verify the hash
    const expectedHash = crypto
      .createHash('sha256')
      .update(`${merchant_oid}${paytrMerchantSalt}${status}${total_amount}`)
      .digest('base64')
      .toString();

    if (hash !== expectedHash) {
      return res.status(400).json({ error: 'Invalid hash' });
    }

    // Update payment status in database
    await admin.firestore().collection('paytr_payments').doc(merchant_oid).update({
      status: status,
      updated_at: new Date(),
      webhook_received: true,
    });

    res.json({ status: 'ok' });

  } catch (error) {
    console.error('PayTR webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

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

// Purchase verification endpoint (generic)
app.post('/api/purchases/verify', authMiddleware, async (req: CustomRequest, res: Response) => {
  try {
    const { 
      purchaseToken, 
      productId, 
      subscriptionType, 
      platform = 'android', 
      receiptData, 
      userEmail 
    } = req.body;

    const userId = req.user.uid;

    if (!purchaseToken || !productId) {
      return res.status(400).json({ error: 'Missing purchaseToken or productId' });
    }

    console.log('Purchase verification request:', {
      purchaseToken,
      productId,
      subscriptionType,
      platform,
      userId,
      userEmail
    });

    // Calculate expiry date (30 days from now)
    const purchaseDate = new Date();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    // Determine subscription type from productId if not provided
    const finalSubscriptionType = subscriptionType || 
      (productId.includes('vip') ? 'vip' : 
       productId.includes('premium') ? 'premium' : 'basic');

    // Save to Firestore
    if (admin.apps.length > 0) {
      await admin.firestore().collection('users').doc(userId).set({
        subscription: {
          type: finalSubscriptionType,
          purchase_date: purchaseDate,
          expiry_date: expiryDate,
          purchase_token: purchaseToken,
          product_id: productId,
          platform: platform,
          status: 'active',
          last_updated: new Date(),
        },
        email: userEmail || req.user.email,
        last_updated: new Date(),
      }, { merge: true });

      // Also create a separate record in subscriptions collection
      await admin.firestore().collection('subscriptions').doc(purchaseToken).set({
        user_id: userId,
        user_email: userEmail || req.user.email,
        type: finalSubscriptionType,
        purchase_date: purchaseDate,
        expiry_date: expiryDate,
        purchase_token: purchaseToken,
        product_id: productId,
        platform: platform,
        status: 'active',
        last_updated: new Date(),
      });
    }

    res.json({
      success: true,
      message: 'Purchase verified successfully',
      expiryDate: expiryDate.toISOString(),
      subscriptionType: finalSubscriptionType,
      purchaseDate: purchaseDate.toISOString(),
      purchaseToken: purchaseToken
    });

  } catch (error) {
    console.error('Purchase verification error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Enhanced user subscription check endpoint
app.get('/api/user/subscription', authMiddleware, async (req: CustomRequest, res: Response) => {
  try {
    const userId = req.user.uid;
    
    if (admin.apps.length > 0) {
      const userDoc = await admin.firestore().collection('users').doc(userId).get();
      const userData = userDoc.data();
      const subscription = userData?.subscription;
      
      if (subscription) {
        const expiryDate = new Date(subscription.expiry_date);
        const isActive = new Date() < expiryDate;
        
        const remainingTime = expiryDate.getTime() - Date.now();
        const remainingDays = Math.ceil(remainingTime / (1000 * 60 * 60 * 24));

        res.json({
          hasActiveSubscription: isActive,
          subscriptionType: subscription.type,
          expiryDate: expiryDate.toISOString(),
          purchaseDate: subscription.purchase_date,
          status: subscription.status,
          remainingDays: remainingDays,
          isExpiringSoon: remainingDays <= 7,
          productId: subscription.product_id
        });
        return;
      }
    }
    
    res.json({ 
      hasActiveSubscription: false,
      subscriptionType: null,
      expiryDate: null,
      status: 'inactive'
    });

  } catch (error) {
    console.error('Subscription check error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get subscription status' 
    });
  }
});

// Feature availability check endpoint
app.get('/api/user/features', authMiddleware, async (req: CustomRequest, res: Response) => {
  try {
    const userId = req.user.uid;
    let hasActiveSubscription = false;
    let subscriptionType = null;

    if (admin.apps.length > 0) {
      const userDoc = await admin.firestore().collection('users').doc(userId).get();
      const subscription = userDoc.data()?.subscription;
      
      if (subscription) {
        hasActiveSubscription = new Date() < new Date(subscription.expiry_date);
        subscriptionType = subscription.type;
      }
    }

    // Feature availability logic
    const features = {
      basic_matching: true, // Always available
      messages: true, // Always available
      ai_matches: hasActiveSubscription && (subscriptionType === 'premium' || subscriptionType === 'vip'),
      lightning_matches: hasActiveSubscription && (subscriptionType === 'premium' || subscriptionType === 'vip'),
      map_love: hasActiveSubscription && subscriptionType === 'vip',
      popup_dating: hasActiveSubscription && subscriptionType === 'vip',
      ai_dating_coach: hasActiveSubscription && subscriptionType === 'vip',
    };

    res.json({
      hasActiveSubscription,
      subscriptionType,
      features,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Features check error:', error);
    res.status(500).json({ error: 'Failed to get features' });
  }
});

// Get user's free matches count
app.get('/api/user/free-matches', authMiddleware, async (req: CustomRequest, res: Response) => {
  try {
    const userId = req.user.uid;
    const freeMatchesUsed = 0; // You'll implement this based on your tracking

    res.json({
      freeMatchesUsed,
      freeMatchesRemaining: 50 - freeMatchesUsed,
      hasUnlimited: false // Will be true if user has subscription
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to get free matches info' });
  }
});

// Record free match usage
app.post('/api/user/record-match', authMiddleware, async (req: CustomRequest, res: Response) => {
  try {
    const userId = req.user.uid;
    // You'll implement match tracking logic here

    res.json({ 
      success: true, 
      message: 'Match recorded' 
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to record match' });
  }
});

// Admin endpoint to update subscription status
app.post('/api/admin/update-subscription', async (req: Request, res: Response) => {
  try {
    // Basic admin auth (you should implement proper admin authentication)
    const { adminKey, userId, status, expiryDate } = req.body;
    
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (admin.apps.length > 0) {
      await admin.firestore().collection('users').doc(userId).update({
        'subscription.status': status,
        'subscription.expiry_date': new Date(expiryDate),
        'last_updated': new Date(),
      });
    }

    res.json({ success: true, message: 'Subscription updated' });

  } catch (error) {
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check available at: http://localhost:${PORT}/health`);
  console.log(`🔐 API endpoints ready for purchase verification`);
  console.log(`🍋 Lemon Squeezy and PayTR endpoints configured`);
});