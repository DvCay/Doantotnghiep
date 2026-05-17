#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <Wire.h>
#include "MAX30105.h"
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ==========================================
// 1. CẤU HÌNH WIFI
// ==========================================
const char* ssid = "Dvc";
const char* password = "99999999";
#define WIFI_BOOT_TIMEOUT 7000 
#define RECONNECT_INTERVAL 10000 

// ==========================================
// 2. CẤU HÌNH CHÂN & THÔNG SỐ
// ==========================================
#define ONE_WIRE_BUS 4
#define BUTTON_PIN 2     
#define BUZZER_PIN 26   
#define LED_RED    12    
#define LED_GREEN  33    

#define SERIAL_BAUD 115200      
#define ADC_MAX     262143.0f   // 18-bit ADC
#define VREF        3.3f        // 3.3V Logic

// ==========================================
// 3. CẤU HÌNH THUẬT TOÁN
// ==========================================
#define SAMPLE_RATE 100     // 100Hz
#define BUFFER_SIZE 100     // Cửa sổ tính SpO2
#define HR_WINDOW 50        // Cửa sổ thống kê HR
#define FINGER_THRESHOLD 50000 

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
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// ==========================================
// 5. BIẾN TOÀN CỤC
// ==========================================
// --- SpO2 Buffers ---
uint32_t rawRedBuffer[BUFFER_SIZE];
uint32_t rawIRBuffer[BUFFER_SIZE];
int bufferIndex = 0;

// --- Kết quả đo (Global) ---
float finalSPO2 = 0;
int finalBPM = 0;
float spo2History[5]; 
int spo2HistIdx = 0;
float bpmHistory[5];
int bpmHistIdx = 0;

// --- Biến thuật toán HR ---
float filteredSignal = 0;
float filterBuf[HR_WINDOW];
int filterIdx = 0;
float hp_prev_in = 0, hp_prev_out = 0, lp_prev_out = 0;
float lastSignal = 0, beforeLastSignal = 0;
unsigned long lastPeakTime = 0;

// --- Biến hệ thống ---
long irValue = 0;
long redValue = 0;
float temperatureC = 0;
unsigned long lastSend = 0;
bool showWave = false; 
bool lastButtonState = HIGH;
bool wifiConnected = false; 
unsigned long lastReconnectAttempt = 0;
unsigned long lastOledFrame = 0;

// --- Biến vẽ sóng OLED ---
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
void setupMAX30102();
void sendDataToWeb();
float bandpassFilter(float input);
void calculateSpO2_Custom(); 

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
  digitalWrite(LED_RED, LOW); digitalWrite(LED_GREEN, LOW); digitalWrite(BUZZER_PIN, LOW);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println(F("OLED Error")); while (1);
  }

  // Init buffers
  for(int i=0; i<WAVE_WIDTH; i++) waveBuffer[i] = WAVE_CENTER;
  for(int i=0; i<5; i++) { spo2History[i] = 98.0; bpmHistory[i] = 70.0; }

display.clearDisplay();
display.setTextSize(1);
display.setTextColor(SSD1306_WHITE);

const char* text = "SYSTEM START";
int16_t textWidth = strlen(text) * 6;   // size 1 → 6px/ký tự
int16_t textHeight = 8;

int16_t x = (128 - textWidth) / 2;
int16_t y = (64 - textHeight) / 2;

display.setCursor(x, y);
display.print(text);
display.display();
delay(100);


  
  setupWiFiBoot();
  setupMAX30102();
  sensors.begin();

  ws.onEvent([](AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len) {});
  server.addHandler(&ws);
  server.begin(); 
}

// ==========================================
// LOOP
// ==========================================
void loop() {
  ws.cleanupClients();
  unsigned long currentMillis = millis();
  handleWiFiReconnection();

  // Nút bấm
  bool btn = digitalRead(BUTTON_PIN);
  if (lastButtonState == HIGH && btn == LOW) {
    showWave = !showWave;
    display.clearDisplay(); display.display(); delay(250); 
  }
  lastButtonState = btn;

  // --- QUAN TRỌNG: Đọc và Xử lý ---
  particleSensor.check();

  while (particleSensor.available()) {
    uint32_t rawIR = particleSensor.getIR();
    uint32_t rawRed = particleSensor.getRed();
    particleSensor.nextSample(); 

    irValue = rawIR;
    redValue = rawRed;
    
    // Tính toán Vt (Điện áp tương tự)
    float Vt = ((float)rawIR / ADC_MAX) * VREF;
    unsigned long nowMicros = micros();

    // --- THUẬT TOÁN XỬ LÝ (Trên ESP32) ---
    if (rawIR > FINGER_THRESHOLD) {
        // 1. Lọc tín hiệu
        filteredSignal = bandpassFilter((float)rawIR);
        
        // 2. Tính ngưỡng động
        filterBuf[filterIdx] = filteredSignal;
        filterIdx = (filterIdx + 1) % HR_WINDOW;
        float sum = 0; for(int i=0; i<HR_WINDOW; i++) sum += filterBuf[i];
        float mean = sum / HR_WINDOW;
        float sumSq = 0; for(int i=0; i<HR_WINDOW; i++) sumSq += pow(filterBuf[i] - mean, 2);
        float stdDev = sqrt(sumSq / HR_WINDOW);
        float threshold = mean + (0.6 * stdDev); 

        // 3. Phát hiện đỉnh tim (BPM)
        bool isPeak = false;
        if (lastSignal > threshold && lastSignal > beforeLastSignal && lastSignal > filteredSignal) {
            if (currentMillis - lastPeakTime > 300) { 
                isPeak = true;
                long interval = currentMillis - lastPeakTime;
                lastPeakTime = currentMillis;
                float instantBPM = 60000.0 / interval;
                
                if (instantBPM > 40 && instantBPM < 200) {
                    bpmHistory[bpmHistIdx] = instantBPM;
                    bpmHistIdx = (bpmHistIdx + 1) % 5;
                    float bpmSum = 0; for(int i=0; i<5; i++) bpmSum += bpmHistory[i];
                    finalBPM = (int)(bpmSum / 5);
                    
                    // Hiệu ứng Bíp/Led
                    digitalWrite(BUZZER_PIN, HIGH); digitalWrite(LED_RED, HIGH);
                }
            }
        }
        if (!isPeak && currentMillis - lastPeakTime > 50) {
            digitalWrite(BUZZER_PIN, LOW); digitalWrite(LED_RED, LOW);
        }
        beforeLastSignal = lastSignal; lastSignal = filteredSignal;

        // 4. Tính SpO2 (Accumulate Buffer)
        rawRedBuffer[bufferIndex] = rawRed;
        rawIRBuffer[bufferIndex] = rawIR;
        bufferIndex++;
        if (bufferIndex >= BUFFER_SIZE) {
            calculateSpO2_Custom(); 
            bufferIndex = 0;
        }
    } else {
        // Reset khi rút tay
        finalBPM = 0; finalSPO2 = 0; filteredSignal = 0;
        hp_prev_in = rawIR; hp_prev_out = 0; lp_prev_out = 0;
        bufferIndex = 0; Vt = 0;
        digitalWrite(BUZZER_PIN, LOW); digitalWrite(LED_RED, LOW);
    }

    // =================================================================
    // [QUAN TRỌNG] GỬI SERIAL DATA CHO WINFORM (Định dạng CSV MỚI)
    // Cấu trúc: t_us, IR, Red, Vt, BPM, SpO2
    // =================================================================
    Serial.print(nowMicros);
    Serial.print(",");
    Serial.print(rawIR);
    Serial.print(",");
    Serial.print(rawRed);
    Serial.print(",");
    Serial.print(Vt, 4);      // Gửi Vt để Winform vẽ sóng
    Serial.print(",");
    Serial.print(finalBPM);   // Gửi BPM đã tính
    Serial.print(",");
    Serial.println(finalSPO2, 1); // Gửi SpO2 đã tính

    // --- Cập nhật sóng OLED (Auto Zoom) ---
    float displayVal = filteredSignal; 
    if (abs(displayVal) > 10) {
         targetScale = (abs(displayVal) * 2.5) / (WAVE_HEIGHT / 2.0);
         if (targetScale < 10) targetScale = 10;
    }
    currentScale = 0.9 * currentScale + 0.1 * targetScale;
    int16_t plottedY = WAVE_CENTER - (displayVal / currentScale);
    if (plottedY < WAVE_MIN_Y) plottedY = WAVE_MIN_Y; if (plottedY > WAVE_MAX_Y) plottedY = WAVE_MAX_Y;
    waveBuffer[waveX] = (uint8_t)plottedY; waveX = (waveX + 1) % WAVE_WIDTH;
  }

  // --- Tác vụ chạy định kỳ (Web & OLED) ---
  if (currentMillis - lastOledFrame > 30) {
      updateOLED();
      lastOledFrame = currentMillis;
  }
  
  if (currentMillis - lastSend > 500) {
    sensors.requestTemperatures();
    temperatureC = sensors.getTempCByIndex(0);
    sendDataToWeb(); // Gửi Web
    
    // Đèn xanh báo hiệu OK
    if (finalSPO2 >= 95 && finalBPM > 50) digitalWrite(LED_GREEN, HIGH); else digitalWrite(LED_GREEN, LOW);
    lastSend = currentMillis;
  }
}

// ==========================================
// CÁC HÀM XỬ LÝ PHỤ TRỢ
// ==========================================

// Hàm tính SpO2 (Dựa trên tỷ lệ R = AC/DC)
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
  particleSensor.setup(30, 1, 2, 100, 411, 4096); // chỉnh độ sáng đèn led
  particleSensor.clearFIFO(); 
}

void setupWiFiBoot() {
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true); WiFi.begin(ssid, password);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_BOOT_TIMEOUT) delay(500);
  wifiConnected = (WiFi.status() == WL_CONNECTED);
}

void handleWiFiReconnection() {
  if (WiFi.status() != WL_CONNECTED && wifiConnected) wifiConnected = false;
  if (WiFi.status() == WL_CONNECTED && !wifiConnected) wifiConnected = true;
  if (!wifiConnected && millis() - lastReconnectAttempt > RECONNECT_INTERVAL) {
    WiFi.disconnect(); WiFi.reconnect(); lastReconnectAttempt = millis();
  }
}

void sendDataToWeb() {
  String json = "{\"bpm\":" + String(finalBPM) + 
                ",\"spo2\":" + String(finalSPO2, 1) + 
                ",\"temp\":" + String(temperatureC, 1) + 
                ",\"ir\":" + String(irValue) + "}";
  if (wifiConnected) ws.textAll(json);
}

void updateOLED() {
  display.clearDisplay();

  if (!showWave) {
    // ===== CHẾ ĐỘ HIỂN THỊ SỐ =====
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);

    // --- HÀNG 1: HR ---
    display.setCursor(0, 0);
    display.print(F("HR:"));
    display.print(finalBPM);
    display.print(F(" bpm"));

    // --- HÀNG 1: SPO2 ---
    display.setCursor(70, 0);
    display.print(F("SPO2:"));
    display.print(finalSPO2, 0);
    display.print(F("%"));

    // --- HÀNG 2: NHIỆT ĐỘ ---
    display.setCursor(0, 20);
    display.print(F("Temp: "));
    display.print(temperatureC, 1);
    display.print(F(" C"));

    // --- HÀNG 3: WIFI ---
    display.setCursor(0, 40);
    display.print(wifiConnected ? F("WIFI: ON") : F("WIFI: OFF"));

  } else {
    // ===== CHẾ ĐỘ HIỂN THỊ SÓNG PPG =====
    for (int i = 1; i < WAVE_WIDTH; i++) {
      display.drawLine(
        i - 1,
        waveBuffer[(waveX + i - 1) % WAVE_WIDTH],
        i,
        waveBuffer[(waveX + i) % WAVE_WIDTH],
        SSD1306_WHITE
      );
    }
  // ===== THANH THÔNG TIN TRÊN CÙNG =====
display.fillRect(0, 0, 128, 10, SSD1306_BLACK);
display.setTextSize(1);
display.setTextColor(SSD1306_WHITE);

// --- GÓC TRÁI: HR ---
display.setCursor(0, 0);
display.print(F("HR: "));
display.print(finalBPM);
display.print(F(" bpm"));

// --- GÓC PHẢI: SPO2 ---
int spo2 = (int)finalSPO2;
int spo2Digits = (spo2 >= 100) ? 3 : (spo2 >= 10) ? 2 : 1;
int spo2Width = 6 * (6 + spo2Digits + 1); 
// "SPO2: " (6) + số + "%"(1)

display.setCursor(128 - spo2Width, 0);
display.print(F("SPO2: "));
display.print(spo2);
display.print(F("%"));
  }

  display.display();
}
