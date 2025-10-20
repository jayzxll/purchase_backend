import axios from 'axios';
import crypto from 'crypto';

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
  Data1?: string;
  Data2?: string;
  Data3?: string;
  Data4?: string;
  Data5?: string;
  Islem_Guvenlik_Tip?: string; 
}

interface SaveCardData {
  KK_Sahibi: string;
  KK_No: string;
  KK_SK_Ay: string;
  KK_SK_Yil: string;
  KK_Kart_Adi: string;
}

interface SaveCardResult {
  success: boolean;
  KS_GUID?: string;
  error?: string;
  Sonuc?: string;
  Sonuc_Str?: string;
}

interface PaymentWithSavedCardData {
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
  Islem_Guvenlik_Tip: string;
  IPAdr: string;
  Ref_URL: string;
}

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
    
    this.baseUrl = config.baseUrl.replace(/\?WSDL$/i, '').replace(/\?wsdl$/i, '');
    console.log('✅ Base URL configured:', this.baseUrl);
  }

  async generateAuthHash(paymentData: ParamPaymentData): Promise<string> {
    try {
      console.log('🔐 Generating Param hash for 3D Secure...');

      const hashData =
        this.clientCode +
        this.guid +
        paymentData.Taksit +
        paymentData.Islem_Tutar.replace(',', '.') +
        paymentData.Toplam_Tutar.replace(',', '.') +
        paymentData.Siparis_ID +
        paymentData.Hata_URL +
        paymentData.Basarili_URL;

      console.log('Hash input:', hashData);

      const hash = crypto.createHash('sha256').update(hashData, 'utf8').digest('base64');

      console.log('✅ Generated SHA256+Base64 hash:', hash);
      return hash;

    } catch (error: any) {
      console.error('❌ Hash generation error:', error.message);
      throw new Error('Hash oluşturulamadı: ' + error.message);
    }
  }

  // ✅ UPDATED: SOAP request method with correct SOAPAction format
  // ✅ UPDATED: Improved SOAP request method with better timeout handling
async makeSoapRequest(action: string, requestData: any): Promise<any> {
  const soapActions = [
    `https://turkpos.com.tr/${action}`,
    `"https://turkpos.com.tr/${action}"`,
    `"${action}"`,
    `${action}`,
    `http://tempuri.org/${action}`,
    `"http://tempuri.org/${action}"`,
  ];

  let lastError: any = null;

  for (const soapAction of soapActions) {
    try {
      console.log(`🔧 Trying SOAP Action: "${soapAction}" for method: ${action}`);
      
      const soapRequest = this.buildSoapEnvelope(action, requestData);

      // ✅ IMPROVED: Better timeout strategy
      const timeout = action === 'TP_WMD_UCD' ? 45000 : 30000; // 3D işlemler için daha uzun timeout

      const headers: any = {
        'Content-Type': 'text/xml; charset=utf-8',
        'User-Agent': 'ErosAI/1.0',
        'SOAPAction': soapAction,
        'Connection': 'keep-alive',
        'Accept-Encoding': 'gzip, deflate, br'
      };

      console.log(`⏱️ Request timeout: ${timeout}ms`);
      console.log('📤 SOAP Request URL:', this.baseUrl);

      // ✅ IMPROVED: Axios configuration with better error handling
      const response = await axios.post(this.baseUrl, soapRequest, {
        headers: headers,
        timeout: timeout,
        responseType: 'text',
      });

      console.log('✅ SOAP Response received with status:', response.status);
      console.log('✅ Successful SOAP Action:', soapAction);
      
      return this.parseSoapResponse(response.data as string, action);
      
    } catch (error: any) {
      lastError = error;
      
      // ✅ IMPROVED: Better error analysis
      if (error.code === 'ECONNABORTED') {
        console.log(`⏰ Timeout with SOAP Action: "${soapAction}"`);
        continue;
      }
      
      if (error.response) {
        // Sunucu yanıt verdi ama hata kodu döndü
        const errorText = error.response.data.toString();
        
        if (errorText.includes('did not recognize') || errorText.includes('SOAPAction')) {
          console.log(`❌ SOAP Action rejected: "${soapAction}"`);
          continue;
        }
        
        // Diğer sunucu hataları için retry yapma
        console.log(`❌ Server error with ${soapAction}:`, error.response.status);
        break;
      }
      
      if (error.request) {
        // İstek gönderildi ama yanıt alınamadı
        console.log(`🌐 Network error with ${soapAction}:`, error.message);
        continue;
      }
      
      console.error(`❌ Other error with SOAP Action "${soapAction}":`, error.message);
    }
  }
  
  // ✅ IMPROVED: Better error reporting
  if (lastError?.code === 'ECONNABORTED') {
    throw new Error(`Param SOAP service timeout (${lastError.config?.timeout}ms). Service might be unavailable or slow.`);
  }
  
  throw new Error(`All SOAP Action formats failed for ${action}. Last error: ${lastError?.message}`);
}

// ParamAuth sınıfına bu metodu ekleyin
async debugConnection(): Promise<{success: boolean; details: any}> {
  console.log('🔍 Debugging Param connection...');
  
  const results: any = {
    url: this.baseUrl,
    networkReachable: false,
    dnsResolved: false,
    portOpen: false,
    soapActionsTested: []
  };

  try {
    // URL kontrolü
    console.log('📍 Target URL:', this.baseUrl);
    const url = new URL(this.baseUrl);
    
    // DNS çözümleme testi
    console.log('🔎 DNS resolution test...');
    const dns = require('dns').promises;
    try {
      await dns.lookup(url.hostname);
      results.dnsResolved = true;
      console.log('✅ DNS resolution: OK');
    } catch (dnsError: any) {
      const dnsErrorMessage = dnsError && typeof dnsError === 'object' && 'message' in dnsError
        ? (dnsError as any).message
        : String(dnsError);
      console.log('❌ DNS resolution: FAILED -', dnsErrorMessage);
    }

    // Network erişim testi
    console.log('🌐 Network connectivity test...');
    const https = require('https');
    
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'HEAD',
        timeout: 10000,
        rejectUnauthorized: false // SSL sertifikasını doğrulama
      }, (res: import('http').IncomingMessage) => {
        results.networkReachable = true;
        results.httpStatus = res.statusCode;
        console.log('✅ Network connectivity: OK');
        console.log('📡 HTTP Status:', res.statusCode);
        resolve(true);
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Network timeout'));
      });
      
      req.on('error', (error: any) => {
        console.log('❌ Network connectivity: FAILED -', error?.message || error);
        reject(error);
      });
      
      req.end();
    });
    
  } catch (error: any) {
    console.log('❌ Network test failed:', error.message);
  }

  // SOAP action testleri
  console.log('🧪 Testing SOAP actions...');
  const testActions = ['SHA2B64', 'TP_WMD_UCD'];
  
  for (const action of testActions) {
    try {
      console.log(`\n🔧 Testing SOAP action: ${action}`);
      let testData: any = {
        G: this.getAuthObject()
      };

      if (action === 'SHA2B64') {
        testData.Data = 'test';
      } else if (action === 'TP_WMD_UCD') {
        // Basit test verisi
        testData = {
          G: this.getAuthObject(),
          GUID: this.guid,
          KK_Sahibi: 'Test Test',
          KK_No: '4546711234567894',
          KK_SK_Ay: '12',
          KK_SK_Yil: '26',
          KK_CVC: '000',
          Hata_URL: 'https://example.com/error',
          Basarili_URL: 'https://example.com/success',
          Siparis_ID: 'TEST_' + Date.now(),
          Siparis_Aciklama: 'Test',
          Taksit: '1',
          Islem_Tutar: '1,00',
          Toplam_Tutar: '1,00',
          Islem_Hash: 'test',
          Islem_Guvenlik_Tip: '3D',
          IPAdr: '127.0.0.1',
          Ref_URL: 'https://example.com'
        };
      }

      const startTime = Date.now();
      const result = await this.makeSoapRequest(action, testData);
      const responseTime = Date.now() - startTime;
      
      results.soapActionsTested.push({
        action: action,
        success: true,
        responseTime: responseTime,
        result: result
      });
      
      console.log(`✅ SOAP action ${action}: OK (${responseTime}ms)`);
      
    } catch (error: any) {
      results.soapActionsTested.push({
        action: action,
        success: false,
        error: error.message,
        code: error.code
      });
      
      console.log(`❌ SOAP action ${action}: FAILED -`, error.message);
    }
  }

  // Sonuç özeti
  console.log('\n📊 DEBUG SUMMARY:');
  console.log('📍 URL:', results.url);
  console.log('🌐 Network Reachable:', results.networkReachable);
  console.log('🔎 DNS Resolved:', results.dnsResolved);
  console.log('📡 HTTP Status:', results.httpStatus);
  console.log('\n🧪 SOAP Actions:');
  results.soapActionsTested.forEach((test: any) => {
    console.log(`  ${test.action}: ${test.success ? '✅' : '❌'} ${test.success ? test.responseTime + 'ms' : test.error}`);
  });

  const overallSuccess = results.networkReachable && 
                        results.soapActionsTested.some((test: any) => test.success);

  return {
    success: overallSuccess,
    details: results
  };
}

  private buildSoapEnvelope(action: string, requestData: any): string {
    let requestBody = '';

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

    for (const [key, value] of Object.entries(requestData)) {
      requestBody += buildXmlElement(key, value);
    }

    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" 
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <${action} xmlns="https://turkpos.com.tr/">
      ${requestBody}
    </${action}>
  </soap:Body>
</soap:Envelope>`;
  }

  private parseSoapResponse(responseData: string, action: string): any {
    try {
      console.log('Parsing SOAP response for method:', action);
      
      const faultMatch = responseData.match(/<faultstring[^>]*>(.*?)<\/faultstring>/i);
      if (faultMatch) {
        throw new Error(`SOAP Fault: ${faultMatch[1]}`);
      }

      const bodyMatch = responseData.match(/<soap:Body[^>]*>(.*?)<\/soap:Body>/is);
      if (!bodyMatch) {
        throw new Error('No SOAP Body found in response');
      }

      const bodyContent = bodyMatch[1];
      
      const resultPatterns = [
        new RegExp(`<${action}Result[^>]*>(.*?)<\/${action}Result>`, 'is'),
        new RegExp(`<${action}Response[^>]*>(.*?)<\/${action}Response>`, 'is'),
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

      const result: any = {};
      const tagMatches = bodyContent.matchAll(/<([^>]+)>([^<]*)<\/\1>/g);
      
      for (const match of tagMatches) {
        result[match[1]] = match[2];
      }

      if (Object.keys(result).length > 0) {
        return result;
      }

      return { rawResponse: responseData, bodyContent: bodyContent };
      
    } catch (error) {
      console.error('SOAP response parsing error:', error);
      throw error;
    }
  }

  private parseParamResult(resultXml: string): any {
    const result: any = {};
    
    const fields = [
      'Sonuc', 'Sonuc_Str', 'UCD_URL', 'Islem_ID', 'Siparis_ID', 
      'Dekont_ID', 'Banka_Sonuc_Kod', 'Redirect_URL', 'Islem_GUID',
      'UCD_HTML', 'HTML_Content', 'ThreeDSecure_URL'
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

  async processPaymentWith3DS(paymentData: ParamPaymentData): Promise<any> {
  try {
    console.log('🔄 Starting 3D Secure payment process with TP_WMD_UCD...');

    // ✅ IMPROVED: Add timeout for hash generation
    const hashData = this.clientCode + this.guid + paymentData.Taksit +
      paymentData.Islem_Tutar.replace(',', '.') +
      paymentData.Toplam_Tutar.replace(',', '.') +
      paymentData.Siparis_ID +
      paymentData.Hata_URL +
      paymentData.Basarili_URL;

    const Islem_Hash = crypto.createHash('sha256').update(hashData, 'utf8').digest('base64');

    console.log('✅ 3D Secure hash generated');

    const soapRequestData = {
      G: this.getAuthObject(),
      GUID: this.guid,
      KK_Sahibi: paymentData.KK_Sahibi,
      KK_No: paymentData.KK_No.replace(/\s/g, ''),
      KK_SK_Ay: paymentData.KK_SK_Ay.padStart(2, '0'),
      KK_SK_Yil: paymentData.KK_SK_Yil.length === 4 ? 
                 paymentData.KK_SK_Yil.slice(-2) : paymentData.KK_SK_Yil,
      KK_CVC: paymentData.KK_CVC,
      KK_Sahibi_GSM: paymentData.KK_Sahibi_GSM || '5555555555',
      Hata_URL: paymentData.Hata_URL,
      Basarili_URL: paymentData.Basarili_URL,
      Siparis_ID: paymentData.Siparis_ID,
      Siparis_Aciklama: paymentData.Siparis_Aciklama,
      Taksit: paymentData.Taksit,
      Islem_Tutar: paymentData.Islem_Tutar,
      Toplam_Tutar: paymentData.Toplam_Tutar,
      Islem_Hash: Islem_Hash,
      Islem_Guvenlik_Tip: '3D',
      Islem_ID: paymentData.Islem_ID || '',
      IPAdr: paymentData.IPAdr,
      Ref_URL: paymentData.Ref_URL,
      Data1: paymentData.Data1 || '',
      Data2: paymentData.Data2 || '',
      Data3: paymentData.Data3 || '',
      Data4: paymentData.Data4 || '',
      Data5: paymentData.Data5 || ''
    };

    console.log('📤 Sending TP_WMD_UCD request to:', this.baseUrl);

    // ✅ IMPROVED: 3D Secure için özel timeout
    const originalMakeSoapRequest = this.makeSoapRequest;
    
    // Geçici olarak timeout'u artır
    this.makeSoapRequest = async (action: string, data: any) => {
      const soapActions = [`https://turkpos.com.tr/${action}`];
      
      for (const soapAction of soapActions) {
        try {
          const soapRequest = this.buildSoapEnvelope(action, data);
          const headers: any = {
            'Content-Type': 'text/xml; charset=utf-8',
            'User-Agent': 'ErosAI/1.0',
            'SOAPAction': soapAction,
          };

          const response = await axios.post(this.baseUrl, soapRequest, {
            headers: headers,
            timeout: 60000, // 3D için 60 saniye
            responseType: 'text'
          });

          return this.parseSoapResponse(response.data as string, action);
        } catch (error: any) {
          if (error.code === 'ECONNABORTED') {
            throw new Error('3D Secure işlemi zaman aşımına uğradı. Lütfen tekrar deneyin.');
          }
          throw error;
        }
      }
    };

    const result = await this.makeSoapRequest('TP_WMD_UCD', soapRequestData);
    
    // Orijinal metodu geri yükle
    this.makeSoapRequest = originalMakeSoapRequest;

    console.log('📥 TP_WMD_UCD Response received');
    return result;

  } catch (error: any) {
    console.error('❌ 3D Secure payment error:', error);
    throw new Error('3D ödeme başlatılamadı: ' + error.message);
  }
}

  async complete3DPayment(md: string, islemGUID: string, orderId: string): Promise<any> {
    try {
      console.log('🔄 Completing 3D Secure payment...');

      const soapRequestData = {
        G: this.getAuthObject(),
        GUID: this.guid,
        Siparis_ID: orderId,
        Islem_GUID: islemGUID,
        MD: md
      };

      console.log('📤 Sending TP_WMD_Pay request...');
      const result = await this.makeSoapRequest('TP_WMD_Pay', soapRequestData);

      console.log('📥 TP_WMD_Pay Response:', result);

      return result;

    } catch (error: any) {
      console.error('❌ 3D payment completion error:', error);
      throw new Error('3D ödeme tamamlanamadı: ' + error.message);
    }
  }

  getAuthObject() {
    return {
      CLIENT_CODE: this.clientCode,
      CLIENT_USERNAME: this.clientUsername,
      CLIENT_PASSWORD: this.clientPassword
    };
  }

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

async testConnection(): Promise<{success: boolean; workingAction?: string; error?: string; responseTime?: number}> {
  const testMethods = ['SHA2B64']; // Daha basit bir metodla başla

  for (const method of testMethods) {
    try {
      console.log(`🔧 Testing connection with method: ${method}`);
      
      const startTime = Date.now();
      let testData: any = {
        G: this.getAuthObject(),
        Data: 'test'
      };

      const result = await this.makeSoapRequest(method, testData);
      const responseTime = Date.now() - startTime;
      
      console.log(`✅ Method ${method} works - Response time: ${responseTime}ms`);
      return { 
        success: true, 
        workingAction: method,
        responseTime: responseTime
      };
      
    } catch (error: any) {
      console.log(`❌ Method ${method} failed:`, error.message);
      
      // Hemen diğer metodlara geçmek yerine analiz et
      if (error.message.includes('timeout')) {
        return { 
          success: false, 
          error: `Connection timeout to Param service. Check network connectivity to: ${this.baseUrl}` 
        };
      }
      
      continue;
    }
  }

  return { 
    success: false, 
    error: 'All connection tests failed. Check Param service availability and credentials.' 
  };
}

  async saveCreditCard(cardData: SaveCardData): Promise<SaveCardResult> {
    try {
      console.log('💳 Saving credit card to Param...');

      const soapRequestData = {
        G: this.getAuthObject(),
        GUID: this.guid,
        KK_Sahibi: cardData.KK_Sahibi,
        KK_No: cardData.KK_No.replace(/\s/g, ''),
        KK_SK_Ay: cardData.KK_SK_Ay.padStart(2, '0'),
        KK_SK_Yil: cardData.KK_SK_Yil.length === 4 ? 
                   cardData.KK_SK_Yil.slice(-2) : cardData.KK_SK_Yil,
        KK_Kart_Adi: cardData.KK_Kart_Adi
      };

      console.log('📤 Sending TP_KK_Sakla request...');
      const result = await this.makeSoapRequest('TP_KK_Sakla', soapRequestData);

      console.log('📥 TP_KK_Sakla Response:', result);

      if (result && (result.Sonuc === '1' || result.Sonuc === 1)) {
        return {
          success: true,
          KS_GUID: result.KS_GUID,
          Sonuc: result.Sonuc,
          Sonuc_Str: result.Sonuc_Str
        };
      } else {
        return {
          success: false,
          error: result?.Sonuc_Str || result?.Sonuc_Aciklama || 'Kart kaydedilemedi',
          Sonuc: result?.Sonuc,
          Sonuc_Str: result?.Sonuc_Str
        };
      }

    } catch (error: any) {
      console.error('❌ Card saving error:', error);
      return {
        success: false,
        error: 'Kart kaydetme hatası: ' + error.message
      };
    }
  }

  async paymentWithSavedCard(paymentData: PaymentWithSavedCardData): Promise<any> {
    try {
      console.log('💳 Processing payment with saved card...');

      const hashData = this.clientCode + this.guid + paymentData.Taksit +
        paymentData.Islem_Tutar.replace(',', '.') +
        paymentData.Toplam_Tutar.replace(',', '.') +
        paymentData.Siparis_ID +
        paymentData.Hata_URL +
        paymentData.Basarili_URL;

      const Islem_Hash = crypto.createHash('sha256').update(hashData, 'utf8').digest('base64');

      console.log('✅ Saved card payment hash generated');

      const soapRequestData = {
        G: this.getAuthObject(),
        GUID: this.guid,
        KS_GUID: paymentData.KS_GUID,
        KK_CVC: paymentData.CVV,
        KK_Sahibi_GSM: paymentData.KK_Sahibi_GSM,
        Hata_URL: paymentData.Hata_URL,
        Basarili_URL: paymentData.Basarili_URL,
        Siparis_ID: paymentData.Siparis_ID,
        Siparis_Aciklama: paymentData.Siparis_Aciklama,
        Taksit: paymentData.Taksit,
        Islem_Tutar: paymentData.Islem_Tutar,
        Toplam_Tutar: paymentData.Toplam_Tutar,
        Islem_Hash: Islem_Hash,
        Islem_Guvenlik_Tip: paymentData.Islem_Guvenlik_Tip || 'NS',
        IPAdr: paymentData.IPAdr,
        Ref_URL: paymentData.Ref_URL
      };

      console.log('📤 Sending TP_KK_Odeme request...');
      const result = await this.makeSoapRequest('TP_KK_Odeme', soapRequestData);

      console.log('📥 TP_KK_Odeme Response:', result);

      return result;

    } catch (error: any) {
      console.error('❌ Saved card payment error:', error);
      throw new Error('Kayıtlı kart ile ödeme başarısız: ' + error.message);
    }
  }

  async deleteSavedCard(KS_GUID: string): Promise<{success: boolean; error?: string}> {
    try {
      console.log('🗑️ Deleting saved card...');

      const soapRequestData = {
        G: this.getAuthObject(),
        GUID: this.guid,
        KS_GUID: KS_GUID
      };

      console.log('📤 Sending TP_KK_Sil request...');
      const result = await this.makeSoapRequest('TP_KK_Sil', soapRequestData);

      console.log('📥 TP_KK_Sil Response:', result);

      if (result && (result.Sonuc === '1' || result.Sonuc === 1)) {
        return { success: true };
      } else {
        return {
          success: false,
          error: result?.Sonuc_Str || result?.Sonuc_Aciklama || 'Kart silinemedi'
        };
      }

    } catch (error: any) {
      console.error('❌ Card deletion error:', error);
      return {
        success: false,
        error: 'Kart silme hatası: ' + error.message
      };
    }
  }

  async getSavedCards(): Promise<any> {
    try {
      console.log('📋 Getting saved cards list...');

      const soapRequestData = {
        G: this.getAuthObject(),
        GUID: this.guid
      };

      console.log('📤 Sending TP_KK_Liste request...');
      const result = await this.makeSoapRequest('TP_KK_Liste', soapRequestData);

      console.log('📥 TP_KK_Liste Response:', result);

      return result;

    } catch (error: any) {
      console.error('❌ Get saved cards error:', error);
      throw new Error('Kayıtlı kartlar getirilemedi: ' + error.message);
    }
  }
}

export function createParamAuth(): ParamAuth {
  const developmentMode = process.env.PARAM_DEVELOPMENT_MODE === 'true';

  console.log(`[Param Init] Mode: ${developmentMode ? 'TEST' : 'PRODUCTION'}`);

  let baseUrl: string;
  let clientCode: string | undefined;
  let clientUsername: string | undefined;
  let clientPassword: string | undefined;
  let terminalNo: string | undefined;
  let guid: string | undefined;

  if (developmentMode) {
    baseUrl = process.env.PARAM_BASE_URL || 
      'https://test-dmz.param.com.tr:4443/turkpos.ws/service_turkpos_test.asmx';
    
    clientCode = process.env.PARAM_CLIENT_CODE;
    clientUsername = process.env.PARAM_CLIENT_USERNAME;
    clientPassword = process.env.PARAM_CLIENT_PASSWORD;
    terminalNo = process.env.PARAM_TERMINAL_NO;
    guid = process.env.PARAM_GUID;
    
    console.log('[Param Init] Using TEST credentials:');
    console.log(`  - Base URL: ${baseUrl}`);
    console.log(`  - Client Code: ${clientCode}`);
    console.log(`  - Terminal No: ${terminalNo}`);
  } else {
    baseUrl = process.env.PARAM_PROD_BASE_URL || 
      'https://posweb.param.com.tr/turkpos.ws/service_turkpos_prod.asmx';
    
    clientCode = process.env.PARAM_PROD_CLIENT_CODE;
    clientUsername = process.env.PARAM_PROD_CLIENT_USERNAME;
    clientPassword = process.env.PARAM_PROD_CLIENT_PASSWORD;
    terminalNo = process.env.PARAM_PROD_TERMINAL_NO;
    guid = process.env.PARAM_PROD_GUID;
    
    console.log('[Param Init] Using PRODUCTION credentials:');
    console.log(`  - Base URL: ${baseUrl}`);
    console.log(`  - Client Code: ${clientCode}`);
    console.log(`  - Terminal No: ${terminalNo}`);
  }

  const config: ParamAuthConfig = {
    clientCode: clientCode!,
    clientUsername: clientUsername!,
    clientPassword: clientPassword!,
    terminalNo: terminalNo!,
    guid: guid!,
    baseUrl: baseUrl
  };

  const missingVars: string[] = [];
  if (!config.clientCode) missingVars.push('PARAM_CLIENT_CODE / PARAM_PROD_CLIENT_CODE');
  if (!config.clientUsername) missingVars.push('PARAM_CLIENT_USERNAME / PARAM_PROD_CLIENT_USERNAME');
  if (!config.clientPassword) missingVars.push('PARAM_CLIENT_PASSWORD / PARAM_PROD_CLIENT_PASSWORD');
  if (!config.terminalNo) missingVars.push('PARAM_TERMINAL_NO / PARAM_PROD_TERMINAL_NO');
  if (!config.guid) missingVars.push('PARAM_GUID / PARAM_PROD_GUID');
  if (!config.baseUrl) missingVars.push('PARAM_BASE_URL / PARAM_PROD_BASE_URL');

  if (missingVars.length > 0) {
    const mode = developmentMode ? 'TEST' : 'PRODUCTION';
    throw new Error(
      `[Param Init] Missing ${mode} configuration variables:\n` +
      missingVars.map(v => `  - ${v}`).join('\n')
    );
  }

  console.log('[Param Init] Configuration validated successfully');
  return new ParamAuth(config);
}

export { ParamAuth };
export type { 
  ParamPaymentData, 
  ParamAuthConfig,
  SaveCardData,
  SaveCardResult,
  PaymentWithSavedCardData 
};