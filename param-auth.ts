import axios from 'axios';
import crypto from 'crypto';

// Param Authentication Class with SOAP-based SHA2B64 hash generation
class ParamAuth {
  private clientCode: string;
  private clientUsername: string;
  private clientPassword: string;
  private terminalNo: string;
  private guid: string;
  private baseUrl: string;

  constructor(clientCode: string, clientUsername: string, clientPassword: string, terminalNo: string, guid: string, baseUrl: string) {
    this.clientCode = clientCode;
    this.clientUsername = clientUsername;
    this.clientPassword = clientPassword;
    this.terminalNo = terminalNo;
    this.guid = guid;
    this.baseUrl = baseUrl;
  }

  // Generate authentication hash using Param's SHA2B64 SOAP method
  async generateAuthHash(paymentData: any): Promise<string> {
    try {
      console.log('Generating hash using Param SOAP service...');
      
      // Prepare the hash string in the exact order Param expects
      // Based on PHP documentation: CLIENT_CODE + GUID + SanalPOS_ID + KK_No + etc.
      const hashString = [
        this.clientCode,
        this.guid,
        paymentData.SanalPOS_ID,
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
      ].join('');

      console.log('Hash input string for SOAP:', hashString);

      // Call Param's SHA2B64 SOAP method
      const soapRequest = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <SHA2B64 xmlns="http://tempuri.org/">
      <Data>${this.escapeXml(hashString)}</Data>
    </SHA2B64>
  </soap:Body>
</soap:Envelope>`;

      console.log('SOAP Request to:', this.baseUrl);
      
      const response = await axios.post(this.baseUrl, soapRequest, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://tempuri.org/SHA2B64',
        'User-Agent': 'ErosAI/1.0'
      },
      timeout: 30000,
      responseType: 'text'
    }) as { data: string; status: number };

      console.log('SOAP Response status:', response.status);
      
      // Extract the hash from SOAP response
        const hashMatch = response.data.match(/<SHA2B64Result>(.*?)<\/SHA2B64Result>/);
    if (hashMatch && hashMatch[1]) {
      const hash = hashMatch[1];
      console.log('Generated hash from Param:', hash);
      return hash;
    } else {
      console.error('SOAP Response:', response.data);
      throw new Error('Hash generation failed - no SHA2B64Result in response');
    }
    } catch (error: any) {
      console.error('SOAP hash generation error:', error.message);
      if (error.response) {
        console.error('SOAP Error response:', error.response.data);
      }
      throw new Error('SOAP hash generation failed: ' + error.message);
    }
  }

  // Helper method to escape XML special characters
  private escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }

  // Fallback method: local hash generation (for testing or backup)
  generateAuthHashLocal(paymentData: any): string {
    console.log('Using local hash generation (fallback)');
    
    const hashString = [
      this.clientCode,
      this.guid,
      paymentData.SanalPOS_ID,
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
    ].join('');

    console.log('Local hash input:', hashString);
    
    // SHA256 hash followed by Base64 encoding
    const hash = crypto.createHash('sha256').update(hashString).digest('hex');
    const base64Hash = Buffer.from(hash).toString('base64');
    
    console.log('Local generated hash:', base64Hash);
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
  async generateAuthenticatedRequest(paymentData: any, useLocalHash: boolean = false): Promise<any> {
    let authHash: string;
    
    try {
      if (useLocalHash) {
        authHash = this.generateAuthHashLocal(paymentData);
      } else {
        authHash = await this.generateAuthHash(paymentData);
      }
    } catch (error) {
      console.warn('SOAP hash failed, falling back to local generation');
      authHash = this.generateAuthHashLocal(paymentData);
    }
    
    return {
      G: this.getAuthObject(),
      Islem_Hash: authHash,
      // Payment data
      SanalPOS_ID: paymentData.SanalPOS_ID,
      Doviz: paymentData.Doviz,
      GUID: paymentData.GUID,
      KK_Sahibi: paymentData.KK_Sahibi,
      KK_No: paymentData.KK_No,
      KK_SK_Ay: paymentData.KK_SK_Ay,
      KK_SK_Yil: paymentData.KK_SK_Yil,
      KK_CVC: paymentData.KK_CVC,
      KK_Sahibi_GSM: paymentData.KK_Sahibi_GSM || '',
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

  const baseUrl = developmentMode ?
    process.env.PARAM_BASE_URL :
    process.env.PARAM_PROD_BASE_URL;

  if (!clientCode || !clientUsername || !clientPassword || !terminalNo || !guid || !baseUrl) {
    console.error('Missing Param credentials:', {
      clientCode: !!clientCode,
      clientUsername: !!clientUsername,
      clientPassword: !!clientPassword,
      terminalNo: !!terminalNo,
      guid: !!guid,
      baseUrl: !!baseUrl
    });
    throw new Error('Param authentication credentials are missing');
  }

  return new ParamAuth(clientCode, clientUsername, clientPassword, terminalNo, guid, baseUrl);
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