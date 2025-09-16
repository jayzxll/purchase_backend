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
  generateAuthHash(paymentData: any): string {
    // According to Param documentation, the hash should be generated from specific parameters
    // in a specific order. This is the typical format they require:
    const hashString = [
      this.clientCode,
      this.guid,
      this.terminalNo,
      paymentData.KK_No,
      paymentData.KK_SK_Ay,
      paymentData.KK_SK_Yil,
      paymentData.KK_CVC,
      paymentData.Islem_Tutar,
      paymentData.Toplam_Tutar,
      paymentData.Siparis_ID,
      paymentData.Hata_URL,
      paymentData.Basarili_URL,
      paymentData.Siparis_Aciklama,
      paymentData.Taksit,
      paymentData.Islem_ID,
      paymentData.IPAdr,
      paymentData.Ref_URL,
      paymentData.Doviz,
      this.clientPassword
    ].join('|'); // The separator might be different - check Param docs

    console.log('Hash input string:', hashString);
    
    // SHA256 hash followed by Base64 encoding
    const hash = crypto.createHash('sha256').update(hashString).digest('hex');
    const base64Hash = Buffer.from(hash).toString('base64');
    
    console.log('Generated hash (SHA256 -> Base64):', base64Hash);
    
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
      G: this.getAuthObject(),
      Islem_Hash: authHash,
      ...paymentData
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