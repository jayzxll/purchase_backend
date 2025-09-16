import crypto from 'crypto';

// Param Authentication Class with correct SHA2B64 hash generation
class ParamAuth {
  private clientCode: string;
  private clientUsername: string;
  private clientPassword: string;
  private terminalNo: string;
  private guid: string;

  constructor(clientCode: string, clientUsername: string, clientPassword: string, terminalNo: string, guid: string) {
    this.clientCode = clientCode;
    this.clientUsername = clientUsername;
    this.clientPassword = clientPassword;
    this.terminalNo = terminalNo;
    this.guid = guid;
  }

  // Generate authentication hash using Param's SHA2B64 method
  // Updated hash generation with correct parameter order
  generateAuthHash(paymentData: any): string {
    // Use the EXACT same parameter order as the PHP constructor
    const hashString = [
      paymentData.SanalPOS_ID,    // virtualPosIdentifier
      paymentData.Doviz,          // currency
      paymentData.GUID,           // globalUniqueIdentifier
      paymentData.KK_Sahibi,      // cardHolderName
      paymentData.KK_No,          // cardNo
      paymentData.KK_SK_Ay,       // cardExpireMonth
      paymentData.KK_SK_Yil,      // cardExpireYear
      paymentData.KK_CVC,         // cvc
      paymentData.KK_Sahibi_GSM,  // cardHolderMobile
      paymentData.Hata_URL,       // error
      paymentData.Basarili_URL,   // success
      paymentData.Siparis_ID,     // orderId
      paymentData.Siparis_Aciklama, // orderExplanation
      paymentData.Taksit,         // installment
      paymentData.Islem_Tutar,    // transactionExpense
      paymentData.Toplam_Tutar,   // totalExpense
      paymentData.Islem_ID,       // transactionIdentifier
      paymentData.IPAdr,          // IP
      paymentData.Ref_URL,        // refererURL
      this.clientPassword         // CLIENT_PASSWORD (from auth)
    ].join('|'); // Use the same separator as Param expects

    console.log('Hash input string (in Param order):', hashString);

    // SHA256 hash followed by Base64 encoding
    const hash = crypto.createHash('sha256').update(hashString).digest('hex');
    const base64Hash = Buffer.from(hash).toString('base64');

    return base64Hash;
  }

  // Get authentication object for API requests
  getAuthObject() {
    return {
      CLIENT_CODE: this.clientCode,
      CLIENT_USERNAME: this.clientUsername,
      CLIENT_PASSWORD: this.clientPassword,
    };
  }

  // Generate complete request with auth
 generateAuthenticatedRequest(paymentData: any): any {
  const authHash = this.generateAuthHash(paymentData);
  
  return {
    G: this.getAuthObject(),  // Authentication
    Islem_Hash: authHash,     // Generated hash
    // Payment data in exact order:
    SanalPOS_ID: paymentData.SanalPOS_ID,
    Doviz: paymentData.Doviz,
    GUID: paymentData.GUID,
    KK_Sahibi: paymentData.KK_Sahibi,
    KK_No: paymentData.KK_No,
    KK_SK_Ay: paymentData.KK_SK_Ay,
    KK_SK_Yil: paymentData.KK_SK_Yil,
    KK_CVC: paymentData.KK_CVC,
    KK_Sahibi_GSM: paymentData.KK_Sahibi_GSM,
    Hata_URL: paymentData.Hata_URL,
    Basarili_URL: paymentData.Basarili_URL,
    Siparis_ID: paymentData.Siparis_ID,
    Siparis_Aciklama: paymentData.Siparis_Aciklama,
    Taksit: paymentData.Taksit,
    Islem_Tutar: paymentData.Islem_Tutar,
    Toplam_Tutar: paymentData.Toplam_Tutar,
    Islem_ID: paymentData.Islem_ID,
    IPAdr: paymentData.IPAdr,
    Ref_URL: paymentData.Ref_URL
  };
}
}

// Helper function to create Param authentication
export function createParamAuth(paymentData: any): ParamAuth {
  const developmentMode = process.env.PARAM_DEVELOPMENT_MODE === 'true';

  const clientCode = developmentMode ?
    process.env.PARAM_CLIENT_CODE :
    process.env.PARAM_PROD_CLIENT_CODE;

  const clientUsername = developmentMode ?
    process.env.PARAM_CLIENT_USERNAME :
    process.env.PARAM_PROD_CLIENT_USERNAME;

  const clientPassword = developmentMode ?
    process.env.PARAM_CLIENT_PASSWORD :
    process.env.PARAM_PROD_CLIENT_PASSWORD;

  const terminalNo = developmentMode ?
    process.env.PARAM_TERMINAL_NO :
    process.env.PARAM_PROD_TERMINAL_NO;

  const guid = developmentMode ?
    process.env.PARAM_GUID :
    process.env.PARAM_PROD_GUID;

  if (!clientCode || !clientUsername || !clientPassword || !terminalNo || !guid) {
    throw new Error('Param authentication credentials are missing');
  }

  return new ParamAuth(clientCode, clientUsername, clientPassword, terminalNo, guid);
}

// Enhanced Param payment request structure
export interface ParamAuthenticatedRequest {
  G: {
    CLIENT_CODE: string;
    CLIENT_USERNAME: string;
    CLIENT_PASSWORD: string;
  };
  Islem_Hash: string;
  // Payment specific fields
  SanalPOS_ID?: string;
  Doviz?: string;
  GUID?: string;
  KK_Sahibi?: string;
  KK_No?: string;
  KK_SK_Ay?: string;
  KK_SK_Yil?: string;
  KK_CVC?: string;
  KK_Sahibi_GSM?: string;
  Hata_URL?: string;
  Basarili_URL?: string;
  Siparis_ID?: string;
  Siparis_Aciklama?: string;
  Taksit?: string;
  Islem_Tutar?: string;
  Toplam_Tutar?: string;
  Islem_ID?: string;
  IPAdr?: string;
  Ref_URL?: string;
}

export { ParamAuth };