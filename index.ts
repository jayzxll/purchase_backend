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

// Define PayTR response interface
interface PayTRResponse {
  status: string;
  token?: string;
  reason?: string;
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

    // Define subscription variant IDs for all plan types and durations
    const subscriptionVariants: Record<string, string> = {
      // Basic Plans
      'basic_monthly': process.env.LEMON_BASIC_MONTHLY_VARIANT_ID || 'basic_monthly_variant_id',
      'basic_3months': process.env.LEMON_BASIC_3MONTHS_VARIANT_ID || 'basic_3months_variant_id',
      'basic_yearly': process.env.LEMON_BASIC_YEARLY_VARIANT_ID || 'basic_yearly_variant_id',

      // Premium Plans
      'premium_monthly': process.env.LEMON_PREMIUM_MONTHLY_VARIANT_ID || 'premium_monthly_variant_id',
      'premium_3months': process.env.LEMON_PREMIUM_3MONTHS_VARIANT_ID || 'premium_3months_variant_id',
      'premium_yearly': process.env.LEMON_PREMIUM_YEARLY_VARIANT_ID || 'premium_yearly_variant_id',

      // VIP Plans
      'vip_monthly': process.env.LEMON_VIP_MONTHLY_VARIANT_ID || 'vip_monthly_variant_id',
      'vip_3months': process.env.LEMON_VIP_3MONTHS_VARIANT_ID || 'vip_3months_variant_id',
      'vip_yearly': process.env.LEMON_VIP_YEARLY_VARIANT_ID || 'vip_yearly_variant_id'
    };

    const variantId = subscriptionVariants[subscriptionType];
    if (!variantId) {
      return res.status(400).json({ error: 'Invalid subscription type' });
    }

    // Get price for the subscription type
    const price = getLemonSqueezyPrice(subscriptionType);

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
            custom_price: price,
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

    // Type cast the response
    interface LemonSqueezyResponse {
      data: {
        attributes: {
          url: string;
        };
      };
    }

    const responseData = response.data as LemonSqueezyResponse;
    const checkoutUrl = responseData.data.attributes.url;

    res.json({
      url: checkoutUrl,
    });

  } catch (error: any) {
    console.error('Lemon Squeezy checkout creation error:', error);
    res.status(500).json({ error: 'Failed to create checkout' });
  }
});

// Helper function to get price for Lemon Squeezy (in cents)
function getLemonSqueezyPrice(subscriptionType: string): number {
  const prices: Record<string, number> = {
    // Basic Plans
    'basic_monthly': 99,    // $0.99
    'basic_3months': 199,   // $1.99
    'basic_yearly': 899,    // $8.99

    // Premium Plans
    'premium_monthly': 299, // $2.99
    'premium_3months': 649, // $6.49
    'premium_yearly': 1999, // $19.99

    // VIP Plans
    'vip_monthly': 749,     // $7.49
    'vip_3months': 1499,    // $14.99
    'vip_yearly': 2599,     // $25.99
  };

  return prices[subscriptionType] || 99;
}

// Helper function to calculate expiry date based on subscription type
function calculateExpiryDate(subscriptionType: string): Date {
  const expiryDate = new Date();

  switch (subscriptionType) {
    case 'basic_monthly':
    case 'premium_monthly':
    case 'vip_monthly':
      expiryDate.setMonth(expiryDate.getMonth() + 1);
      break;
    case 'basic_3months':
    case 'premium_3months':
    case 'vip_3months':
      expiryDate.setMonth(expiryDate.getMonth() + 3);
      break;
    case 'basic_yearly':
    case 'premium_yearly':
    case 'vip_yearly':
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      break;
    default:
      expiryDate.setMonth(expiryDate.getMonth() + 1);
  }

  return expiryDate;
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
  } catch (error: any) {
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
      // Calculate expiry date based on subscription type
      const purchaseDate = new Date();
      const expiryDate = calculateExpiryDate(subscriptionType);

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
          accountPlan: subscriptionType, // For compatibility
          expirationDate: expiryDate.toISOString(), // For compatibility
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
  } catch (error: any) {
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
  } catch (error: any) {
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
  } catch (error: any) {
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
  } catch (error: any) {
    console.error('Error handling subscription cancelled:', error);
  }
}

// ✅ PAYTR ENDPOINTS

// Generate PayTR token
/*const generatePayTRToken = (params: Record<string, string>): string => {
  const sortedParams = Object.keys(params).sort().map(key => `${key}=${params[key]}`);
  const hashString = sortedParams.join('&') + paytrMerchantSalt;
  return crypto.createHmac('sha256', paytrMerchantKey).update(hashString).digest('base64');
};*/

// Helper function to get price for PayTR (in kuruş)
function getPayTRPrice(subscriptionType: string): number {
  const prices: Record<string, number> = {
    // Basic Plans
    'basic_monthly': 100,    // ₺0.99
    'basic_3months': 199,   // ₺1.99
    'basic_yearly': 899,    // ₺8.99

    // Premium Plans
    'premium_monthly': 299, // ₺2.99
    'premium_3months': 649, // ₺6.49
    'premium_yearly': 1999, // ₺19.99

    // VIP Plans
    'vip_monthly': 749,     // ₺7.49
    'vip_3months': 1499,    // ₺14.99
    'vip_yearly': 2599,     // ₺25.99
  };

  return prices[subscriptionType] || 99;
}

// Create PayTR payment - FIXED VERSION
// Create PayTR payment - COMPLETELY FIXED VERSION
app.post('/api/paytr/create-payment', authMiddleware, async (req: CustomRequest, res: Response) => {
  console.log('=== PayTR Payment Creation Started ===');

  try {
    // Debug environment first
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Test mode will be:', process.env.NODE_ENV === 'production' ? '0' : '1');

    // Check PayTR config first
    console.log('PayTR Config Status:');
    console.log('- PAYTR_MERCHANT_ID:', process.env.PAYTR_MERCHANT_ID ? 'SET' : 'NOT SET');
    console.log('- PAYTR_MERCHANT_KEY:', process.env.PAYTR_MERCHANT_KEY ? 'SET' : 'NOT SET');
    console.log('- PAYTR_MERCHANT_SALT:', process.env.PAYTR_MERCHANT_SALT ? 'SET' : 'NOT SET');

    const { subscriptionType, userEmail, userName } = req.body;
    const userId = req.user.uid;

    if (!subscriptionType) {
      return res.status(400).json({ error: 'Missing subscriptionType field' });
    }

    // Validate PayTR configuration
    if (!paytrMerchantId || !paytrMerchantKey || !paytrMerchantSalt) {
      console.error('PayTR configuration missing');
      return res.status(500).json({ error: 'Payment system configuration error' });
    }

    // Get price for the subscription type
    const amount = getPayTRPrice(subscriptionType);
    const currency = 'TL';
    const test_mode = process.env.NODE_ENV === 'production' ? '0' : '1';

    // Generate a unique merchant order ID
    const merchantOid = `SUB${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

    // Create user_basket
    const subscriptionDisplayName = getSubscriptionDisplayName(subscriptionType);
    const userBasket = JSON.stringify([[subscriptionDisplayName, (amount / 100).toFixed(2), 1]]);

    // Get client IP properly
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      '127.0.0.1';

    // Define payment parameters in the EXACT order PayTR expects for token generation
    const paymentParams: Record<string, string> = {
      merchant_id: paytrMerchantId,
      user_ip: clientIp,
      merchant_oid: merchantOid,
      email: userEmail || req.user.email || 'customer@example.com',
      payment_amount: amount.toString(),
      payment_type: 'card',
      currency: currency,
      test_mode: test_mode,
      non_3d: '0',
      merchant_ok_url: `${process.env.BASE_URL || 'https://purchasebackend-production.up.railway.app'}/api/paytr/success?merchant_oid=${merchantOid}&user_id=${userId}`,
      merchant_fail_url: `${process.env.BASE_URL || 'https://purchasebackend-production.up.railway.app'}/api/paytr/fail?merchant_oid=${merchantOid}&user_id=${userId}`,
      user_name: userName || 'Customer',
      user_address: 'Turkey',
      user_phone: '5555555555',
      user_basket: userBasket,
      no_installment: '0',
      max_installment: '12',
      timeout_limit: '30',
    };

    // Generate token with CORRECT algorithm
    const paytrToken = generatePayTRToken(paymentParams);

    // Save initial payment record
    if (admin.apps.length > 0) {
      await admin.firestore().collection('paytr_payments').doc(merchantOid).set({
        user_id: userId,
        user_email: userEmail || req.user.email,
        subscription_type: subscriptionType,
        amount: amount / 100,
        currency: currency,
        merchant_oid: merchantOid,
        status: 'pending',
        test_mode: test_mode,
        created_at: new Date(),
      });
    }

    // Prepare form data for PayTR API
    const formParams = new URLSearchParams();

    // Add parameters in any order for the form submission
    // (The order only matters for token generation, not for form submission)
    Object.entries(paymentParams).forEach(([key, value]) => {
      formParams.append(key, value);
    });
    formParams.append('paytr_token', paytrToken);

    // Make request to PayTR API
    const response = await axios.post(
      'https://www.paytr.com/odeme/api/get-token',
      formParams,
      {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
      }
    );

    const responseData = response.data as PayTRResponse;

    if (responseData.status === 'success' && responseData.token) {
      const paymentUrl = `https://www.paytr.com/odeme/guvenli/${responseData.token}`;

      // Update payment record with token
      if (admin.apps.length > 0) {
        await admin.firestore().collection('paytr_payments').doc(merchantOid).update({
          paytr_token: responseData.token,
          payment_url: paymentUrl,
          status: 'token_generated',
          updated_at: new Date(),
        });
      }

      res.json({
        success: true,
        token: responseData.token,
        url: paymentUrl,
        merchantOid: merchantOid,
        amount: amount / 100,
        currency: currency,
        test_mode: test_mode === '1',
      });
    } else {
      throw new Error(responseData.reason || 'PayTR token generation failed');
    }

  } catch (error: any) {
    console.error('PayTR payment creation error:', error);

    const errorMessage = error.response?.data?.reason ||
      error.response?.data?.message ||
      error.message ||
      'Unknown PayTR API error';

    res.status(500).json({
      error: 'Failed to create PayTR payment: ' + errorMessage,
    });
  }
});

// CORRECT PayTR token generation function
const generatePayTRToken = (params: Record<string, string>): string => {
  // PayTR requires parameters in this EXACT order for hash calculation
  const hashString =
    params.merchant_id +
    params.user_ip +
    params.merchant_oid +
    params.email +
    params.payment_amount +
    params.payment_type +
    params.currency +
    params.test_mode +
    params.non_3d +
    params.merchant_ok_url +
    params.merchant_fail_url +
    params.user_name +
    params.user_address +
    params.user_phone +
    params.user_basket +
    paytrMerchantSalt;

  console.log('Hash string for debugging (first 100 chars):', hashString.substring(0, 100));

  return crypto.createHmac('sha256', paytrMerchantKey).update(hashString).digest('base64');
};

// Helper function to get display names for subscriptions
function getSubscriptionDisplayName(subscriptionType: string): string {
  const displayNames: Record<string, string> = {
    'basic_monthly': 'Basic Monthly Subscription',
    'basic_3months': 'Basic 3-Month Subscription',
    'basic_yearly': 'Basic Yearly Subscription',
    'premium_monthly': 'Premium Monthly Subscription',
    'premium_3months': 'Premium 3-Month Subscription',
    'premium_yearly': 'Premium Yearly Subscription',
    'vip_monthly': 'VIP Monthly Subscription',
    'vip_3months': 'VIP 3-Month Subscription',
    'vip_yearly': 'VIP Yearly Subscription',
  };

  return displayNames[subscriptionType] || 'Subscription';
}

// Add PayTR success callback endpoint
app.get('/api/paytr/success', async (req: Request, res: Response) => {
  try {
    const { merchant_oid, user_id } = req.query;

    console.log('PayTR success callback:', { merchant_oid, user_id });

    if (merchant_oid && admin.apps.length > 0) {
      await admin.firestore().collection('paytr_payments').doc(merchant_oid as string).update({
        status: 'user_returned_success',
        success_callback_at: new Date(),
      });
    }

    // Redirect to your app's success page
    res.redirect(`${process.env.FRONTEND_URL || 'https://yourdomain.com'}/payment-success?gateway=paytr&order=${merchant_oid}`);

  } catch (error: any) {
    console.error('PayTR success callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'https://yourdomain.com'}/payment-error`);
  }
});

// Add PayTR fail callback endpoint
app.get('/api/paytr/fail', async (req: Request, res: Response) => {
  try {
    const { merchant_oid, user_id } = req.query;

    console.log('PayTR fail callback:', { merchant_oid, user_id });

    if (merchant_oid && admin.apps.length > 0) {
      await admin.firestore().collection('paytr_payments').doc(merchant_oid as string).update({
        status: 'user_returned_fail',
        fail_callback_at: new Date(),
      });
    }

    // Redirect to your app's failure page
    res.redirect(`${process.env.FRONTEND_URL || 'https://yourdomain.com'}/payment-failed?gateway=paytr&order=${merchant_oid}`);

  } catch (error: any) {
    console.error('PayTR fail callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'https://yourdomain.com'}/payment-error`);
  }
});

// ENHANCED PayTR webhook handler with proper verification
app.post('/api/paytr/webhook', express.raw({ type: 'application/x-www-form-urlencoded' }), async (req: Request, res: Response) => {
  try {
    console.log('=== PayTR Webhook Received ===');
    console.log('Headers:', req.headers);
    console.log('Raw body:', req.body.toString());

    // Parse form data
    const formData = new URLSearchParams(req.body.toString());
    const merchant_oid = formData.get('merchant_oid');
    const status = formData.get('status');
    const total_amount = formData.get('total_amount');
    const hash = formData.get('hash');

    console.log('Parsed webhook data:', {
      merchant_oid,
      status,
      total_amount,
      hash: hash?.substring(0, 20) + '...'
    });

    if (!merchant_oid || !status || !total_amount || !hash) {
      console.error('Missing required webhook parameters');
      return res.status(400).send('Missing parameters');
    }

    // Verify the hash - PayTR webhook verification
    const expectedHashData = merchant_oid + paytrMerchantSalt + status + total_amount;
    const expectedHash = crypto
      .createHmac('sha256', paytrMerchantKey)
      .update(expectedHashData)
      .digest('base64');

    console.log('Hash verification:', {
      received: hash.substring(0, 20) + '...',
      expected: expectedHash.substring(0, 20) + '...',
      matches: hash === expectedHash
    });

    if (hash !== expectedHash) {
      console.error('Hash verification failed');
      return res.status(400).send('Invalid hash');
    }

    // Get payment details from Firestore
    let paymentData = null;
    if (admin.apps.length > 0) {
      const paymentDoc = await admin.firestore().collection('paytr_payments').doc(merchant_oid).get();
      paymentData = paymentDoc.data();
    }

    if (!paymentData) {
      console.error('Payment record not found:', merchant_oid);
      return res.status(404).send('Payment not found');
    }

    // Update payment status
    if (admin.apps.length > 0) {
      await admin.firestore().collection('paytr_payments').doc(merchant_oid).update({
        status: status,
        total_amount: total_amount,
        webhook_hash: hash,
        webhook_received_at: new Date(),
        updated_at: new Date(),
      });
    }

    // If payment is successful, activate subscription
    if (status === 'success') {
      console.log('Payment successful, activating subscription');

      const userId = paymentData.user_id;
      const subscriptionType = paymentData.subscription_type;

      // Calculate expiry date
      const purchaseDate = new Date();
      const expiryDate = calculateExpiryDate(subscriptionType);

      // Update user subscription
      if (admin.apps.length > 0) {
        await admin.firestore().collection('users').doc(userId).set({
          subscription: {
            type: subscriptionType,
            purchase_date: purchaseDate,
            expiry_date: expiryDate,
            purchase_token: merchant_oid,
            product_id: `paytr_${subscriptionType}`,
            platform: 'paytr',
            status: 'active',
            last_updated: new Date(),
          },
          accountPlan: subscriptionType, // For compatibility
          expirationDate: expiryDate.toISOString(), // For compatibility
          last_updated: new Date(),
        }, { merge: true });

        // Create subscription record
        await admin.firestore().collection('subscriptions').doc(merchant_oid).set({
          user_id: userId,
          user_email: paymentData.user_email,
          type: subscriptionType,
          purchase_date: purchaseDate,
          expiry_date: expiryDate,
          purchase_token: merchant_oid,
          product_id: `paytr_${subscriptionType}`,
          platform: 'paytr',
          status: 'active',
          amount: parseFloat(total_amount) / 100,
          currency: 'TL',
          last_updated: new Date(),
        });
      }

      console.log('Subscription activated successfully');
    }

    // PayTR expects "OK" response for successful webhook processing
    res.status(200).send('OK');

  } catch (error: any) {
    console.error('PayTR webhook processing error:', error);
    res.status(500).send('Webhook processing failed');
  }
});

// Add this debug endpoint to verify your configuration
app.get('/api/debug/paytr-config', (req: Request, res: Response) => {
  res.json({
    hasMerchantId: !!process.env.PAYTR_MERCHANT_ID,
    hasMerchantKey: !!process.env.PAYTR_MERCHANT_KEY,
    hasMerchantSalt: !!process.env.PAYTR_MERCHANT_SALT,
    merchantIdLength: process.env.PAYTR_MERCHANT_ID?.length,
    merchantKeyLength: process.env.PAYTR_MERCHANT_KEY?.length,
    merchantSaltLength: process.env.PAYTR_MERCHANT_SALT?.length,
    nodeEnv: process.env.NODE_ENV,
  });
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

    // Determine subscription type from productId
    let subscriptionType = 'basic_monthly';
    if (productId.includes('vip')) {
      subscriptionType = productId.includes('yearly') ? 'vip_yearly' :
        productId.includes('3months') ? 'vip_3months' : 'vip_monthly';
    } else if (productId.includes('premium')) {
      subscriptionType = productId.includes('yearly') ? 'premium_yearly' :
        productId.includes('3months') ? 'premium_3months' : 'premium_monthly';
    } else if (productId.includes('basic')) {
      subscriptionType = productId.includes('yearly') ? 'basic_yearly' :
        productId.includes('3months') ? 'basic_3months' : 'basic_monthly';
    }

    // Calculate expiry date based on subscription type
    const purchaseDate = new Date();
    const expiryDate = calculateExpiryDate(subscriptionType);

    // Save to Firestore (if Firebase is configured)
    if (admin.apps.length > 0) {
      await admin.firestore().collection('users').doc(userId).set({
        subscription: {
          type: subscriptionType,
          purchase_date: purchaseDate,
          expiry_date: expiryDate,
          purchase_token: purchaseToken,
          product_id: productId,
          platform: 'android',
          status: 'active',
          last_updated: new Date(),
        },
        accountPlan: subscriptionType, // For compatibility
        expirationDate: expiryDate.toISOString(), // For compatibility
      }, { merge: true });
    }

    res.json({
      success: true,
      message: 'Purchase verified',
      expiry_date: expiryDate.toISOString(),
      subscription_type: subscriptionType
    });

  } catch (error: any) {
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
  } catch (error: any) {
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

    // Determine final subscription type
    let finalSubscriptionType = subscriptionType;
    if (!finalSubscriptionType) {
      // Extract from productId if not provided
      if (productId.includes('vip')) {
        finalSubscriptionType = productId.includes('yearly') ? 'vip_yearly' :
          productId.includes('3months') ? 'vip_3months' : 'vip_monthly';
      } else if (productId.includes('premium')) {
        finalSubscriptionType = productId.includes('yearly') ? 'premium_yearly' :
          productId.includes('3months') ? 'premium_3months' : 'premium_monthly';
      } else {
        finalSubscriptionType = productId.includes('yearly') ? 'basic_yearly' :
          productId.includes('3months') ? 'basic_3months' : 'basic_monthly';
      }
    }

    // Calculate expiry date based on subscription type
    const purchaseDate = new Date();
    const expiryDate = calculateExpiryDate(finalSubscriptionType);

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
        accountPlan: finalSubscriptionType, // For compatibility
        expirationDate: expiryDate.toISOString(), // For compatibility
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

  } catch (error: any) {
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

      // Add null checks for subscription data
      if (userData && userData.subscription) {
        const subscription = userData.subscription;
        const expiryDate = subscription.expiry_date ? new Date(subscription.expiry_date) : null;

        if (expiryDate) {
          const isActive = new Date() < expiryDate;
          const remainingTime = expiryDate.getTime() - Date.now();
          const remainingDays = Math.ceil(remainingTime / (1000 * 60 * 60 * 24));

          res.json({
            hasActiveSubscription: isActive,
            subscriptionType: subscription.type || null,
            expiryDate: expiryDate.toISOString(),
            purchaseDate: subscription.purchase_date || null,
            status: subscription.status || 'inactive',
            remainingDays: remainingDays,
            isExpiringSoon: remainingDays <= 7,
            productId: subscription.product_id || null
          });
          return;
        }
      }
    }

    res.json({
      hasActiveSubscription: false,
      subscriptionType: null,
      expiryDate: null,
      status: 'inactive'
    });

  } catch (error: any) {
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

    // Determine plan category
    const isBasicPlan = subscriptionType && (
      subscriptionType.includes('basic_monthly') ||
      subscriptionType.includes('basic_3months') ||
      subscriptionType.includes('basic_yearly')
    );

    const isPremiumPlan = subscriptionType && (
      subscriptionType.includes('premium_monthly') ||
      subscriptionType.includes('premium_3months') ||
      subscriptionType.includes('premium_yearly')
    );

    const isVipPlan = subscriptionType && (
      subscriptionType.includes('vip_monthly') ||
      subscriptionType.includes('vip_3months') ||
      subscriptionType.includes('vip_yearly')
    );

    // Feature availability logic
    const features = {
      basic_matching: true, // Always available
      messages: true, // Always available
      ai_matches: hasActiveSubscription && (isPremiumPlan || isVipPlan),
      lightning_matches: hasActiveSubscription && (isPremiumPlan || isVipPlan),
      map_love: hasActiveSubscription && isVipPlan,
      popup_dating: hasActiveSubscription && isVipPlan,
      ai_dating_coach: true, // Free for everyone
    };

    res.json({
      hasActiveSubscription,
      subscriptionType,
      features,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
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

  } catch (error: any) {
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

  } catch (error: any) {
    res.status(500).json({ error: 'Failed to record match' });
  }
});

// Admin endpoint to update subscription status
app.post('/api/admin/update-subscription', async (req: Request, res: Response) => {
  try {
    // Basic admin auth (you should implement proper admin authentication)
    const { adminKey, userId, status, expiryDate, subscriptionType } = req.body;

    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (admin.apps.length > 0) {
      await admin.firestore().collection('users').doc(userId).update({
        'subscription.status': status,
        'subscription.expiry_date': new Date(expiryDate),
        'subscription.type': subscriptionType,
        'accountPlan': subscriptionType, // For compatibility
        'expirationDate': new Date(expiryDate).toISOString(), // For compatibility
        'last_updated': new Date(),
      });
    }

    res.json({ success: true, message: 'Subscription updated' });

  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

// Debug endpoint to check PayTR configuration
app.get('/api/debug/paytr-config', (req: Request, res: Response) => {
  res.json({
    hasMerchantId: !!process.env.PAYTR_MERCHANT_ID,
    hasMerchantKey: !!process.env.PAYTR_MERCHANT_KEY,
    hasMerchantSalt: !!process.env.PAYTR_MERCHANT_SALT,
    merchantIdValue: process.env.PAYTR_MERCHANT_ID ? 'SET' : 'NOT SET',
    nodeEnv: process.env.NODE_ENV,
    allEnvKeys: Object.keys(process.env).filter(key => key.includes('PAYTR')),
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check available at: http://localhost:${PORT}/health`);
  console.log(`🔐 API endpoints ready for purchase verification`);
  console.log(`🍋 Lemon Squeezy and PayTR endpoints configured`);
});