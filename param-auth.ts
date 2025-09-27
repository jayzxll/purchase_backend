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

// ✅ FIXED: Param Authentication Class with correct SOAP Action
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

  // ✅ FIXED: SOAP request method with multiple SOAP Action formats
  async makeSoapRequest(action: string, requestData: any): Promise<any> {
    // ✅ TRY DIFFERENT SOAP ACTION FORMATS THAT PARAM MIGHT EXPECT
    const soapActionFormats = [
      `TP_Islem_Odeme`,  // Just the method name
      `"TP_Islem_Odeme"`, // Method name in quotes
      `"http://tempuri.org/TP_Islem_Odeme"`, // Full URI in quotes
      `http://tempuri.org/TP_Islem_Odeme`, // Full URI without quotes
      `"TP_Islem_Odeme"`, // Double quotes
      `'TP_Islem_Odeme'`, // Single quotes
      `urn:TP_Islem_Odeme`, // URN format
      ``, // Empty SOAP Action (some services accept this)
    ];

    for (const soapAction of soapActionFormats) {
      try {
        console.log(`🔧 Trying SOAP Action: "${soapAction}"`);
        
        const soapRequest = this.buildSoapEnvelope(action, requestData);
        console.log('SOAP Request (first 500 chars):', soapRequest.substring(0, 500));

        const headers: any = {
          'Content-Type': 'text/xml; charset=utf-8',
          'User-Agent': 'ErosAI/1.0'
        };

        // Only add SOAPAction header if it's not empty
        if (soapAction !== '') {
          headers['SOAPAction'] = soapAction;
        }

        console.log('Request headers:', headers);

        const response = await axios.post(this.baseUrl, soapRequest, {
          headers: headers,
          timeout: 30000,
          responseType: 'text'
        });

        console.log('✅ SOAP Response received with SOAP Action:', soapAction);
        console.log('Response status:', response.status);
        
        return this.parseSoapResponse(response.data as string, action);
        
      } catch (error: any) {
        if (error.response && error.response.data) {
          const errorText = error.response.data.toString();
          
          // Check if this is a SOAP Action error
          if (errorText.includes('did not recognize') || errorText.includes('SOAPAction')) {
            console.log(`❌ SOAP Action rejected: "${soapAction}"`);
            continue; // Try next format
          }
        }
        
        // If it's not a SOAP Action error, rethrow
        console.error(`❌ Error with SOAP Action "${soapAction}":`, error.message);
        throw error;
      }
    }
    
    throw new Error('All SOAP Action formats failed. Param service might be unavailable.');
  }

  // ✅ FIXED: SOAP envelope building with correct namespace
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

    // ✅ FIXED: Use correct namespace for Param POS
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" 
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <TP_Islem_Odeme xmlns="http://tempuri.org/">
      ${requestBody}
    </TP_Islem_Odeme>
  </soap:Body>
</soap:Envelope>`;
  }

  // ✅ FIXED: SOAP response parsing for Param POS
  private parseSoapResponse(responseData: string, action: string): any {
    try {
      console.log('Parsing SOAP response...');
      
      // Check for SOAP fault first
      const faultMatch = responseData.match(/<faultstring[^>]*>(.*?)<\/faultstring>/i);
      if (faultMatch) {
        throw new Error(`SOAP Fault: ${faultMatch[1]}`);
      }

      // Try to extract the response content
      const bodyMatch = responseData.match(/<soap:Body[^>]*>(.*?)<\/soap:Body>/is);
      if (!bodyMatch) {
        throw new Error('No SOAP Body found in response');
      }

      const bodyContent = bodyMatch[1];
      
      // Try different response patterns
      const resultPatterns = [
        /<TP_Islem_OdemeResult[^>]*>(.*?)<\/TP_Islem_OdemeResult>/is,
        /<TP_Islem_OdemeResponse[^>]*>(.*?)<\/TP_Islem_OdemeResponse>/is,
        /<Result[^>]*>(.*?)<\/Result>/i,
        /<Sonuc[^>]*>(.*?)<\/Sonuc>/i
      ];

      for (const pattern of resultPatterns) {
        const match = bodyContent.match(pattern);
        if (match && match[1]) {
          console.log('Found result with pattern');
          return this.parseParamResult(match[1]);
        }
      }

      // If no specific pattern found, try to parse all XML elements
      const result: any = {};
      const tagMatches = bodyContent.matchAll(/<([^>]+)>([^<]*)<\/\1>/g);
      
      for (const match of tagMatches) {
        result[match[1]] = match[2];
      }

      if (Object.keys(result).length > 0) {
        return result;
      }

      // Return raw response if parsing fails
      return { rawResponse: responseData, bodyContent: bodyContent };
      
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
      'Dekont_ID', 'Banka_Sonuc_Kod', 'Redirect_URL', 'Islem_GUID'
    ];
    
    fields.forEach(field => {
      const regex = new RegExp(`<${field}[^>]*>(.*?)</${field}>`, 'i');
      const match = resultXml.match(regex);
      if (match) {
        result[field] = match[1].trim();
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

  // ✅ Test connection with different methods
  async testConnection(): Promise<{success: boolean; workingAction?: string; error?: string}> {
    const testMethods = [
      'SHA2B64',
      'BIN_SanalPos',
      'TP_Islem_Odeme'
    ];

    for (const method of testMethods) {
      try {
        console.log(`🔧 Testing method: ${method}`);
        
        let testData: any = {
          G: this.getAuthObject()
        };

        // Add method-specific test data
        if (method === 'BIN_SanalPos') {
          testData.BIN = '450803';
        } else if (method === 'SHA2B64') {
          testData.Data = 'test';
        } else {
          // For TP_Islem_Odeme, use minimal test data
          testData = {
            G: this.getAuthObject(),
            Islem_Hash: 'test',
            SanalPOS_ID: '10738',
            Doviz: 'TRY',
            GUID: this.guid,
            KK_Sahibi: 'Test',
            KK_No: '4508030000000000',
            KK_SK_Ay: '12',
            KK_SK_Yil: '25',
            KK_CVC: '000',
            Hata_URL: 'https://test.com/error',
            Basarili_URL: 'https://test.com/success',
            Siparis_ID: 'TEST' + Date.now(),
            Siparis_Aciklama: 'Test',
            Taksit: '1',
            Islem_Tutar: '1,00',
            Toplam_Tutar: '1,00',
            Islem_ID: 'TEST' + Date.now(),
            IPAdr: '127.0.0.1',
            Ref_URL: 'https://test.com'
          };
        }

        const result = await this.makeSoapRequest(method, testData);
        console.log(`✅ Method ${method} works`);
        return { success: true, workingAction: method };
        
      } catch (error: any) {
        console.log(`❌ Method ${method} failed:`, error.message);
        continue;
      }
    }

    return { 
      success: false, 
      error: 'All connection tests failed. Check Param service availability.' 
    };
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