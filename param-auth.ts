import axios from 'axios';
import crypto from 'crypto';

// Define interfaces for better type safety
interface ParamAuthConfig {
  clientCode: string;
  clientUsername: string;
  clientPassword: string;
  terminalNo: string;
  guid: string;
  baseUrl: string;
}

interface ParamPaymentData {
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
}

// Param Authentication Class with SOAP-based SHA2B64 hash generation
class ParamAuth {
  private clientCode: string;
  private clientUsername: string;
  private clientPassword: string;
  private terminalNo: string;
  private guid: string;
  private baseUrl: string;

  constructor(config: ParamAuthConfig) {
    this.clientCode = config.clientCode;
    this.clientUsername = config.clientUsername;
    this.clientPassword = config.clientPassword;
    this.terminalNo = config.terminalNo;
    this.guid = config.guid;
    this.baseUrl = config.baseUrl;
  }

  // Generate authentication hash using Param's SHA2B64 SOAP method
  async generateAuthHash(paymentData: ParamPaymentData): Promise<string> {
    try {
      console.log('Generating hash using Param SOAP service...');
      
      // ✅ CORRECT HASH STRING ORDER FOR PARAM
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
        this.clientPassword
      ].join('');

      console.log('Hash input string for SOAP:', hashString);

      // ✅ CORRECT SOAP REQUEST FORMAT FOR PARAM
      const soapRequest = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" 
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
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
          'User-Agent': 'ErosAI/1.0',
          'Accept': 'text/xml'
        },
        timeout: 30000,
        responseType: 'text'
      });

      console.log('SOAP Response status:', response.status);
      
      // ✅ FIXED: Proper type handling for response data
      const responseData = response.data as string;
      console.log('SOAP Response data:', responseData);
      
      // ✅ FIXED: Proper XML parsing
      const hashMatch = responseData.match(/<SHA2B64Result>(.*?)<\/SHA2B64Result>/);
      if (hashMatch && hashMatch[1]) {
        const hash = hashMatch[1].trim();
        console.log('Generated hash from Param:', hash);
        return hash;
      } else {
        console.error('SOAP Response could not parse hash:', responseData);
        throw new Error('Hash generation failed - no SHA2B64Result in response');
      }
    } catch (error: any) {
      console.error('SOAP hash generation error:', error.message);
      if (error.response) {
        console.error('SOAP Error response status:', error.response.status);
        console.error('SOAP Error response data:', error.response.data);
      }
      throw new Error('SOAP hash generation failed: ' + error.message);
    }
  }

  // ✅ ALTERNATIVE: Use Param's direct HTTP endpoint
  async generateAuthHashDirect(paymentData: ParamPaymentData): Promise<string> {
    try {
      console.log('Trying direct HTTP endpoint for hash generation...');
      
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
        this.clientPassword
      ].join('');

      // Try direct HTTP POST
      const formData = new URLSearchParams();
      formData.append('Data', hashString);

      const response = await axios.post(this.baseUrl, formData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'ErosAI/1.0'
        },
        timeout: 30000,
        responseType: 'text'
      });

      const responseData = response.data as string;
      console.log('Direct hash generation response:', responseData);
      
      if (responseData) {
        return responseData.trim();
      }
      
      throw new Error('Empty response from direct endpoint');
      
    } catch (error: any) {
      console.error('Direct hash generation failed:', error.message);
      throw error;
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
  generateAuthHashLocal(paymentData: ParamPaymentData): string {
    console.log('Using local hash generation (fallback)');
    
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
      this.clientPassword
    ].join('');

    console.log('Local hash input:', hashString);
    
    // SHA256 hash followed by Base64 encoding
    const hash = crypto.createHash('sha256').update(hashString, 'utf8').digest('hex');
    const base64Hash = Buffer.from(hash, 'utf8').toString('base64');
    
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
  async generateAuthenticatedRequest(paymentData: ParamPaymentData): Promise<any> {
    let authHash: string;
    
    try {
      // First try SOAP
      authHash = await this.generateAuthHash(paymentData);
    } catch (soapError) {
      console.warn('SOAP hash failed, trying direct method...');
      try {
        // Then try direct HTTP
        authHash = await this.generateAuthHashDirect(paymentData);
      } catch (directError) {
        console.warn('Direct hash failed, falling back to local generation');
        // Finally use local fallback
        authHash = this.generateAuthHashLocal(paymentData);
      }
    }
    
    return {
      G: this.getAuthObject(),
      Islem_Hash: authHash,
      ...paymentData
    };
  }
}

// ✅ FIXED: Proper createParamAuth function with explicit return type
export function createParamAuth(): ParamAuth {
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
    const missingVars = {
      clientCode: !clientCode,
      clientUsername: !clientUsername,
      clientPassword: !clientPassword,
      terminalNo: !terminalNo,
      guid: !guid,
      baseUrl: !baseUrl
    };
    console.error('Missing Param credentials:', missingVars);
    throw new Error('Param authentication credentials are missing');
  }

  return new ParamAuth({
    clientCode: clientCode!,
    clientUsername: clientUsername!,
    clientPassword: clientPassword!,
    terminalNo: terminalNo!,
    guid: guid!,
    baseUrl: baseUrl!
  });
}

// Export types and class
export { ParamAuth };
export type { ParamPaymentData, ParamAuthConfig };