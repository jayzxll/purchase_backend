import crypto from 'crypto';

// Param Authentication Class (based on their PHP documentation)
class ParamAuth {
  private clientCode: string;
  private clientUsername: string;
  private clientPassword: string;
  private data: string;

  constructor(data: string, clientCode: string, clientUsername: string, clientPassword: string) {
    this.data = data;
    this.clientCode = clientCode;
    this.clientUsername = clientUsername;
    this.clientPassword = clientPassword;
  }

  // Generate authentication hash similar to PHP's GeneralClass
  generateAuthHash(): string {
    // This follows Param's typical hash generation pattern
    // Adjust the concatenation order based on their specific requirements
    const hashString = `${this.clientCode}${this.clientUsername}${this.clientPassword}${this.data}`;
    return crypto.createHash('sha256').update(hashString).digest('hex').toUpperCase();
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
  generateAuthenticatedRequest(requestData: any): any {
    const authHash = this.generateAuthHash();
    
    return {
      G: this.getAuthObject(),
      Data: this.data,
      Islem_Hash: authHash,
      ...requestData
    };
  }
}

// Helper function to create Param authentication
export function createParamAuth(requestData: any): ParamAuth {
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

  if (!clientCode || !clientUsername || !clientPassword) {
    throw new Error('Param authentication credentials are missing');
  }

  // Convert request data to string for hash generation
  const dataString = typeof requestData === 'string' ? 
    requestData : 
    JSON.stringify(requestData);

  return new ParamAuth(dataString, clientCode, clientUsername, clientPassword);
}

// Enhanced Param payment request structure
export interface ParamAuthenticatedRequest {
  G: {
    CLIENT_CODE: string;
    CLIENT_USERNAME: string;
    CLIENT_PASSWORD: string;
  };
  Data: string;
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