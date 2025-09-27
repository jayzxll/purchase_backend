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

// ✅ FIXED: Param Authentication Class
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
    
    // ✅ FIX: Remove any WSDL parameters from base URL
    this.baseUrl = config.baseUrl.replace(/\?WSDL$/i, '').replace(/\?wsdl$/i, '');
    console.log('✅ Base URL configured:', this.baseUrl);
  }

  // ✅ FIXED: Correct hash calculation according to Param documentation
  async generateAuthHash(paymentData: ParamPaymentData): Promise<string> {
    try {
      console.log('🔐 Generating Param hash according to documentation...');

      // ✅ DOKÜMANDA BELİRTİLEN SIRALAMA (Sayfa 7):
      // CLIENT_CODE + GUID + Taksit + Islem_Tutar + Toplam_Tutar + Siparis_ID + Hata_URL + Basarili_URL
      
      const hashData =
        this.clientCode +
        this.guid +
        paymentData.Taksit +
        paymentData.Islem_Tutar.replace(',', '.') + // Use dot for decimal in hash calculation
        paymentData.Toplam_Tutar.replace(',', '.') + // Use dot for decimal in hash calculation
        paymentData.Siparis_ID +
        paymentData.Hata_URL +
        paymentData.Basarili_URL;

      console.log('Hash input:', hashData);
      console.log('Hash input length:', hashData.length);

      // ✅ DOKÜMANDA BELİRTİLEN HASH METODU: SHA256 + Base64
      const hash = crypto.createHash('sha256').update(hashData, 'utf8').digest('base64');

      console.log('✅ Generated SHA256+Base64 hash:', hash);
      return hash;

    } catch (error: any) {
      console.error('❌ Hash generation error:', error.message);
      throw new Error('Hash oluşturulamadı: ' + error.message);
    }
  }

  // ✅ FIXED: SOAP request method with correct SOAP Action
  async makeSoapRequest(action: string, requestData: any): Promise<any> {
    try {
      console.log(`🔧 Making SOAP request to: ${this.baseUrl}`);
      console.log(`🔧 Action: ${action}`);

      // ✅ FIX: Use dynamic SOAP Action based on the method being called
      const soapAction = `http://tempuri.org/${action}`;
      console.log(`🔧 SOAP Action: ${soapAction}`);

      const soapRequest = this.buildSoapEnvelope(action, requestData);
      console.log('SOAP Request (first 500 chars):', soapRequest.substring(0, 500));

      const headers: any = {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': soapAction,
        'User-Agent': 'ErosAI/1.0'
      };

      console.log('Request headers:', { 
        'Content-Type': headers['Content-Type'],
        'SOAPAction': headers['SOAPAction'] 
      });

      // ✅ FIX: Make sure we're using the correct endpoint
      const response = await axios.post(this.baseUrl, soapRequest, {
        headers: headers,
        timeout: 30000,
        responseType: 'text'
      });

      console.log('✅ SOAP Response received, status:', response.status);
      console.log('Response data (first 500 chars):', (response.data as string).substring(0, 500));
      
      return this.parseSoapResponse(response.data as string, action);
      
    } catch (error: any) {
      console.error('❌ SOAP Request failed:');
      console.error('Error message:', error.message);
      
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response headers:', error.response.headers);
        
        if (error.response.data) {
          console.error('Response data (first 1000 chars):', 
            error.response.data.toString().substring(0, 1000));
        }
      }
      
      if (error.code) {
        console.error('Error code:', error.code);
      }
      
      throw new Error(`SOAP request failed: ${error.message}`);
    }
  }

  // ✅ FIXED: SOAP envelope building
  private buildSoapEnvelope(action: string, requestData: any): string {
    let requestBody = '';

    // Build XML elements in the correct order
    const buildXmlElement = (key: string, value: any): string => {
      if (value === null || value === undefined || value === '') {
        return '';
      }
      
      if (typeof value === 'object') {
        let nestedXml = '';
        for (const [subKey, subValue] of Object.entries(value)) {
          nestedXml += buildXmlElement(subKey, subValue);
        }
        return nestedXml ? `<${key}>${nestedXml}</${key}>` : '';
      } else {
        return `<${key}>${this.escapeXml(value)}</${key}>`;
      }
    };

    // Build request body in specific order
    for (const [key, value] of Object.entries(requestData)) {
      requestBody += buildXmlElement(key, value);
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

  // ✅ FIXED: SOAP response parsing for Param POS
  private parseSoapResponse(responseData: string, action: string): any {
    try {
      console.log('Parsing SOAP response...');
      
      // Remove namespaces for easier parsing
      const cleanData = responseData.replace(/xmlns(:[^=]*)?="[^"]*"/g, '');
      
      // Try to find the result element specific to Param POS
      const resultPatterns = [
        new RegExp(`<${action}Result>(.*?)</${action}Result>`),
        new RegExp(`<${action}Response>(.*?)</${action}Response>`),
        /<Result>(.*?)<\/Result>/,
        /<Sonuc>(.*?)<\/Sonuc>/
      ];

      for (const pattern of resultPatterns) {
        const match = cleanData.match(pattern);
        if (match && match[1]) {
          console.log('Found result with pattern:', pattern);
          return this.parseParamResult(match[1]);
        }
      }

      // Check for SOAP fault
      const faultMatch = responseData.match(/<faultstring>(.*?)<\/faultstring>/);
      if (faultMatch) {
        throw new Error(`SOAP Fault: ${faultMatch[1]}`);
      }

      // If no specific result found, try to parse as XML
      try {
        // Simple XML to object conversion for Param responses
        const result: any = {};
        const matches = cleanData.match(/<([^>]+)>([^<]*)<\/\1>/g);
        
        if (matches) {
          matches.forEach(match => {
            const tagMatch = match.match(/<([^>]+)>([^<]*)<\/\1>/);
            if (tagMatch) {
              result[tagMatch[1]] = tagMatch[2];
            }
          });
        }

        if (Object.keys(result).length > 0) {
          return result;
        }
      } catch (parseError) {
        console.log('XML parsing failed, returning raw response');
      }

      // Return raw response if parsing fails
      return { rawResponse: responseData };
      
    } catch (error) {
      console.error('SOAP response parsing error:', error);
      throw error;
    }
  }

  // ✅ Parse Param-specific result format
  private parseParamResult(resultXml: string): any {
    const result: any = {};
    
    // Extract common Param POS fields
    const fields = [
      'Sonuc', 'Sonuc_Str', 'UCD_URL', 'Islem_ID', 'Siparis_ID', 
      'Dekont_ID', 'Banka_Sonuc_Kod', 'Redirect_URL'
    ];
    
    fields.forEach(field => {
      const regex = new RegExp(`<${field}>(.*?)</${field}>`);
      const match = resultXml.match(regex);
      if (match) {
        result[field] = match[1];
      }
    });
    
    return result;
  }

  // ✅ FIXED: Payment processing
  async processPayment(paymentData: ParamPaymentData): Promise<any> {
    try {
      const authHash = await this.generateAuthHash(paymentData);

      // ✅ Param'ın beklediği parametre sırası ve yapısı
      const soapRequestData = {
        G: {
          CLIENT_CODE: this.clientCode,
          CLIENT_USERNAME: this.clientUsername,
          CLIENT_PASSWORD: this.clientPassword
        },
        Islem_Hash: authHash,
        SanalPOS_ID: paymentData.SanalPOS_ID,
        Doviz: paymentData.Doviz,
        GUID: this.guid, // Use instance GUID
        KK_Sahibi: paymentData.KK_Sahibi,
        KK_No: paymentData.KK_No.replace(/\s/g, ''),
        KK_SK_Ay: paymentData.KK_SK_Ay.padStart(2, '0'),
        KK_SK_Yil: paymentData.KK_SK_Yil.length === 4 ? 
                   paymentData.KK_SK_Yil.slice(-2) : paymentData.KK_SK_Yil,
        KK_CVC: paymentData.KK_CVC,
        KK_Sahibi_GSM: paymentData.KK_Sahibi_GSM || '',
        Hata_URL: paymentData.Hata_URL,
        Basarili_URL: paymentData.Basarili_URL,
        Siparis_ID: paymentData.Siparis_ID,
        Siparis_Aciklama: paymentData.Siparis_Aciklama,
        Taksit: paymentData.Taksit,
        Islem_Tutar: paymentData.Islem_Tutar, // Keep comma for Param
        Toplam_Tutar: paymentData.Toplam_Tutar, // Keep comma for Param
        Islem_ID: paymentData.Islem_ID,
        IPAdr: paymentData.IPAdr,
        Ref_URL: paymentData.Ref_URL
      };

      console.log('Sending SOAP request data:', JSON.stringify(soapRequestData, null, 2));

      return await this.makeSoapRequest('TP_Islem_Odeme', soapRequestData);
    } catch (error: any) {
      console.error('Payment processing error:', error);
      throw error;
    }
  }

  // ✅ Test connection method
  async testConnection(): Promise<boolean> {
    try {
      console.log('🔧 Testing Param connection...');
      
      // Test with SHA2B64 method first (usually available)
      const testData = {
        G: this.getAuthObject(),
        Data: 'test'
      };

      const result = await this.makeSoapRequest('SHA2B64', testData);
      console.log('✅ Connection test successful:', result);
      return true;
      
    } catch (error) {
      console.log('❌ SHA2B64 test failed, trying BIN_SanalPos...');
      
      try {
        // Try another method
        const testData = {
          G: this.getAuthObject(),
          BIN: '450803' // Test BIN number
        };

        const result = await this.makeSoapRequest('BIN_SanalPos', testData);
        console.log('✅ BIN_SanalPos test successful');
        return true;
      } catch (error2) {
        console.error('❌ All connection tests failed');
        return false;
      }
    }
  }

  // ✅ XML escape helper
  private escapeXml(unsafe: any): string {
    try {
      if (unsafe === null || unsafe === undefined) {
        return '';
      }

      const stringValue = String(unsafe);
      return stringValue
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/'/g, '&apos;')
        .replace(/"/g, '&quot;');
    } catch (error) {
      console.error('XML escape error:', error);
      return '';
    }
  }

  // ✅ Get authentication object
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

  // ✅ KART SAKLAMA METODU
 // ✅ KART SAKLAMA METODU
  async saveCreditCard(cardData: {
    KK_Sahibi: string;
    KK_No: string;
    KK_SK_Ay: string;
    KK_SK_Yil: string;
    KK_Kart_Adi?: string;
    KK_Islem_ID?: string;
  }): Promise<{ success: boolean; KS_GUID?: string; error?: string }> {
    try {
      const soapRequestData = {
        G: this.getAuthObject(),
        GUID: this.guid,
        KK_Sahibi: cardData.KK_Sahibi,
        KK_No: cardData.KK_No.replace(/\s/g, ''),
        KK_SK_Ay: cardData.KK_SK_Ay.padStart(2, '0'),
        KK_SK_Yil: cardData.KK_SK_Yil,
        KK_Kart_Adi: cardData.KK_Kart_Adi || `Kart-${Date.now()}`,
        KK_Islem_ID: cardData.KK_Islem_ID || `CARD-${Date.now()}`
      };

      const result = await this.makeSoapRequest('KK_Saklama', soapRequestData);

      if (result && result.Sonuc && parseInt(result.Sonuc) > 0) {
        return {
          success: true,
          KS_GUID: result.KS_GUID
        };
      } else {
        return {
          success: false,
          error: result.Sonuc_Str || 'Kart saklama başarısız'
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ✅ SAKLI KART LİSTESİ
  async getSavedCards(cardNumber?: string, userTCKN?: string): Promise<any> {
    try {
      const soapRequestData = {
        G: this.getAuthObject(),
        Kart_No: cardNumber?.replace(/\s/g, '') || '',
        KS_KK_Kisi_ID: userTCKN || ''
      };

      const result = await this.makeSoapRequest('KK_Sakli_Liste', soapRequestData);
      return result;
    } catch (error: any) {
      throw new Error('Kart listesi alınamadı: ' + error.message);
    }
  }

  // ✅ SAKLI KART İLE ÖDEME
  async paymentWithSavedCard(paymentData: {
    KS_GUID: string;
    CVV: string;
    KK_Sahibi_GSM: string;
    Hata_URL: string;
    Basarili_URL: string;
    Siparis_ID: string;
    Siparis_Aciklama: string;
    Taksit: string;
    Islem_Tutar: string;
    Toplam_Tutar: string;
    Islem_Guvenlik_Tip: string; // "NS" veya "3D"
    Islem_ID?: string;
    IPAdr: string;
    Ref_URL?: string;
    Data1?: string;
    Data2?: string;
    Data3?: string;
    Data4?: string;
    KK_Islem_ID?: string;
  }): Promise<any> {
    try {
      // Hash hesaplama (dokümanda belirtilen formata göre)
      const hashData = this.clientCode + this.guid + paymentData.Taksit +
        paymentData.Islem_Tutar + paymentData.Toplam_Tutar + paymentData.Siparis_ID;

      const Islem_Hash = await this.generateHash(hashData);

      const soapRequestData = {
        G: this.getAuthObject(),
        GUID: this.guid,
        KS_GUID: paymentData.KS_GUID,
        CVV: paymentData.CVV,
        KK_Sahibi_GSM: paymentData.KK_Sahibi_GSM,
        Hata_URL: paymentData.Hata_URL,
        Basarili_URL: paymentData.Basarili_URL,
        Siparis_ID: paymentData.Siparis_ID,
        Siparis_Aciklama: paymentData.Siparis_Aciklama,
        Taksit: paymentData.Taksit,
        Islem_Tutar: paymentData.Islem_Tutar,
        Toplam_Tutar: paymentData.Toplam_Tutar,
        Islem_Guvenlik_Tip: paymentData.Islem_Guvenlik_Tip,
        Islem_Hash: Islem_Hash,
        Islem_ID: paymentData.Islem_ID || `PAY-${Date.now()}`,
        IPAdr: paymentData.IPAdr,
        Ref_URL: paymentData.Ref_URL,
        Data1: paymentData.Data1,
        Data2: paymentData.Data2,
        Data3: paymentData.Data3,
        Data4: paymentData.Data4,
        KK_Islem_ID: paymentData.KK_Islem_ID
      };

      const result = await this.makeSoapRequest('KS_Tahsilat', soapRequestData);
      return result;
    } catch (error: any) {
      throw new Error('Saklı kart ile ödeme başarısız: ' + error.message);
    }
  }

  // ✅ DOĞRU HASH HESAPLAMA (Dokümana uygun)
  private async generateHash(data: string): Promise<string> {
    // SHA2B64 formatına uygun hash hesaplama
    const hash = crypto.createHash('sha256').update(data, 'utf8').digest('base64');
    return hash;
  }

  // ✅ SAKLI KART SİLME
  async deleteSavedCard(KS_GUID: string): Promise<boolean> {
    try {
      const soapRequestData = {
        G: this.getAuthObject(),
        KS_GUID: KS_GUID
      };

      const result = await this.makeSoapRequest('KS_Kart_Sil', soapRequestData);
      return result.Sonuc && parseInt(result.Sonuc) > 0;
    } catch (error: any) {
      throw new Error('Kart silme başarısız: ' + error.message);
    }
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

  // ✅ FIX: Remove WSDL from base URL
  if (config.baseUrl) {
    config.baseUrl = config.baseUrl.replace(/\?WSDL$/i, '').replace(/\?wsdl$/i, '');
  }

  console.log('Param Auth Configuration:', {
    clientCode: config.clientCode ? 'SET' : 'MISSING',
    clientUsername: config.clientUsername ? 'SET' : 'MISSING',
    baseUrl: config.baseUrl
  });

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