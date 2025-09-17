import express from 'express';
import { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as admin from 'firebase-admin';
import { config } from 'dotenv';
import crypto from 'crypto';
import axios from 'axios';
import { createParamAuth, ParamAuth } from './param-auth';

// Load environment variables
config();

// Define custom interface that extends Express Request
interface CustomRequest extends Request {
  user?: any;
}

interface ParamApiResponse {
  Sonuc?: number | string;
  Sonuc_Aciklama?: string;
  Redirect_URL?: string;
  Payment_URL?: string;
  Islem_ID?: string;
  Ref_ID?: string;
  Error_Message?: string;
  Mesaj?: string;
  [key: string]: any; // For any additional properties
}

// Define interfaces for Param payment requests
// Define interfaces for Param payment requests
interface ParamPaymentRequest {
  SanalPOS_ID: string;
  Doviz: string;
  GUID: string;
  KK_Sahibi: string;
  KK_No: string;
  KK_SK_Ay: string;
  KK_SK_Yil: string;
  KK_CVC: string;
  KK_Sahibi_GSM?: string;
  Hata_URL: string;
  Basarili_URL: string;
  Siparis_ID: string;
  Siparis_Aciklama: string;
  Taksit: string;
  Islem_Tutar: string;
  Toplam_Tutar: string;
  Islem_ID: string;
  IPAdr: string;
  Ref_URL: string;
  CLIENT_CODE?: string;
  CLIENT_USERNAME?: string;
  CLIENT_PASSWORD?: string;
  Islem_Hash?: string;
  [key: string]: any; // For any additional properties
}

interface ParamVerificationRequest {
  apiKey: string;
  transactionId: string;
  signature?: string;
}

// Define Lemon Squeezy response interface
interface LemonSqueezyResponse {
  data: {
    attributes: {
      url: string;
    };
  };
}

const app = express();
const PORT = process.env.PORT || 3000;

// Lemon Squeezy configuration
const lemonSqueezyApiKey = process.env.LEMON_SQUEEZY_API_KEY || '';
const lemonSqueezyStoreId = process.env.LEMON_SQUEEZY_STORE_ID || '';

// Param configuration
const paramTerminalNo = process.env.PARAM_TERMINAL_NO || '';
const paramClientUsername = process.env.PARAM_CLIENT_USERNAME || '';
const paramClientPassword = process.env.PARAM_CLIENT_PASSWORD || '';
const paramGuidKey = process.env.PARAM_GUID_KEY || '';
const paramBaseUrl = process.env.PARAM_BASE_URL || 'https://test-dmz.param.com.tr:4443/turkpos.ws/service_turkpos_prod.asmx';

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

// Create Param payment (updated to match proper API structure)
// Enhanced validation function for Param payment requests
function validateParamPaymentRequest(requestData: any): { isValid: boolean; error?: string } {
  const {
    subscriptionType,
    userEmail,
    userName,
    cardHolderName,
    cardNumber,
    cardExpMonth,
    cardExpYear,
    cardCVC,
    cardHolderPhone
  } = requestData;

  // Check if card holder name is provided and not empty
  if (!cardHolderName || cardHolderName.trim().length === 0) {
    return { isValid: false, error: 'Kart üzerinde yazan ad soyad boş geçilemez' };
  }

  // Check card number - remove spaces and validate length
  const cleanCardNumber = cardNumber ? cardNumber.replace(/\s/g, '') : '';
  if (!cardNumber || cleanCardNumber.length !== 16) {
    return { isValid: false, error: 'Kart numaranızı kontrol ediniz' };
  }

  // Validate card number is numeric
  if (!/^\d{16}$/.test(cleanCardNumber)) {
    return { isValid: false, error: 'Kart numarası sadece rakam içermelidir' };
  }

  // Check expiry month - must be 2 digits
  const expMonth = cardExpMonth ? cardExpMonth.toString().trim() : '';
  if (!cardExpMonth || expMonth.length !== 2) {
    return { isValid: false, error: 'Kartınızın son kullanım ayını kontrol ediniz' };
  }

  // Validate month is between 01-12
  const monthNum = parseInt(expMonth);
  if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
    return { isValid: false, error: 'Geçersiz son kullanım ayı (01-12 arası olmalıdır)' };
  }

  // Check expiry year - must be 2 digits
  const expYear = cardExpYear ? cardExpYear.toString().trim() : '';
  if (!cardExpYear || expYear.length !== 2) {
    return { isValid: false, error: 'Kartınızın son kullanım yılını kontrol ediniz' };
  }

  // Validate year is numeric and not in the past
  const yearNum = parseInt(expYear);
  const currentYear = new Date().getFullYear() % 100; // Get last 2 digits of current year
  if (isNaN(yearNum) || yearNum < currentYear) {
    return { isValid: false, error: 'Kartınızın son kullanım tarihi geçmiş olamaz' };
  }

  // Check if card is expired (more detailed check)
  const currentMonth = new Date().getMonth() + 1; // getMonth() returns 0-11
  const currentYearFull = new Date().getFullYear();
  const expYearFull = 2000 + yearNum; // Convert 2-digit to 4-digit year

  if (expYearFull < currentYearFull ||
    (expYearFull === currentYearFull && monthNum < currentMonth)) {
    return { isValid: false, error: 'Kartınızın son kullanım tarihi geçmiş' };
  }

  // Check CVC - must be 3 digits
  const cvc = cardCVC ? cardCVC.toString().trim() : '';
  if (!cardCVC || cvc.length !== 3) {
    return { isValid: false, error: 'Kartınızın güvenlik kodunu kontrol ediniz' };
  }

  // Validate CVC is numeric
  if (!/^\d{3}$/.test(cvc)) {
    return { isValid: false, error: 'Güvenlik kodu 3 haneli rakam olmalıdır' };
  }

  // Check subscription type
  if (!subscriptionType || subscriptionType.trim().length === 0) {
    return { isValid: false, error: 'Ödeme tipini seçiniz' };
  }

  // Validate subscription type against allowed types
  const validSubscriptionTypes = [
    'basic_monthly', 'basic_3months', 'basic_yearly',
    'premium_monthly', 'premium_3months', 'premium_yearly',
    'vip_monthly', 'vip_3months', 'vip_yearly'
  ];

  if (!validSubscriptionTypes.includes(subscriptionType)) {
    return { isValid: false, error: 'Geçersiz abonelik tipi seçildi' };
  }

  // Check payment amount
  const amount = getParamPrice(subscriptionType);
  if (!amount || amount <= 0) {
    return { isValid: false, error: 'Ödeme tutarınız hatalı' };
  }

  // Optional: Validate email format if provided
  if (userEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
    return { isValid: false, error: 'Geçersiz email formatı' };
  }

  // Optional: Validate phone number format if provided
  if (cardHolderPhone && cardHolderPhone.trim().length > 0) {
    const cleanPhone = cardHolderPhone.replace(/\D/g, ''); // Remove non-digits
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return { isValid: false, error: 'Geçersiz telefon numarası formatı' };
    }
  }

  return { isValid: true };
}

// Add this endpoint to your index.ts
app.get('/api/test-param-connectivity', async (req: Request, res: Response) => {
  try {
    const testUrl = 'https://posweb.param.com.tr';

    console.log('Testing connectivity to:', testUrl);

    const response = await axios.get(testUrl, {
      timeout: 5000,

    });

    res.json({
      success: true,
      status: response.status,
      statusText: response.statusText,
      canConnect: response.status > 0
    });

  } catch (error: any) {
    res.json({
      success: false,
      error: error.message,
      code: error.code,
      canConnect: false
    });
  }
});

// Enhanced Create Param payment endpoint with comprehensive validation
app.post('/api/param/create-payment', authMiddleware, async (req: CustomRequest, res: Response) => {
  console.log('=== Param Payment Creation Started ===');

  try {
    const {
      subscriptionType,
      userEmail,
      userName,
      cardHolderName,
      cardNumber,
      cardExpMonth,
      cardExpYear,
      cardCVC,
      cardHolderPhone
    } = req.body;

    const userId = req.user.uid;

    // Comprehensive validation
    const validation = validateParamPaymentRequest(req.body);
    if (!validation.isValid) {
      console.error('Validation failed:', validation.error);
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    // Get Param credentials from environment
    const developmentMode = process.env.PARAM_DEVELOPMENT_MODE === 'true';
    const clientCode = developmentMode ? process.env.PARAM_CLIENT_CODE : process.env.PARAM_PROD_CLIENT_CODE;
    const clientUsername = developmentMode ? process.env.PARAM_CLIENT_USERNAME : process.env.PARAM_PROD_CLIENT_USERNAME;
    const clientPassword = developmentMode ? process.env.PARAM_CLIENT_PASSWORD : process.env.PARAM_PROD_CLIENT_PASSWORD;
    const terminalNo = developmentMode ? process.env.PARAM_TERMINAL_NO : process.env.PARAM_PROD_TERMINAL_NO;
    const guid = developmentMode ? process.env.PARAM_GUID : process.env.PARAM_PROD_GUID;
    const baseUrl = developmentMode ? process.env.PARAM_BASE_URL : process.env.PARAM_PROD_BASE_URL;

    // Validate Param configuration
    if (!clientCode || !clientUsername || !clientPassword || !terminalNo || !guid || !baseUrl) {
      console.error('Param configuration missing:', {
        hasClientCode: developmentMode ? !!process.env.PARAM_CLIENT_CODE : !!process.env.PARAM_PROD_CLIENT_CODE,
        hasClientUsername: developmentMode ? !!process.env.PARAM_CLIENT_USERNAME : !!process.env.PARAM_PROD_CLIENT_USERNAME,
        hasClientPassword: developmentMode ? !!process.env.PARAM_CLIENT_PASSWORD : !!process.env.PARAM_PROD_CLIENT_PASSWORD,
        hasTerminalNo: developmentMode ? !!process.env.PARAM_TERMINAL_NO : !!process.env.PARAM_PROD_TERMINAL_NO,
        hasGuid: developmentMode ? !!process.env.PARAM_GUID : !!process.env.PARAM_PROD_GUID,
        hasBaseUrl: developmentMode ? !!process.env.PARAM_BASE_URL : !!process.env.PARAM_PROD_BASE_URL
      });
      return res.status(500).json({ error: 'Ödeme sistemi yapılandırması eksik' });
    }

    // Get price
    const amount = getParamPrice(subscriptionType);

    // Generate unique transaction ID
    const transactionId = `TRX${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

    // ✅ FIXED: Prepare payment data in the CORRECT format for Param API
    // The payment data for hash generation should NOT include the G object
    const paymentDataForHash = {
      SanalPOS_ID: terminalNo,
      Doviz: 'TRY',
      GUID: guid,
      KK_Sahibi: cardHolderName.trim(),
      KK_No: cardNumber.replace(/\s/g, ''),
      KK_SK_Ay: cardExpMonth.toString().padStart(2, '0'),
      KK_SK_Yil: cardExpYear.toString().slice(-2),
      KK_CVC: cardCVC.toString(),
      KK_Sahibi_GSM: cardHolderPhone ? cardHolderPhone.replace(/\D/g, '') : '',
      Hata_URL: req.body.errorUrl || `${process.env.BASE_URL}/api/param/callback?status=error`,
      Basarili_URL: req.body.successUrl || `${process.env.BASE_URL}/api/param/callback?status=success`,
      Siparis_ID: req.body.orderID || transactionId,
      Siparis_Aciklama: req.body.orderExplanation || getSubscriptionDisplayName(subscriptionType),
      Taksit: req.body.installment || '1', // ← ADD INSTALLMENT
      Islem_Tutar: amount.toFixed(2),
      Toplam_Tutar: amount.toFixed(2),
      Islem_ID: transactionId,
      IPAdr: req.ip || req.connection.remoteAddress || '127.0.0.1',
      Ref_URL: req.body.paymentUrl || process.env.BASE_URL || 'https://www.erosaidating.com',
    };

    console.log('Payment data prepared for hash:', {
      transactionId,
      amount,
      subscriptionType,
      cardHolder: cardHolderName,
      terminalNo,
      guid
    });

    try {
      // ✅ FIXED: Generate hash using ONLY the payment data (without G object)
      const paramAuth = new ParamAuth({ clientCode, clientUsername, clientPassword, terminalNo, guid, baseUrl });
      const hash = await paramAuth.generateAuthHash(paymentDataForHash);

      // ✅ FIXED: Create the final authenticated request with proper structure
      const authenticatedRequest = {
        G: {
          CLIENT_CODE: clientCode,
          CLIENT_USERNAME: clientUsername,
          CLIENT_PASSWORD: clientPassword
        },
        Islem_Hash: hash,
        // Include all the payment data fields
        ...paymentDataForHash
      };

      console.log('Making Param API request to:', baseUrl);
      console.log('Authenticated request structure:', JSON.stringify({
        hasG: !!authenticatedRequest.G,
        hasHash: !!authenticatedRequest.Islem_Hash,
        siparis_id: authenticatedRequest.Siparis_ID,
        G: authenticatedRequest.G ? {
          CLIENT_CODE: authenticatedRequest.G.CLIENT_CODE ? 'SET' : 'MISSING',
          CLIENT_USERNAME: authenticatedRequest.G.CLIENT_USERNAME ? 'SET' : 'MISSING',
          CLIENT_PASSWORD: authenticatedRequest.G.CLIENT_PASSWORD ? 'SET' : 'MISSING'
        } : 'MISSING'
      }, null, 2));

      // ✅ FIXED: Make request to Param API with proper headers
      const response = await axios.post(baseUrl, authenticatedRequest, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'ErosAI/1.0'
        },
        timeout: 30000
      });

      console.log('Param API response status:', response.status);
      console.log('Param API response data:', response.data);

      const responseData = response.data as ParamApiResponse;

      // Process response based on Param's actual response format
      if (responseData && (responseData.Sonuc === '1' || responseData.Sonuc === 1)) {
        // Success case

        // Save payment record
        if (admin.apps.length > 0) {
          await admin.firestore().collection('param_payments').doc(transactionId).set({
            user_id: userId,
            user_email: userEmail,
            user_name: userName,
            card_holder_name: cardHolderName.trim(),
            subscription_type: subscriptionType,
            amount: amount,
            currency: 'TRY',
            transaction_id: transactionId,
            param_ref_id: responseData.Islem_ID || responseData.Ref_ID || '',
            status: 'pending',
            created_at: new Date(),
            payment_request: authenticatedRequest,
            payment_response: responseData
          });
        }

        res.json({
          success: true,
          paymentUrl: responseData.Redirect_URL || responseData.Payment_URL || '',
          transactionId: transactionId,
          paramRefId: responseData.Islem_ID || responseData.Ref_ID || '',
          message: responseData.Sonuc_Aciklama || 'Ödeme başlatıldı'
        });
      } else {
        // Error case
        const errorMessage = responseData.Sonuc_Aciklama ||
          responseData.Error_Message ||
          responseData.Mesaj ||
          `Ödeme işlemi başlatılamadı (Sonuc: ${responseData.Sonuc})`;

        console.error('Param payment failed:', errorMessage);

        // Save failed attempt
        if (admin.apps.length > 0) {
          await admin.firestore().collection('param_payments').doc(transactionId).set({
            user_id: userId,
            user_email: userEmail,
            user_name: userName,
            subscription_type: subscriptionType,
            amount: amount,
            currency: 'TRY',
            transaction_id: transactionId,
            status: 'failed',
            error_message: errorMessage,
            created_at: new Date(),
            payment_request: authenticatedRequest,
            payment_response: responseData
          });
        }

        res.status(400).json({
          success: false,
          error: errorMessage,
          transactionId: transactionId
        });
      }

    } catch (authError: any) {
      console.error('Authentication creation error:', authError);
      return res.status(500).json({
        success: false,
        error: 'Kimlik doğrulama hatası: ' + authError.message
      });
    }

  } catch (error: any) {
    console.error('Param payment creation error:', error);

    let errorMessage = 'Bilinmeyen ödeme sistemi hatası';
    let statusCode = 500;

    if (error.response) {
      console.error('Param API error response:', error.response.data);
      console.error('Param API error status:', error.response.status);

      statusCode = error.response.status;

      const errorData = error.response.data as ParamApiResponse;
      errorMessage = errorData.Error_Message ||
        errorData.Sonuc_Aciklama ||
        errorData.Mesaj ||
        `İstek başarısız (Durum kodu: ${error.response.status})`;
    } else if (error.request) {
      console.error('No response received from Param API');
      errorMessage = 'Ödeme sağlayıcısından yanıt alınamadı';
    } else {
      errorMessage = error.message;
    }

    res.status(statusCode).json({
      success: false,
      error: 'Ödeme işlemi başarısız: ' + errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});



// ✅ ADD THIS - Param callback endpoint (for user redirects)
app.get('/api/param/callback', async (req: Request, res: Response) => {
  try {
    const { transactionId, status, error, userId } = req.query;

    console.log('Param callback received:', {
      transactionId,
      status,
      error,
      userId
    });

    if (!transactionId) {
      return res.status(400).json({ error: 'Transaction ID required' });
    }

    // Update payment record with callback info
    if (admin.apps.length > 0) {
      const updateData: any = {
        callback_received_at: new Date(),
        callback_status: status,
        callback_error: error
      };

      if (status === 'success') {
        updateData.status = 'user_returned_success';
      } else if (status === 'error') {
        updateData.status = 'user_returned_error';
        updateData.error_message = error;
      }

      await admin.firestore().collection('param_payments')
        .doc(transactionId as string)
        .update(updateData);
    }

    // Redirect to appropriate Flutter web page
    if (status === 'success') {
      res.redirect(`${process.env.FRONTEND_URL || 'https://www.erosaidating.com'}/payment-success?transactionId=${transactionId}&gateway=param`);
    } else {
      res.redirect(`${process.env.FRONTEND_URL || 'https://www.erosaidating.com'}/payment-error?transactionId=${transactionId}&error=${encodeURIComponent(error as string)}&gateway=param`);
    }

  } catch (error: any) {
    console.error('Param callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'https://www.erosaidating.com'}/payment-error?message=Callback processing failed`);
  }
});

// Enhanced webhook validation function
function validateParamWebhookData(webhookData: any): { isValid: boolean; error?: string } {
  // Check required fields
  if (!webhookData) {
    return { isValid: false, error: 'Webhook verisi boş' };
  }

  const transactionId = webhookData.Siparis_ID || webhookData.transactionId || webhookData.Transaction_ID;
  if (!transactionId || transactionId.trim().length === 0) {
    return { isValid: false, error: 'İşlem ID eksik' };
  }

  const status = webhookData.Islem_Sonuc || webhookData.paymentStatus || webhookData.Status;
  if (status === undefined || status === null) {
    return { isValid: false, error: 'İşlem durumu eksik' };
  }

  // Validate transaction ID format (should match our generated format)
  if (!transactionId.startsWith('TRX')) {
    console.warn('Transaction ID format unexpected:', transactionId);
  }

  return { isValid: true };
}

// Enhanced Param webhook handler with validation
app.post('/api/param/webhook', express.json(), async (req: Request, res: Response) => {
  console.log('=== Param Webhook Received ===');

  try {
    const webhookData = req.body;
    console.log('Webhook data:', JSON.stringify(webhookData, null, 2));

    // Validate webhook data
    const validation = validateParamWebhookData(webhookData);
    if (!validation.isValid) {
      console.error('Webhook validation failed:', validation.error);
      return res.status(400).json({
        error: validation.error
      });
    }

    // Extract webhook parameters
    const transactionId = webhookData.Siparis_ID || webhookData.transactionId || webhookData.Transaction_ID;
    const status = webhookData.Islem_Sonuc || webhookData.paymentStatus || webhookData.Status;
    const signature = webhookData.Imza || webhookData.signature || webhookData.Hash;
    const amount = webhookData.Tutar || webhookData.amount;
    const currency = webhookData.Para_Birimi || webhookData.currency || 'TRY';
    const paramRefId = webhookData.Islem_ID || webhookData.Ref_ID || webhookData.Reference_ID;

    console.log('Extracted webhook parameters:', {
      transactionId,
      status,
      signature: signature ? 'PROVIDED' : 'MISSING',
      amount,
      currency,
      paramRefId
    });

    // Verify signature if provided
    if (signature) {
      const isValidSignature = verifyParamWebhookSignature(webhookData, signature);
      if (!isValidSignature) {
        console.error('Invalid signature in Param webhook');
        return res.status(400).json({ error: 'Geçersiz imza' });
      }
      console.log('Signature verification successful');
    } else {
      console.warn('No signature provided in webhook, proceeding without verification');
    }

    // Get payment details from database
    const paymentDoc = await admin.firestore().collection('param_payments').doc(transactionId).get();

    if (!paymentDoc.exists) {
      console.error('Payment record not found:', transactionId);
      return res.status(404).json({ error: 'Ödeme kaydı bulunamadı' });
    }

    const paymentData = paymentDoc.data();
    console.log('Found payment record:', {
      userId: paymentData?.user_id,
      subscriptionType: paymentData?.subscription_type,
      currentStatus: paymentData?.status
    });

    // Update payment status
    const updateData: any = {
      status: status,
      webhook_received_at: new Date(),
      updated_at: new Date(),
      webhook_data: webhookData
    };

    // Add reference ID if provided
    if (paramRefId) {
      updateData.param_ref_id = paramRefId;
    }

    await admin.firestore().collection('param_payments').doc(transactionId).update(updateData);

    // If payment is successful, activate subscription
    if (status === '1' || status === 1 || status === 'Success' || status === 'success') {
      console.log('Payment successful, activating subscription');

      const userId = paymentData?.user_id;
      const subscriptionType = paymentData?.subscription_type;
      const userEmail = paymentData?.user_email;

      if (!userId || !subscriptionType) {
        console.error('Missing user data in payment record:', { userId, subscriptionType });
        return res.status(400).json({ error: 'Ödeme kaydında kullanıcı bilgileri eksik' });
      }

      // Calculate expiry date based on subscription type
      const purchaseDate = new Date();
      const expiryDate = calculateExpiryDate(subscriptionType);

      // Update user subscription
      await admin.firestore().collection('users').doc(userId).set({
        subscription: {
          type: subscriptionType,
          purchase_date: purchaseDate,
          expiry_date: expiryDate,
          purchase_token: transactionId,
          product_id: `param_${subscriptionType}`,
          platform: 'param',
          status: 'active',
          last_updated: new Date(),
        },
        accountPlan: subscriptionType,
        expirationDate: expiryDate.toISOString(),
        last_updated: new Date(),
        email: userEmail,
      }, { merge: true });

      // Create subscription record
      await admin.firestore().collection('subscriptions').doc(transactionId).set({
        user_id: userId,
        user_email: userEmail,
        type: subscriptionType,
        purchase_date: purchaseDate,
        expiry_date: expiryDate,
        purchase_token: transactionId,
        product_id: `param_${subscriptionType}`,
        platform: 'param',
        status: 'active',
        amount: paymentData?.amount || amount,
        currency: paymentData?.currency || currency,
        last_updated: new Date(),
      });

      // Update payment record with success status
      await admin.firestore().collection('param_payments').doc(transactionId).update({
        status: 'verified',
        verified_at: new Date(),
      });

      console.log('Subscription activated successfully for user:', userId);
    } else {
      console.log('Payment status indicates failure or pending:', status);

      // Update user subscription if payment failed
      const userId = paymentData?.user_id;
      if (userId) {
        await admin.firestore().collection('users').doc(userId).set({
          subscription: {
            status: 'failed',
            last_updated: new Date(),
          },
          last_updated: new Date(),
        }, { merge: true });
      }
    }

    console.log('Webhook processed successfully');
    res.status(200).json({
      success: true,
      message: 'Webhook başarıyla işlendi',
      transactionId: transactionId
    });

  } catch (error: any) {
    console.error('Param webhook processing error:', error);

    // More detailed error logging
    if (error.response) {
      console.error('Error response data:', error.response.data);
      console.error('Error response status:', error.response.status);
      console.error('Error response headers:', error.response.headers);
    } else if (error.request) {
      console.error('Error request:', error.request);
    } else {
      console.error('Error message:', error.message);
    }

    res.status(500).json({
      error: 'Webhook işlemi başarısız',
      message: error.message,
      transactionId: req.body?.Siparis_ID || req.body?.transactionId
    });
  }
});

// Updated webhook signature verification function
function verifyParamWebhookSignature(webhookData: any, signature: string): boolean {
  try {
    const developmentMode = process.env.PARAM_DEVELOPMENT_MODE === 'true';
    const clientCode = developmentMode ? process.env.PARAM_CLIENT_CODE : process.env.PARAM_PROD_CLIENT_CODE;
    const clientPassword = developmentMode ? process.env.PARAM_CLIENT_PASSWORD : process.env.PARAM_PROD_CLIENT_PASSWORD;

    if (!clientCode || !clientPassword) {
      console.error('Missing credentials for signature verification');
      return false;
    }

    // Create expected signature based on Param's requirements
    const transactionId = webhookData.Siparis_ID || webhookData.transactionId || '';
    const status = webhookData.Islem_Sonuc || webhookData.Status || '';

    // Generate expected signature (adjust based on Param's actual requirements)
    const signatureData = `${clientCode}${transactionId}${status}${clientPassword}`;
    const expectedSignature = crypto.createHash('sha256').update(signatureData).digest('hex').toUpperCase();

    return signature.toUpperCase() === expectedSignature;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

// Helper function to get price for Param
function getParamPrice(subscriptionType: string): number {
  const prices: Record<string, number> = {
    // Basic Plans
    'basic_monthly': 1.00,    // ₺1.00
    'basic_3months': 2.00,   // ₺2.00
    'basic_yearly': 9.00,    // ₺9.00

    // Premium Plans
    'premium_monthly': 3.00, // ₺3.00
    'premium_3months': 6.50, // ₺6.50
    'premium_yearly': 20.00, // ₺20.00

    // VIP Plans
    'vip_monthly': 7.50,     // ₺7.50
    'vip_3months': 15.00,    // ₺15.00
    'vip_yearly': 26.00,     // ₺26.00
  };

  return prices[subscriptionType] || 1.00;
}

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

// Param success callback endpoint
app.get('/api/param/success', async (req: Request, res: Response) => {
  try {
    const { transactionId, userId } = req.query;

    console.log('Param success callback:', { transactionId, userId });

    if (transactionId && admin.apps.length > 0) {
      await admin.firestore().collection('param_payments').doc(transactionId as string).update({
        status: 'user_returned_success',
        success_callback_at: new Date(),
      });

      // Verify payment with Param API
      await verifyParamPayment(transactionId as string, userId as string);
    }

    res.redirect(`${process.env.FRONTEND_URL || 'https://www.erosaidating.com'}/payment-success?gateway=param&transaction=${transactionId}`);

  } catch (error: any) {
    console.error('Param success callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'https://www.erosaidating.com'}/payment-error`);
  }
});

// Param fail callback endpoint
app.get('/api/param/fail', async (req: Request, res: Response) => {
  try {
    const { transactionId, userId } = req.query;

    console.log('Param fail callback:', { transactionId, userId });

    if (transactionId && admin.apps.length > 0) {
      await admin.firestore().collection('param_payments').doc(transactionId as string).update({
        status: 'user_returned_fail',
        fail_callback_at: new Date(),
      });
    }

    res.redirect(`${process.env.FRONTEND_URL || 'https://www.erosaidating.com'}/payment-failed?gateway=param&transaction=${transactionId}`);

  } catch (error: any) {
    console.error('Param fail callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'https://www.erosaidating.com'}/payment-error`);
  }
});

// Verify Param payment
// Verify Param payment
async function verifyParamPayment(transactionId: string, userId: string) {
  try {
    // Get Param credentials
    const terminalNo = process.env.PARAM_TERMINAL_NO;
    const clientPassword = process.env.PARAM_CLIENT_PASSWORD;

    if (!terminalNo || !clientPassword) {
      console.error('Param configuration missing for verification');
      return;
    }

    // Prepare verification request according to Param's API
    // This needs to be adjusted based on their actual API requirements
    const verificationRequest = {
      G: {
        CLIENT_CODE: terminalNo,
        CLIENT_PASSWORD: clientPassword,
        // Add other required authentication fields
      },
      Siparis_ID: transactionId,
      // Add other required verification fields
    };

    // Make request to Param API verification endpoint
    const response = await axios.post(
      `${paramBaseUrl}/payment/query`, // Adjust endpoint based on Param's API
      verificationRequest,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      }
    );

    const responseData = response.data as any;

    // Process verification response based on Param's API
    if (responseData && (responseData.Sonuc === '1' || responseData.Sonuc === 1)) {
      // Payment verified successfully

      // Get payment details
      const paymentDoc = await admin.firestore().collection('param_payments').doc(transactionId).get();
      const paymentData = paymentDoc.data();

      if (paymentData) {
        const subscriptionType = paymentData.subscription_type;

        // Calculate expiry date
        const purchaseDate = new Date();
        const expiryDate = calculateExpiryDate(subscriptionType);

        // Update user subscription
        await admin.firestore().collection('users').doc(userId).set({
          subscription: {
            type: subscriptionType,
            purchase_date: purchaseDate,
            expiry_date: expiryDate,
            purchase_token: transactionId,
            product_id: `param_${subscriptionType}`,
            platform: 'param',
            status: 'active',
            last_updated: new Date(),
          },
          accountPlan: subscriptionType,
          expirationDate: expiryDate.toISOString(),
          last_updated: new Date(),
        }, { merge: true });

        // Create subscription record
        await admin.firestore().collection('subscriptions').doc(transactionId).set({
          user_id: userId,
          user_email: paymentData.user_email,
          type: subscriptionType,
          purchase_date: purchaseDate,
          expiry_date: expiryDate,
          purchase_token: transactionId,
          product_id: `param_${subscriptionType}`,
          platform: 'param',
          status: 'active',
          amount: paymentData.amount,
          currency: 'TRY',
          last_updated: new Date(),
        });

        // Update payment record
        await admin.firestore().collection('param_payments').doc(transactionId).update({
          status: 'verified',
          verified_at: new Date(),
        });

        console.log('Param payment verified successfully');
      }
    } else {
      console.error('Param payment verification failed:', responseData);
    }
  } catch (error: any) {
    console.error('Param payment verification error:', error);
  }
}


// Debug endpoint to check all environment variables
app.get('/api/debug/env', (req: Request, res: Response) => {
  // Filter out sensitive data for security
  const envVars = Object.keys(process.env)
    .filter(key => !key.toLowerCase().includes('password') &&
      !key.toLowerCase().includes('secret') &&
      !key.toLowerCase().includes('key') &&
      !key.toLowerCase().includes('private'))
    .reduce((obj, key) => {
      const value = process.env[key];
      // Only add to object if value is not undefined
      if (value !== undefined) {
        obj[key] = value;
      }
      return obj;
    }, {} as Record<string, string>);

  res.json({
    allEnvKeys: Object.keys(process.env),
    filteredEnv: envVars,
    hasParamTerminalNo: !!process.env.PARAM_TERMINAL_NO,
    hasParamClientUsername: !!process.env.PARAM_CLIENT_USERNAME,
    hasParamClientPassword: !!process.env.PARAM_CLIENT_PASSWORD,
    hasParamGuidKey: !!process.env.PARAM_GUID_KEY,
    nodeEnv: process.env.NODE_ENV || 'not set',
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

// Debug endpoint to check Param configuration
app.get('/api/debug/param-config', (req: Request, res: Response) => {
  res.json({
    hasTerminalNo: !!process.env.PARAM_TERMINAL_NO,
    hasClientUsername: !!process.env.PARAM_CLIENT_USERNAME,
    hasClientPassword: !!process.env.PARAM_CLIENT_PASSWORD,
    hasGuidKey: !!process.env.PARAM_GUID_KEY,
    terminalNoValue: process.env.PARAM_TERMINAL_NO ? 'SET' : 'NOT SET',
    nodeEnv: process.env.NODE_ENV,
    allEnvKeys: Object.keys(process.env).filter(key => key.includes('PARAM')),
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check available at: http://localhost:${PORT}/health`);
  console.log(`🔐 API endpoints ready for purchase verification`);
  console.log(`🍋 Lemon Squeezy and Param endpoints configured`);
});