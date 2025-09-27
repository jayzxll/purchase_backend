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
// Update the makeSoapRequest method to try Param-specific formats
async makeSoapRequest(action: string, requestData: any): Promise<any> {
  const soapActionFormats = [
    // Param-specific formats
    `http://turkpos.com.tr/${action}`,
    `https://turkpos.com.tr/${action}`,
    `urn:TP_Islem_${action}`,
    `urn:${action}`,
    `TP_Islem_${action}`,
    
    // Standard formats
    `http://tempuri.org/ITurkPos/${action}`,
    `http://tempuri.org/${action}`,
    action,
    `ITurkPos/${action}`,
    '' // Some services accept empty SOAPAction
  ];

  for (const soapAction of soapActionFormats) {
    try {
      console.log(`🔧 Trying SOAPAction: ${soapAction}`);
      
      const soapRequest = this.buildSoapEnvelope(action, requestData);
      
      const headers: any = {
        'Content-Type': 'text/xml; charset=utf-8',
        'User-Agent': 'ErosAI/1.0'
      };
      
      if (soapAction) {
        headers['SOAPAction'] = soapAction;
      }

      const response = await axios.post(this.baseUrl.replace('?WSDL', ''), soapRequest, {
        headers: headers,
        timeout: 30000,
        responseType: 'text'
      });

      console.log(`✅ Success with SOAPAction: ${soapAction}`);
      return this.parseSoapResponse(response.data as string, action);
      
    } catch (error: any) {
      if (error.response && error.response.data) {
        const errorText = error.response.data.toString();
        if (errorText.includes('did not recognize') || errorText.includes('Unable to handle request')) {
          console.log(`❌ SOAPAction rejected: ${soapAction}`);
          continue; // Try next format
        }
      }
      // Other error (network, auth, etc.)
      throw error;
    }
  }
  
  throw new Error('All SOAPAction formats failed');
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

  async testHashGeneration(): Promise<string> {
    try {
      const testData = {
        Data: 'test'
      };

      const result = await this.makeSoapRequest('SHA2B64', testData);
      return result;
    } catch (error) {
      console.error('Hash test failed:', error);
      throw error;
    }
  }

  // ✅ ADD THIS METHOD TO DISCOVER AVAILABLE METHODS
  // Replace the discoverAvailableMethods method with this:
  async discoverAvailableMethods(): Promise<string[]> {
    try {
      const response = await axios.get('https://test-dmz.param.com.tr:4443/turkpos.ws/service_turkpos_test.asmx?wsdl', {
        timeout: 10000
      });

      const wsdlContent: string = response.data as string;
      console.log('📋 Raw WSDL content (first 1000 chars):', wsdlContent.substring(0, 1000));

      // Try different patterns to find methods
      const patterns = [
        /<operation name="([^"]+)"/g,
        /<wsdl:operation name="([^"]+)"/g,
        /<soap:operation soapAction="[^"]*#([^"]+)"/g,
        /<operation name='([^']+)'/g
      ];

      let methods: string[] = [];
      for (const pattern of patterns) {
        const matches = wsdlContent.match(pattern);
        if (matches && matches.length > 0) {
          methods = matches.map(m => {
            const method = m.replace(/.*name=(["'])([^"']+)\1.*/, '$2');
            return method;
          });
          break;
        }
      }

      console.log('📋 Available methods:', methods);
      return methods;
    } catch (error) {
      console.error('Failed to fetch WSDL:', error);
      return [];
    }
  }

  // ✅ ADD THIS ENHANCED CONNECTION TEST METHOD
 // Update the testConnection method with Param-specific methods
async testConnection(): Promise<boolean> {
  try {
    const methods = await this.discoverAvailableMethods();
    console.log('🔍 Discovered methods:', methods);

    // Param-specific method names
    const paramMethods = [
      'TP_Islem_Odeme',
      'TP_Islem_Odeme_OnProv',
      'TP_Islem_Odeme_Prov',
      'TP_Islem_Sorgulama',
      'TP_Islem_Iade',
      'TP_Islem_Iade_OnProv',
      'TP_Islem_Iade_Prov',
      'BIN_SanalPos',
      'SHA2B64',
      'Islem_Odeme',
      'Odeme'
    ];

    const testMethods = [...paramMethods, ...methods];

    for (const method of testMethods) {
      try {
        console.log(`🔧 Testing method: ${method}`);
        
        const testData = {
          G: this.getAuthObject(),
          Test: 'test',
          Data: 'test'
        };

        const result = await this.makeSoapRequest(method, testData);
        console.log(`✅ Method ${method} works:`, result);
        return true;
      } catch (error) {
        if (error instanceof Error) {
          console.log(`❌ Method ${method} failed:`, error.message);
        } else {
          console.log(`❌ Method ${method} failed:`, error);
        }
        continue;
      }
    }
    
    return false;
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
      
      // Response parsing
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