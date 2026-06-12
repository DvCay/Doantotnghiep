#include <WiFi.h>
#include <Wire.h>
#include "MAX30105.h"
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// --- THÊM TỪ KHÓA ĐỂ SỬ DỤNG FIREBASE (FIRESTORE) ---
#include <Firebase_ESP_Client.h>
#include <addons/TokenHelper.h>

// ==========================================
// 1. CẤU HÌNH WIFI & FIREBASE
// ==========================================
const char* WIFI_SSID = "Dvc";
const char* WIFI_PASS = "99999999";

// -- CẤU HÌNH FIREBASE --
#define API_KEY "AIzaSyCWTsHAgfhBJVDE-tOAjnjelPtiKKZFRhM"
#define PROJECT_ID "du-lieu-cb"

#define WIFI_BOOT_TIMEOUT 6000 
#define RECONNECT_INTERVAL 2000 
#define FIREBASE_INIT_DELAY 1000

// ==========================================
// 2. CẤU HÌNH CHÂN & THÔNG SỐ
// ==========================================
#define ONE_WIRE_BUS 4
#define BUTTON_PIN 2     
#define BUZZER_PIN 26   
#define LED_RED    12    
#define LED_GREEN  33    

#define SERIAL_BAUD 115200      
#define ADC_MAX     262143.0f   
#define VREF        3.3f        

// ==========================================
// 3. CẤU HÌNH THUẬT TOÁN
// ==========================================
#define SAMPLE_RATE 100     
#define BUFFER_SIZE 100     
#define HR_WINDOW 50        
#define FINGER_THRESHOLD 50000 
#define FIREBASE_SEND_INTERVAL 250
#define TEMP_READ_INTERVAL 1000
#define TEMP_CONVERSION_DELAY 120
#define BUTTON_DEBOUNCE_MS 50
#define BUTTON_ACTION_GUARD_MS 350
#define MIN_PEAK_INTERVAL_MS 300
#define BEEP_DURATION_MS 60
#define VALID_BPM_MIN 40
#define VALID_BPM_MAX 200

// ==========================================
// 4. KHỞI TẠO ĐỐI TƯỢNG
// ==========================================
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_ADDR 0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

MAX30105 particleSensor;

// --- KHỞI TẠO ĐỐI TƯỢNG FIREBASE & MULTI-CORE ---
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;
TaskHandle_t FirebaseTaskHandle;

// ==========================================
// 5. BIẾN TOÀN CỤC
// ==========================================
uint32_t rawRedBuffer[BUFFER_SIZE];
uint32_t rawIRBuffer[BUFFER_SIZE];
int bufferIndex = 0;

float finalSPO2 = 0;
int finalBPM = 0;
float spo2History[5]; 
int spo2HistIdx = 0;
float bpmHistory[5];
int bpmHistIdx = 0;

float filteredSignal = 0;
float filterBuf[HR_WINDOW];
int filterIdx = 0;
float hp_prev_in = 0, hp_prev_out = 0, lp_prev_out = 0;
float lastSignal = 0, beforeLastSignal = 0;
unsigned long lastPeakTime = 0;
unsigned long beepOffAt = 0;

long irValue = 0;
long redValue = 0;
float temperatureC = 0;
unsigned long lastSend = 0;
bool showWave = false; 
bool lastButtonReading = HIGH;
bool buttonStableState = HIGH;
volatile bool wifiConnected = false; 
volatile bool firebaseReady = false;
unsigned long lastButtonChangeTime = 0;
unsigned long lastButtonActionTime = 0;
unsigned long lastReconnectAttempt = 0;
unsigned long wifiConnectedAt = 0;
unsigned long lastWifiStatusPrint = 0;
unsigned long lastOledFrame = 0;
unsigned long lastFirebaseErrorPrint = 0;
unsigned long lastFirebaseSend = 0;
unsigned long lastTempRequest = 0;
bool tempConversionPending = false;

enum DeviceMode {
  MODE_ONLINE,
  MODE_OFFLINE
};

volatile DeviceMode deviceMode = MODE_OFFLINE;

#define WAVE_WIDTH 128 
#define WAVE_MIN_Y 12           
#define WAVE_MAX_Y 63           
#define WAVE_HEIGHT (WAVE_MAX_Y - WAVE_MIN_Y)
#define WAVE_CENTER (WAVE_MIN_Y + (WAVE_HEIGHT / 2)) 
float currentScale = 80.0;      
float targetScale = 80.0;       
uint8_t waveBuffer[WAVE_WIDTH];
uint8_t waveX = 0;

// Nguyên mẫu hàm
void updateOLED();
void setupWiFiBoot(); 
void handleWiFiReconnection(); 
void handleButton(unsigned long currentMillis);
void setupMAX30102();
void sendDataToFirebase(); 
float bandpassFilter(float input);
void calculateSpO2_Custom(); 
void initFirebase();

// ==========================================
// KẾT NỐI FIREBASE TỐI ƯU
// ==========================================
void initFirebase() {
  if (firebaseReady) return;

  config.api_key = API_KEY;
  // Bỏ qua tạo Token để tốc độ kết nối nhanh nhất (Ẩn danh)
  config.signer.test_mode = true; 

  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  firebaseReady = true;
  Serial.println(F("Firebase initialized"));
}

void stopFirebaseWiFiReconnect() {
  if (firebaseReady) {
    Firebase.reconnectWiFi(false);
    firebaseReady = false;
  }
}

// ==========================================
// HÀM GỬI LÊN FIRESTORE CHIỀU QUA CORE 0
// ==========================================
void sendDataToFirebase() {
  if (deviceMode == MODE_ONLINE && wifiConnected && firebaseReady) { 
    double safeSPO2 = (double)finalSPO2;
    double safeTemp = (double)temperatureC;
    double safeBPM = (double)finalBPM;
    double uptime = (double)millis(); 

    FirebaseJson content;
    content.set("fields/bpm/doubleValue", safeBPM);
    content.set("fields/spo2/doubleValue", safeSPO2);
    content.set("fields/temp/doubleValue", safeTemp);
    content.set("fields/uptime/doubleValue", uptime); 
    
    String documentPath = "realtime_data/esp32_sensor";

    if (deviceMode == MODE_ONLINE && !Firebase.Firestore.patchDocument(&fbdo, PROJECT_ID, "", documentPath.c_str(), content.raw(), "bpm,spo2,temp,uptime")) {
      if (millis() - lastFirebaseErrorPrint > 3000) {
        Serial.print(F("Firebase patch failed: "));
        Serial.println(fbdo.errorReason());
        lastFirebaseErrorPrint = millis();
      }
    }
  }
}

// ==========================================
// TASK CHẠY NGẦM CHO CORE 0 (GỬI LÊN WEB)
// ==========================================
void TaskFirebaseRun(void *pvParameters) {
  for (;;) {
    unsigned long now = millis();

    if (tempConversionPending && now - lastTempRequest >= TEMP_CONVERSION_DELAY) {
      float temp = sensors.getTempCByIndex(0);
      if (temp != DEVICE_DISCONNECTED_C) {
        temperatureC = temp;
      }
      tempConversionPending = false;
    }

    if (!tempConversionPending && now - lastTempRequest >= TEMP_READ_INTERVAL) {
      sensors.requestTemperatures();
      lastTempRequest = now;
      tempConversionPending = true;
    }

    if (deviceMode == MODE_ONLINE && wifiConnected && now - lastFirebaseSend >= FIREBASE_SEND_INTERVAL) {
      sendDataToFirebase();
      lastFirebaseSend = now;
    }

    vTaskDelay(20 / portTICK_PERIOD_MS);
  }
}

// ==========================================
// SETUP
// ==========================================
void setup() {
  Serial.begin(SERIAL_BAUD);
  Wire.begin();
  Wire.setClock(400000); 

  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  lastButtonReading = digitalRead(BUTTON_PIN);
  buttonStableState = lastButtonReading;
  lastButtonChangeTime = millis();
  digitalWrite(LED_RED, LOW); digitalWrite(LED_GREEN, LOW); digitalWrite(BUZZER_PIN, LOW);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println(F("OLED Error")); while (1);
  }

  for(int i=0; i<WAVE_WIDTH; i++) waveBuffer[i] = WAVE_CENTER;
  for(int i=0; i<5; i++) { spo2History[i] = 98.0; bpmHistory[i] = 70.0; }

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  const char* text = "SYSTEM START";
  int16_t textWidth = strlen(text) * 6;   
  int16_t textHeight = 8;
  int16_t x = (128 - textWidth) / 2;
  int16_t y = (64 - textHeight) / 2;

  display.setCursor(x, y);  display.print(text);  display.display();
  delay(1200);

  setupWiFiBoot();
  setupMAX30102();
  sensors.begin();
  sensors.setResolution(9);
  sensors.setWaitForConversion(false);
  sensors.requestTemperatures();
  lastTempRequest = millis();
  tempConversionPending = true;
  
  // TRUYỀN TASK LÊN CORE 0 NGAY TRƯỚC KHI VÀO LOOP
  xTaskCreatePinnedToCore(
    TaskFirebaseRun,   
    "FirebaseTask",    
    10000,             
    NULL,              
    1,                 
    &FirebaseTaskHandle, 
    0);                
}

// ==========================================
// LOOP (CORE 1) - QUÉT NHỊP CHẠY LÊN WINFORM
// ==========================================
void loop() {
  unsigned long currentMillis = millis();
  handleButton(currentMillis);
  handleWiFiReconnection();

  particleSensor.check();

  while (particleSensor.available()) {
    uint32_t rawIR = particleSensor.getIR();
    uint32_t rawRed = particleSensor.getRed();
    particleSensor.nextSample(); 
    handleButton(millis());

    irValue = rawIR;
    redValue = rawRed;
    float Vt = ((float)rawIR / ADC_MAX) * VREF;
    unsigned long nowMicros = micros();

    if (rawIR > FINGER_THRESHOLD) {
        filteredSignal = bandpassFilter((float)rawIR);
        
        filterBuf[filterIdx] = filteredSignal;
        filterIdx = (filterIdx + 1) % HR_WINDOW;
        float sum = 0; for(int i=0; i<HR_WINDOW; i++) sum += filterBuf[i];
        float mean = sum / HR_WINDOW;
        float sumSq = 0; for(int i=0; i<HR_WINDOW; i++) sumSq += pow(filterBuf[i] - mean, 2);
        float stdDev = sqrt(sumSq / HR_WINDOW);
        float threshold = mean + (0.6 * stdDev); 

        if (lastSignal > threshold && lastSignal > beforeLastSignal && lastSignal > filteredSignal) {
            if (currentMillis - lastPeakTime > MIN_PEAK_INTERVAL_MS) { 
                long interval = currentMillis - lastPeakTime;
                lastPeakTime = currentMillis;
                float instantBPM = 60000.0 / interval;
                
                if (instantBPM > VALID_BPM_MIN && instantBPM < VALID_BPM_MAX) {
                    bpmHistory[bpmHistIdx] = instantBPM;
                    bpmHistIdx = (bpmHistIdx + 1) % 5;
                    float bpmSum = 0; for(int i=0; i<5; i++) bpmSum += bpmHistory[i];
                    finalBPM = (int)(bpmSum / 5);
                    
                    digitalWrite(BUZZER_PIN, HIGH); digitalWrite(LED_RED, HIGH);
                    beepOffAt = currentMillis + BEEP_DURATION_MS;
                }
            }
        }
        if (beepOffAt > 0 && currentMillis >= beepOffAt) {
            digitalWrite(BUZZER_PIN, LOW); digitalWrite(LED_RED, LOW);
            beepOffAt = 0;
        }
        beforeLastSignal = lastSignal; lastSignal = filteredSignal;

        rawRedBuffer[bufferIndex] = rawRed;
        rawIRBuffer[bufferIndex] = rawIR;
        bufferIndex++;
        if (bufferIndex >= BUFFER_SIZE) {
            calculateSpO2_Custom(); 
            bufferIndex = 0;
        }
    } else {
        finalBPM = 0; finalSPO2 = 0; filteredSignal = 0;
        hp_prev_in = rawIR; hp_prev_out = 0; lp_prev_out = 0;
        bufferIndex = 0; Vt = 0;
        digitalWrite(BUZZER_PIN, LOW); digitalWrite(LED_RED, LOW);
        beepOffAt = 0;
    }

    float displayVal = filteredSignal; 
    if (abs(displayVal) > 10) {
         targetScale = (abs(displayVal) * 2.5) / (WAVE_HEIGHT / 2.0);
         if (targetScale < 10) targetScale = 10;
    }
    currentScale = 0.9 * currentScale + 0.1 * targetScale;
    int16_t plottedY = WAVE_CENTER - (displayVal / currentScale);
    if (plottedY < WAVE_MIN_Y) plottedY = WAVE_MIN_Y; if (plottedY > WAVE_MAX_Y) plottedY = WAVE_MAX_Y;
    waveBuffer[waveX] = (uint8_t)plottedY; waveX = (waveX + 1) % WAVE_WIDTH;

    // -------------------------------------------------------------
    // CHỦ ĐỘNG GỬI SÓNG CHO WINFORM HIỂN THỊ ĐỒ THỊ
    // Format C#: t_us, IR, Red, Vt, BPM, SpO2
    // -------------------------------------------------------------
    Serial.print(nowMicros);     Serial.print(",");
    Serial.print(rawIR);         Serial.print(",");
    Serial.print(rawRed);        Serial.print(",");
    Serial.print(Vt, 4);         Serial.print(",");
    Serial.print(finalBPM);      Serial.print(",");
    Serial.println(finalSPO2, 2); 
    // -------------------------------------------------------------
  }

  // Refresh OLED 
  if (currentMillis - lastOledFrame > 30) {
      updateOLED();
      lastOledFrame = currentMillis;
  }
  
  if (finalSPO2 >= 95 && finalBPM > 50) digitalWrite(LED_GREEN, HIGH); else digitalWrite(LED_GREEN, LOW);
}

// ==== CÁC HÀM THUẬT TOÁN KÈM OELD ====
void calculateSpO2_Custom() {
    uint32_t minRed = 999999, maxRed = 0;
    uint32_t minIR = 999999, maxIR = 0;
    for (int i = 0; i < BUFFER_SIZE; i++) {
        if (rawRedBuffer[i] < minRed) minRed = rawRedBuffer[i];
        if (rawRedBuffer[i] > maxRed) maxRed = rawRedBuffer[i];
        if (rawIRBuffer[i] < minIR) minIR = rawIRBuffer[i];
        if (rawIRBuffer[i] > maxIR) maxIR = rawIRBuffer[i];
    }
    float acRed = maxRed - minRed; float dcRed = minRed;
    float acIR = maxIR - minIR; float dcIR = minIR;
    
    if (dcRed != 0 && dcIR != 0 && acIR > 0) {
        float R = (acRed / dcRed) / (acIR / dcIR);
        float spo2Calc = -45.060 * R * R + 30.354 * R + 94.845;
        if (spo2Calc > 100) spo2Calc = 100; if (spo2Calc < 0) spo2Calc = 0;
        
        spo2History[spo2HistIdx] = spo2Calc;
        spo2HistIdx = (spo2HistIdx + 1) % 5;
        float sumSpo2 = 0; for(int i=0; i<5; i++) sumSpo2 += spo2History[i];
        finalSPO2 = sumSpo2 / 5.0;
    }
}

float bandpassFilter(float input) {
    float hp_out = 0.95 * (hp_prev_out + input - hp_prev_in);
    hp_prev_in = input; hp_prev_out = hp_out;
    float lp_out = 0.25 * hp_out + 0.75 * lp_prev_out;
    lp_prev_out = lp_out;
    return lp_out;
}

void setupMAX30102() {
  if (!particleSensor.begin(Wire, I2C_SPEED_STANDARD)) {
    Serial.println(F("MAX30102 Error")); while (1);
  }
  particleSensor.setup(30, 1, 2, 100, 411, 4096);
  particleSensor.clearFIFO(); 
}

void setupWiFiBoot() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);

  display.clearDisplay();
  display.setCursor(0, 0);
  display.print(F("Connecting WiFi"));
  display.setCursor(0, 16);
  display.print(F("Please wait..."));
  display.display();

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  lastReconnectAttempt = millis();

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_BOOT_TIMEOUT) {
    delay(200);
  }

  wifiConnected = (WiFi.status() == WL_CONNECTED);

  if (wifiConnected) {
    deviceMode = MODE_ONLINE;
    wifiConnectedAt = millis();
    Serial.println(F("WiFi connected"));
  } else {
    deviceMode = MODE_OFFLINE;
    Serial.println(F("WiFi not connected"));
  }
}

void handleWiFiReconnection() {
  wl_status_t status = WiFi.status();

  if (status == WL_CONNECTED) {
    if (!wifiConnected) {
      Serial.println(F("WiFi reconnected"));
      wifiConnectedAt = millis();
    }
    wifiConnected = true;
    deviceMode = MODE_ONLINE;
    if (!firebaseReady && millis() - wifiConnectedAt >= FIREBASE_INIT_DELAY) {
      lastFirebaseSend = millis();
      initFirebase();
    }
    return;
  }

  if (wifiConnected) {
    wifiConnected = false;
    stopFirebaseWiFiReconnect();
    Serial.println(F("WiFi disconnected"));
  }

  deviceMode = MODE_OFFLINE;

  if (millis() - lastReconnectAttempt > RECONNECT_INTERVAL) {
    if (millis() - lastWifiStatusPrint > 3000) {
      Serial.println(F("WiFi reconnecting"));
      lastWifiStatusPrint = millis();
    }
    WiFi.disconnect(false, false);
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    lastReconnectAttempt = millis();
  }
}

void handleButton(unsigned long currentMillis) {
  bool reading = digitalRead(BUTTON_PIN);

  if (reading != lastButtonReading) {
    lastButtonReading = reading;
    lastButtonChangeTime = currentMillis;
  }

  if (currentMillis - lastButtonChangeTime < BUTTON_DEBOUNCE_MS) {
    return;
  }

  if (currentMillis - lastButtonActionTime < BUTTON_ACTION_GUARD_MS) {
    return;
  }

  if (reading != buttonStableState) {
    buttonStableState = reading;

    if (buttonStableState == LOW) {
      return;
    }

    showWave = !showWave;
    display.clearDisplay();
    display.display();
    lastButtonActionTime = currentMillis;

    return;
  }
}

void updateOLED() {
  display.clearDisplay();

  if (!showWave) {
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);

    display.setCursor(0, 0);
    display.print(F("HR:")); display.print(finalBPM); display.print(F(" bpm"));

    display.setCursor(64, 0);
    display.print(F("SPO2:")); display.print(finalSPO2, 1); display.print(F("%"));

    display.setCursor(0, 20);
    display.print(F("Temp: ")); display.print(temperatureC, 1); display.print(F(" C"));

    display.setCursor(0, 40);
    display.print(wifiConnected ? F("WIFI: ON") : F("WIFI: OFF"));

  } else {
    for (int i = 1; i < WAVE_WIDTH; i++) {
        display.drawLine( i - 1, waveBuffer[(waveX + i - 1) % WAVE_WIDTH], i, waveBuffer[(waveX + i) % WAVE_WIDTH], SSD1306_WHITE);
    }
                                                                          
    display.fillRect(0, 0, 128, 10, SSD1306_BLACK);
    display.setTextSize(1); display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);  display.print(F("HR: ")); display.print(finalBPM); display.print(F(" bpm"));

    int spo2Int = (int)finalSPO2;
    int spo2Digits = (spo2Int >= 100) ? 3 : (spo2Int >= 10) ? 2 : 1;
    int spo2Width = 6 * (6 + spo2Digits + 3); 
    display.setCursor(128 - spo2Width, 0);
    display.print(F("SPO2: ")); display.print(finalSPO2, 1); display.print(F("%"));
  }
  display.display();
}
