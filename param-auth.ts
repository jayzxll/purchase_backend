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

// ✅ DOĞRU: Param Authentication Class - Dokümana Uygun
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

  // ✅ DOĞRU: Param dokümanındaki hash formatı (Sayfa 7-8)
  async generateAuthHash(paymentData: ParamPaymentData): Promise<string> {
    try {
      console.log('🔐 Generating Param hash according to documentation...');

      // ✅ DOKÜMANDA BELİRTİLEN SIRALAMA (Sayfa 7):
      // CLIENT_CODE + GUID + TerminalID + KK_No + KK_SK_Ay + KK_SK_Yil + KK_CVC + 
      // Islem_Tutar + Toplam_Tutar + Siparis_ID + Hata_URL + Basarili_URL + CLIENT_PASSWORD

      const hashData =
        this.clientCode +
        this.guid +
        this.terminalNo +
        paymentData.KK_No.replace(/\s/g, '') + // Kart numarasındaki boşlukları kaldır
        paymentData.KK_SK_Ay.padStart(2, '0') + // Ay 2 haneli olmalı
        paymentData.KK_SK_Yil.slice(-2) + // Yılın son 2 hanesi
        paymentData.KK_CVC +
        paymentData.Islem_Tutar +
        paymentData.Toplam_Tutar +
        paymentData.Siparis_ID +
        paymentData.Hata_URL +
        paymentData.Basarili_URL +
        this.clientPassword;

      console.log('Hash input length:', hashData.length);
      console.log('Hash input (first 100 chars):', hashData.substring(0, 100) + '...');

      // ✅ DOKÜMANDA BELİRTİLEN HASH METODU: SHA1 + Base64
      const hash = crypto.createHash('sha1').update(hashData, 'utf8').digest('binary');
      const base64Hash = Buffer.from(hash, 'binary').toString('base64');

      console.log('✅ Generated SHA1+Base64 hash:', base64Hash);
      return base64Hash;

    } catch (error: any) {
      console.error('❌ Hash generation error:', error.message);
      throw new Error('Hash oluşturulamadı: ' + error.message);
    }
  }

  // ✅ DOĞRU: SOAP isteği için format (Doküman Sayfa 9)
  async makeSoapRequest(action: string, requestData: any): Promise<any> {
  try {
    const soapRequest = this.buildSoapEnvelope(action, requestData);
    
    console.log('📤 SOAP Request to:', this.baseUrl);
    console.log('SOAP Action:', action);
    console.log('SOAP Request Body:', soapRequest);

    const response = await axios.post(this.baseUrl, soapRequest, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': `http://tempuri.org/ITurkPos/${action}`, // FIXED
        'User-Agent': 'ErosAI/1.0'
      },
      timeout: 30000,
      responseType: 'text'
    });

    console.log('✅ SOAP Response:', response.data);
    return this.parseSoapResponse(response.data as string, action);
  } catch (error: any) {
    console.error('SOAP request error:', error.message);
    if (error.response) {
      console.error('SOAP response status:', error.response.status);
      console.error('SOAP response data:', error.response.data);
    }
    throw error;
  }
}

  // ✅ DOĞRU: SOAP envelope oluşturma
 private buildSoapEnvelope(action: string, requestData: any): string {
  let requestBody = '';
  
  for (const [key, value] of Object.entries(requestData)) {
    if (typeof value === 'object' && value !== null) {
      // Handle nested objects like G: { CLIENT_CODE, CLIENT_USERNAME, etc. }
      requestBody += `<${key}>`;
      for (const [subKey, subValue] of Object.entries(value)) {
        requestBody += `<${subKey}>${this.escapeXml(subValue)}</${subKey}>`;
      }
      requestBody += `</${key}>`;
    } else {
      requestBody += `<${key}>${this.escapeXml(value)}</${key}>`;
    }
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" 
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <${action} xmlns="http://tempuri.org/">
      ${requestBody}
    </${action}>
  </soap:Body>
</soap:Envelope>`;
}

  // ✅ DOĞRU: SOAP response parsing
  private parseSoapResponse(responseData: string, action: string): any {
    try {
      const resultMatch = responseData.match(/<([a-zA-Z:]+)?Result>(.*?)<\/([a-zA-Z:]+)?Result>/);
      if (resultMatch && resultMatch[2]) {
        return resultMatch[2].trim();
      }

      // Error handling
      const errorMatch = responseData.match(/<faultstring>(.*?)<\/faultstring>/);
      if (errorMatch) {
        throw new Error(`SOAP Error: ${errorMatch[1]}`);
      }

      throw new Error('Invalid SOAP response format');
    } catch (error) {
      console.error('SOAP response parsing error:', error);
      throw error;
    }
  }

  // ✅ DOĞRU: Ödeme işlemi için SOAP isteği (Doküman Sayfa 10)
  async processPayment(paymentData: ParamPaymentData): Promise<any> {
    const authHash = await this.generateAuthHash(paymentData);

    const soapRequestData = {
      G: {
        CLIENT_CODE: this.clientCode,
        CLIENT_USERNAME: this.clientUsername,
        CLIENT_PASSWORD: this.clientPassword
      },
      Islem_Hash: authHash,
      ...paymentData
    };

    return await this.makeSoapRequest('TP_Islem_Odeme', soapRequestData);
  }

  // ✅ DOĞRU: İşlem sorgulama (Doküman Sayfa 11)
  async queryTransaction(transactionId: string): Promise<any> {
    const queryData = {
      G: {
        CLIENT_CODE: this.clientCode,
        CLIENT_USERNAME: this.clientUsername,
        CLIENT_PASSWORD: this.clientPassword
      },
      GUID: this.guid,
      Siparis_ID: transactionId,
      Dekont_ID: transactionId
    };

    return await this.makeSoapRequest('TP_Islem_Sorgulama', queryData);
  }

  // ✅ DOĞRU: BIN sorgulama (Kart bilgileri için)
  async queryBIN(cardNumber: string): Promise<any> {
    const binData = {
      G: {
        CLIENT_CODE: this.clientCode,
        CLIENT_USERNAME: this.clientUsername,
        CLIENT_PASSWORD: this.clientPassword
      },
      BIN: cardNumber.substring(0, 6) // İlk 6 hane
    };

    return await this.makeSoapRequest('BIN_SanalPos', binData);
  }

  // ✅ DOĞRU: Test bağlantısı
  async testConnection(): Promise<boolean> {
    try {
      const testData = {
        G: {
          CLIENT_CODE: this.clientCode,
          CLIENT_USERNAME: this.clientUsername,
          CLIENT_PASSWORD: this.clientPassword
        },
        GUID: this.guid,
        Terminal_ID: this.terminalNo
      };

      const result = await this.makeSoapRequest('TP_Islem_Odeme_Test', testData);
      return result.includes('BAŞARILI') || result.includes('1');
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }

  // ✅ DOĞRU: XML escape helper
  // ✅ FIXED CODE
  private escapeXml(unsafe: any): string {
    try {
      // Handle null/undefined
      if (unsafe === null || unsafe === undefined) {
        return '';
      }

      // Convert to string
      const stringValue = String(unsafe);

      // Escape XML special characters
      return stringValue
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/'/g, '&apos;')
        .replace(/"/g, '&quot;');
    } catch (error) {
      console.error('XML escape error:', error);
      return ''; // Return empty string on error
    }
  }

  // ✅ DOĞRU: Get authentication object
  getAuthObject() {
    return {
      CLIENT_CODE: this.clientCode,
      CLIENT_USERNAME: this.clientUsername,
      CLIENT_PASSWORD: this.clientPassword
    };
  }

  // ✅ DOĞRU: Generate complete authenticated request
  async generateAuthenticatedRequest(paymentData: ParamPaymentData): Promise<any> {
    const authHash = await this.generateAuthHash(paymentData);

    return {
      G: this.getAuthObject(),
      Islem_Hash: authHash,
      ...paymentData
    };
  }
}

// ✅ DOĞRU: Environment-based auth factory
export function createParamAuth(): ParamAuth {
  const developmentMode = process.env.PARAM_DEVELOPMENT_MODE === 'true';

  const config = {
    clientCode: developmentMode ?
      process.env.PARAM_CLIENT_CODE :
      process.env.PARAM_PROD_CLIENT_CODE,

    clientUsername: developmentMode ?
      process.env.PARAM_CLIENT_USERNAME :
      process.env.PARAM_PROD_CLIENT_USERNAME,

    clientPassword: developmentMode ?
      process.env.PARAM_CLIENT_PASSWORD :
      process.env.PARAM_PROD_CLIENT_PASSWORD,

    terminalNo: developmentMode ?
      process.env.PARAM_TERMINAL_NO :
      process.env.PARAM_PROD_TERMINAL_NO,

    guid: developmentMode ? process.env.PARAM_GUID! : process.env.PARAM_PROD_GUID!,

    baseUrl: developmentMode ?
      process.env.PARAM_BASE_URL :
      process.env.PARAM_PROD_BASE_URL
  };

  // ✅ Validation
  const missingVars = Object.entries(config)
    .filter(([key, value]) => !value)
    .map(([key]) => key);

  if (missingVars.length > 0) {
    throw new Error(`Missing Param configuration: ${missingVars.join(', ')}`);
  }

  return new ParamAuth(config as ParamAuthConfig);
}

// Export types and class
export { ParamAuth };
export type { ParamPaymentData, ParamAuthConfig };